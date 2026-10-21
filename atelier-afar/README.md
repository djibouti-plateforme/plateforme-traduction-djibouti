# Atelier Afar — démonstration frontend

Application web de démonstration pour constituer deux jeux de données en afar (Qafar af) :

1. **Corpus parallèle français–afar** : un linguiste révise des traductions automatiques (fictives), les valide, les corrige, les rejette ou les signale, et annote les erreurs.
2. **Corpus audio TTS** : les phrases validées ou corrigées sont lues à voix haute et enregistrées en WAV, avec le texte exact prononcé et les métadonnées.

> **Mode démonstration — Données fictives — Aucun serveur connecté.**
> Les textes français et les traductions afar sont fictifs et **non vérifiés**. Les statuts « Validé · simulé » du jeu de départ sont simulés. Aucune API (Anthropic ou autre) n'est appelée.

Adresse : `https://djibouti-plateforme.github.io/plateforme-traduction-djibouti/atelier-afar/`

---

## Deux modes de fonctionnement

| | **Supabase** (par défaut) | **Démonstration locale** (`?demo`) |
|---|---|---|
| Adresse | `…/atelier-afar/` | `…/atelier-afar/?demo` |
| Compte | E-mail + mot de passe, créé par l'administrateur | Aucun (linguiste simulé) |
| Données | Base Postgres + stockage de fichiers Supabase, **Francfort (UE)**, partagées entre membres | Navigateur uniquement (localStorage + IndexedDB) |
| Persistance | Survit au changement d'appareil ou de navigateur | Perdue si les données du site sont effacées |

Les textes et traductions restent des **données de démonstration fictives** dans les deux modes.

### Stockage Supabase

