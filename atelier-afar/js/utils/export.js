// Construction des fichiers d'export (fonctions pures, testables sous Node).
import { REVIEW_STATUS, exclusionReason, normalizeSpaces } from './status.js';

export const EXPORT_SCHEMA_VERSION = '1.0';

/** Normalisation documentée : Unicode NFC + espaces fusionnés. Aucune réécriture linguistique. */
export const normalizeText = (s) => normalizeSpaces(String(s ?? '').normalize('NFC'));

/**
 * Une ligne par segment. La traduction machine (mt_afar) et la correction humaine (corrected_afar)
 * restent dans deux champs distincts.
 */
export function buildRevisionRecords(segments, reviews) {
  return segments.map((s) => {
    const r = reviews[s.id];
    return {
      segment_id: s.id,
      lot: s.lot,
      domaine: s.domaine,
      source_fr: s.source_fr,
      mt_afar: s.mt_afar,
      corrected_afar: r?.corrected_afar ?? null,
      human_edited: r?.status === 'corrige',
      status: r?.status ?? 'a_reviser',
      status_label: REVIEW_STATUS[r?.status ?? 'a_reviser'],
      status_simulated: !!r?.simulated,
      flag_comment: r?.flag_comment ?? null,
      reviewer_id: r?.reviewer_id ?? null,
      error_annotations: (r?.annotations ?? []).map(({ id, category, subcategory, severity, comment, created_at, author_id }) =>
        ({ id, category, subcategory: subcategory || null, severity, comment: comment || null, created_at, author_id })),
      review_duration_seconds: Math.round(r?.duration_seconds ?? 0),
      text_version: r?.text_version ?? 0,
      mt_model: s.mt_model,
      mt_prompt_version: s.mt_prompt_version,
      mt_created_at: s.created_at,
      reviewed_at: r?.reviewed_at ?? null,
      schema_version: EXPORT_SCHEMA_VERSION,
      demo_data: true,
    };
  });
}

export const toJsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');

/** CSV pour Excel (séparateur « ; », BOM UTF-8). */
export function toCsv(records, columns) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(';'), ...records.map((r) => columns.map((c) => cell(r[c])).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export const REVISION_CSV_COLUMNS = [
  'segment_id', 'lot', 'domaine', 'status_label', 'status_simulated', 'source_fr', 'mt_afar', 'corrected_afar',
  'human_edited', 'reviewer_id', 'review_duration_seconds', 'error_annotations', 'flag_comment', 'mt_model',
  'mt_prompt_version', 'reviewed_at',
];

/** Nom de fichier sûr pour une prise. */
export const wavFileName = (segmentId, speakerId) =>
  `${segmentId}_${speakerId}`.replace(/[^A-Za-z0-9_-]+/g, '_') + '.wav';

/**
 * Sélectionne les prises éligibles au corpus TTS et construit leurs métadonnées.
 * @returns {{ entries: Array<{ take: object, path: string, meta: object }>, excluded: Array<{ take: object, reason: string }> }}
 */
export function buildTtsManifest(segments, reviews, takes, consents, speakers) {
  const segById = new Map(segments.map((s) => [s.id, s]));
  const entries = [];
  const excluded = [];
  for (const take of takes) {
    const segment = segById.get(take.segment_id);
    const review = reviews[take.segment_id];
    const reason = !segment ? 'segment inconnu' : exclusionReason(take, review, consents[take.speaker_id]);
    if (reason) { excluded.push({ take, reason }); continue; }
    const path = `wavs/${wavFileName(take.segment_id, take.speaker_id)}`;
    const speaker = speakers.find((s) => s.id === take.speaker_id);
    entries.push({
      take,
      path,
      meta: {
        segment_id: take.segment_id,
        recording_id: take.id,
        audio_filepath: path,
        text_display: take.text_display,
        text_spoken: take.text_spoken,
        normalized_text: normalizeText(take.text_spoken),
        source_fr: segment.source_fr,
        speaker_id: take.speaker_id,
        dialect: speaker?.dialect ?? null,
        duration_seconds: Math.round(take.duration_seconds * 1000) / 1000,
        sample_rate: take.sample_rate,
        audio_format: 'wav_pcm_s16le_mono',
        quality_status: take.quality_status,
        quality_flags: take.flags,
        quality_warnings: take.warnings,
        peak_dbfs: take.peak_dbfs ?? null,
        rms_dbfs: take.rms_dbfs ?? null,
        translation_status: review.status,
        translation_status_simulated: !!review.simulated,
        text_version: take.text_version,
        recorded_at: take.recorded_at,
        validated_at: take.validated_at ?? null,
        schema_version: EXPORT_SCHEMA_VERSION,
      },
    });
  }
  // Un même chemin ne doit jamais désigner deux fichiers.
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.path)) throw new Error(`Chemin audio en double dans l'export : ${e.path}`);
    seen.add(e.path);
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, excluded };
}

