// Implémentation de DataService adossée à Supabase (Postgres + Storage + Auth).
// Même modèle que MockDataService : instantané en mémoire pour l'affichage, commandes asynchrones
// pour les écritures. Les écritures sont sérialisées (ordre garanti) ; en cas d'échec, l'état est
// rechargé depuis le serveur et l'erreur est remontée à l'interface.
import { DataService } from './DataService.js';
import { defaultSettings, uid } from './MockDataService.js';
import { emptyReview, applyReviewAction, invalidateTakes } from '../utils/status.js';
import { SUPABASE } from '../config.js';

const SETTINGS_KEY = 'atelier-afar.cloud.settings';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const SIMULATED_VALIDATED = ['seg_002', 'seg_004', 'seg_006', 'seg_010', 'seg_015'];

const REVIEW_COLUMNS = ['segment_id', 'status', 'corrected_afar', 'last_approved_text', 'draft_afar', 'draft_saved_at', 'reviewer_id',
  'reviewed_at', 'flag_comment', 'annotations', 'duration_seconds', 'text_version', 'history', 'simulated'];
const TAKE_COLUMNS = ['id', 'segment_id', 'speaker_id', 'text_display', 'text_spoken', 'text_version', 'duration_seconds', 'sample_rate',
  'format', 'size_bytes', 'storage_path', 'recorded_at', 'quality_status', 'current', 'confirmed', 'flags', 'warnings', 'warning_messages',
  'peak_dbfs', 'rms_dbfs', 'invalidated_reason', 'validated_at'];

const nowIso = () => new Date().toISOString();
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const num = (v) => (v === null || v === undefined ? v : Number(v));

/** Erreur Supabase → message français. */
function describe(error) {
  const msg = error?.message ?? String(error);
  if (/Invalid login credentials/i.test(msg)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(msg)) return 'Adresse e-mail non confirmée : demandez à l\'administrateur de confirmer le compte.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Connexion au serveur impossible. Vérifiez votre connexion internet.';
  if (/row-level security|permission denied/i.test(msg)) return 'Action refusée : votre compte n\'a pas les droits nécessaires.';
  if (/JWT expired/i.test(msg)) return 'Votre session a expiré : reconnectez-vous.';
  return msg;
}

