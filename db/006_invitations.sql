-- =====================================================================
-- 006 : invitations, liens de partage, gestion des membres
-- A lancer une fois dans Supabase (SQL Editor), apres 002 a 005.
--
-- Principe : seul le proprietaire d'un arbre invite. Une personne invitee
-- se connecte avec l'adresse invitee (ou ouvre un lien de partage) et
-- rejoint l'arbre avec le role prevu. Les inscriptions restent FERMEES de fait :
-- un trigger refuse la creation de compte pour une adresse non invitee.
-- =====================================================================

-- ---------- 1. Lecture : seul le proprietaire voit les invitations et liens ----------
drop policy if exists invitations_owner_read on invitations;
drop policy if exists share_links_owner_read on share_links;
create policy invitations_owner_read on invitations for select using (my_role(tree_id) = 'owner');
create policy share_links_owner_read on share_links for select using (my_role(tree_id) = 'owner');
-- Aucune politique d'ecriture : tout passe par les fonctions ci-dessous.

-- Une seule invitation en attente par adresse et par arbre
create unique index if not exists invitations_pending_uniq on invitations (tree_id, lower(email)) where status = 'pending';

-- ---------- 2. Inviter ----------
create or replace function create_invitation(p_tree uuid, p_email text, p_role tree_role)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text := lower(trim(p_email));
  v_id    uuid;
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then
    raise exception 'Seul le propriétaire de l''arbre peut inviter.';
  end if;
  if p_role = 'owner' then
    raise exception 'On ne peut pas inviter quelqu''un comme propriétaire.';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Adresse e-mail invalide.';
  end if;
  if exists (
    select 1 from memberships m join auth.users u on u.id = m.user_id
    where m.tree_id = p_tree and lower(u.email) = v_email
  ) then
    raise exception 'Cette personne a déjà accès à l''arbre.';
  end if;

  update invitations
     set role = p_role, expires_at = now() + interval '30 days', invited_by = auth.uid()
   where tree_id = p_tree and lower(email) = v_email and status = 'pending'
   returning id into v_id;

  if v_id is null then
    insert into invitations (tree_id, email, role, invited_by, expires_at)
    values (p_tree, v_email, p_role, auth.uid(), now() + interval '30 days')
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_tree uuid;
begin
  select tree_id into v_tree from invitations where id = p_invitation;
  if v_tree is null or my_role(v_tree) is distinct from 'owner' then
    raise exception 'Action refusée.';
  end if;
  update invitations set status = 'revoked' where id = p_invitation and status = 'pending';
end $$;

-- ---------- 3. Liens de partage ----------
create or replace function create_share_link(p_tree uuid, p_role tree_role)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then
    raise exception 'Seul le propriétaire de l''arbre peut créer un lien.';
  end if;
  if p_role = 'owner' then
    raise exception 'Un lien ne peut pas donner le rôle de propriétaire.';
  end if;
  insert into share_links (tree_id, role, created_by, expires_at)
  values (p_tree, p_role, auth.uid(), now() + interval '30 days')
  returning token into v_token;
  return v_token;
end $$;

