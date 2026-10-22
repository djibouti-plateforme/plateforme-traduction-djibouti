# Atelier Afar

Plateforme de travail pour constituer deux jeux de données en afar (Qafar af) :

1. **Corpus parallèle français–afar** : les linguistes révisent des traductions automatiques (Claude), les valident, les corrigent, les rejettent ou les signalent, et annotent les erreurs.
2. **Corpus audio TTS** : les phrases validées ou corrigées sont lues à voix haute et enregistrées en WAV, avec le texte exact prononcé et les métadonnées.

Adresse : `https://djibouti-plateforme.github.io/plateforme-traduction-djibouti/atelier-afar/`

## Contenu chargé

- **514 sujets** français (`supabase/seed/corpus.json`), répartis en **13 lots** de 30 à 50 segments sur 8 domaines : Sécurité sociale, Retraite, Prestations familiales, Assurance maladie, Santé, Travail, Fiscalité, Administration. Mots isolés, phrases et courts passages ; environ un quart contient des nombres, dates, montants ou sigles (utile pour l'oralisation TTS).
- Chaque sujet est accompagné de sa **traduction automatique en afar produite par Claude** (`mt_model = Claude`, `mt_prompt_version = fr-aa-v1`). Ces traductions n'ont pas été vérifiées par un locuteur : c'est précisément le rôle de la révision. Les termes administratifs sans équivalent établi sont souvent laissés en français.
- Le premier segment reprend la paire de référence fournie par le client.

## Travail à plusieurs

- **Comptes** : l'administrateur invite une personne dans *Paramètres → Équipe* (adresse, nom, code, rôle). Elle reçoit un **lien d'activation** (valable 7 jours, à usage unique) qui ouvre une page où elle confirme son nom et choisit son mot de passe, puis elle est connectée directement. Statut « Invitation en attente » tant que le lien n'est pas utilisé ; « Renvoyer l'invitation », « Réinitialiser le mot de passe » (lien valable 24 h) et « Supprimer » sont disponibles. Sur l'écran de connexion, « Mot de passe oublié ? » envoie un lien de réinitialisation. Chacun peut modifier son nom et son mot de passe dans *Mon compte*.
- **Envoi des e-mails** : via [Brevo](https://www.brevo.com) (offre gratuite : 300 e-mails/jour) lorsque les secrets `BREVO_API_KEY` et `MAIL_SENDER` (adresse d'expéditeur validée dans Brevo) sont définis pour la fonction `admin-users` ; `MAIL_SENDER_NAME` est facultatif. Tant que ce n'est pas configuré, l'atelier affiche le message et le lien à transmettre soi-même (copie ou ouverture dans la messagerie).
- **Répartition** : *Paramètres → Répartition du travail* attribue chaque lot à un linguiste ; il le retrouve avec le filtre « Mes segments ». Le tableau de bord affiche l'avancement par linguiste.
- **Verrous** : un segment ouvert est réservé à la personne qui l'a ouvert. Les autres le voient « … y travaille » dans la liste et en lecture seule (avec « Prendre la main » si nécessaire). Le verrou est rafraîchi chaque minute et expire après 5 minutes d'inactivité.
- **Temps réel** : révisions, verrous, attributions, glossaire et enregistrements se mettent à jour instantanément sur tous les postes. L'en-tête indique les collègues en train de réviser.
- Après une décision, l'atelier ouvre automatiquement le **prochain segment libre à traiter** de la liste.

## Fonctionnalités

### Révision des traductions
Liste filtrable (linguiste, statut, lot, domaine, recherche plein texte) ; texte français avec termes du glossaire surlignés ; traduction automatique conservée telle quelle ; éditeur afar (`lang="aa"`, sans correction orthographique) ; diff mot à mot et pourcentage de mots modifiés ; *Valider sans modification*, *Enregistrer la correction*, *Rejeter — À retraduire*, *Signaler un problème*, *Passer au suivant* ; brouillon enregistré automatiquement ; annotations d'erreurs (exactitude, fluidité, terminologie, style, conventions ; gravité) ; historique ; chronomètre ; raccourcis (`Ctrl/Cmd + Entrée`, `Ctrl/Cmd + Maj + Entrée`, `Alt + ←/→`, `?`).

### Glossaire
Recherche, ajout, modification, propositions de correction. Les entrées initiales sont au statut « Non vérifié ».

### Enregistrement audio
Consentement et profil vocal du locuteur ; choix et test du micro (vumètre dBFS, bruit ambiant sur 5 s) ; file des phrases validées/corrigées ; distinction `text_display` / `text_spoken` avec avertissement sur les nombres, sigles et emprunts (aucune transcription automatique) ; enregistrement (bouton ou barre d'espace, compte à rebours, forme d'onde, alertes de saturation/niveau faible) ; contrôle qualité avec confirmation obligatoire ; nouvelle prise sans perte de l'ancienne ; une traduction modifiée après enregistrement repasse « À refaire ».

Format : WAV PCM 16 bits mono à la fréquence native de la carte son, sans rééchantillonnage ni compression. Le micro exige HTTPS (GitHub Pages) ou `localhost`.

### Exports
- **Corpus FR–Afar** : `revisions_<date>.jsonl` (+ CSV pour Excel) — `segment_id`, `source_fr`, `mt_afar`, `corrected_afar`, `status`, `reviewer_id`, `error_annotations`, `review_duration_seconds`, `mt_model`, `mt_prompt_version`, `reviewed_at`…
- **Corpus TTS** : `afar_tts_dataset_<date>.zip` — `wavs/`, `metadata.jsonl`, `metadata.csv` (format LJSpeech), `speakers.json`, `README.txt`. Seules les prises courantes, validées, confirmées, liées à une traduction toujours approuvée et à un consentement valide sont incluses ; l'archive est relue et vérifiée avant téléchargement.

## Architecture

Site **100 % statique** (modules JavaScript natifs, aucune compilation), hébergé sur GitHub Pages. Les données sont stockées sur un projet **Supabase** (Postgres, stockage de fichiers, authentification, temps réel) hébergé à Francfort (UE).

```text
atelier-afar/
├── index.html, css/app.css
├── js/
│   ├── main.js                    Démarrage, connexion, en-tête, routage
│   ├── config.js                  Adresse du serveur et clé publique, durée des verrous
│   ├── services/
│   │   ├── DataService.js         Contrat d'accès aux données
│   │   └── SupabaseDataService.js Implémentation (lectures, écritures, temps réel, verrous, comptes)
│   ├── pages/                     review.js, recording.js, dashboard.js, settings.js
│   ├── components/                ui.js, glossaryPanel.js, annotationsPanel.js, speakerConsent.js, accentPalette.js
│   ├── audio/                     recorder.js, recorder-worklet.js, wav.js, levels.js, waveform.js
│   └── utils/                     status.js (règles métier), diff.js, detect.js, export.js, exporter.js, dom.js, defaults.js
├── supabase/
│   ├── migrations/                Schéma, règles d'accès (RLS), stockage audio, collaboration
│   ├── functions/admin-users/     Fonction serveur : invitations, activation, mot de passe oublié, suppression de comptes
│   └── seed/corpus.json           Les 514 sujets chargés
└── tests/                         Tests unitaires (node --test)
```

### Sécurité
- Règles d'accès (RLS) sur toutes les tables et sur le stockage audio : un visiteur non connecté ne voit rien, un compte qui n'est pas dans `members` non plus.
- Les linguistes lisent et écrivent révisions, glossaire, locuteurs et prises ; seuls les administrateurs gèrent l'équipe, les attributions et la suppression globale des enregistrements.
- La clé utilisée par le site est la clé *publishable*, publique par conception. La clé de service n'est utilisée que dans la fonction serveur `admin-users`.

## Développement

```bash
cd atelier-afar
python3 -m http.server 8000     # puis http://localhost:8000
npm test                        # 51 tests, Node 20+, aucune dépendance
```

Le déploiement est automatique à chaque push sur `main` (workflow GitHub Pages du dépôt).

## Limites connues
- Offre gratuite Supabase : le projet est mis en pause après une période d'inactivité prolongée (le relancer depuis le tableau de bord Supabase) ; 1 Go de stockage de fichiers (≈ 3 h d'audio WAV 48 kHz).
- Le brouillon d'un segment est partagé : si un linguiste « prend la main », c'est la dernière version enregistrée qui fait foi.
