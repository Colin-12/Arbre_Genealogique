-- =====================================================================
-- Migration 015 : tutoriel de l'appli ("Ne plus me montrer ca")
-- A lancer une fois dans Supabase > SQL Editor, apres 014_link_children.sql
-- =====================================================================

-- Le choix est gardé sur le compte (et pas seulement dans le navigateur) :
-- celui qui a dit "ne plus me montrer ça" ne le revoit ni sur son téléphone, ni sur son ordinateur.
alter table profiles add column if not exists tutorial_dismissed_at timestamptz;

create or replace function tutorial_dismissed()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select tutorial_dismissed_at is not null from profiles where id = auth.uid()), false)
$$;

create or replace function dismiss_tutorial()
returns void
language sql security definer set search_path = public as $$
  update profiles set tutorial_dismissed_at = coalesce(tutorial_dismissed_at, now()) where id = auth.uid()
$$;

revoke execute on function tutorial_dismissed() from public, anon;
revoke execute on function dismiss_tutorial() from public, anon;
grant  execute on function tutorial_dismissed() to authenticated;
grant  execute on function dismiss_tutorial() to authenticated;