create or replace function revoke_share_link(p_link uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_tree uuid;
begin
  select tree_id into v_tree from share_links where id = p_link;
  if v_tree is null or my_role(v_tree) is distinct from 'owner' then
    raise exception 'Action refusée.';
  end if;
  update share_links set revoked_at = now() where id = p_link and revoked_at is null;
end $$;

-- ---------- 4. Rejoindre un arbre ----------
-- Appelee a chaque connexion : accepte les invitations en attente pour l'adresse du compte connecte.
create or replace function accept_my_invitations()
returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  r       record;
  v_n     int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;

  insert into profiles (id, display_name)
  values (auth.uid(), split_part(v_email, '@', 1))
  on conflict (id) do nothing;

  update invitations set status = 'expired' where status = 'pending' and expires_at <= now();

  for r in
    select * from invitations where lower(email) = v_email and status = 'pending' and expires_at > now()
  loop
    insert into memberships (tree_id, user_id, role) values (r.tree_id, auth.uid(), r.role)
    on conflict (tree_id, user_id) do update set role = excluded.role where excluded.role < memberships.role;
    update invitations set status = 'accepted' where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Rejoindre avec un lien de partage. Retourne l'arbre rejoint.
create or replace function join_with_link(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  l record;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  select * into l from share_links
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if l.id is null then
    raise exception 'Ce lien d''invitation n''est plus valide.';
  end if;

  insert into profiles (id, display_name)
  select auth.uid(), split_part(coalesce(u.email, 'invité'), '@', 1) from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;

  insert into memberships (tree_id, user_id, role) values (l.tree_id, auth.uid(), l.role)
  on conflict (tree_id, user_id) do update set role = excluded.role where excluded.role < memberships.role;
  return l.tree_id;
end $$;

-- ---------- 5. Gerer les membres (proprietaire) ----------
create or replace function list_members(p_tree uuid)
returns table (user_id uuid, display_name text, email text, role tree_role, joined_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then
    raise exception 'Action refusée.';
  end if;
  return query
    select m.user_id, p.display_name, u.email::text, m.role, m.created_at
    from memberships m
    join profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.tree_id = p_tree
    order by (m.role = 'owner') desc, m.created_at;
end $$;

create or replace function change_member_role(p_tree uuid, p_user uuid, p_role tree_role)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then
    raise exception 'Action refusée.';
  end if;
  if p_role = 'owner' then raise exception 'Le rôle de propriétaire ne peut pas être donné ici.'; end if;
  if exists (select 1 from memberships where tree_id = p_tree and user_id = p_user and role = 'owner') then
    raise exception 'Le rôle du propriétaire ne peut pas être modifié.';
  end if;
  update memberships set role = p_role where tree_id = p_tree and user_id = p_user;
  if not found then raise exception 'Cette personne n''est pas membre de l''arbre.'; end if;
end $$;

create or replace function remove_member(p_tree uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then
    raise exception 'Action refusée.';
  end if;
  if exists (select 1 from memberships where tree_id = p_tree and user_id = p_user and role = 'owner') then
    raise exception 'Le propriétaire ne peut pas être retiré.';
  end if;
  delete from memberships where tree_id = p_tree and user_id = p_user;
  if not found then raise exception 'Cette personne n''est pas membre de l''arbre.'; end if;
end $$;

-- Un membre (non proprietaire) peut quitter l'arbre
create or replace function leave_tree(p_tree uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Action refusée.'; end if;
  if my_role(p_tree) = 'owner' then raise exception 'Le propriétaire ne peut pas quitter son arbre.'; end if;
  delete from memberships where tree_id = p_tree and user_id = auth.uid();
end $$;

-- ---------- 6. Inscriptions : seules les adresses invitees peuvent creer un compte ----------
-- Dans Supabase, "Allow new users to sign up" doit etre ACTIVE : c'est ce trigger qui ferme la porte.
create or replace function check_signup_allowed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Installation neuve (aucun compte) : le premier compte est toujours autorise
  if not exists (select 1 from profiles) then return new; end if;

  if new.email is not null and exists (
    select 1 from invitations
    where lower(email) = lower(new.email) and status = 'pending' and expires_at > now()
  ) then
    return new;
  end if;

  -- Lien de partage valide (le jeton est transmis a la connexion).
  -- Deux "if" imbriques : on ne convertit en uuid qu'un texte qui en a bien la forme.
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

drop trigger if exists before_user_created on auth.users;
create trigger before_user_created
before insert on auth.users
for each row execute function check_signup_allowed();

-- ---------- 7. Droits d'execution ----------
revoke execute on function check_signup_allowed() from public, anon, authenticated;
revoke execute on function create_invitation(uuid, text, tree_role) from public, anon;
revoke execute on function revoke_invitation(uuid)                  from public, anon;
revoke execute on function create_share_link(uuid, tree_role)       from public, anon;
revoke execute on function revoke_share_link(uuid)                  from public, anon;
revoke execute on function accept_my_invitations()                  from public, anon;
revoke execute on function join_with_link(uuid)                     from public, anon;
revoke execute on function list_members(uuid)                       from public, anon;
revoke execute on function change_member_role(uuid, uuid, tree_role) from public, anon;
revoke execute on function remove_member(uuid, uuid)                from public, anon;
revoke execute on function leave_tree(uuid)                         from public, anon;
grant execute on function create_invitation(uuid, text, tree_role) to authenticated;
grant execute on function revoke_invitation(uuid)                  to authenticated;
grant execute on function create_share_link(uuid, tree_role)       to authenticated;
grant execute on function revoke_share_link(uuid)                  to authenticated;
grant execute on function accept_my_invitations()                  to authenticated;
grant execute on function join_with_link(uuid)                     to authenticated;
grant execute on function list_members(uuid)                       to authenticated;
grant execute on function change_member_role(uuid, uuid, tree_role) to authenticated;
grant execute on function remove_member(uuid, uuid)                to authenticated;
grant execute on function leave_tree(uuid)                         to authenticated;
