// Définitions de types (JSDoc) partagées par toute l'application.
// Ce fichier ne contient pas de code exécutable : il documente le modèle de données
// que le futur backend devra exposer à l'identique (voir README, « Intégration backend »).

/**
 * Segment source fourni par le pipeline de traduction automatique.
 * @typedef {Object} Segment
 * @property {string} id
 * @property {string} lot
 * @property {string} domaine
 * @property {string} source_fr
 * @property {string} mt_afar            Traduction automatique d'origine (jamais modifiée).
 * @property {string} mt_model
 * @property {string} mt_prompt_version
 * @property {string} created_at         ISO 8601
 */

/**
 * @typedef {'a_reviser'|'en_cours'|'valide'|'corrige'|'rejete'|'signale'} ReviewStatus
 */

/**
 * Catégorie d'erreur de traduction (typologie inspirée de MQM).
 * @typedef {'exactitude'|'fluidite'|'terminologie'|'style'|'conventions'} ErrorCategory
 */

/**
 * @typedef {Object} ErrorAnnotation
 * @property {string} id
 * @property {ErrorCategory} category
 * @property {string} [subcategory]
 * @property {'mineure'|'majeure'|'critique'} severity
 * @property {string} [comment]
 * @property {string} created_at
 * @property {string} author_id
 */

/**
 * Version enregistrée d'une traduction (historique).
 * @typedef {Object} ReviewVersion
 * @property {string} text
 * @property {ReviewStatus} status
 * @property {string} saved_at
 * @property {string} reviewer_id
 */

/**
 * Révision humaine d'un segment.
 * @typedef {Object} Review
 * @property {string} segment_id
 * @property {ReviewStatus} status
 * @property {string|null} corrected_afar  Dernière version approuvée par le linguiste (null tant qu'aucune décision).
 * @property {string|null} draft_afar      Brouillon en cours (sauvegarde automatique).
 * @property {string|null} draft_saved_at
 * @property {string|null} reviewer_id
 * @property {string|null} reviewed_at
 * @property {string|null} flag_comment    Motif du signalement ou du rejet.
 * @property {ErrorAnnotation[]} annotations
 * @property {number} duration_seconds     Temps de révision cumulé.
 * @property {number} text_version         Incrémenté à chaque changement du texte approuvé.
 * @property {ReviewVersion[]} history     Versions enregistrées (la traduction machine reste dans Segment.mt_afar).
 */

/**
 * @typedef {'brouillon'|'valide'|'a_refaire'} TakeQuality
 * @typedef {'a_enregistrer'|'en_cours'|'enregistre'|'a_refaire'} AudioStatus
 */

/**
 * Prise audio (une phrase peut avoir plusieurs prises ; une seule est « courante » par locuteur).
 * @typedef {Object} Recording
 * @property {string} id
 * @property {string} segment_id
 * @property {string} speaker_id
 * @property {string} text_display        Texte afar validé affiché au moment de la prise.
 * @property {string} text_spoken         Transcription exacte de ce qui a été prononcé.
 * @property {number} text_version        Version du texte approuvé au moment de la prise.
 * @property {number} duration_seconds
 * @property {number} sample_rate
 * @property {string} format              'audio/wav; PCM s16le; mono'
 * @property {number} size_bytes
 * @property {string} recorded_at
 * @property {TakeQuality} quality_status
 * @property {boolean} current            Prise courante pour (segment, locuteur).
 * @property {boolean} confirmed          Case « l'enregistrement correspond exactement au texte prononcé ».
 * @property {{bruit:boolean, hesitation:boolean, prononciation:boolean, erreur_lecture:boolean}} flags
 * @property {string[]} warnings          Codes d'avertissement qualité calculés après la prise.
 * @property {number|null} peak_dbfs
 * @property {number|null} rms_dbfs
 * @property {string|null} invalidated_reason
 * @property {string|null} validated_at
 */

/**
 * @typedef {Object} Speaker
 * @property {string} id
 * @property {string} name
 * @property {string} [sexe]
 * @property {string} [age_range]
 * @property {string} dialect
 * @property {string} [region]
 * @property {string} [notes]
 * @property {string} created_at
 */

/**
 * @typedef {Object} Consent
 * @property {string} speaker_id
 * @property {string} speaker_name
 * @property {boolean} consent_given
 * @property {boolean} training_reuse
 * @property {string} consent_date        AAAA-MM-JJ
 * @property {string} recorded_at
 * @property {string|null} withdrawn_at
 * @property {string} text_version        Version du texte de consentement affiché.
 */

/**
 * @typedef {'non_verifie'|'propose'|'valide_linguiste'} GlossaryStatus
 */

/**
 * @typedef {Object} GlossaryEntry
 * @property {string} id
 * @property {string} fr
 * @property {string} afar
 * @property {string} domaine
 * @property {string} notes
 * @property {GlossaryStatus} status
 * @property {'linguiste'} source
 * @property {string|null} [validated_by]   Réservé : attribution future du statut « Terme validé par un linguiste ».
 * @property {string|null} [validated_at]
 * @property {Array<{afar:string, comment:string, by:string, at:string}>} [proposals]
 * @property {string} [updated_at]
 * @property {string} [updated_by]
 */

/**
 * @typedef {Object} Linguist
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} Settings
 * @property {string} projectName
 * @property {string} activeLinguistId
 * @property {string|null} activeSpeakerId
 * @property {number} textScale            1 = normal
 * @property {boolean} accentPalette
 * @property {boolean} countdown
 * @property {boolean} showFrenchWhileRecording
 * @property {string|null} micDeviceId
 * @property {{clipDbfs:number, lowRmsDbfs:number, minDuration:number, maxDuration:number, noiseWarnDbfs:number}} audio
 * @property {string[]} dialects
 */

export {};
