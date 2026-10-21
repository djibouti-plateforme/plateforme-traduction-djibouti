// Implémentation locale de DataService : localStorage pour les annotations et préférences,
// IndexedDB pour les prises audio. Aucune requête réseau hormis le chargement des fichiers
// de démonstration servis avec l'application.
import { DataService } from './DataService.js';
import * as idb from './idb.js';
import { emptyReview, applyReviewAction, invalidateTakes } from '../utils/status.js';

const STORAGE_KEY = 'atelier-afar.v1';
const SIMULATED_VALIDATED = ['seg_002', 'seg_004', 'seg_006', 'seg_010', 'seg_015'];

export const DEFAULT_DIALECTS = ['Aussa', 'Baadu', 'Afar central', 'Afar du Nord', 'Autre'];

export const uid = (prefix) =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 12)}`;

const nowIso = () => new Date().toISOString();

function defaultSettings() {
  return {
    projectName: 'Atelier Afar',
    activeLinguistId: 'ling_demo',
    activeSpeakerId: null,
    textScale: 1,
    accentPalette: false,
    countdown: true,
    showFrenchWhileRecording: true,
    micDeviceId: null,
    audio: { clipDbfs: -1, lowRmsDbfs: -40, minDuration: 1, maxDuration: 15, noiseWarnDbfs: -50 },
    dialects: [...DEFAULT_DIALECTS],
  };
}

export class MockDataService extends DataService {
  constructor() {
    super();
    this.listeners = new Set();
    this.segments = [];
    this.seedGlossary = [];
    this.state = null;
    this.takes = [];
    this.audioAvailable = true;
  }

  get mode() { return 'demo'; }

  async init() {
    const [segments, glossary] = await Promise.all([
      fetch(new URL('../mocks/segments.json', import.meta.url)).then((r) => r.json()),
      fetch(new URL('../mocks/glossary.json', import.meta.url)).then((r) => r.json()),
    ]);
    this.segments = segments;
    this.seedGlossary = glossary;
    this.state = this.#load() ?? this.#seed();
    this.state.settings = { ...defaultSettings(), ...this.state.settings, audio: { ...defaultSettings().audio, ...this.state.settings?.audio } };
    try {
      this.takes = await idb.getAll(idb.STORES.takes);
    } catch (err) {
      this.audioAvailable = false;
      this.audioError = err.message;
      this.takes = [];
    }
  }

  #seed() {
    const reviews = {};
    for (const id of SIMULATED_VALIDATED) {
      const seg = this.segments.find((s) => s.id === id);
      if (!seg) continue;
      const { review } = applyReviewAction(emptyReview(id), seg, 'validate', { reviewerId: 'simulation', now: nowIso() });
      reviews[id] = { ...review, simulated: true };
    }
    const state = {
      version: 1,
      seededAt: nowIso(),
      reviews,
      glossary: this.seedGlossary.map((g) => ({ proposals: [], validated_by: null, validated_at: null, ...g })),
      speakers: [],
      consents: {},
      linguists: [{ id: 'ling_demo', name: 'Linguiste (démo)' }],
      settings: defaultSettings(),
    };
    this.#persist(state);
    return state;
  }

  #load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  #persist(state = this.state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      this.#emit('storage-error');
      throw new Error('Impossible d\'écrire dans le stockage local du navigateur (espace plein ou navigation privée).');
    }
  }

  #emit(topic) { this.listeners.forEach((fn) => fn(topic)); }

  #commit(topic) {
    this.#persist();
    this.#emit(topic);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    const s = this.state;
    return {
      segments: this.segments,
      reviews: s.reviews,
      takes: this.takes,
      glossary: s.glossary,
      speakers: s.speakers,
      consents: s.consents,
      linguists: s.linguists,
      settings: s.settings,
    };
  }

  get reviewerId() { return this.state.settings.activeLinguistId; }

  // --- Révisions -----------------------------------------------------------
  getReview(segmentId) {
    return this.state.reviews[segmentId] ?? emptyReview(segmentId);
  }

  #segment(id) {
    const seg = this.segments.find((s) => s.id === id);
    if (!seg) throw new Error(`Segment inconnu : ${id}`);
    return seg;
  }

  async saveDraft(segmentId, text) {
    const { review } = applyReviewAction(this.getReview(segmentId), this.#segment(segmentId), 'draft', { text, reviewerId: this.reviewerId, now: nowIso() });
    this.state.reviews[segmentId] = review;
    this.#commit('reviews');
    return review;
  }

  async touchReview(segmentId) {
    const before = this.getReview(segmentId);
    if (before.status !== 'a_reviser') return before;
    const { review } = applyReviewAction(before, this.#segment(segmentId), 'touch', { reviewerId: this.reviewerId, now: nowIso() });
    this.state.reviews[segmentId] = review;
    this.#commit('reviews');
    return review;
  }

  async reviewAction(segmentId, action, payload = {}) {
    const res = applyReviewAction(this.getReview(segmentId), this.#segment(segmentId), action, { ...payload, reviewerId: this.reviewerId, now: nowIso() });
    if (res.error) return { ok: false, error: res.error, invalidatedTakes: 0 };
    this.state.reviews[segmentId] = res.review;
    let invalidatedTakes = 0;
    if (res.textChanged) {
      const { takes, changed } = invalidateTakes(this.takes, segmentId, `Texte approuvé modifié le ${new Date().toLocaleString('fr-FR')}`);
      if (changed.length) {
        await idb.putMany(idb.STORES.takes, takes.filter((t) => changed.includes(t.id)));
        this.takes = takes;
        invalidatedTakes = changed.length;
      }
    }
    this.#commit('reviews');
    return { ok: true, invalidatedTakes };
  }

  async addAnnotation(segmentId, annotation) {
    const review = { ...this.getReview(segmentId) };
    review.annotations = [...review.annotations, { id: uid('ann'), created_at: nowIso(), author_id: this.reviewerId, ...annotation }];
    if (review.status === 'a_reviser') review.status = 'en_cours';
    this.state.reviews[segmentId] = review;
    this.#commit('reviews');
  }

  async removeAnnotation(segmentId, annotationId) {
    const review = { ...this.getReview(segmentId) };
    review.annotations = review.annotations.filter((a) => a.id !== annotationId);
    this.state.reviews[segmentId] = review;
    this.#commit('reviews');
  }

  async addReviewTime(segmentId, seconds) {
    if (!(seconds > 0)) return;
    const review = { ...this.getReview(segmentId) };
    review.duration_seconds = (review.duration_seconds || 0) + seconds;
    this.state.reviews[segmentId] = review;
    this.#persist(); // pas de notification : évite de redessiner l'écran toutes les secondes
  }

  // --- Glossaire ------------------------------------------------------------
  async saveGlossaryEntry(entry) {
    const list = this.state.glossary;
    const i = list.findIndex((g) => g.id === entry.id);
    const base = i >= 0 ? list[i] : { id: uid('gl'), status: 'non_verifie', source: 'linguiste', proposals: [], validated_by: null, validated_at: null, notes: '', domaine: '' };
    const next = { ...base, ...entry, id: base.id, updated_at: nowIso(), updated_by: this.reviewerId };
    if (i >= 0) list[i] = next; else list.unshift(next);
    this.#commit('glossary');
    return next;
  }

  async proposeGlossaryCorrection(entryId, { afar, comment }) {
    const entry = this.state.glossary.find((g) => g.id === entryId);
    if (!entry) return;
    entry.proposals = [...(entry.proposals ?? []), { afar, comment: comment || '', by: this.reviewerId, at: nowIso() }];
    entry.status = 'propose';
    this.#commit('glossary');
  }

  // --- Locuteurs et consentement --------------------------------------------
  async saveSpeaker(speaker) {
    const list = this.state.speakers;
    const i = list.findIndex((s) => s.id === speaker.id);
    const next = { created_at: nowIso(), ...(i >= 0 ? list[i] : {}), ...speaker };
    if (i >= 0) list[i] = next; else list.push(next);
    this.#commit('speakers');
    return next;
  }

  async saveConsent(consent) {
    this.state.consents[consent.speaker_id] = { ...consent, recorded_at: nowIso(), withdrawn_at: null };
    this.#commit('speakers');
  }

  async withdrawConsent(speakerId, { deleteRecordings }) {
    const c = this.state.consents[speakerId];
    if (c) c.withdrawn_at = nowIso();
    if (deleteRecordings) {
      const ids = this.takes.filter((t) => t.speaker_id === speakerId).map((t) => t.id);
      if (ids.length) await idb.deleteTakesWithAudio(ids);
      this.takes = this.takes.filter((t) => t.speaker_id !== speakerId);
      this.state.speakers = this.state.speakers.filter((s) => s.id !== speakerId);
      delete this.state.consents[speakerId];
      if (this.state.settings.activeSpeakerId === speakerId) this.state.settings.activeSpeakerId = null;
    }
    this.#commit('speakers');
  }

  // --- Enregistrements ------------------------------------------------------
  #requireAudio() {
    if (!this.audioAvailable) throw new Error(this.audioError || 'Stockage audio indisponible.');
  }

  async saveTake(meta, wavBuffer) {
    this.#requireAudio();
    /** @type {import('../types.js').Recording} */
    const take = {
      id: uid('take'),
      quality_status: 'brouillon',
      current: true,
      confirmed: false,
      flags: { bruit: false, hesitation: false, prononciation: false, erreur_lecture: false },
      warnings: [],
      invalidated_reason: null,
      validated_at: null,
      recorded_at: nowIso(),
      format: 'audio/wav; PCM s16le; mono',
      size_bytes: wavBuffer.byteLength,
      ...meta,
    };
    // La prise précédente devient non courante mais reste disponible jusqu'à suppression explicite.
    const demoted = this.takes
      .filter((t) => t.current && t.segment_id === take.segment_id && t.speaker_id === take.speaker_id)
      .map((t) => ({ ...t, current: false }));
    await idb.putTakeWithAudio(take, wavBuffer);
    if (demoted.length) await idb.putMany(idb.STORES.takes, demoted);
    this.takes = [...this.takes.map((t) => demoted.find((d) => d.id === t.id) ?? t), take];
    this.#emit('takes');
    return take;
  }

  async updateTake(takeId, patch) {
    const i = this.takes.findIndex((t) => t.id === takeId);
    if (i < 0) return null;
    const next = { ...this.takes[i], ...patch };
    await idb.put(idb.STORES.takes, next);
    this.takes = this.takes.map((t) => (t.id === takeId ? next : t));
    this.#emit('takes');
    return next;
  }

  async validateTake(takeId, { textSpoken, flags, confirmed }) {
    if (!confirmed) throw new Error('Cochez la confirmation de correspondance entre l\'audio et le texte prononcé.');
    if (!String(textSpoken ?? '').trim()) throw new Error('Le texte prononcé est vide.');
    return this.updateTake(takeId, { text_spoken: textSpoken.trim(), flags, confirmed: true, quality_status: 'valide', validated_at: nowIso() });
  }

  async getTakeAudio(takeId) {
    this.#requireAudio();
    return (await idb.get(idb.STORES.audio, takeId)) ?? null;
  }

  async deleteTake(takeId) {
    await idb.deleteTakesWithAudio([takeId]);
    this.takes = this.takes.filter((t) => t.id !== takeId);
    this.#emit('takes');
  }

  async deleteAllTakes() {
    if (this.audioAvailable) {
      await idb.clear(idb.STORES.takes);
      await idb.clear(idb.STORES.audio);
    }
    this.takes = [];
    this.#emit('takes');
  }

  // --- Paramètres et maintenance --------------------------------------------
  async saveSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch, audio: { ...this.state.settings.audio, ...(patch.audio ?? {}) } };
    this.#commit('settings');
  }

  async addLinguist(name) {
    const l = { id: uid('ling'), name: name.trim() };
    this.state.linguists.push(l);
    this.#commit('settings');
    return l;
  }

  async storageInfo() {
    let usage = null;
    let quota = null;
    try {
      const est = await navigator.storage?.estimate?.();
      usage = est?.usage ?? null;
      quota = est?.quota ?? null;
    } catch { /* non disponible */ }
    let persisted = null;
    try { persisted = await navigator.storage?.persisted?.(); } catch { /* idem */ }
    return {
      usage,
      quota,
      persisted,
      takes: this.takes.length,
      audioBytes: this.takes.reduce((a, t) => a + (t.size_bytes || 0), 0),
      localBytes: (localStorage.getItem(STORAGE_KEY) || '').length * 2,
    };
  }

  /** Réinitialise révisions, glossaire et statuts simulés. Les locuteurs et les prises sont conservés. */
  async resetDemo() {
    const keep = { speakers: this.state.speakers, consents: this.state.consents, linguists: this.state.linguists, settings: this.state.settings };
    this.state = { ...this.#seed(), ...keep };
    this.#commit('reset');
  }
}
