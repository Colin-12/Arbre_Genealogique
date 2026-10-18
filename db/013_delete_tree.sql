-- =====================================================================
-- 013 : supprimer un arbre (propriétaire). Quitter un arbre existe déjà (leave_tree, migration 006).
-- A lancer une fois dans Supabase (SQL Editor), après 012. Ne casse rien d'existant.
--
-- - tree_summary    : ce que contient un arbre (personnes, photos, membres), pour avertir avant de supprimer
-- - tree_file_paths : tous les fichiers de l'arbre dans le stockage (l'appli les efface AVANT de supprimer l'arbre,
--                     tant que le propriétaire a encore le droit de le faire)
-- - delete_tree     : supprime l'arbre et tout ce qu'il contient, pour tout le monde. Il faut redonner le nom exact
--                     de l'arbre. C'est définitif.
-- =====================================================================

-- {persons, photos, members} ; propriétaire seulement
create or replace function tree_summary(p_tree uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then raise exception 'Action refusée.'; end if;
  return jsonb_build_object(
    'persons', (select count(*) from persons where tree_id = p_tree and deleted_at is null),
    'photos',  (select count(*) from photos where tree_id = p_tree),
    'members', (select count(*) from memberships where tree_id = p_tree)
  );
end $$;

-- Chemins de tous les fichiers de l'arbre (photos de profil, galerie, anciennes versions) ; propriétaire seulement
create or replace function tree_file_paths(p_tree uuid)
returns text[]
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then raise exception 'Action refusée.'; end if;
  return coalesce((
    select array_agg(o.name order by o.name)
    from storage.objects o
    where o.bucket_id = 'photos' and o.name like p_tree::text || '/%'
  ), '{}');
end $$;

-- Supprime l'arbre pour tout le monde ; le nom saisi doit être exactement celui de l'arbre
create or replace function delete_tree(p_tree uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role(p_tree) is distinct from 'owner' then raise exception 'Action refusée.'; end if;
  if btrim(coalesce(p_name, '')) is distinct from (select name from trees where id = p_tree) then
    raise exception 'Le nom saisi ne correspond pas à celui de l''arbre.';
  end if;
  delete from trees where id = p_tree;   -- tout le reste suit (personnes, liens, photos, membres, invitations, demandes)
end $$;

revoke execute on function tree_summary(uuid)           from public, anon;
revoke execute on function tree_file_paths(uuid)        from public, anon;
revoke execute on function delete_tree(uuid, text)      from public, anon;
grant execute on function tree_summary(uuid)            to authenticated;
grant execute on function tree_file_paths(uuid)         to authenticated;
grant execute on function delete_tree(uuid, text)       to authenticated;
