-- =====================================================================
-- 008 : galerie de photos (légendes, personnes identifiées, plafond par arbre)
-- A lancer une fois dans Supabase (SQL Editor), après 005 et 006. Ne casse rien d'existant.
--
-- - photos        : une ligne par photo (fichier dans le bucket "photos", sous <arbre>/gallery/)
-- - photo_people  : qui est sur la photo (la photo apparait dans la galerie de ces personnes ;
--                   au moins une personne par photo, sinon elle serait introuvable)
-- - trees.photo_limit : nombre maximum de photos de galerie par arbre (1000 par défaut)
-- - droits : tous les membres voient, propriétaires et éditeurs ajoutent / identifient /
--   suppriment, les commentateurs peuvent en plus écrire les légendes
-- - toutes les écritures passent par les fonctions ci-dessous (aucun droit d'écriture direct)
-- =====================================================================

alter table trees add column if not exists photo_limit int not null default 1000 check (photo_limit >= 0);

create table if not exists photos (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references trees(id) on delete cascade,
  path        text not null unique,
  caption     text check (caption is null or char_length(caption) <= 500),
  uploaded_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (path like tree_id::text || '/gallery/%')
);
create index if not exists photos_tree_idx on photos (tree_id, created_at desc);

create table if not exists photo_people (
  photo_id  uuid not null references photos(id) on delete cascade,
  person_id uuid not null references persons(id) on delete cascade,
  primary key (photo_id, person_id)
);
create index if not exists photo_people_person_idx on photo_people (person_id);

alter table photos       enable row level security;
alter table photo_people enable row level security;

drop policy if exists photos_member_read on photos;
create policy photos_member_read on photos for select to authenticated
  using (my_role(tree_id) is not null);

drop policy if exists photo_people_member_read on photo_people;
create policy photo_people_member_read on photo_people for select to authenticated
  using (exists (select 1 from photos p where p.id = photo_id and my_role(p.tree_id) is not null));

revoke insert, update, delete on photos, photo_people from authenticated, anon;

-- ---------- lecture ----------

-- Photos où une personne est identifiée : [{id, path, caption, created_at, people: [uuid...]}], plus récentes d'abord
create or replace function person_gallery(p_person uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tree uuid;
begin
  select tree_id into v_tree from persons where id = p_person;
  if v_tree is null or my_role(v_tree) is null then
    raise exception 'Accès refusé';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', ph.id, 'path', ph.path, 'caption', ph.caption, 'created_at', ph.created_at,
             'people', coalesce((select jsonb_agg(pp2.person_id) from photo_people pp2 where pp2.photo_id = ph.id), '[]'::jsonb)
           ) order by ph.created_at desc)
    from photos ph
    join photo_people pp on pp.photo_id = ph.id and pp.person_id = p_person
  ), '[]'::jsonb);
end $$;

