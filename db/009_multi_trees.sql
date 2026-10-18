-- =====================================================================
-- 009 : plusieurs arbres par personne, création d'arbre, limites, inscription ouverte
-- A lancer une fois dans Supabase (SQL Editor), après 008. Ne casse rien d'existant.
--
-- - create_tree      : crée un arbre (et ses premières personnes), avec détection de doublon
-- - my_trees         : les arbres de la personne connectée, le plus récemment rejoint d'abord
-- - limites          : 3 arbres par personne (profiles.max_trees), 500 personnes par arbre
--                      (trees.max_persons), 200 photos par nouvel arbre (trees.photo_limit).
--                      Les arbres existants gardent leurs valeurs ; chaque limite se change en base.
-- - app_settings     : réglage "signup_open" (true = n'importe qui peut créer un compte).
--                      Pour refermer les inscriptions en cas d'abus :
--                        update app_settings set value = 'false' where key = 'signup_open';
-- =====================================================================

alter table profiles add column if not exists max_trees int not null default 3 check (max_trees >= 0);
alter table trees    add column if not exists max_persons int not null default 500 check (max_persons >= 0);
alter table trees    alter column photo_limit set default 200;

-- ---------- réglages de l'application ----------
create table if not exists app_settings (
  key   text primary key,
  value text not null
);
alter table app_settings enable row level security;  -- aucune règle : seules les fonctions ci-dessous la lisent
revoke all on app_settings from anon, authenticated;
insert into app_settings (key, value) values ('signup_open', 'true') on conflict (key) do nothing;

-- ---------- inscriptions : ouvertes par défaut, refermables ----------
create or replace function check_signup_allowed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Inscriptions ouvertes : tout le monde peut créer un compte (l'accès aux arbres reste sur invitation)
  if coalesce((select value from app_settings where key = 'signup_open'), 'true') = 'true' then
    return new;
  end if;

  -- Inscriptions fermées : installation neuve, adresse invitée, ou lien de partage valide
  if not exists (select 1 from profiles) then return new; end if;

  if new.email is not null and exists (
    select 1 from invitations
    where lower(email) = lower(new.email) and status = 'pending' and expires_at > now()
  ) then
    return new;
  end if;

  if new.raw_user_meta_data ? 'join_token'
     and (new.raw_user_meta_data->>'join_token') ~ '^[0-9a-fA-F-]{36}$' then
    if exists (
      select 1 from share_links
      where token = (new.raw_user_meta_data->>'join_token')::uuid
        and revoked_at is null and (expires_at is null or expires_at > now())
    ) then
      return new;
    end if;
  end if;

  raise exception 'SIGNUP_NOT_INVITED';
end $$;

-- ---------- taille maximale d'un arbre ----------
create or replace function enforce_max_persons()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from persons where tree_id = new.tree_id and deleted_at is null)
     >= (select max_persons from trees where id = new.tree_id) then
    raise exception 'Cet arbre a atteint sa taille maximale (% personnes).', (select max_persons from trees where id = new.tree_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_max_persons on persons;
create trigger trg_max_persons before insert on persons
for each row execute function enforce_max_persons();

-- ---------- mes arbres ----------
-- [{id, name, role, joined_at}], du plus récemment rejoint au plus ancien
create or replace function my_trees()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', m.role, 'joined_at', m.created_at)
                     order by m.created_at desc)
    from memberships m join trees t on t.id = m.tree_id
    where m.user_id = auth.uid()
  ), '[]'::jsonb);
end $$;

