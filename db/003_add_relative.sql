-- =====================================================================
-- Migration 003 : ajout d'une personne reliee a une autre (enfant, conjoint, parent)
-- A lancer une fois dans Supabase > SQL Editor, apres 002_auth_and_seed.sql
-- =====================================================================

-- Suggestions de saisie : recherche mot par mot (remplace la version de schema.sql)
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
    and (
      p.search_name % q.s
      -- chaque mot saisi doit se retrouver dans le nom, dans n'importe quel ordre
      -- ("lé b" retrouve "Léa Benali", "benali lea" aussi)
      or not exists (
        select 1 from unnest(string_to_array(q.s, ' ')) as w
        where w <> '' and p.search_name not like '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
    )
  order by score desc, p.last_name, p.first_names
  limit p_limit;
$$;

-- Vrai si p_a est un ancetre de p_b (parent, grand-parent, ...). Sert a eviter les cycles.
create or replace function is_ancestor(p_a uuid, p_b uuid)
returns boolean language sql stable set search_path = public as $$
  with recursive anc(id) as (
    select v.pid
    from filiations f
    join unions u on u.id = f.union_id
    cross join lateral (values (u.partner_a), (u.partner_b)) v(pid)
    where f.child_id = p_b and v.pid is not null
    union
    select v.pid
    from anc
    join filiations f on f.child_id = anc.id
    join unions u on u.id = f.union_id
    cross join lateral (values (u.partner_a), (u.partner_b)) v(pid)
    where v.pid is not null
  )
  select exists (select 1 from anc where id = p_a)
$$;

-- Ajoute une personne (nouvelle, ou deja presente dans l'arbre via p_existing) reliee a p_anchor.
--   p_relation = 'child'  : la personne est un enfant de p_anchor (p_other = l'autre parent, facultatif)
--   p_relation = 'spouse' : la personne est le conjoint de p_anchor
--   p_relation = 'parent' : la personne est un parent de p_anchor
-- Tout se fait en une seule transaction. Les regles de securite (RLS) s'appliquent a l'appelant.
create or replace function add_relative(
  p_tree            uuid,
  p_anchor          uuid,
  p_relation        text,
  p_other           uuid default null,
  p_existing        uuid default null,
  p_first           text default null,
  p_last            text default null,
  p_gender          text default null,
  p_birth           date default null,
  p_birth_precision date_precision default null,
  p_death           date default null,
  p_death_precision date_precision default null
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_new   uuid;
  v_union uuid;
  v_fil   record;
  v_order int;
begin
  if p_relation not in ('child', 'spouse', 'parent') then
    raise exception 'Relation inconnue : %', p_relation;
  end if;
  if coalesce(my_role(p_tree)::text, '') not in ('owner', 'editor') then
    raise exception 'Droits insuffisants pour modifier cet arbre';
  end if;
  if not exists (select 1 from persons where id = p_anchor and tree_id = p_tree and deleted_at is null) then
    raise exception 'Personne de depart introuvable dans cet arbre';
  end if;
  if p_other is not null and not exists
     (select 1 from persons where id = p_other and tree_id = p_tree and deleted_at is null) then
    raise exception 'Autre parent introuvable dans cet arbre';
  end if;

  -- La personne : existante (choisie dans les suggestions) ou nouvelle
  if p_existing is not null then
    if not exists (select 1 from persons where id = p_existing and tree_id = p_tree and deleted_at is null) then
      raise exception 'Personne introuvable dans cet arbre';
    end if;
    v_new := p_existing;
  else
    insert into persons (tree_id, first_names, last_name, gender,
                         birth_date, birth_precision, death_date, death_precision,
                         is_living, created_by)
    values (p_tree, nullif(trim(p_first), ''), nullif(trim(p_last), ''), p_gender,
            p_birth, p_birth_precision, p_death, p_death_precision,
            case when p_death is null then null else false end, auth.uid())
    returning id into v_new;
  end if;

  if v_new = p_anchor or v_new = p_other then
    raise exception 'Une personne ne peut pas etre reliee a elle-meme';
  end if;

  if p_relation = 'child' then
    if is_ancestor(v_new, p_anchor) then
      raise exception 'Cette personne est un ancetre : elle ne peut pas devenir un enfant';
    end if;
    if p_other is not null and is_ancestor(v_new, p_other) then
      raise exception 'Cette personne est un ancetre de l''autre parent';
    end if;

    select id into v_union from unions
    where tree_id = p_tree and (
      (p_other is null and partner_a = p_anchor and partner_b is null)
      or (p_other is not null and ((partner_a = p_anchor and partner_b = p_other)
                                or (partner_a = p_other and partner_b = p_anchor)))
    ) limit 1;
    if v_union is null then
      insert into unions (tree_id, partner_a, partner_b) values (p_tree, p_anchor, p_other)
      returning id into v_union;
    end if;

    select coalesce(max(p.sibling_order), -1) + 1 into v_order
    from filiations f join persons p on p.id = f.child_id
    where f.union_id = v_union;

    begin
      insert into filiations (tree_id, child_id, union_id) values (p_tree, v_new, v_union);
    exception when unique_violation then
      raise exception 'Cette personne a deja des parents connus';
    end;
    update persons set sibling_order = v_order where id = v_new and sibling_order is null;

  elsif p_relation = 'spouse' then
    if is_ancestor(v_new, p_anchor) or is_ancestor(p_anchor, v_new) then
      raise exception 'Un parent et son enfant ne peuvent pas etre en couple';
    end if;
    if exists (select 1 from unions where tree_id = p_tree and
               ((partner_a = p_anchor and partner_b = v_new) or (partner_a = v_new and partner_b = p_anchor))) then
      raise exception 'Ce couple existe deja';
    end if;
    insert into unions (tree_id, partner_a, partner_b) values (p_tree, p_anchor, v_new);

  else -- parent
    if is_ancestor(p_anchor, v_new) then
      raise exception 'Cette personne descend de la personne choisie : elle ne peut pas en etre le parent';
    end if;

    select f.id as fid, u.id as uid, u.partner_a, u.partner_b into v_fil
    from filiations f join unions u on u.id = f.union_id
    where f.child_id = p_anchor and f.kind = 'biological' limit 1;

    if not found then
      -- Premier parent connu : on reutilise son union "seul parent connu" si elle existe
      select id into v_union from unions
      where tree_id = p_tree and partner_a = v_new and partner_b is null limit 1;
      if v_union is null then
        insert into unions (tree_id, partner_a, partner_b) values (p_tree, v_new, null)
        returning id into v_union;
      end if;
      insert into filiations (tree_id, child_id, union_id) values (p_tree, p_anchor, v_union);
    else
      if v_fil.partner_b is not null then
        raise exception 'Les deux parents de cette personne sont deja connus';
      end if;
      if v_fil.partner_a = v_new then
        raise exception 'Cette personne est deja un parent';
      end if;
      -- Second parent : si le couple existe deja, on y rattache l'enfant ; sinon on complete l'union
      select id into v_union from unions
      where tree_id = p_tree and ((partner_a = v_fil.partner_a and partner_b = v_new)
                               or (partner_a = v_new and partner_b = v_fil.partner_a)) limit 1;
      if v_union is not null then
        update filiations set union_id = v_union where id = v_fil.fid;
      else
        update unions set partner_b = v_new where id = v_fil.uid;
      end if;
    end if;
  end if;

  return v_new;
end $$;

-- Droits d'appel : utilisateurs connectes seulement (jamais le role anonyme)
revoke execute on function is_ancestor(uuid, uuid) from public, anon;
revoke execute on function add_relative(uuid, uuid, text, uuid, uuid, text, text, text, date, date_precision, date, date_precision) from public, anon;
revoke execute on function suggest_persons(uuid, text, int) from public, anon;
revoke execute on function my_role(uuid) from public, anon;
grant  execute on function is_ancestor(uuid, uuid) to authenticated;
grant  execute on function add_relative(uuid, uuid, text, uuid, uuid, text, text, text, date, date_precision, date, date_precision) to authenticated;
grant  execute on function suggest_persons(uuid, text, int) to authenticated;
grant  execute on function my_role(uuid) to authenticated;
