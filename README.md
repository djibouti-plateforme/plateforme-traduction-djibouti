# Atelier de traduction — langues de Djibouti

Plateforme web permettant à des linguistes de traduire du **français** vers les langues de Djibouti
(l'**afar** pour commencer, puis le somali, l'arabe… ou toute autre langue).
Les traductions sont enregistrées dans des fichiers **Excel (.xlsx)**.

> 🆕 **[Atelier Afar](atelier-afar/)** — démonstration de révision de traductions FR→Afar et d'enregistrement d'un corpus vocal TTS : `https://djibouti-plateforme.github.io/plateforme-traduction-djibouti/atelier-afar/` (voir [atelier-afar/README.md](atelier-afar/README.md)).

Site : `https://djibouti-plateforme.github.io/plateforme-traduction-djibouti/`

## Utilisation

1. **Bienvenue** : la personne indique son nom et la langue vers laquelle elle traduit.
2. **Charger du français** : on colle un texte (ou on dépose un fichier `.txt`, `.csv`, `.xlsx`) et on choisit le découpage :
   - *Phrases* : le texte est découpé phrase par phrase ;
   - *Lignes* : un élément par ligne ;
   - *Mots* : chaque mot distinct devient un élément (utile pour un lexique) ;
   - *Texte entier* : le texte est traduit en un seul bloc.

   Les éléments sont regroupés dans un **lot** (ex. « Santé – brochure 2026 »). Les doublons sont ignorés.
3. **Traduire** : les éléments s'affichent un par un. On saisit la traduction, puis **Suivant →**
   (ou <kbd>Ctrl</kbd> + <kbd>Entrée</kbd>). On peut revenir en arrière, ajouter des notes, marquer « À revoir ».
   L'option *Non traduits seulement* saute ce qui est déjà fait.
4. **Tout voir** : liste de tous les éléments avec recherche et filtres ; un clic ouvre l'élément pour le traduire.
5. **Enregistrer** :
   - **⤓ Excel** télécharge `traductions_fr-<langue>_<nom>_<date>.xlsx`
     (colonnes `ID | Lot | Type | Français | <Langue> | Notes | Statut | Traducteur | Mis à jour le`) ;
   - **☁ GitHub** dépose le fichier dans ce dépôt : `data/traductions/<code langue>/<nom>.xlsx`.
   - *Importer un Excel* (dans « Tout voir ») permet de reprendre un travail.

Tout est aussi sauvegardé automatiquement dans le navigateur.

## Ajouter une langue

Ajouter une entrée dans [`data/langues.json`](data/langues.json) :

```json
{ "code": "so", "nom": "Somali", "autonyme": "Af-Soomaali", "dir": "ltr", "exemple": "Af-Soomaali…" }
```

`dir` vaut `rtl` pour les langues écrites de droite à gauche (arabe). Chaque langue a ses propres traductions et fichiers Excel.

## Corpus commun

[`data/corpus.json`](data/corpus.json) contient les éléments proposés à tous les linguistes
(`{ "id", "fr", "type": "mot|phrase|texte", "lot" }`). Les éléments chargés depuis l'interface
restent dans le navigateur de la personne, mais sont inclus dans ses exports Excel.

## Activer « Enregistrer sur GitHub »

Chaque linguiste a besoin d'un jeton GitHub :

1. GitHub → *Settings* → *Developer settings* → *Personal access tokens* → **Fine-grained tokens** → *Generate new token*.
2. *Resource owner* : `djibouti-plateforme` ; *Repository access* : uniquement `plateforme-traduction-djibouti`.
3. *Repository permissions* → **Contents : Read and write**.
4. Sur le site, cliquer sur ⚙ et coller le jeton (il reste dans le navigateur).

## Déploiement

`.github/workflows/pages.yml` publie le site à chaque push sur `main`.
Une seule fois : *Settings* → *Pages* → *Source* : **GitHub Actions**.

## Développement local

Aucun outil de build : `python3 -m http.server 8000`, puis http://localhost:8000.