/** metadata.csv au format LJSpeech : id|transcription|transcription normalisée (sans en-tête). */
export function buildLjspeechCsv(entries) {
  const clean = (s) => String(s).replace(/[|\r\n]+/g, ' ').trim();
  return entries.map((e) => [
    e.path.replace(/^wavs\//, '').replace(/\.wav$/, ''),
    clean(e.meta.text_spoken),
    clean(e.meta.normalized_text),
  ].join('|')).join('\n') + (entries.length ? '\n' : '');
}

export function buildSpeakersJson(speakers, consents, entries) {
  const used = new Set(entries.map((e) => e.meta.speaker_id));
  return speakers.filter((s) => used.has(s.id)).map((s) => {
    const c = consents[s.id];
    return {
      speaker_id: s.id,
      name: s.name,
      sexe: s.sexe || null,
      age_range: s.age_range || null,
      dialect: s.dialect,
      region: s.region || null,
      notes: s.notes || null,
      consent: c ? { consent_given: c.consent_given, training_reuse: c.training_reuse, consent_date: c.consent_date, consent_text_version: c.text_version } : null,
      recordings: entries.filter((e) => e.meta.speaker_id === s.id).length,
    };
  });
}

export function buildTtsReadme({ projectName, exportedAt, entries, excluded }) {
  const total = entries.reduce((a, e) => a + e.meta.duration_seconds, 0);
  const rates = [...new Set(entries.map((e) => e.meta.sample_rate))].join(', ') || '—';
  return `${projectName} — corpus TTS afar (Qafar af)
Exporté le : ${exportedAt}
Version du schéma : ${EXPORT_SCHEMA_VERSION}

/!\\ JEU DE DÉMONSTRATION : les textes source et les traductions sont fictifs et non vérifiés.
Les enregistrements sont réels mais ont été produits dans un environnement de test.

CONTENU
  wavs/            Fichiers WAV, PCM signé 16 bits little-endian, mono, fréquence native de la carte son
                   (aucun rééchantillonnage). Fréquence(s) présente(s) : ${rates} Hz.
  metadata.jsonl   Une ligne JSON par enregistrement (détail des champs ci-dessous).
  metadata.csv     Format LJSpeech : identifiant|transcription|transcription normalisée (sans en-tête,
                   séparateur « | »). L'identifiant est le nom du fichier sans « .wav ».
  speakers.json    Profils des locuteurs et informations de consentement.

STATISTIQUES
  Enregistrements : ${entries.length}
  Durée totale    : ${(total / 60).toFixed(2)} min
  Prises exclues  : ${excluded.length} (non validées, non courantes, texte modifié, consentement absent…)

RÈGLES D'INCLUSION
  Une prise est exportée uniquement si : elle est la prise courante du locuteur pour ce segment,
  elle a été validée par le linguiste, la case « l'enregistrement correspond exactement au texte
  prononcé » a été cochée, la traduction est toujours Validée ou Corrigée, le texte n'a pas changé
  depuis la prise, et le locuteur a donné un consentement valide (non retiré) incluant la
  réutilisation pour l'entraînement.

CHAMPS DE metadata.jsonl
  segment_id          Identifiant du segment source.
  recording_id        Identifiant unique de la prise.
  audio_filepath      Chemin relatif du WAV dans l'archive (vérifié à l'export).
  text_display        Texte afar validé affiché au locuteur (peut contenir chiffres, sigles…).
  text_spoken         Transcription exacte de ce qui est prononcé, saisie par le linguiste.
                      C'est CE champ qui correspond à l'audio.
  normalized_text     text_spoken après normalisation technique uniquement : Unicode NFC et
                      fusion des espaces. Aucune conversion de nombres, aucune translittération,
                      aucune modification de casse ou de ponctuation.
  source_fr           Texte français d'origine (référence).
  speaker_id, dialect Locuteur et dialecte déclaré.
  duration_seconds    Durée mesurée de l'audio.
  sample_rate         Fréquence d'échantillonnage réelle du fichier (Hz).
  audio_format        wav_pcm_s16le_mono.
  quality_status      Statut de la prise (toujours « valide » dans cet export).
  quality_flags       Signalements cochés par le linguiste (bruit, hésitation, prononciation, erreur de lecture).
  quality_warnings    Avertissements automatiques (saturation, niveau faible, durée) — indicatifs.
  peak_dbfs, rms_dbfs Niveaux mesurés.
  translation_status  Statut de la traduction (valide | corrige) ; *_simulated = statut simulé de démonstration.
  text_version        Version du texte approuvé au moment de la prise.
  recorded_at, validated_at  Dates ISO 8601 (UTC).
`;
}
