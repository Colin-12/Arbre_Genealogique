-- =====================================================================
-- Migration 014 : rattacher des enfants au couple formé avec un conjoint
-- A lancer une fois dans Supabase > SQL Editor, apres 013_delete_tree.sql
-- =====================================================================

-- Des enfants qui n'ont qu'un seul parent connu (p_parent) deviennent aussi
-- les enfants de p_other : ils sont deplaces de l'union "p_parent seul" vers
-- l'union du couple (creee si besoin). Retourne le nombre d'enfants deplaces.
-- Les regles de securite (RLS) s'appliquent a l'appelant (proprietaire ou editeur).
create or replace function link_children_to_couple(
  p_tree     uuid,
  p_parent   uuid,
  p_other    uuid,
  p_children uuid[]
) returns int
language plpgsql set search_path = public as $$
declare
  v_single uuid;
  v_couple uuid;
  v_child  uuid;
  v_moved  int := 0;
begin
  if coalesce(my_role(p_tree)::text, '') not in ('owner', 'editor') then
    raise exception 'Droits insuffisants pour modifier cet arbre';
  end if;
  if p_parent is null or p_other is null or p_parent = p_other then
    raise exception 'Parents invalides';
  end if;
  if (select count(*) from persons
      where tree_id = p_tree and deleted_at is null and id in (p_parent, p_other)) <> 2 then
    raise exception 'Parent introuvable dans cet arbre';
  end if;
  if p_children is null or coalesce(array_length(p_children, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_children, 1) > 50 then
    raise exception 'Trop d''enfants a la fois';
  end if;

  select id into v_single from unions
  where tree_id = p_tree and partner_a = p_parent and partner_b is null limit 1;
  if v_single is null then
    raise exception 'Cette personne n''a pas d''enfant avec un seul parent connu';
  end if;

  select id into v_couple from unions
  where tree_id = p_tree
    and ((partner_a = p_parent and partner_b = p_other) or (partner_a = p_other and partner_b = p_parent))
  limit 1;
  if v_couple is null then
    insert into unions (tree_id, partner_a, partner_b) values (p_tree, p_parent, p_other)
    returning id into v_couple;
  end if;

  for v_child in select distinct unnest(p_children) loop
    if v_child = p_other or v_child = p_parent then
      raise exception 'Une personne ne peut pas etre son propre parent';
    end if;
    if is_ancestor(v_child, p_other) then
      raise exception 'Cette personne est un ancetre du conjoint : elle ne peut pas devenir son enfant';
    end if;
    update filiations set union_id = v_couple
    where tree_id = p_tree and child_id = v_child and union_id = v_single;
    if not found then
      raise exception 'Un des enfants n''a pas cette personne comme seul parent connu';
    end if;
    v_moved := v_moved + 1;
  end loop;

  -- L'union "seul parent" devenue vide n'a plus de raison d'exister
  delete from unions u
  where u.id = v_single and u.partner_b is null
    and not exists (select 1 from filiations f where f.union_id = u.id);

  return v_moved;
end $$;

revoke execute on function link_children_to_couple(uuid, uuid, uuid, uuid[]) from public, anon;
grant  execute on function link_children_to_couple(uuid, uuid, uuid, uuid[]) to authenticated;
