# Arbre (nom provisoire)

Application web collaborative pour construire des arbres généalogiques en famille. Accessible depuis un téléphone ou un ordinateur, avec des projets (arbres) partageables et des droits façon Google Docs.

Projet loisir, pensé d'abord pour la famille, avec la possibilité d'être ouvert plus tard à d'autres (instances).

## Vision

- Un utilisateur crée un **arbre** (projet) et en devient automatiquement propriétaire.
- Il invite d'autres personnes par **email** ou par **lien de partage**, avec un rôle.
- On ajoute des personnes (nom, prénoms, parents, enfants, conjoints) et l'arbre se construit et se réorganise automatiquement.
- Au fil du temps, on enrichit les fiches : dates de naissance et de décès, lieux, notes, photos.
- L'âge est calculé automatiquement. Les enfants d'un même couple sont classés de gauche à droite, du plus âgé au plus jeune.
- Plus tard : arbres communicants (correspondances entre deux projets, avec accord des deux propriétaires).

## Principes de conception

1. **Une généalogie est un graphe, pas un arbre strict.** Remariages, demi-frères et soeurs, parents inconnus, adoptions : le modèle doit les accepter dès le départ.
2. **Les dates sont souvent incomplètes.** On stocke une date et une précision (jour, mois, année, "vers").
3. **Le rendu d'abord.** On valide l'affichage avec de fausses données avant de construire le reste.
4. **Pas de doublons à la saisie.** Suggestions pendant la frappe (recherche tolérante aux accents et aux fautes), avec le contexte (année de naissance, parents) pour distinguer les homonymes. Une sortie "Créer une nouvelle personne" reste toujours visible.
5. **Chaque arbre est cloisonné.** Chaque personne a un identifiant stable (UUID), ce qui prépare les arbres communicants sans rien casser.
6. **Vie privée.** Des données sur des personnes vivantes sont stockées : visibilité réduite pour les lecteurs, suppression possible, RGPD si l'app s'ouvre à d'autres.

## Rôles

| Rôle | Lire | Modifier les personnes | Commenter | Gérer membres et partage | Supprimer l'arbre |
|---|---|---|---|---|---|
| owner | oui | oui | oui | oui | oui |
| editor | oui | oui | oui | non | non |
| commenter | oui | non | oui | non | non |
| viewer | oui | non | non | non | non |

Le créateur d'un arbre est owner automatiquement. Un lien de partage porte un rôle (jamais owner), peut expirer et être révoqué.

## Stack envisagée

- **Front** : Next.js (React), responsive, PWA pour un usage mobile.
- **Affichage de l'arbre** : [family-chart](https://github.com/donatso/family-chart) (basé sur D3) pour démarrer. Alternatives : React Flow avec dagre ou ELK, Topola.
- **Base de données** : PostgreSQL. Extensions `pg_trgm` (recherche tolérante) et `unaccent`.
- **Auth, emails d'invitation, droits** : Supabase (auth + row level security), ou Django / FastAPI si tu préfères un backend classique.
- **Déploiement** : Vercel + Supabase au départ. Docker pour les futures instances auto-hébergées.

## Feuille de route

Chaque étape produit quelque chose de visible.

### Étape 0 : cadrage (ici)
- [ ] Dessiner sur papier un morceau de la vraie famille, avec les cas difficiles
- [ ] Choisir le nom du projet

### Étape 1 : le rendu avec de fausses données
- [ ] Afficher `data/sample_family.json` avec family-chart
- [ ] Vérifier les cas de test (voir plus bas)
- [ ] Régler le style : couleurs, cartes, zoom, déplacement, mobile
- [ ] Tri des fratries : par date de naissance, repli sur un ordre manuel
- [ ] Contexte de la vue : bandeau "Vue centrée sur ...", fil d'Ariane des personnes visitées
- [ ] Navigation : boutons "Vue d'ensemble", "Remonter d'un niveau", "Revenir au départ"

### Étape 2 : la base de données
- [ ] Appliquer `db/schema.sql`
- [ ] Remplacer le JSON par des requêtes, sans changer l'affichage

### Étape 3 : ajout et édition de personnes
- [ ] Formulaire d'ajout (parents, enfants, conjoints)
- [ ] Autocomplétion anti-doublons (`suggest_persons`)
- [ ] Fiche personne : dates, lieux, notes, âge calculé

### Étape 4 : comptes et collaboration
- [ ] Inscription, connexion
- [ ] Création d'un arbre, propriétaire automatique
- [ ] Invitations par email, liens de partage, rôles
- [ ] Journal des modifications (qui a changé quoi) et annulation

### Étape 5 : confort
- [ ] Import et export GEDCOM
- [ ] Photos
- [ ] Recherche globale
- [ ] Outil de fusion manuelle des doublons
- [ ] Masquage des informations des personnes vivantes pour les lecteurs

### Étape 6 : avancé
- [ ] Arbres communicants : l'app propose des correspondances avec un score, jamais de fusion automatique, accord des deux propriétaires, lien réversible
- [ ] Instances auto-hébergées (Docker)

## Cas de test du jeu de données

`data/sample_family.json` contient 21 personnes d'une famille fictive, construites pour éprouver l'affichage :

- **Remariage** : Pierre Martin a deux conjointes (Claire, puis Sophie).
- **Demi-frère ou demi-soeur** : Emma est la fille de Pierre et Sophie, et la demi-soeur de Thomas, Julie et Mathieu.
- **Parent inconnu** : Hugo (père Luc, mère inconnue) et Inès (mère Léa, père inconnu).
- **Date de naissance manquante** : Mathieu, pour tester le repli sur l'ordre manuel.
- **Fratrie volontairement désordonnée dans les données** : les enfants de Pierre et Claire sont listés dans le désordre, l'affichage doit les classer du plus âgé au plus jeune.
- **Personnes décédées** : Joseph Martin et Henri Dubois.
- **Quatre générations** : pour tester la lisibilité sur un téléphone.

Remarque : le format suit la convention de family-chart (`rels.parents`, `rels.spouses`, `rels.children`, `data`). Selon la version de la bibliothèque, les noms des champs de `data` peuvent demander un petit ajustement.

## Structure du dépôt (proposée)

```
.
├── README.md
├── data/
│   └── sample_family.json
├── db/
│   └── schema.sql
└── app/            (à créer à l'étape 1)
```

## Questions ouvertes

- Nom du projet ?
- Les personnes vivantes sont-elles masquées par défaut pour les lecteurs ?
- Un utilisateur peut-il être rattaché à sa propre fiche dans un arbre (bouton "c'est moi") ?
- Photos : stockage où, et quelle taille maximale ?
- Langues : français uniquement au départ ?