-- ---------- création d'un arbre ----------
-- p_people : [{"first_names":"Joseph","last_name":"Martin","gender":"M","birth_year":1928},
--             {"first_names":"Marie","last_name":"Le Gall","gender":"F","relation":"spouse"}, ...] (1 à 5 personnes)
--   La première personne est le point de départ ; chacune des suivantes indique son lien avec elle dans
--   "relation" : spouse (conjoint), parent (père ou mère, 2 au plus) ou child (enfant).
-- Si un arbre d'une autre famille contient déjà ces personnes, refuse avec "SIMILAR_TREE" (sauf p_force).
create or replace function create_tree(p_name text, p_people jsonb, p_force boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_user   uuid := auth.uid();
  v_tree   uuid;
  v_n      int;
  p        jsonb;
  v_ids    uuid[] := '{}';
  v_id     uuid;
  v_union  uuid;
  v_idx    int;
  v_kids   int := 0;
  v_first  text;
  v_last   text;
  v_gender text;
  v_year   int;
begin
  if v_user is null then raise exception 'Connexion requise'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Donne un nom à l''arbre (100 caractères au plus).';
  end if;
  if jsonb_typeof(p_people) is distinct from 'array' or jsonb_array_length(p_people) not between 1 and 5 then
    raise exception 'Indique 1 à 5 personnes pour commencer l''arbre.';
  end if;
  if (select count(*) from memberships where user_id = v_user and role = 'owner')
     >= (select max_trees from profiles where id = v_user) then
    raise exception 'Tu as déjà atteint le nombre maximal d''arbres que tu peux créer (%).', (select max_trees from profiles where id = v_user);
  end if;

  -- Validation des personnes
  v_n := 0;
  for p in select * from jsonb_array_elements(p_people) loop
    v_first  := nullif(btrim(coalesce(p->>'first_names', '')), '');
    v_last   := nullif(btrim(coalesce(p->>'last_name', '')), '');
    v_gender := p->>'gender';
    if v_first is null and v_last is null then
      raise exception 'Chaque personne a besoin d''un prénom ou d''un nom.';
    end if;
    if v_gender is null or v_gender not in ('M', 'F') then
      raise exception 'Indique si chaque personne est un homme ou une femme.';
    end if;
    if v_n > 0 and coalesce(p->>'relation', '') not in ('spouse', 'parent', 'child') then
      raise exception 'Indique le lien de chaque personne avec la première.';
    end if;
    if nullif(p->>'birth_year', '') is not null then
      begin
        v_year := (p->>'birth_year')::int;
      exception when others then
        raise exception 'Année de naissance invalide.';
      end;
      if v_year < 1000 or v_year > extract(year from current_date)::int then
        raise exception 'Année de naissance invalide.';
      end if;
    end if;
    v_n := v_n + 1;
  end loop;

  -- Détection de doublon : un autre arbre (dont on n'est pas membre) qui contient au moins
  -- min(2, nombre de personnes données) de ces personnes (même nom, et même année si elle est connue des deux).
  if not coalesce(p_force, false) then
    if exists (
      select pe.tree_id
      from jsonb_array_elements(p_people) with ordinality q(j, ord)
      join persons pe
        on pe.deleted_at is null
       and pe.search_name = lower(f_unaccent(coalesce(q.j->>'first_names', '') || ' ' || coalesce(q.j->>'last_name', '')))
       and (nullif(q.j->>'birth_year', '') is null
            or pe.birth_date is null
            or extract(year from pe.birth_date)::int = (q.j->>'birth_year')::int)
      where pe.tree_id not in (select tree_id from memberships where user_id = v_user)
      group by pe.tree_id
      having count(distinct q.ord) >= least(2, v_n)
    ) then
      raise exception 'SIMILAR_TREE';
    end if;
  end if;

  insert into trees (name, created_by) values (v_name, v_user) returning id into v_tree;  -- le trigger ajoute le propriétaire

  -- Personnes
  for p in select * from jsonb_array_elements(p_people) loop
    insert into persons (tree_id, first_names, last_name, gender, birth_date, birth_precision, created_by)
    values (v_tree,
            nullif(btrim(coalesce(p->>'first_names', '')), ''),
            nullif(btrim(coalesce(p->>'last_name', '')), ''),
            p->>'gender',
            case when nullif(p->>'birth_year', '') is not null then make_date((p->>'birth_year')::int, 1, 1) end,
            case when nullif(p->>'birth_year', '') is not null then 'year'::date_precision end,
            v_user)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Liens avec la première personne : conjoints d'abord, puis parents, puis enfants
  for v_idx in 2 .. v_n loop
    if p_people->(v_idx - 1)->>'relation' = 'spouse' then
      select id into v_union from unions where tree_id = v_tree and partner_a = v_ids[1] and partner_b is null limit 1;
      if v_union is null then
        insert into unions (tree_id, partner_a, partner_b) values (v_tree, v_ids[1], v_ids[v_idx]);
      else
        update unions set partner_b = v_ids[v_idx] where id = v_union;
      end if;
    end if;
  end loop;

  for v_idx in 2 .. v_n loop
    if p_people->(v_idx - 1)->>'relation' = 'parent' then
      select f.union_id into v_union from filiations f where f.child_id = v_ids[1] limit 1;
      if v_union is null then
        insert into unions (tree_id, partner_a, partner_b) values (v_tree, v_ids[v_idx], null) returning id into v_union;
        insert into filiations (tree_id, child_id, union_id) values (v_tree, v_ids[1], v_union);
      elsif exists (select 1 from unions where id = v_union and partner_b is null) then
        update unions set partner_b = v_ids[v_idx] where id = v_union;
      else
        raise exception 'Une personne ne peut avoir que deux parents.';
      end if;
    end if;
  end loop;

  for v_idx in 2 .. v_n loop
    if p_people->(v_idx - 1)->>'relation' = 'child' then
      select id into v_union from unions
      where tree_id = v_tree and (partner_a = v_ids[1] or partner_b = v_ids[1])
      order by (partner_b is null) limit 1;
      if v_union is null then
        insert into unions (tree_id, partner_a, partner_b) values (v_tree, v_ids[1], null) returning id into v_union;
      end if;
      insert into filiations (tree_id, child_id, union_id) values (v_tree, v_ids[v_idx], v_union);
      v_kids := v_kids + 1;
      update persons set sibling_order = v_kids where id = v_ids[v_idx];
    end if;
  end loop;

  return v_tree;
end $$;

-- ---------- droits d'appel ----------
revoke execute on function check_signup_allowed()              from public, anon, authenticated;
revoke execute on function enforce_max_persons()               from public, anon, authenticated;
revoke execute on function my_trees()                          from public, anon;
revoke execute on function create_tree(text, jsonb, boolean)   from public, anon;
grant execute on function my_trees()                           to authenticated;
grant execute on function create_tree(text, jsonb, boolean)    to authenticated;
