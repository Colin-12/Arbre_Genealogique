# Arbre généalogique

Un arbre généalogique que toute la famille peut consulter et compléter depuis son téléphone. Je l'ai commencé parce que les arbres de la famille existent en ce moment sous forme de photos de feuilles, de PDF qui circulent et de souvenirs de chacun, et que personne ne sait quelle version est la bonne. L'idée est d'avoir un seul endroit, privé, où chacun ajoute ce qu'il sait.

C'est un projet perso, fait à mon rythme et testé surtout sur mon téléphone et celui de mes proches. Ce n'est pas un produit fini.

## Ce que ça fait aujourd'hui

On se connecte avec son adresse e-mail (un lien arrive dans la boîte, pas de mot de passe). On tombe sur l'arbre, centré sur une personne, et on navigue de proche en proche : un clic sur une carte recentre la vue, un bouton remonte vers les parents, la recherche retrouve quelqu'un par son nom sans se soucier des accents.

Chaque personne a une fiche avec ses dates (complètes ou partielles : on peut ne connaître que l'année, ou le mois), ses lieux, son nom de naissance, un commentaire, une photo de profil et une galerie. Sur une photo on indique qui apparaît, et elle s'affiche dans la fiche de chacun. L'âge est calculé tout seul (« environ 76 ans » quand seule l'année de naissance est connue), et les frères et sœurs sont toujours classés du plus âgé au plus jeune.

