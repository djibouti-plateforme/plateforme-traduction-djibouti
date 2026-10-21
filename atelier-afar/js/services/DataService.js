// Contrat d'accès aux données. Les composants ne connaissent que cette interface :
// SupabaseDataService l'implémente ; une autre API pourra la remplacer sans toucher à l'interface.
//
// Modèle : lecture synchrone d'un instantané en mémoire (snapshot) + commandes asynchrones.
// Après chaque commande réussie, le service notifie les abonnés (subscribe).

/* eslint-disable no-unused-vars */
export class DataService {
  /** Mode de fonctionnement affiché à l'utilisateur. */
  get mode() { return 'abstract'; }

  /** Charge les données initiales. */
  async init() { throw new Error('non implémenté'); }

  /**
   * Instantané en lecture seule de l'état courant.
   * @returns {{
   *   segments: import('../types.js').Segment[],
   *   reviews: Record<string, import('../types.js').Review>,
   *   takes: import('../types.js').Recording[],
   *   glossary: import('../types.js').GlossaryEntry[],
   *   speakers: import('../types.js').Speaker[],
   *   consents: Record<string, import('../types.js').Consent>,
   *   linguists: import('../types.js').Linguist[],
   *   settings: import('../types.js').Settings,
   * }}
   */
  snapshot() { throw new Error('non implémenté'); }

  /** @param {(topic: string) => void} listener @returns {() => void} */
  subscribe(listener) { throw new Error('non implémenté'); }

  // --- Révisions -----------------------------------------------------------
  /** @returns {import('../types.js').Review} */
  getReview(segmentId) { throw new Error('non implémenté'); }
  async saveDraft(segmentId, text) { throw new Error('non implémenté'); }
  async touchReview(segmentId) { throw new Error('non implémenté'); }
  /**
   * @param {'validate'|'correct'|'reject'|'flag'} action
   * @returns {Promise<{ ok: boolean, error?: string, invalidatedTakes: number }>}
   */
  async reviewAction(segmentId, action, payload) { throw new Error('non implémenté'); }
  async addAnnotation(segmentId, annotation) { throw new Error('non implémenté'); }
  async removeAnnotation(segmentId, annotationId) { throw new Error('non implémenté'); }
  async addReviewTime(segmentId, seconds) { throw new Error('non implémenté'); }

  // --- Glossaire ------------------------------------------------------------
  async saveGlossaryEntry(entry) { throw new Error('non implémenté'); }
  async proposeGlossaryCorrection(entryId, proposal) { throw new Error('non implémenté'); }

  // --- Locuteurs et consentement --------------------------------------------
  async saveSpeaker(speaker) { throw new Error('non implémenté'); }
  async saveConsent(consent) { throw new Error('non implémenté'); }
  async withdrawConsent(speakerId, { deleteRecordings }) { throw new Error('non implémenté'); }

  // --- Enregistrements ------------------------------------------------------
  /** @returns {Promise<import('../types.js').Recording>} */
  async saveTake(meta, wavBuffer) { throw new Error('non implémenté'); }
  async updateTake(takeId, patch) { throw new Error('non implémenté'); }
  async validateTake(takeId, { textSpoken, flags, confirmed }) { throw new Error('non implémenté'); }
  /** @returns {Promise<ArrayBuffer|null>} */
  async getTakeAudio(takeId) { throw new Error('non implémenté'); }
  async deleteTake(takeId) { throw new Error('non implémenté'); }
  async deleteAllTakes() { throw new Error('non implémenté'); }

  // --- Paramètres et maintenance --------------------------------------------
  async saveSettings(patch) { throw new Error('non implémenté'); }
  async storageInfo() { throw new Error('non implémenté'); }
}
