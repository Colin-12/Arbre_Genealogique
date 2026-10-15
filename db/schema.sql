-- =====================================================================
-- Arbre : schéma PostgreSQL (pensé pour Supabase, adaptable)
-- Étapes de la feuille de route : 2 (données), 3 (saisie), 4 (collaboration)
-- =====================================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() n'est pas "immutable" : on l'enveloppe pour pouvoir l'indexer.
-- Sur Supabase, l'extension peut vivre dans le schéma "extensions" :
-- adapter alors le nom qualifié ci-dessous.
create or replace function f_unaccent(text)
returns text
language sql immutable parallel safe strict
as $$ select public.unaccent('public.unaccent', $1) $$;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type tree_role         as enum ('owner', 'editor', 'commenter', 'viewer');
create type date_precision    as enum ('day', 'month', 'year', 'about');
create type filiation_kind    as enum ('biological', 'adopted', 'step', 'foster');
create type union_kind        as enum ('marriage', 'partnership', 'other');
create type invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

-- ---------------------------------------------------------------------
-- Utilisateurs (sur Supabase : lié à auth.users)
-- ---------------------------------------------------------------------
create table profiles (
  id           uuid primary key,  -- = auth.users.id sur Supabase
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Arbres (projets) et membres
-- ---------------------------------------------------------------------
create table trees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

create table memberships (
  tree_id    uuid not null references trees(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       tree_role not null,
  created_at timestamptz not null default now(),
  primary key (tree_id, user_id)
);

-- Le créateur d'un arbre en devient automatiquement propriétaire.
create or replace function add_creator_as_owner()
returns trigger language plpgsql security definer as $$
begin
  insert into memberships (tree_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end $$;

create trigger trg_tree_owner
after insert on trees
for each row execute function add_creator_as_owner();

-- Invitations par email
create table invitations (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references trees(id) on delete cascade,
  email      text not null,
  role       tree_role not null check (role <> 'owner'),
  token      uuid not null default gen_random_uuid(),
  status     invitation_status not null default 'pending',
  invited_by uuid not null references profiles(id),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create index on invitations (tree_id);
create index on invitations (lower(email));

-- Liens de partage (rôle limité, révocable, expirable)
create table share_links (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references trees(id) on delete cascade,
  role       tree_role not null check (role <> 'owner'),
  token      uuid not null unique default gen_random_uuid(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Personnes
-- ---------------------------------------------------------------------
create table persons (
  id               uuid primary key default gen_random_uuid(),  -- identifiant stable
  tree_id          uuid not null references trees(id) on delete cascade,

  first_names      text,
  last_name        text,
  birth_last_name  text,           -- nom de naissance si différent
  gender           text check (gender in ('M', 'F', 'X')),

  birth_date       date,           -- date de référence (1er janv. si seule l'année est connue)
  birth_precision  date_precision,
  birth_place      text,
  death_date       date,
  death_precision  date_precision,
  death_place      text,
  is_living        boolean,        -- null = inconnu

  notes            text,
  sibling_order    int,            -- ordre manuel, repli quand les dates manquent

  -- Colonne de recherche : minuscules, sans accents
  search_name      text generated always as (
                     lower(f_unaccent(coalesce(first_names, '') || ' ' || coalesce(last_name, '')))
                   ) stored,

  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,    -- suppression douce

  check (first_names is not null or last_name is not null),
  check (death_date is null or birth_date is null or death_date >= birth_date),
  unique (id, tree_id)             -- permet les clés étrangères composites ci-dessous
);
create index persons_tree_idx   on persons (tree_id);
create index persons_search_idx on persons using gin (search_name gin_trgm_ops);

-- Couples (unions). partner_b peut être inconnu.
create table unions (
  id              uuid primary key default gen_random_uuid(),
  tree_id         uuid not null references trees(id) on delete cascade,
  partner_a       uuid not null,
  partner_b       uuid,
  kind            union_kind not null default 'marriage',
  start_date      date,
  start_precision date_precision,
  end_date        date,
  end_precision   date_precision,
  notes           text,
  created_at      timestamptz not null default now(),
  foreign key (partner_a, tree_id) references persons (id, tree_id) on delete cascade,
  foreign key (partner_b, tree_id) references persons (id, tree_id) on delete cascade,
  check (partner_b is null or partner_a <> partner_b),
  unique (id, tree_id)
);
create index on unions (tree_id);
create index on unions (partner_a);
create index on unions (partner_b);

-- Filiation : un enfant est rattaché à une union (donc à ses deux parents,
-- ou à un seul si l'autre est inconnu).
create table filiations (
  id        uuid primary key default gen_random_uuid(),
  tree_id   uuid not null references trees(id) on delete cascade,
  child_id  uuid not null,
  union_id  uuid not null,
  kind      filiation_kind not null default 'biological',
  foreign key (child_id, tree_id) references persons (id, tree_id) on delete cascade,
  foreign key (union_id, tree_id) references unions (id, tree_id) on delete cascade,
  unique (child_id, union_id)
);
-- Un seul lien biologique par enfant
create unique index filiations_one_biological
  on filiations (child_id) where kind = 'biological';
create index on filiations (tree_id);
create index on filiations (union_id);

-- ---------------------------------------------------------------------
-- Vue : âge calculé
-- (approximatif d'un an près quand la précision est "year" ou "about")
-- ---------------------------------------------------------------------
create view persons_with_age with (security_invoker = true) as
select
  p.*,
  case
    when p.birth_date is null then null
    when p.birth_precision in ('year', 'about') then
      extract(year from coalesce(p.death_date, current_date))::int
      - extract(year from p.birth_date)::int
    else
      date_part('year', age(coalesce(p.death_date, current_date), p.birth_date))::int
  end as age_years,
  (p.death_date is not null or p.is_living = false) as is_deceased
from persons p
where p.deleted_at is null;

-- ---------------------------------------------------------------------
-- Suggestions pendant la saisie (anti-doublons)
-- ---------------------------------------------------------------------
create or replace function suggest_persons(p_tree uuid, p_query text, p_limit int default 8)
returns table (
  id uuid, first_names text, last_name text,
  birth_date date, birth_precision date_precision, score real
)
language sql stable as $$
  with q as (select lower(f_unaccent(trim(p_query))) as s)
  select p.id, p.first_names, p.last_name, p.birth_date, p.birth_precision,
         similarity(p.search_name, q.s) as score
  from persons p, q
  where p.tree_id = p_tree
    and p.deleted_at is null
    and length(q.s) >= 2
    and (p.search_name % q.s or p.search_name like '%' || q.s || '%')
  order by score desc, p.last_name, p.first_names
  limit p_limit;
$$;
-- Pour afficher le contexte dans la liste ("née en 1932, fille de Paul et Jeanne"),
-- joindre ensuite filiations, unions et persons côté application.

-- ---------------------------------------------------------------------
-- Historique des modifications
-- ---------------------------------------------------------------------
create table audit_log (
  id         bigserial primary key,
  tree_id    uuid not null,
  user_id    uuid,
  table_name text not null,
  row_id     uuid not null,
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data   jsonb,
  new_data   jsonb,
  at         timestamptz not null default now()
);
create index on audit_log (tree_id, at desc);

create or replace function log_change()
returns trigger language plpgsql security definer as $$
declare
  r record := coalesce(new, old);
begin
  insert into audit_log (tree_id, user_id, table_name, row_id, action, old_data, new_data)
  values (
    r.tree_id,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,  -- Supabase
    tg_table_name,
    r.id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_persons    after insert or update or delete on persons    for each row execute function log_change();
create trigger audit_unions     after insert or update or delete on unions     for each row execute function log_change();
create trigger audit_filiations after insert or update or delete on filiations for each row execute function log_change();

-- Mise à jour automatique de updated_at
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_persons_touch
before update on persons
for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Droits (row level security), version Supabase : à tester avant usage réel
-- ---------------------------------------------------------------------
create or replace function my_role(p_tree uuid)
returns tree_role
language sql stable security definer set search_path = public as $$
  select role from memberships where tree_id = p_tree and user_id = auth.uid()
$$;

alter table trees       enable row level security;
alter table memberships enable row level security;
alter table persons     enable row level security;
alter table unions      enable row level security;
alter table filiations  enable row level security;

-- Arbres : visibles par leurs membres, modifiables par le propriétaire
create policy trees_read   on trees for select using (my_role(id) is not null);
create policy trees_insert on trees for insert with check (created_by = auth.uid());
create policy trees_update on trees for update using (my_role(id) = 'owner');
create policy trees_delete on trees for delete using (my_role(id) = 'owner');

-- Membres : visibles par les membres, gérés par le propriétaire
create policy members_read   on memberships for select using (my_role(tree_id) is not null);
create policy members_manage on memberships for all
  using (my_role(tree_id) = 'owner') with check (my_role(tree_id) = 'owner');

-- Personnes, unions, filiations : lecture pour tous les membres,
-- écriture pour owner et editor
create policy persons_read  on persons for select using (my_role(tree_id) is not null);
create policy persons_write on persons for all
  using (my_role(tree_id) in ('owner', 'editor'))
  with check (my_role(tree_id) in ('owner', 'editor'));

create policy unions_read  on unions for select using (my_role(tree_id) is not null);
create policy unions_write on unions for all
  using (my_role(tree_id) in ('owner', 'editor'))
  with check (my_role(tree_id) in ('owner', 'editor'));

create policy filiations_read  on filiations for select using (my_role(tree_id) is not null);
create policy filiations_write on filiations for all
  using (my_role(tree_id) in ('owner', 'editor'))
  with check (my_role(tree_id) in ('owner', 'editor'));

-- À prévoir : politiques pour invitations et share_links (propriétaire),
-- acceptation d'invitation et accès par lien (fonctions dédiées),
-- masquage des champs sensibles des personnes vivantes pour les lecteurs.

-- ---------------------------------------------------------------------
-- Étape 6 (plus tard) : arbres communicants
-- ---------------------------------------------------------------------
-- create table person_links (
--   id          uuid primary key default gen_random_uuid(),
--   person_a    uuid not null references persons(id) on delete cascade,
--   person_b    uuid not null references persons(id) on delete cascade,
--   score       real,
--   status      text not null default 'proposed'
--               check (status in ('proposed', 'accepted_a', 'accepted_b', 'linked', 'rejected', 'revoked')),
--   created_at  timestamptz not null default now(),
--   check (person_a <> person_b)
-- );
-- Principe : jamais de fusion, seulement un lien réversible accepté par
-- les propriétaires des deux arbres. Chaque arbre garde ses données.
