-- =====================================================================
-- 010 : demandes d'accès à un arbre
-- A lancer une fois dans Supabase (SQL Editor), après 009. Ne casse rien d'existant.
--
-- Chaque arbre a un code ("join_code") que le propriétaire peut partager sous forme de lien.
-- Une personne qui ouvre ce lien se connecte, puis DEMANDE l'accès : elle n'entre pas toute seule.
-- Le propriétaire voit la demande (nom, e-mail, petit message) et l'accepte avec le rôle de son choix
-- ou la refuse. Un lien qui circule trop loin ne donne donc rien à lui seul.
-- Le propriétaire peut changer le code d'un arbre à tout moment : l'ancien lien cesse de marcher.
-- =====================================================================

alter table trees add column if not exists join_code uuid not null default gen_random_uuid();
create unique index if not exists trees_join_code_uniq on trees (join_code);

create table if not exists access_requests (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references trees(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  message    text check (message is null or char_length(message) <= 300),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id) on delete set null
);
create unique index if not exists access_requests_pending_uniq on access_requests (tree_id, user_id) where status = 'pending';
create index if not exists access_requests_tree_idx on access_requests (tree_id, status);

alter table access_requests enable row level security;   -- aucune règle : tout passe par les fonctions ci-dessous
revoke all on access_requests from anon, authenticated;

-- ---------- côté demandeur ----------

-- Ce que voit quelqu'un qui ouvre le lien : le nom de l'arbre, et s'il en est déjà membre / a déjà demandé
create or replace function tree_for_code(p_code uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tree trees%rowtype;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  select * into v_tree from trees where join_code = p_code;
  if v_tree.id is null then raise exception 'Ce lien n''est plus valide.'; end if;
  return jsonb_build_object(
    'id', v_tree.id,
    'name', v_tree.name,
    'member', my_role(v_tree.id) is not null,
    'requested', exists (select 1 from access_requests where tree_id = v_tree.id and user_id = auth.uid() and status = 'pending')
  );
end $$;

create or replace function request_access(p_code uuid, p_message text default null)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_tree uuid;
  v_msg  text := nullif(btrim(coalesce(p_message, '')), '');
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  select id into v_tree from trees where join_code = p_code;
  if v_tree is null then raise exception 'Ce lien n''est plus valide.'; end if;
  if char_length(coalesce(v_msg, '')) > 300 then raise exception 'Message trop long (300 caractères au plus).'; end if;

  insert into profiles (id, display_name)
  select auth.uid(), split_part(coalesce(u.email, 'invité'), '@', 1) from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;

  if my_role(v_tree) is not null then raise exception 'Tu as déjà accès à cet arbre.'; end if;
  if exists (select 1 from access_requests where tree_id = v_tree and user_id = auth.uid()
             and status = 'declined' and decided_at > now() - interval '30 days') then
    raise exception 'Ta précédente demande pour cet arbre a été refusée. Tu pourras en refaire une dans quelques semaines.';
  end if;

  update access_requests set message = v_msg
   where tree_id = v_tree and user_id = auth.uid() and status = 'pending'
   returning id into v_id;
  if v_id is not null then return v_id; end if;

  if (select count(*) from access_requests where user_id = auth.uid() and status = 'pending') >= 5 then
    raise exception 'Tu as déjà 5 demandes en attente. Attends une réponse avant d''en faire d''autres.';
  end if;
  if (select count(*) from access_requests where tree_id = v_tree and status = 'pending') >= 50 then
    raise exception 'Cet arbre a trop de demandes en attente. Préviens son propriétaire.';
  end if;

  insert into access_requests (tree_id, user_id, message) values (v_tree, auth.uid(), v_msg)
  returning id into v_id;
  return v_id;
end $$;

-- Mes demandes en attente : [{id, tree_name, created_at}]
create or replace function my_access_requests()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'tree_name', t.name, 'created_at', r.created_at) order by r.created_at desc)
    from access_requests r join trees t on t.id = r.tree_id
    where r.user_id = auth.uid() and r.status = 'pending'
  ), '[]'::jsonb);
end $$;

-- ---------- côté propriétaire ----------

create or replace function get_join_code(p_tree uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then raise exception 'Action refusée.'; end if;
  select join_code into v from trees where id = p_tree;
  return v;
end $$;

create or replace function regenerate_join_code(p_tree uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := gen_random_uuid();
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then raise exception 'Action refusée.'; end if;
  update trees set join_code = v where id = p_tree;
  return v;
end $$;

create or replace function pending_requests_count(p_tree uuid)
returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then return 0; end if;
  return (select count(*)::int from access_requests where tree_id = p_tree and status = 'pending');
end $$;

create or replace function list_access_requests(p_tree uuid)
returns table (id uuid, user_id uuid, display_name text, email text, message text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then raise exception 'Action refusée.'; end if;
  return query
    select r.id, r.user_id, p.display_name, u.email::text, r.message, r.created_at
    from access_requests r
    join profiles p on p.id = r.user_id
    left join auth.users u on u.id = r.user_id
    where r.tree_id = p_tree and r.status = 'pending'
    order by r.created_at;
end $$;

create or replace function answer_access_request(p_request uuid, p_accept boolean, p_role tree_role default 'viewer')
returns void
language plpgsql security definer set search_path = public as $$
declare r access_requests%rowtype;
begin
  select * into r from access_requests where id = p_request and status = 'pending';
  if r.id is null then raise exception 'Cette demande n''existe plus.'; end if;
  if auth.uid() is null or my_role(r.tree_id) is distinct from 'owner' then raise exception 'Action refusée.'; end if;
  if p_accept then
    if p_role = 'owner' then raise exception 'On ne peut pas donner le rôle de propriétaire.'; end if;
    insert into memberships (tree_id, user_id, role) values (r.tree_id, r.user_id, p_role)
    on conflict (tree_id, user_id) do nothing;
  end if;
  update access_requests
     set status = case when p_accept then 'approved' else 'declined' end, decided_at = now(), decided_by = auth.uid()
   where id = p_request;
end $$;

-- ---------- droits d'appel ----------
revoke execute on function tree_for_code(uuid)                              from public, anon;
revoke execute on function request_access(uuid, text)                       from public, anon;
revoke execute on function my_access_requests()                             from public, anon;
revoke execute on function get_join_code(uuid)                              from public, anon;
revoke execute on function regenerate_join_code(uuid)                       from public, anon;
revoke execute on function pending_requests_count(uuid)                     from public, anon;
revoke execute on function list_access_requests(uuid)                       from public, anon;
revoke execute on function answer_access_request(uuid, boolean, tree_role)  from public, anon;
grant execute on function tree_for_code(uuid)                               to authenticated;
grant execute on function request_access(uuid, text)                        to authenticated;
grant execute on function my_access_requests()                              to authenticated;
grant execute on function get_join_code(uuid)                               to authenticated;
grant execute on function regenerate_join_code(uuid)                        to authenticated;
grant execute on function pending_requests_count(uuid)                      to authenticated;
grant execute on function list_access_requests(uuid)                        to authenticated;
grant execute on function answer_access_request(uuid, boolean, tree_role)   to authenticated;
