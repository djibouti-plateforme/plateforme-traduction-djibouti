// Règles métier pures : transitions de statut des révisions, file audio,
// invalidation des prises et éligibilité à l'export. Aucune dépendance au DOM.

export const REVIEW_STATUS = {
  a_reviser: 'À réviser',
  en_cours: 'En cours',
  valide: 'Validé',
  corrige: 'Corrigé',
  rejete: 'Rejeté',
  signale: 'Signalé',
};

export const AUDIO_STATUS = {
  a_enregistrer: 'À enregistrer',
  en_cours: 'En cours',
  enregistre: 'Enregistré',
  a_refaire: 'À refaire',
};

const APPROVED = new Set(['valide', 'corrige']);
const HISTORY_LIMIT = 20;

/** @param {string} s */
export const normalizeSpaces = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * @param {string} segmentId
 * @returns {import('../types.js').Review}
 */
export function emptyReview(segmentId) {
  return {
    segment_id: segmentId,
    status: 'a_reviser',
    corrected_afar: null,
    last_approved_text: null,
    draft_afar: null,
    draft_saved_at: null,
    reviewer_id: null,
    reviewed_at: null,
    flag_comment: null,
    annotations: [],
    duration_seconds: 0,
    text_version: 0,
    history: [],
  };
}

/** @param {import('../types.js').Review|undefined|null} review */
export const isApproved = (review) => !!review && APPROVED.has(review.status);

/** Texte afar actuellement approuvé (null si le segment n'est pas Validé/Corrigé). */
export function approvedText(review) {
  return isApproved(review) ? review.corrected_afar : null;
}

/** Texte à afficher dans l'éditeur : brouillon, sinon version approuvée, sinon traduction machine. */
export function editorText(review, segment) {
  return review?.draft_afar ?? review?.corrected_afar ?? segment.mt_afar;
}

/**
 * Applique une action du linguiste à une révision (fonction pure).
 * @param {import('../types.js').Review} review
 * @param {import('../types.js').Segment} segment
 * @param {'draft'|'touch'|'validate'|'correct'|'reject'|'flag'} action
 * @param {{ text?: string, comment?: string, reviewerId: string, now: string }} payload
 * @returns {{ review: import('../types.js').Review, textChanged: boolean, error?: string }}
 */
export function applyReviewAction(review, segment, action, payload) {
  const { reviewerId, now } = payload;
  const r = { ...review, annotations: [...review.annotations], history: [...review.history] };
  let textChanged = false;

  const approve = (status, text) => {
    if (text !== r.last_approved_text) {
      r.text_version += 1;
      r.last_approved_text = text;
      textChanged = true;
    }
    r.status = status;
    r.corrected_afar = text;
    r.draft_afar = null;
    r.draft_saved_at = null;
    r.flag_comment = null;
    r.reviewer_id = reviewerId;
    r.reviewed_at = now;
    r.simulated = false;
    pushHistory(r, { text, status, saved_at: now, reviewer_id: reviewerId });
  };

  switch (action) {
    case 'draft': {
      const text = payload.text ?? '';
      const reference = r.corrected_afar ?? segment.mt_afar;
      r.draft_afar = normalizeSpaces(text) === normalizeSpaces(reference) ? null : text;
      r.draft_saved_at = r.draft_afar === null ? null : now;
      if (r.status === 'a_reviser' && r.draft_afar !== null) r.status = 'en_cours';
      break;
    }
    case 'touch':
      if (r.status === 'a_reviser') r.status = 'en_cours';
      break;
    case 'validate':
      approve('valide', segment.mt_afar);
      break;
    case 'correct': {
      const text = (payload.text ?? '').trim();
      if (!text) return { review, textChanged: false, error: 'La traduction corrigée est vide.' };
      if (normalizeSpaces(text) === normalizeSpaces(segment.mt_afar)) {
        return { review, textChanged: false, error: 'Le texte est identique à la traduction automatique : utilisez « Valider sans modification ».' };
      }
      approve('corrige', text);
      break;
    }
    case 'reject':
    case 'flag': {
      const comment = (payload.comment ?? '').trim();
      if (action === 'flag' && !comment) return { review, textChanged: false, error: 'Décrivez le problème rencontré dans le texte français.' };
      r.status = action === 'reject' ? 'rejete' : 'signale';
      r.flag_comment = comment || null;
      r.corrected_afar = null;
      r.reviewer_id = reviewerId;
      r.reviewed_at = now;
      r.simulated = false;
      pushHistory(r, { text: payload.text ?? r.draft_afar ?? segment.mt_afar, status: r.status, saved_at: now, reviewer_id: reviewerId });
      break;
    }
    default:
      return { review, textChanged: false, error: `Action inconnue : ${action}` };
  }
  return { review: r, textChanged };
}

