# Traduction Français → Afar (Qafar af)

Plateforme web légère permettant à des linguistes de traduire des phrases du français vers l'afar de Djibouti.
Les réponses sont enregistrées dans des fichiers **Excel (.xlsx)**.

Site : `https://djibouti-plateforme.github.io/traduction-francais-afar/`

## Fonctionnement

1. Le·la linguiste ouvre le site et saisit son nom.
2. Pour chaque phrase française, il·elle tape la traduction en afar (et des notes éventuelles : variante, prononciation…).
   Le statut passe automatiquement à « Traduite » ; on peut le mettre à « À revoir ».
3. Tout est **sauvegardé automatiquement dans le navigateur**.
4. Les traductions sont stockées en Excel de deux façons :
   - **⬇ Exporter en Excel** : télécharge `traductions_fr-afar_<nom>_<date>.xlsx` sur l'ordinateur ;
   - **☁ Enregistrer sur GitHub** : dépose le fichier Excel dans ce dépôt, dans `data/traductions/<nom>.xlsx`
     (un fichier par traducteur, historique conservé par Git).
5. **⬆ Importer un Excel** permet de reprendre un travail (ou de charger une nouvelle liste de phrases :
   une colonne `Français` suffit, colonnes optionnelles `ID`, `Catégorie`, `Afar`, `Notes`, `Statut`, `Traducteur`).

Colonnes du fichier Excel : `ID | Catégorie | Français | Afar | Notes | Statut | Traducteur | Mis à jour le`.

## Ajouter des phrases à traduire

Modifier `data/phrases.json` (format `{ "id": "P0068", "fr": "…", "category": "…" }`) puis pousser sur `main`.
Les linguistes peuvent aussi ajouter des phrases depuis l'interface (« ＋ Ajouter une phrase »).

## Activer « Enregistrer sur GitHub »

Chaque linguiste a besoin d'un jeton GitHub :

1. GitHub → *Settings* → *Developer settings* → *Personal access tokens* → **Fine-grained tokens** → *Generate new token*.
2. *Resource owner* : `djibouti-plateforme` ; *Repository access* : uniquement `traduction-francais-afar`.
3. *Permissions* → *Repository permissions* → **Contents : Read and write**.
4. Dans le site, cliquer sur ⚙ et coller le jeton.

Le jeton reste dans le navigateur du linguiste (localStorage) ; ne pas l'utiliser sur un poste partagé.

## Déploiement

Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main`.
Une seule fois : *Settings* → *Pages* → *Build and deployment* → *Source* : **GitHub Actions**.

## Développement local

Aucun outil de build : `python3 -m http.server 8000` puis ouvrir http://localhost:8000.
