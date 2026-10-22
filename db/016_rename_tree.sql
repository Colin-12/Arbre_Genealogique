-- =====================================================================
-- Migration 016 : renommer un arbre (propriétaire seulement)
-- A lancer une fois dans Supabase > SQL Editor, apres 015_tutorial.sql
-- =====================================================================

create or replace function rename_tree(p_tree uuid, p_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then
    raise exception 'Seul le propriétaire peut renommer cet arbre.';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Le nom de l''arbre doit faire entre 1 et 100 caractères.';
  end if;
  update trees set name = v_name where id = p_tree;
  return v_name;
end $$;

revoke execute on function rename_tree(uuid, text) from public, anon;
grant  execute on function rename_tree(uuid, text) to authenticated;
