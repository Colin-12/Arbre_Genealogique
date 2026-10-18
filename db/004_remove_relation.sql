-- =====================================================================
-- Migration 004 : retirer un lien familial (corriger un mauvais emplacement)
-- A lancer une fois dans Supabase > SQL Editor, apres 003_add_relative.sql
-- =====================================================================

-- Retire un lien sans supprimer de personne :
--   p_kind = 'parent' : detache p_person de son parent p_other
--                       (si l'autre parent est connu, l'enfant reste rattache a lui seul)
--   p_kind = 'spouse' : retire le couple p_person + p_other (refuse s'il a des enfants)
-- Les regles de securite (RLS) s'appliquent a l'appelant.
create or replace function remove_relation(
  p_tree   uuid,
  p_person uuid,
  p_kind   text,
  p_other  uuid
) returns void
language plpgsql set search_path = public as $$
declare
  v_fil       record;
  v_union     uuid;
  v_remaining uuid;
  v_children  int;
begin
  if p_kind not in ('parent', 'spouse') then
    raise exception 'Type de lien inconnu : %', p_kind;
  end if;
  if coalesce(my_role(p_tree)::text, '') not in ('owner', 'editor') then
    raise exception 'Droits insuffisants pour modifier cet arbre';
  end if;

  if p_kind = 'parent' then
    select f.id as fid, u.id as uid, u.partner_a, u.partner_b into v_fil
    from filiations f join unions u on u.id = f.union_id
    where f.tree_id = p_tree and f.child_id = p_person
      and (u.partner_a = p_other or u.partner_b = p_other)
    limit 1;
    if not found then
      raise exception 'Ce lien de parente n''existe pas';
    end if;

    if v_fil.partner_b is null then
      -- Seul parent connu : l'enfant n'a plus de parent
      delete from filiations where id = v_fil.fid;
      delete from unions u
      where u.id = v_fil.uid and u.partner_b is null
        and not exists (select 1 from filiations f where f.union_id = u.id);
    else
      -- Deux parents connus : l'enfant reste rattache a l'autre, seul
      v_remaining := case when v_fil.partner_a = p_other then v_fil.partner_b else v_fil.partner_a end;
      select id into v_union from unions
      where tree_id = p_tree and partner_a = v_remaining and partner_b is null limit 1;
      if v_union is null then
        insert into unions (tree_id, partner_a, partner_b) values (p_tree, v_remaining, null)
        returning id into v_union;
      end if;
      update filiations set union_id = v_union where id = v_fil.fid;
    end if;

  else -- spouse
    select id into v_union from unions
    where tree_id = p_tree
      and ((partner_a = p_person and partner_b = p_other) or (partner_a = p_other and partner_b = p_person))
    limit 1;
    if v_union is null then
      raise exception 'Ce couple n''existe pas';
    end if;
    select count(*) into v_children from filiations where union_id = v_union;
    if v_children > 0 then
      raise exception 'Ce couple a % enfant(s) : detache-les d''abord de leurs parents', v_children;
    end if;
    delete from unions where id = v_union;
  end if;
end $$;

revoke execute on function remove_relation(uuid, uuid, text, uuid) from public, anon;
grant  execute on function remove_relation(uuid, uuid, text, uuid) to authenticated;
