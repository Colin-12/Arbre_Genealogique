-- =====================================================================
-- Migration 017 : requête quotidienne anti-pause (offre gratuite Supabase)
-- A lancer une fois dans Supabase > SQL Editor, apres 016_rename_tree.sql
-- =====================================================================

-- Renvoie seulement l'heure du serveur : aucune donnée, aucun accès aux tables.
-- L'appli l'appelle une fois par jour (route /api/keepalive) pour que la base reste "active".
create or replace function keepalive()
returns timestamptz
language sql stable as $$
  select now()
$$;

grant execute on function keepalive() to anon, authenticated;