- Projet `atelier-afar` (`klppbbucaslphagjbmth`), région `eu-central-1`. Configuration côté client : `js/config.js` (URL et clé *publishable*, publique par conception).
- Tables : `segments`, `reviews`, `glossary`, `speakers`, `consents`, `recordings`, `members`. Fichiers WAV dans le bucket **privé** `recordings` (`<locuteur>/<segment>/<prise>.wav`, WAV uniquement, 50 Mo max).
- **Sécurité** : RLS activée sur toutes les tables et sur le stockage. Un visiteur non connecté ne voit rien ; un compte connecté ne voit rien non plus s'il n'est pas dans `members`. Les linguistes lisent et écrivent révisions, glossaire, locuteurs et prises ; seuls les administrateurs gèrent les membres, les segments, la réinitialisation de la démo et la suppression globale des enregistrements.
- Les règles métier (versions du texte, invalidation des prises, éligibilité à l'export) restent dans `js/utils/status.js`, partagé par les deux modes.
- Écritures sérialisées ; en cas d'échec réseau, l'interface recharge l'état depuis le serveur et prévient l'utilisateur. Pas encore de synchronisation en temps réel : si deux linguistes modifient le même segment, la dernière écriture l'emporte (recharger la page pour voir le travail des autres).

### Ajouter un linguiste

1. Dans l'atelier, connecté en administrateur : **Paramètres → Membres du projet** → adresse, nom, code (ex. `ling_02`) → *Autoriser ce membre*.
2. Dans le [tableau de bord Supabase](https://supabase.com/dashboard/project/klppbbucaslphagjbmth/auth/users) : **Authentication → Users → Add user → Create new user**, même adresse, mot de passe provisoire, cocher **Auto Confirm User**.
3. Communiquer le mot de passe ; la personne peut le changer dans **Paramètres → Mon compte**.

Mot de passe oublié : l'administrateur le réinitialise depuis le même écran Supabase (l'envoi d'e-mails n'est pas configuré).

## Choix techniques : aucun serveur, aucune compilation

Le cahier des charges initial proposait React + TypeScript + Vite + Tailwind. Comme demandé, la stack a été adaptée pour **n'exiger aucun serveur ni aucune étape de build** :

| Besoin | Solution retenue |
|---|---|
| Interface | JavaScript natif en **modules ES** (`<script type="module">`), sans framework ni bundler. Les fichiers sont servis tels quels. |
| Typage | Modèle de données documenté en **JSDoc** (`js/types.js`), lisible par les éditeurs. |
| Style | CSS unique (`css/app.css`), palette bleu nuit / turquoise. |
| Icônes | Tracés SVG inspirés de Lucide, intégrés (`js/utils/dom.js`). |
| Annotations, préférences | `localStorage`. |
| Fichiers audio | **IndexedDB** (stockés en `ArrayBuffer`). |
| Capture audio | Web Audio API + **AudioWorklet** (PCM brut) → encodeur WAV maison. |
| Archive ZIP | **JSZip** chargé depuis cdnjs. |
| Tests | Lanceur intégré de Node (`node --test`), **aucune dépendance npm**. |
| Hébergement | **GitHub Pages** (déjà en place pour ce dépôt). Fonctionne aussi sur Netlify, Vercel ou tout hébergement statique. |

Conséquence : pas de `npm install` ni de `npm run build`. Le dossier `atelier-afar/` *est* le site.

## Lancer en local

```bash
cd atelier-afar
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

N'importe quel serveur de fichiers statiques convient (`npx serve`, extension « Live Server »…). Ouvrir `index.html` directement par `file://` **ne fonctionne pas** : les modules ES, le chargement des données de démonstration et le micro exigent une vraie origine HTTP.

## Tests

```bash
cd atelier-afar
npm test          # équivaut à : node --test tests/*.test.js  (Node 20+)
```

| Fichier | Couvre |
|---|---|
| `tests/wav.test.js` | Encodeur WAV : en-tête RIFF/WAVE, PCM 16 bits mono, fréquence, durée, écrêtage, aller-retour. |
| `tests/levels.test.js` | Niveaux dBFS, avertissements (saturation, niveau faible, silence, durée < 1 s / > 15 s). |
| `tests/diff.test.js` | Diff mot à mot, pourcentage de mots modifiés. |
| `tests/detect.test.js` | Détection des chiffres, pourcentages, sigles, symboles, abréviations, emprunts au français. |
| `tests/status.test.js` | Transitions de statut, file audio, invalidation d'un enregistrement après modification de la traduction, éligibilité à l'export. |
| `tests/export.test.js` | JSONL / CSV des révisions, manifeste TTS, `metadata.csv` LJSpeech, normalisation. |

Le parcours complet de démonstration (19 étapes du cahier des charges) a été vérifié dans Chromium avec un micro simulé.

## Structure

```text
atelier-afar/
├── index.html                 Coquille de l'application
├── css/app.css                Styles
├── js/
│   ├── main.js                Démarrage, en-tête, routage (#/revision, #/enregistrement…)
│   ├── types.js               Modèle de données (JSDoc) : Segment, Review, ErrorAnnotation, Recording, Speaker, Consent, GlossaryEntry
│   ├── ui-state.js            Préférences d'affichage (filtres, dernier segment…)
│   ├── services/
│   │   ├── DataService.js     Contrat d'accès aux données (abstraction)
│   │   ├── MockDataService.js Implémentation locale (localStorage + IndexedDB)
│   │   └── idb.js             Surcouche IndexedDB
│   ├── mocks/
│   │   ├── segments.json      25 segments fictifs (8 domaines, 3 lots)
│   │   └── glossary.json      Glossaire fictif non vérifié
│   ├── pages/                 review.js, recording.js, dashboard.js, settings.js
│   ├── components/            ui.js (dialogues, notifications), glossaryPanel.js, annotationsPanel.js,
│   │                          speakerConsent.js, accentPalette.js
│   ├── audio/                 recorder.js, recorder-worklet.js, wav.js, levels.js, waveform.js
│   └── utils/                 status.js (règles métier), diff.js, detect.js, export.js, exporter.js, dom.js
└── tests/                     Tests unitaires (node --test)
```

Les pages ne lisent jamais `mocks/` directement : elles passent par `DataService`. `MockDataService` est la seule classe qui connaît les données fictives et le stockage du navigateur.

## Fonctionnement

### Révision des traductions
- Liste des segments avec recherche plein texte, filtres (statut, lot, domaine) et progression.
- Texte français (lecture seule, termes du glossaire surlignés), traduction automatique (lecture seule, métadonnées fictives), éditeur afar prérempli (`lang="aa"`, correcteur orthographique désactivé).
- Diff mot à mot en direct, pourcentage de mots modifiés, restauration de la version originale (avec confirmation).
- Actions : *Valider sans modification*, *Enregistrer la correction*, *Rejeter — À retraduire* (confirmation), *Signaler un problème* (motif obligatoire), *Passer au suivant*.
- Brouillon sauvegardé automatiquement ; la traduction machine reste toujours dans `mt_afar`, la version humaine dans `corrected_afar`, avec l'historique des décisions.
- Annotations d'erreurs (exactitude, fluidité, terminologie, style, conventions ; sous-catégorie ; gravité ; commentaire), plusieurs par segment.
- Chronomètre de révision actif (pause après 90 s d'inactivité ou onglet masqué).
- Raccourcis : `Ctrl/Cmd + Entrée` (enregistrer la correction et passer au suivant), `Ctrl/Cmd + Maj + Entrée` (valider sans modification ; confirmation si le texte a été modifié), `Alt + ←/→`, `?` (aide). Une touche maintenue ne déclenche pas de validation répétée ; les raccourcis sont inactifs quand une boîte de dialogue est ouverte.

### Glossaire
Recherche, ajout, modification, propositions de correction (historisées). Statuts : `non_verifie`, `propose`, `valide_linguiste` (champs `validated_by` / `validated_at` réservés pour le futur processus de validation).

### Enregistrement audio
- Consentement préalable (identité du locuteur, date, autorisation explicite de réutilisation pour l'entraînement), retrait possible avec suppression des données locales du locuteur.
- Profil vocal : identifiant, nom/pseudonyme, sexe et tranche d'âge facultatifs, dialecte (liste configurable : Aussa, Baadu, Afar central, Afar du Nord, Autre — **à confirmer avec le linguiste**), région, notes.
- Micro : choix du périphérique, autorisation, vumètre (RMS et crête en dBFS), mesure du bruit ambiant sur 5 s, messages explicites en cas de refus ou d'absence de micro, rappel HTTPS.
- File : segments *Validés* ou *Corrigés* uniquement ; statuts *À enregistrer*, *En cours*, *Enregistré*, *À refaire* ; minutes d'audio validé.
- **Texte affiché vs texte prononcé** : `text_display` (texte validé) et `text_spoken` (ce qui est réellement dit) sont distincts. Les chiffres, pourcentages, sigles, symboles, abréviations et emprunts au français déclenchent un avertissement ; **aucune transcription n'est générée automatiquement**.
- Enregistrement : bouton ou barre d'espace (hors champ de saisie), compte à rebours optionnel, voyant rouge, forme d'onde, vumètre, chronomètre, alertes de saturation / signal faible, rappel de pause après 45 min.
- Contrôle qualité : réécoute, forme d'onde, signalements (bruit, hésitation, prononciation, erreur de lecture), avertissements de durée (< 1 s, > 15 s) — indicatifs uniquement. **Validation impossible sans cocher** « Je confirme que l'enregistrement correspond exactement au texte prononcé indiqué ».
- Refaire une prise conserve l'ancienne comme *prise non courante* jusqu'à suppression explicite.
- **Si une traduction déjà enregistrée est modifiée dans l'onglet Révision, sa prise passe « À refaire »** (le fichier n'est pas supprimé).

### Format audio
WAV RIFF, PCM signé 16 bits little-endian, **mono**, à la **fréquence native de l'AudioContext** (souvent 44,1 ou 48 kHz), **sans rééchantillonnage ni compression**. L'annulation d'écho, la réduction de bruit et le gain automatique du navigateur sont désactivés lorsque le navigateur l'accepte.

### Exports
- **Corpus FR–Afar** : `revisions_<date>.jsonl` (une ligne par segment : `segment_id`, `source_fr`, `mt_afar`, `corrected_afar`, `human_edited`, `status`, `status_simulated`, `reviewer_id`, `error_annotations`, `review_duration_seconds`, `mt_model`, `mt_prompt_version`, `reviewed_at`…) et un CSV (séparateur `;`, UTF-8 avec BOM, pour Excel).
- **Corpus TTS** : `afar_tts_dataset_<date>.zip` contenant `wavs/`, `metadata.jsonl`, `metadata.csv` (format LJSpeech : `id|transcription|transcription normalisée`), `speakers.json` et `README.txt` (description détaillée des champs).
  - Seules sont incluses les prises **courantes**, **validées**, **confirmées**, liées à une traduction **toujours approuvée** dont le texte **n'a pas changé** depuis la prise, d'un locuteur au **consentement valide**.
  - `normalized_text` = `text_spoken` en Unicode NFC avec espaces fusionnés, **sans aucune autre transformation**.
  - Après génération, l'archive est relue : chaque `audio_filepath` doit exister et son en-tête WAV et sa durée sont contrôlés, sinon l'export échoue.

## Stockage local et limites du mode démo

- Révisions, glossaire, locuteurs, consentements et réglages : `localStorage` (clé `atelier-afar.v1`). Audio : IndexedDB (base `atelier-afar`).
- Les données restent **dans ce navigateur, sur cet appareil**. Elles peuvent être perdues en effaçant les données du site, en navigation privée ou en changeant d'appareil ou de navigateur. **Exportez régulièrement.** La page Paramètres affiche l'espace utilisé et permet de demander un stockage persistant.
- Pas d'authentification : le choix du linguiste est simulé.
- Un seul poste : pas de synchronisation entre linguistes.
- *Paramètres → Réinitialiser les données de démonstration* restaure les révisions et le glossaire d'origine (les enregistrements sont conservés) ; *Supprimer les enregistrements locaux* efface l'audio.

## Microphone

- Exige **HTTPS** (GitHub Pages l'est) ou `localhost`.
- Navigateurs testés : Chrome / Edge récents. Firefox et Safari 14.1+ prennent en charge AudioWorklet ; Safari peut ignorer la désactivation des traitements audio. Sur iOS, la capture s'interrompt si l'onglet passe en arrière-plan. Un casque Bluetooth peut réduire la fréquence à 16 kHz : préférer un micro filaire ou USB.
- Le navigateur demande l'autorisation au premier clic sur « Autoriser et tester le micro » ou sur le bouton d'enregistrement. Le micro est libéré en quittant l'onglet *Enregistrement audio*.

## Déploiement

- **GitHub Pages** (actuel) : le workflow `.github/workflows/pages.yml` publie tout le dépôt à chaque push sur `main` ; l'atelier est servi sous `/atelier-afar/`.
- **Netlify / Vercel** : publier le dossier `atelier-afar/` comme site statique, sans commande de build (*Build command* vide, *Publish directory* `atelier-afar`).

## Évolutions possibles du backend

`SupabaseDataService.js` est la première implémentation distante de `DataService`. Pour une autre API :

1. Créer `js/services/ApiDataService.js` qui étend `DataService` et implémente les mêmes méthodes via HTTP (révisions, annotations, glossaire, locuteurs, consentements, prises audio).
   Conserver le principe actuel : un **instantané en mémoire** (`snapshot()`) pour l'affichage, des **commandes asynchrones** pour les écritures, et `subscribe()` pour notifier l'interface.
2. Remplacer `new SupabaseDataService()` par `new ApiDataService(...)` dans `js/main.js` (une seule ligne).
3. Côté serveur :
   - stocker `mt_afar` (sortie Claude, avec modèle, version de prompt et date) séparément des corrections humaines ;
   - appliquer les mêmes règles que `js/utils/status.js` (versionnement du texte approuvé, invalidation des prises, éligibilité à l'export) — ce module est sans dépendance et peut être réutilisé tel quel côté Node ;
   - téléverser les WAV (`saveTake`) vers un stockage objet, sans réencodage ;
   - authentifier les linguistes (remplace la sélection simulée) et tracer le consentement côté serveur ;
   - générer la traduction automatique avec l'API Claude **côté serveur uniquement** (jamais de clé API dans le navigateur).
4. Retirer le bandeau « Mode démonstration » et les mentions de statut simulé.