function pushHistory(r, entry) {
  r.history.push(entry);
  if (r.history.length > HISTORY_LIMIT) r.history.splice(0, r.history.length - HISTORY_LIMIT);
}

/**
 * Invalide les prises courantes d'un segment dont le texte approuvé a changé.
 * Les fichiers ne sont pas supprimés : les prises deviennent « non courantes » et « à refaire ».
 * @param {import('../types.js').Recording[]} takes
 * @param {string} segmentId
 * @param {string} reason
 * @returns {{ takes: import('../types.js').Recording[], changed: string[] }}
 */
export function invalidateTakes(takes, segmentId, reason) {
  const changed = [];
  const next = takes.map((t) => {
    if (t.segment_id !== segmentId || !t.current) return t;
    changed.push(t.id);
    return { ...t, current: false, quality_status: 'a_refaire', invalidated_reason: reason };
  });
  return { takes: next, changed };
}

/**
 * Statut audio d'un segment pour un locuteur.
 * @param {import('../types.js').Review|undefined} review
 * @param {import('../types.js').Recording[]} takes  Prises de ce segment et de ce locuteur.
 * @returns {import('../types.js').AudioStatus|null}  null si le segment n'est pas dans la file.
 */
export function audioStatus(review, takes) {
  if (!isApproved(review)) return null;
  const current = takes.find((t) => t.current);
  if (current) {
    if (current.text_version !== review.text_version) return 'a_refaire';
    if (current.quality_status === 'valide') return 'enregistre';
    if (current.quality_status === 'a_refaire') return 'a_refaire';
    return 'en_cours';
  }
  return takes.some((t) => t.quality_status === 'a_refaire') ? 'a_refaire' : 'a_enregistrer';
}

/**
 * File d'enregistrement : segments Validés ou Corrigés, avec leur statut audio.
 * @param {import('../types.js').Segment[]} segments
 * @param {Record<string, import('../types.js').Review>} reviews
 * @param {import('../types.js').Recording[]} takes
 * @param {string|null} speakerId
 */
export function buildAudioQueue(segments, reviews, takes, speakerId) {
  const out = [];
  for (const segment of segments) {
    const review = reviews[segment.id];
    if (!isApproved(review)) continue;
    const mine = takes.filter((t) => t.segment_id === segment.id && t.speaker_id === speakerId);
    const current = mine.find((t) => t.current) || null;
    const last = mine.reduce((a, t) => (!a || t.recorded_at > a.recorded_at ? t : a), null);
    out.push({
      segment,
      review,
      text: review.corrected_afar,
      status: /** @type {import('../types.js').AudioStatus} */ (audioStatus(review, mine)),
      currentTake: current,
      lastTake: last,
      takeCount: mine.length,
    });
  }
  return out;
}

/** @param {import('../types.js').Consent|undefined|null} consent */
export const consentValid = (consent) =>
  !!consent && consent.consent_given && consent.training_reuse && !consent.withdrawn_at;

/**
 * Une prise peut-elle entrer dans le corpus TTS d'entraînement ?
 * @returns {string|null} null si éligible, sinon la raison de l'exclusion.
 */
export function exclusionReason(take, review, consent) {
  if (!take.current) return 'prise non courante';
  if (take.quality_status !== 'valide') return 'prise non validée';
  if (!take.confirmed) return 'correspondance texte/audio non confirmée';
  if (!isApproved(review)) return 'traduction plus approuvée';
  if (take.text_version !== review.text_version || take.text_display !== review.corrected_afar) return 'texte modifié depuis la prise';
  if (!normalizeSpaces(take.text_spoken)) return 'texte prononcé manquant';
  if (!consentValid(consent)) return 'consentement absent ou retiré';
  return null;
}