Pour modifier l'arbre, on ajoute un enfant, un conjoint, un parent, un frère ou une sœur à partir d'une personne existante. L'appli propose les personnes déjà saisies pour éviter les doublons. On peut aussi retirer un lien, corriger une erreur ou supprimer quelqu'un (et le rétablir juste après si on s'est trompé). Quand on ajoute un conjoint à quelqu'un qui a déjà des enfants, l'appli demande lesquels sont aussi les enfants de ce conjoint (cela se corrige aussi après coup, dans « Corriger les liens »).

Plusieurs arbres peuvent coexister, chacun avec ses membres. Le propriétaire d'un arbre invite ses proches par e-mail avec un rôle : éditeur, commentateur (peut seulement écrire des légendes) ou lecteur. Il peut coller une vingtaine d'adresses d'un coup ; chacun reçoit un lien, clique dessus, et se retrouve dans l'arbre. Pour les familles nombreuses, il peut aussi partager un lien unique (par message, WhatsApp...) : chaque personne crée son compte et fait une demande, que le propriétaire accepte ou refuse depuis l'appli. Le lien seul ne donne accès à rien, et il se change d'un clic s'il a circulé trop loin. Le propriétaire est prévenu de chaque nouvelle demande par e-mail, et par une notification sur son téléphone s'il les a activées ; le demandeur est prévenu de la même façon quand on l'accepte. Quand on crée un arbre, l'appli prévient si un autre contient déjà les mêmes personnes, pour éviter que deux cousins montent chacun leur version de la même famille.

L'appli s'installe sur l'écran d'accueil du téléphone (« Ajouter à l'écran d'accueil »), sans passer par un magasin d'applications.

## Comment c'est fait

- Next.js (App Router) et React pour l'interface, en TypeScript.
- [family-chart](https://github.com/donatso/family-chart) pour dessiner l'arbre. Je lui fournis les personnes, les couples et les filiations, il s'occupe de la mise en page.
- Supabase pour tout le reste : base PostgreSQL, connexion par lien magique, stockage des photos.
- Vercel pour l'hébergement, avec un déploiement automatique à chaque push sur `main`.

Les dossiers :

```
app/    l'application web (c'est ce que Vercel déploie)
db/     le schéma de la base, puis les migrations numérotées
data/   un petit arbre d'exemple en JSON
```

Une règle que je me suis donnée : tout ce qui touche aux droits se règle dans la base, pas dans l'interface. Les tables sont protégées par des règles d'accès au niveau des lignes (RLS), et les opérations sensibles (inviter, répondre à une demande d'accès, retirer un membre, créer un arbre, ajouter une photo) passent par des fonctions SQL qui vérifient elles-mêmes le rôle de la personne. Masquer un bouton n'a jamais suffi à protéger quoi que ce soit. Les photos sont dans un stockage privé, et l'application demande des adresses temporaires pour les afficher.

Les limites (3 arbres par personne, 500 personnes par arbre, 200 photos par arbre) sont des valeurs en base. Elles empêchent qu'un inconnu ne remplisse la base gratuite, et se changent sans toucher au code. Les inscriptions sont ouvertes par défaut ; un réglage dans la table `app_settings` permet de les refermer si besoin.

## Le faire tourner chez soi

Il faut un compte Supabase (l'offre gratuite suffit) et Node.js.

1. Créer un projet Supabase, puis lancer dans l'éditeur SQL, dans cet ordre : `db/schema.sql`, puis `db/002_auth_and_seed.sql` jusqu'à `db/014_link_children.sql`.
2. Dans Authentication, onglet URL Configuration, mettre l'adresse du site (et `http://localhost:3000/**` pour le développement) dans les URL de redirection.
3. Créer `app/.env.local` avec deux variables : `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Ce sont les valeurs de Settings, API, dans Supabase. La clé « anon » peut être publique ; la clé `service_role`, elle, ne doit jamais se retrouver dans le dépôt ni dans l'application.
4. Puis :

```bash
cd app
npm install
npm run dev
```

Pour déployer sur Vercel, importer le dépôt, indiquer `app` comme dossier racine et recopier les deux variables d'environnement.

Les notifications sont facultatives. Elles passent par une petite route de l'application (`app/api/notify`) que la base appelle quand une demande arrive, ce qui demande quelques réglages côté hébergeur : `NOTIFY_SECRET` (un secret partagé avec la base, qui le lit dans la table `app_settings`), `GMAIL_USER` et `GMAIL_APP_PASSWORD` pour l'e-mail, et un couple de clés `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (générées avec `npx web-push generate-vapid-keys`) pour les notifications du téléphone. Sans ces réglages l'appli fonctionne normalement, simplement sans prévenir personne. Sur iPhone, les notifications ne marchent qu'une fois l'appli ajoutée à l'écran d'accueil.

Détail pratique : le service e-mail intégré de Supabase limite très vite le nombre de liens envoyés. Dès qu'on invite plusieurs personnes, il vaut mieux brancher son propre SMTP (j'utilise un compte Gmail avec un mot de passe d'application, dans Authentication, SMTP Settings). Et il vaut mieux traduire les modèles d'e-mail, sinon les invités reçoivent un message en anglais.

## Quitter ou supprimer un arbre

Dans « Mes arbres », le bouton « Quitter ou supprimer un arbre » permet à chacun de quitter un arbre dont il n'est pas propriétaire. Le propriétaire peut le supprimer : il doit taper le nom exact de l'arbre, une sauvegarde (personnes et liens, sans les photos) lui est proposée, et la suppression est définitive pour tous les membres. L'adresse du compte connecté est affichée sur l'écran d'accueil et dans « Mes arbres ».

## Ce qui manque

- Passer la propriété d'un arbre à quelqu'un d'autre. Aujourd'hui le propriétaire ne peut pas quitter son arbre, seulement le supprimer.
- Restaurer une sauvegarde : le fichier téléchargé avant une suppression existe, mais l'appli ne sait pas encore le relire.
- Une liste des personnes qui ne sont pas visibles depuis la vue actuelle. Aujourd'hui, les parents d'un conjoint existent bien dans l'arbre mais n'apparaissent que si on se recentre sur lui.
- Un rendu neutre pour les personnes dont le sexe est inconnu : la bibliothèque de dessin ne connaît que homme et femme.
- Rapprocher deux arbres qui se recoupent, quand deux branches de la famille se rejoignent.
- Les commentaires sur les fiches et un historique des modifications.

## Un mot sur les données

Un arbre généalogique contient des informations sur des personnes, dont certaines sont vivantes. Les arbres sont privés, accessibles uniquement sur invitation, et l'appli n'est pas référencée par les moteurs de recherche. Si vous l'installez pour votre famille, pensez à demander l'accord des personnes dont vous saisissez la date de naissance ou la photo.
