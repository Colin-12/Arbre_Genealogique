-- =====================================================================
-- 012 : prévenir le demandeur quand sa demande d'accès est acceptée
-- A lancer une fois dans Supabase (SQL Editor), après 011. Ne casse rien d'existant.
--
-- Même mécanisme que pour le propriétaire (011) : la base appelle /api/notify, qui envoie un e-mail
-- à l'adresse du compte du demandeur et une notification sur ses appareils s'il les a activées.
-- Un refus ne déclenche aucun message. Sans les réglages notify_url / notify_secret, rien n'est envoyé,
-- et un échec d'envoi n'empêche jamais la réponse du propriétaire.
-- =====================================================================

create or replace function notify_access_approved()
returns trigger
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_url     text;
  v_secret  text;
  v_payload jsonb;
begin
  begin
    select value into v_url    from app_settings where key = 'notify_url';
    select value into v_secret from app_settings where key = 'notify_secret';
    if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return new; end if;

    v_payload := jsonb_build_object(
      'kind', 'access_approved',
      'tree_name', (select name from trees where id = new.tree_id),
      'role', coalesce((select role::text from memberships where tree_id = new.tree_id and user_id = new.user_id), ''),
      'recipients', coalesce((
        select jsonb_agg(jsonb_build_object('email', u.email::text)) from auth.users u where u.id = new.user_id and u.email is not null
      ), '[]'::jsonb),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
        from push_subscriptions s where s.user_id = new.user_id
      ), '[]'::jsonb)
    );

    perform net.http_post(
      url := v_url,
      body := v_payload,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;   -- une notification qui échoue ne doit jamais bloquer la réponse du propriétaire
  end;
  return new;
end $$;

drop trigger if exists trg_notify_access_approved on access_requests;
create trigger trg_notify_access_approved after update of status on access_requests
for each row when (old.status = 'pending' and new.status = 'approved')
execute function notify_access_approved();

revoke execute on function notify_access_approved() from public, anon, authenticated;
