-- =====================================================================
-- 005 : photos de profil
-- A lancer une fois dans Supabase (SQL Editor). Ne casse rien d'existant.
--
-- - persons.photo_path : chemin de la photo dans le stockage
--   (forme imposée : <id de l'arbre>/<id de la personne>/<nom du fichier>)
-- - bucket "photos" : PRIVE, 2 Mo maximum par fichier, JPEG / PNG / WebP
-- - droits : les membres d'un arbre voient ses photos, seuls les
--   propriétaires et éditeurs peuvent en ajouter, remplacer ou supprimer
-- =====================================================================

alter table persons add column if not exists photo_path text;

-- Le chemin doit appartenir à la bonne personne (empêche de pointer vers la photo d'un autre arbre)
alter table persons drop constraint if exists persons_photo_path_check;
alter table persons add constraint persons_photo_path_check
  check (photo_path is null or photo_path like tree_id::text || '/' || id::text || '/%');

-- Identifiant de l'arbre lu dans le chemin d'un fichier (null si le chemin est invalide)
create or replace function photo_tree(p_name text)
returns uuid
language plpgsql immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- Espace de stockage privé
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Droits sur les fichiers (my_role renvoie null pour un non-membre ou un chemin invalide)
drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_update on storage.objects;
drop policy if exists photos_delete on storage.objects;

create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and my_role(photo_tree(name)) is not null);

create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and my_role(photo_tree(name)) in ('owner', 'editor'));

create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and my_role(photo_tree(name)) in ('owner', 'editor'))
  with check (bucket_id = 'photos' and my_role(photo_tree(name)) in ('owner', 'editor'));

create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and my_role(photo_tree(name)) in ('owner', 'editor'));
