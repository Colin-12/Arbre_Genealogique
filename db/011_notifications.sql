-- =====================================================================
-- 011 : prévenir le propriétaire d'une nouvelle demande d'accès (e-mail + notification sur le téléphone)
-- A lancer une fois dans Supabase (SQL Editor), après 010. Ne casse rien d'existant.
--
-- Fonctionnement : quand quelqu'un demande l'accès à un arbre, un déclencheur envoie un message
-- à l'adresse /api/notify de l'application (hébergée sur Vercel), qui envoie l'e-mail et la notification.
-- Rien n'est envoyé tant que les deux réglages ci-dessous ne sont pas renseignés, et un échec
-- d'envoi n'empêche jamais la demande d'être enregistrée.
--
-- Réglages à ajouter une fois (voir le guide de mise en place) :
--   insert into app_settings (key, value) values
--     ('notify_url',    'https://VOTRE-SITE.vercel.app/api/notify'),
--     ('notify_secret', 'LE_SECRET_PARTAGÉ')
--   on conflict (key) do update set value = excluded.value;
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- ---------- appareils qui reçoivent les notifications ----------
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;   -- aucune règle : tout passe par les fonctions ci-dessous
revoke all on push_subscriptions from anon, authenticated;

-- Enregistre (ou réattribue) l'appareil courant ; on garde au plus 5 appareils par personne
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000 then
    raise exception 'Appareil invalide.';
  end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;

  delete from push_subscriptions
  where user_id = auth.uid()
    and id not in (select id from push_subscriptions where user_id = auth.uid() order by created_at desc, id limit 5);
end $$;

create or replace function delete_push_subscription(p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

-- ---------- déclencheur : nouvelle demande d'accès ----------
create or replace function notify_access_request()
returns trigger
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_url     text;
  v_secret  text;
  v_tree    text;
  v_name    text;
  v_email   text;
  v_payload jsonb;
begin
  begin
    select value into v_url    from app_settings where key = 'notify_url';
    select value into v_secret from app_settings where key = 'notify_secret';
    if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return new; end if;

    select name into v_tree from trees where id = new.tree_id;
    select display_name into v_name from profiles where id = new.user_id;
    select email::text into v_email from auth.users where id = new.user_id;

    v_payload := jsonb_build_object(
      'kind', 'access_request',
      'tree_name', v_tree,
      'requester_name', coalesce(v_name, ''),
      'requester_email', coalesce(v_email, ''),
      'message', coalesce(new.message, ''),
      'recipients', coalesce((
        select jsonb_agg(jsonb_build_object('email', u.email::text))
        from memberships m join auth.users u on u.id = m.user_id
        where m.tree_id = new.tree_id and m.role = 'owner' and u.email is not null
      ), '[]'::jsonb),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
        from push_subscriptions s
        join memberships m on m.user_id = s.user_id and m.tree_id = new.tree_id and m.role = 'owner'
      ), '[]'::jsonb)
    );

    perform net.http_post(
      url := v_url,
      body := v_payload,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
      timeout_milliseconds := 8000
    );
  exception when others then
    -- une notification qui échoue ne doit jamais empêcher la demande
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_notify_access_request on access_requests;
create trigger trg_notify_access_request after insert on access_requests
for each row execute function notify_access_request();

-- ---------- droits d'appel ----------
revoke execute on function notify_access_request()                      from public, anon, authenticated;
revoke execute on function save_push_subscription(text, text, text)     from public, anon;
revoke execute on function delete_push_subscription(text)               from public, anon;
grant execute on function save_push_subscription(text, text, text)      to authenticated;
grant execute on function delete_push_subscription(text)                to authenticated;