export class SupabaseDataService extends DataService {
  constructor() {
    super();
    this.listeners = new Set();
    this.client = null;
    this.user = null;
    this.member = null;
    this.members = [];
    this.segments = [];
    this.reviews = {};
    this.glossary = [];
    this.speakers = [];
    this.consents = {};
    this.takes = [];
    this.audioCache = new Map();
    this.queue = Promise.resolve();
    this.audioAvailable = true;
    this.audioError = null;
    this.settings = { ...defaultSettings(), ...this.#loadSettings() };
  }

  get mode() { return 'supabase'; }
  get isAdmin() { return this.member?.role === 'admin'; }
  get reviewerId() { return this.member?.code ?? this.user?.email ?? 'inconnu'; }

  // --- Session ---------------------------------------------------------------
  async #ensureClient() {
    if (this.client) return;
    const { createClient } = await import(SUPABASE_JS);
    this.client = createClient(SUPABASE.url, SUPABASE.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'atelier-afar.auth' },
    });
    this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && this.user) { this.user = null; this.#emit('signed-out'); }
    });
  }

  /**
   * @returns {Promise<{ status: 'ready'|'login'|'forbidden', email?: string }>}
   */
  async init() {
    await this.#ensureClient();
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return { status: 'login' };
    this.user = session.user;
    const { data: me, error } = await this.client.from('members').select('*').eq('email', session.user.email.toLowerCase()).maybeSingle();
    if (error) throw new Error(describe(error));
    if (!me) return { status: 'forbidden', email: session.user.email };
    this.member = me;
    await this.#loadAll();
    return { status: 'ready' };
  }

  async signIn(email, password) {
    await this.#ensureClient();
    const { error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(describe(error));
  }

  async signOut() {
    await this.client?.auth.signOut();
    this.user = null;
  }

  async changePassword(password) {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw new Error(describe(error));
  }

  async #loadAll() {
    const c = this.client;
    const results = await Promise.all([
      c.from('segments').select('id, lot, domaine, source_fr, mt_afar, mt_model, mt_prompt_version, created_at').order('position'),
      c.from('reviews').select('*'),
      c.from('glossary').select('*').order('id'),
      c.from('speakers').select('*').order('created_at'),
      c.from('consents').select('*'),
      c.from('recordings').select('*'),
      c.from('members').select('*').order('created_at'),
    ]);
    const failed = results.find((r) => r.error);
    if (failed) throw new Error(describe(failed.error));
    const [segments, reviews, glossary, speakers, consents, takes, members] = results.map((r) => r.data);
    this.segments = segments;
    this.reviews = Object.fromEntries(reviews.map((r) => [r.segment_id, { ...r, duration_seconds: num(r.duration_seconds) }]));
    this.glossary = glossary;
    this.speakers = speakers;
    this.consents = Object.fromEntries(consents.map((c) => [c.speaker_id, c]));
    this.takes = takes.map((t) => ({ ...t, duration_seconds: num(t.duration_seconds), peak_dbfs: num(t.peak_dbfs), rms_dbfs: num(t.rms_dbfs) }));
    this.members = members;
  }

  /** Recharge tout depuis le serveur (après une erreur, ou à la demande). */
  async refresh() {
    await this.#loadAll();
    this.#emit('reset');
  }

  // --- Infrastructure --------------------------------------------------------------
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(topic) { this.listeners.forEach((fn) => fn(topic)); }

  /** Exécute une écriture distante dans l'ordre ; en cas d'échec, resynchronise et relance l'erreur. */
  #write(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run.catch(async (err) => {
      this.#emit('sync-error');
      try { await this.refresh(); } catch { /* hors ligne */ }
      throw new Error(describe(err));
    });
  }

  static #check({ error }) {
    if (error) throw error;
  }

  #loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  }

  snapshot() {
    return {
      segments: this.segments,
      reviews: this.reviews,
      takes: this.takes,
      glossary: this.glossary,
      speakers: this.speakers,
      consents: this.consents,
      linguists: this.members.map((m) => ({ id: m.code, name: m.display_name })),
      members: this.members,
      settings: { ...this.settings, activeLinguistId: this.member?.code ?? null },
    };
  }

  // --- Révisions -----------------------------------------------------------------
  getReview(segmentId) {
    return this.reviews[segmentId] ?? emptyReview(segmentId);
  }

  #segment(id) {
    const seg = this.segments.find((s) => s.id === id);
    if (!seg) throw new Error(`Segment inconnu : ${id}`);
    return seg;
  }

  #putReview(review) {
    this.reviews[review.segment_id] = review;
    const row = pick(review, REVIEW_COLUMNS);
    return this.#write(async () => SupabaseDataService.#check(await this.client.from('reviews').upsert(row)));
  }

  async saveDraft(segmentId, text) {
    const { review } = applyReviewAction(this.getReview(segmentId), this.#segment(segmentId), 'draft', { text, reviewerId: this.reviewerId, now: nowIso() });
    const p = this.#putReview(review);
    this.#emit('reviews');
    await p;
    return review;
  }

  async touchReview(segmentId) {
    const before = this.getReview(segmentId);
    if (before.status !== 'a_reviser') return before;
    const { review } = applyReviewAction(before, this.#segment(segmentId), 'touch', { reviewerId: this.reviewerId, now: nowIso() });
    const p = this.#putReview(review); // état local mis à jour immédiatement
    this.#emit('reviews');
    await p;
    return review;
  }

  async reviewAction(segmentId, action, payload = {}) {
    const res = applyReviewAction(this.getReview(segmentId), this.#segment(segmentId), action, { ...payload, reviewerId: this.reviewerId, now: nowIso() });
    if (res.error) return { ok: false, error: res.error, invalidatedTakes: 0 };
    let invalidated = [];
    let nextTakes = this.takes;
    if (res.textChanged) {
      const inv = invalidateTakes(this.takes, segmentId, `Texte approuvé modifié le ${new Date().toLocaleString('fr-FR')}`);
      invalidated = inv.takes.filter((t) => inv.changed.includes(t.id));
      nextTakes = inv.takes;
    }
    try {
      await this.#putReview(res.review);
      if (invalidated.length) {
        await this.#write(async () => {
          for (const t of invalidated) {
            SupabaseDataService.#check(await this.client.from('recordings').update({ current: false, quality_status: 'a_refaire', invalidated_reason: t.invalidated_reason }).eq('id', t.id));
          }
        });
        this.takes = nextTakes;
      }
    } catch (err) {
      return { ok: false, error: `Enregistrement impossible : ${err.message}`, invalidatedTakes: 0 };
    }
    this.#emit('reviews');
    return { ok: true, invalidatedTakes: invalidated.length };
  }

  async addAnnotation(segmentId, annotation) {
    const review = { ...this.getReview(segmentId) };
    review.annotations = [...review.annotations, { id: uid('ann'), created_at: nowIso(), author_id: this.reviewerId, ...annotation }];
    if (review.status === 'a_reviser') review.status = 'en_cours';
    await this.#putReview(review);
    this.#emit('reviews');
  }

  async removeAnnotation(segmentId, annotationId) {
    const review = { ...this.getReview(segmentId) };
    review.annotations = review.annotations.filter((a) => a.id !== annotationId);
    await this.#putReview(review);
    this.#emit('reviews');
  }

  async addReviewTime(segmentId, seconds) {
    if (!(seconds > 0)) return;
    const review = { ...this.getReview(segmentId) };
    review.duration_seconds = (review.duration_seconds || 0) + seconds;
    // Pas de notification : évite de redessiner l'écran toutes les 10 secondes.
    this.#putReview(review).catch(() => {});
  }

  // --- Glossaire -------------------------------------------------------------------
  async saveGlossaryEntry(entry) {
    const i = this.glossary.findIndex((g) => g.id === entry.id);
    const base = i >= 0 ? this.glossary[i] : { id: uid('gl'), status: 'non_verifie', source: 'linguiste', proposals: [], validated_by: null, validated_at: null, notes: '', domaine: '' };
    const next = { ...base, ...entry, id: base.id };
    const row = pick(next, ['id', 'fr', 'afar', 'domaine', 'notes', 'status', 'source', 'validated_by', 'validated_at', 'proposals']);
    await this.#write(async () => SupabaseDataService.#check(await this.client.from('glossary').upsert(row)));
    if (i >= 0) this.glossary[i] = next; else this.glossary.unshift(next);
    this.#emit('glossary');
    return next;
  }

  async proposeGlossaryCorrection(entryId, { afar, comment }) {
    const entry = this.glossary.find((g) => g.id === entryId);
    if (!entry) return;
    const proposals = [...(entry.proposals ?? []), { afar, comment: comment || '', by: this.reviewerId, at: nowIso() }];
    await this.#write(async () => SupabaseDataService.#check(await this.client.from('glossary').update({ proposals, status: 'propose' }).eq('id', entryId)));
    Object.assign(entry, { proposals, status: 'propose' });
    this.#emit('glossary');
  }

  // --- Locuteurs et consentement ------------------------------------------------------
  async saveSpeaker(speaker) {
    const i = this.speakers.findIndex((s) => s.id === speaker.id);
    const next = { ...(i >= 0 ? this.speakers[i] : {}), ...speaker };
    const row = pick(next, ['id', 'name', 'sexe', 'age_range', 'dialect', 'region', 'notes']);
    const { data } = await this.#write(async () => {
      const res = await this.client.from('speakers').upsert(row).select().single();
      SupabaseDataService.#check(res);
      return res;
    });
    if (i >= 0) this.speakers[i] = data; else this.speakers.push(data);
    this.#emit('speakers');
    return data;
  }

  async saveConsent(consent) {
    const row = { ...pick(consent, ['speaker_id', 'speaker_name', 'consent_given', 'training_reuse', 'consent_date', 'text_version']), recorded_at: nowIso(), withdrawn_at: null };
    await this.#write(async () => SupabaseDataService.#check(await this.client.from('consents').upsert(row)));
    this.consents[consent.speaker_id] = row;
    this.#emit('speakers');
  }

  async withdrawConsent(speakerId, { deleteRecordings }) {
    await this.#write(async () => {
      if (deleteRecordings) {
        const paths = this.takes.filter((t) => t.speaker_id === speakerId).map((t) => t.storage_path);
        await this.#removeObjects(paths);
        // Suppression du locuteur : consentement et prises supprimés en cascade.
        SupabaseDataService.#check(await this.client.from('speakers').delete().eq('id', speakerId));
      } else {
        SupabaseDataService.#check(await this.client.from('consents').update({ withdrawn_at: nowIso() }).eq('speaker_id', speakerId));
      }
    });
    if (deleteRecordings) {
      this.takes.filter((t) => t.speaker_id === speakerId).forEach((t) => this.audioCache.delete(t.id));
      this.takes = this.takes.filter((t) => t.speaker_id !== speakerId);
      this.speakers = this.speakers.filter((s) => s.id !== speakerId);
      delete this.consents[speakerId];
      if (this.settings.activeSpeakerId === speakerId) await this.saveSettings({ activeSpeakerId: null });
    } else if (this.consents[speakerId]) {
      this.consents[speakerId].withdrawn_at = nowIso();
    }
    this.#emit('speakers');
  }

  // --- Enregistrements ----------------------------------------------------------------
  async #removeObjects(paths) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await this.client.storage.from(SUPABASE.audioBucket).remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
  }

  async saveTake(meta, wavBuffer) {
    const id = uid('take');
    const storage_path = `${meta.speaker_id}/${meta.segment_id}/${id}.wav`;
    const take = {
      id,
      quality_status: 'brouillon',
      current: true,
      confirmed: false,
      flags: { bruit: false, hesitation: false, prononciation: false, erreur_lecture: false },
      warnings: [],
      warning_messages: [],
      invalidated_reason: null,
      validated_at: null,
      recorded_at: nowIso(),
      format: 'audio/wav; PCM s16le; mono',
      size_bytes: wavBuffer.byteLength,
      storage_path,
      ...meta,
    };
    const demoted = this.takes.filter((t) => t.current && t.segment_id === take.segment_id && t.speaker_id === take.speaker_id).map((t) => t.id);
    await this.#write(async () => {
      const up = await this.client.storage.from(SUPABASE.audioBucket).upload(storage_path, new Blob([wavBuffer], { type: 'audio/wav' }), { contentType: 'audio/wav', upsert: false });
      if (up.error) throw up.error;
      const ins = await this.client.from('recordings').insert(pick(take, TAKE_COLUMNS));
      if (ins.error) {
        await this.client.storage.from(SUPABASE.audioBucket).remove([storage_path]);
        throw ins.error;
      }
      if (demoted.length) SupabaseDataService.#check(await this.client.from('recordings').update({ current: false }).in('id', demoted));
    });
    this.audioCache.set(id, wavBuffer);
    this.takes = [...this.takes.map((t) => (demoted.includes(t.id) ? { ...t, current: false } : t)), take];
    this.#emit('takes');
    return take;
  }

  async updateTake(takeId, patch) {
    const i = this.takes.findIndex((t) => t.id === takeId);
    if (i < 0) return null;
    await this.#write(async () => SupabaseDataService.#check(await this.client.from('recordings').update(pick(patch, TAKE_COLUMNS)).eq('id', takeId)));
    const next = { ...this.takes[i], ...patch };
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
    if (this.audioCache.has(takeId)) return this.audioCache.get(takeId);
    const take = this.takes.find((t) => t.id === takeId);
    if (!take) return null;
    const { data, error } = await this.client.storage.from(SUPABASE.audioBucket).download(take.storage_path);
    if (error) return null;
    const buf = await data.arrayBuffer();
    if (this.audioCache.size > 40) this.audioCache.delete(this.audioCache.keys().next().value);
    this.audioCache.set(takeId, buf);
    return buf;
  }

  async deleteTake(takeId) {
    const take = this.takes.find((t) => t.id === takeId);
    if (!take) return;
    await this.#write(async () => {
      await this.#removeObjects([take.storage_path]);
      SupabaseDataService.#check(await this.client.from('recordings').delete().eq('id', takeId));
    });
    this.audioCache.delete(takeId);
    this.takes = this.takes.filter((t) => t.id !== takeId);
    this.#emit('takes');
  }

  async deleteAllTakes() {
    if (!this.isAdmin) throw new Error('Seul un administrateur peut supprimer tous les enregistrements.');
    await this.#write(async () => {
      await this.#removeObjects(this.takes.map((t) => t.storage_path));
      SupabaseDataService.#check(await this.client.from('recordings').delete().neq('id', ''));
    });
    this.audioCache.clear();
    this.takes = [];
    this.#emit('takes');
  }

  // --- Paramètres, membres et maintenance ----------------------------------------------
  async saveSettings(patch) {
    this.settings = { ...this.settings, ...patch, audio: { ...this.settings.audio, ...(patch.audio ?? {}) } };
    delete this.settings.activeLinguistId;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* préférence locale non essentielle */ }
    this.#emit('settings');
  }

  async addLinguist() {
    throw new Error('Les linguistes sont gérés comme membres du projet (Paramètres → Membres).');
  }

  async addMember({ email, display_name, code, role }) {
    const row = { email: email.trim().toLowerCase(), display_name: display_name.trim(), code: code.trim(), role };
    await this.#write(async () => SupabaseDataService.#check(await this.client.from('members').insert(row)));
    this.members = [...this.members, { ...row, created_at: nowIso() }];
    this.#emit('settings');
  }

  async removeMember(email) {
    if (email === this.member?.email) throw new Error('Vous ne pouvez pas retirer votre propre accès.');
    await this.#write(async () => SupabaseDataService.#check(await this.client.from('members').delete().eq('email', email)));
    this.members = this.members.filter((m) => m.email !== email);
    this.#emit('settings');
  }

  async storageInfo() {
    return {
      remote: true,
      region: SUPABASE.region,
      takes: this.takes.length,
      audioBytes: this.takes.reduce((a, t) => a + (t.size_bytes || 0), 0),
      reviews: Object.keys(this.reviews).length,
      members: this.members.length,
    };
  }

  /** Réservé aux administrateurs : restaure révisions et glossaire de démonstration. Les enregistrements sont conservés. */
  async resetDemo() {
    if (!this.isAdmin) throw new Error('Seul un administrateur peut réinitialiser les données de démonstration.');
    const glossarySeed = await fetch(new URL('../mocks/glossary.json', import.meta.url)).then((r) => r.json());
    const now = nowIso();
    const simulated = SIMULATED_VALIDATED.map((id) => this.segments.find((s) => s.id === id)).filter(Boolean).map((seg) => {
      const { review } = applyReviewAction(emptyReview(seg.id), seg, 'validate', { reviewerId: 'simulation', now });
      return pick({ ...review, simulated: true }, REVIEW_COLUMNS);
    });
    await this.#write(async () => {
      SupabaseDataService.#check(await this.client.from('reviews').delete().neq('segment_id', ''));
      SupabaseDataService.#check(await this.client.from('reviews').insert(simulated));
      SupabaseDataService.#check(await this.client.from('glossary').delete().neq('id', ''));
      SupabaseDataService.#check(await this.client.from('glossary').insert(glossarySeed.map((g) => ({ ...g, proposals: [] }))));
    });
    await this.refresh();
  }
}