-- Nombre de photos utilisées et plafond de l'arbre : {used, max}
create or replace function gallery_quota(p_tree uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if my_role(p_tree) is null then raise exception 'Accès refusé'; end if;
  return jsonb_build_object(
    'used', (select count(*) from photos where tree_id = p_tree),
    'max',  (select photo_limit from trees where id = p_tree)
  );
end $$;

-- ---------- écriture ----------

-- Vérifie que toutes les personnes appartiennent à l'arbre
create or replace function _check_people_in_tree(p_tree uuid, p_people uuid[])
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (
    select 1 from unnest(coalesce(p_people, '{}')) x(id)
    where not exists (select 1 from persons pe where pe.id = x.id and pe.tree_id = p_tree)
  ) then
    raise exception 'Une des personnes n''appartient pas à cet arbre.';
  end if;
end $$;

-- Enregistre une photo déjà envoyée dans le stockage (le fichier doit etre sous <arbre>/gallery/)
create or replace function add_photo(p_tree uuid, p_path text, p_caption text, p_people uuid[])
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  if my_role(p_tree) not in ('owner', 'editor') then
    raise exception 'Tu n''as pas le droit d''ajouter des photos à cet arbre.';
  end if;
  if p_path is null or p_path not like p_tree::text || '/gallery/%' then
    raise exception 'Chemin de photo invalide.';
  end if;
  if (select count(*) from photos where tree_id = p_tree) >= (select photo_limit from trees where id = p_tree) then
    raise exception 'Le plafond de photos de cet arbre est atteint.';
  end if;
  if coalesce(cardinality(p_people), 0) = 0 then
    raise exception 'Une photo doit montrer au moins une personne.';
  end if;
  perform _check_people_in_tree(p_tree, p_people);

  insert into photos (tree_id, path, caption, uploaded_by) values (p_tree, p_path, v_caption, auth.uid())
  returning id into v_id;
  insert into photo_people (photo_id, person_id)
  select v_id, x from unnest(coalesce(p_people, '{}')) x on conflict do nothing;
  return v_id;
end $$;

-- Remplace la liste des personnes identifiées sur une photo
create or replace function set_photo_people(p_photo uuid, p_people uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_tree uuid;
begin
  select tree_id into v_tree from photos where id = p_photo;
  if v_tree is null then raise exception 'Photo introuvable.'; end if;
  if my_role(v_tree) not in ('owner', 'editor') then
    raise exception 'Tu n''as pas le droit de modifier les photos de cet arbre.';
  end if;
  if coalesce(cardinality(p_people), 0) = 0 then
    raise exception 'Une photo doit rester associée à au moins une personne (sinon supprime-la).';
  end if;
  perform _check_people_in_tree(v_tree, p_people);
  delete from photo_people where photo_id = p_photo and person_id <> all (coalesce(p_people, '{}'));
  insert into photo_people (photo_id, person_id)
  select p_photo, x from unnest(coalesce(p_people, '{}')) x on conflict do nothing;
end $$;

-- Légende : propriétaires, éditeurs et commentateurs
create or replace function set_photo_caption(p_photo uuid, p_caption text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_tree uuid;
begin
  select tree_id into v_tree from photos where id = p_photo;
  if v_tree is null then raise exception 'Photo introuvable.'; end if;
  if my_role(v_tree) not in ('owner', 'editor', 'commenter') then
    raise exception 'Tu n''as pas le droit d''écrire une légende dans cet arbre.';
  end if;
  update photos set caption = nullif(btrim(coalesce(p_caption, '')), '') where id = p_photo;
end $$;

-- Supprime la photo (toutes les galeries) et renvoie le chemin du fichier à effacer du stockage
create or replace function delete_photo(p_photo uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_tree uuid; v_path text;
begin
  select tree_id, path into v_tree, v_path from photos where id = p_photo;
  if v_tree is null then raise exception 'Photo introuvable.'; end if;
  if my_role(v_tree) not in ('owner', 'editor') then
    raise exception 'Tu n''as pas le droit de supprimer les photos de cet arbre.';
  end if;
  delete from photos where id = p_photo;
  return v_path;
end $$;

-- ---------- droits d'appel ----------
revoke execute on function person_gallery(uuid)                       from public, anon;
revoke execute on function gallery_quota(uuid)                        from public, anon;
revoke execute on function _check_people_in_tree(uuid, uuid[])        from public, anon, authenticated;
revoke execute on function add_photo(uuid, text, text, uuid[])        from public, anon;
revoke execute on function set_photo_people(uuid, uuid[])             from public, anon;
revoke execute on function set_photo_caption(uuid, text)              from public, anon;
revoke execute on function delete_photo(uuid)                         from public, anon;
grant execute on function person_gallery(uuid)                        to authenticated;
grant execute on function gallery_quota(uuid)                         to authenticated;
grant execute on function add_photo(uuid, text, text, uuid[])         to authenticated;
grant execute on function set_photo_people(uuid, uuid[])              to authenticated;
grant execute on function set_photo_caption(uuid, text)               to authenticated;
grant execute on function delete_photo(uuid)                          to authenticated;
