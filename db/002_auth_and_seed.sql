-- =====================================================================
-- Migration 002 : comptes (connexion) et arbre d'exemple
-- A lancer une fois dans Supabase > SQL Editor, apres db/schema.sql
-- =====================================================================

-- 1. Profil cree automatiquement a la premiere connexion --------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

revoke execute on function handle_new_user() from public, anon, authenticated;

-- 2. Chacun lit et modifie son propre profil ---------------------------
-- (la lecture des profils des autres membres d'un arbre viendra avec la collaboration)
drop policy if exists profiles_self_read   on profiles;
drop policy if exists profiles_self_update on profiles;
create policy profiles_self_read   on profiles for select using (id = auth.uid());
create policy profiles_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- 3. Arbre d'exemple (21 personnes) ------------------------------------
-- Usage : select seed_sample_tree('ton.adresse@exemple.fr');
-- Le compte doit exister : connecte-toi d'abord une fois avec le lien magique.
create or replace function seed_sample_tree(p_email text)
returns uuid language plpgsql as $$
declare
  v_user  uuid;
  v_tree  uuid;
  v_ids   jsonb := '{}'::jsonb;
  v_union uuid;
  r       jsonb;
  k       text;
  i       int;
  persons jsonb := '[{"k": "1", "first": "Joseph", "last": "Martin", "g": "M", "b": 1928, "d": 2004}, {"k": "2", "first": "Marie", "last": "Le Gall", "g": "F", "b": 1932, "d": null}, {"k": "3", "first": "Henri", "last": "Dubois", "g": "M", "b": 1930, "d": 2011}, {"k": "4", "first": "Odette", "last": "Roux", "g": "F", "b": 1933, "d": null}, {"k": "5", "first": "Pierre", "last": "Martin", "g": "M", "b": 1955, "d": null}, {"k": "6", "first": "Anne", "last": "Martin", "g": "F", "b": 1958, "d": null}, {"k": "7", "first": "Luc", "last": "Martin", "g": "M", "b": 1962, "d": null}, {"k": "8", "first": "Claire", "last": "Dubois", "g": "F", "b": 1957, "d": null}, {"k": "9", "first": "Sophie", "last": "Bernard", "g": "F", "b": 1963, "d": null}, {"k": "10", "first": "Thomas", "last": "Martin", "g": "M", "b": 1982, "d": null}, {"k": "11", "first": "Julie", "last": "Martin", "g": "F", "b": 1985, "d": null}, {"k": "12", "first": "Mathieu", "last": "Martin", "g": "M", "b": null, "d": null}, {"k": "13", "first": "Emma", "last": "Martin", "g": "F", "b": 1996, "d": null}, {"k": "14", "first": "Karim", "last": "Benali", "g": "M", "b": 1956, "d": null}, {"k": "15", "first": "Léa", "last": "Benali", "g": "F", "b": 1984, "d": null}, {"k": "16", "first": "Yanis", "last": "Benali", "g": "M", "b": 1987, "d": null}, {"k": "17", "first": "Hugo", "last": "Martin", "g": "M", "b": 1990, "d": null}, {"k": "18", "first": "Camille", "last": "Petit", "g": "F", "b": 1984, "d": null}, {"k": "19", "first": "Louis", "last": "Martin", "g": "M", "b": 2012, "d": null}, {"k": "20", "first": "Jade", "last": "Martin", "g": "F", "b": 2015, "d": null}, {"k": "21", "first": "Inès", "last": "Benali", "g": "F", "b": 2018, "d": null}]'::jsonb;
  unions  jsonb := '[{"a": "1", "b": "2", "kids": ["5", "6", "7"]}, {"a": "3", "b": "4", "kids": ["8"]}, {"a": "5", "b": "8", "kids": ["11", "10", "12"]}, {"a": "5", "b": "9", "kids": ["13"]}, {"a": "14", "b": "6", "kids": ["16", "15"]}, {"a": "10", "b": "18", "kids": ["20", "19"]}, {"a": "7", "b": null, "kids": ["17"]}, {"a": "15", "b": null, "kids": ["21"]}]'::jsonb;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'Aucun compte pour %. Connecte-toi d''abord avec le lien magique.', p_email;
  end if;

  insert into profiles (id, display_name)
  values (v_user, split_part(p_email, '@', 1))
  on conflict (id) do nothing;

  insert into trees (name, description, created_by)
  values ('Famille Martin (exemple)', 'Jeu de test de 21 personnes', v_user)
  returning id into v_tree;

  for r in select * from jsonb_array_elements(persons) loop
    k := r->>'k';
    v_ids := v_ids || jsonb_build_object(k, gen_random_uuid());
    insert into persons (id, tree_id, first_names, last_name, gender,
                         birth_date, birth_precision, death_date, death_precision,
                         is_living, created_by)
    values (
      (v_ids->>k)::uuid, v_tree, r->>'first', r->>'last', r->>'g',
      case when r->>'b' is not null then make_date((r->>'b')::int, 1, 1) end,
      case when r->>'b' is not null then 'year'::date_precision end,
      case when r->>'d' is not null then make_date((r->>'d')::int, 1, 1) end,
      case when r->>'d' is not null then 'year'::date_precision end,
      case when r->>'d' is null then null else false end,
      v_user
    );
  end loop;

  for r in select * from jsonb_array_elements(unions) loop
    insert into unions (tree_id, partner_a, partner_b, kind)
    values (v_tree,
            (v_ids->>(r->>'a'))::uuid,
            case when r->>'b' is not null then (v_ids->>(r->>'b'))::uuid end,
            'marriage')
    returning id into v_union;

    i := 0;
    for k in select jsonb_array_elements_text(r->'kids') loop
      insert into filiations (tree_id, child_id, union_id)
      values (v_tree, (v_ids->>k)::uuid, v_union);
      -- ordre manuel : sert seulement quand les dates de naissance manquent
      update persons set sibling_order = i where id = (v_ids->>k)::uuid;
      i := i + 1;
    end loop;
  end loop;

  return v_tree;
end $$;

revoke execute on function seed_sample_tree(text) from public, anon, authenticated;
