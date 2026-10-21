// Enregistreur micro basé sur AudioWorklet : capture PCM brute (sans traitement), mono,
// à la fréquence native du contexte audio (pas de rééchantillonnage).
import { concatFloat32 } from './wav.js';
import { toDbfs } from './levels.js';

const LIVE_SECONDS = 3;
const STOP_TIMEOUT_MS = 3000;

/**
 * Crée une erreur nommée (pour describeError).
 * @param {string} name
 * @param {string} message
 * @param {unknown} [cause]
 */
function namedError(name, message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.name = name;
  return err;
}

export class AudioRecorder {
  constructor() {
    /** @type {MediaStream|null} */ this._stream = null;
    /** @type {AudioContext|null} */ this._ctx = null;
    /** @type {MediaStreamAudioSourceNode|null} */ this._source = null;
    /** @type {AudioWorkletNode|null} */ this._node = null;
    /** @type {GainNode|null} */ this._mute = null;
    this._recording = false;
    /** @type {Float32Array[]} */ this._chunks = [];
    /** @type {Set<(l: { peak: number, rms: number, peakDbfs: number, rmsDbfs: number }) => void>} */
    this._levelListeners = new Set();
    /** @type {Set<(l: { peak: number, rms: number }) => void>} */
    this._rawLevelListeners = new Set();
    /** @type {((value: void) => void)|null} */ this._stoppedResolve = null;
    // Tampon circulaire des ~3 dernières secondes (forme d'onde en direct)
    this._live = new Float32Array(0);
    this._liveWrite = 0;
    this._liveCount = 0;
    /** @type {Float32Array|null} */ this._liveCache = null;
  }

  /**
   * Le navigateur dispose-t-il de getUserMedia, AudioContext et AudioWorklet ?
   * @returns {boolean}
   */
  static isSupported() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return Boolean(
      navigator.mediaDevices?.getUserMedia &&
      (window.AudioContext || /** @type {any} */ (window).webkitAudioContext) &&
      typeof window.AudioWorkletNode === 'function'
    );
  }

  /**
   * Contexte sécurisé (HTTPS ou localhost), requis pour accéder au micro.
   * @returns {boolean}
   */
  static isSecureContextOk() {
    return typeof window !== 'undefined' && window.isSecureContext === true;
  }

  /**
   * Liste les entrées audio. Les libellés sont vides tant que l'accès au micro
   * n'a pas été accordé : on substitue alors « Microphone 1 », « Microphone 2 »…
   * @returns {Promise<Array<{ deviceId: string, label: string }>>}
   */
  static async listInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  /**
   * Message d'erreur en français, à afficher tel quel.
   * @param {any} err
   * @returns {string}
   */
  static describeError(err) {
    const name = err?.name || '';
    switch (name) {
      case 'InsecureContextError':
        return 'L\'accès au micro exige une connexion sécurisée : ouvrez l\'atelier en HTTPS (ou sur localhost).';
      case 'NotSupportedError':
        return 'Ce navigateur ne permet pas l\'enregistrement audio. Utilisez une version récente de Chrome, Edge, Firefox ou Safari.';
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return 'L\'accès au micro a été refusé. Autorisez le micro dans les paramètres du navigateur pour ce site, puis réessayez. '
          + '(L\'enregistrement n\'est possible qu\'en HTTPS, sauf sur localhost.)';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'Aucun micro n\'a été trouvé. Branchez un micro ou choisissez une autre entrée, puis réessayez.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'Le micro est déjà utilisé par une autre application (visioconférence, enregistreur…). Fermez-la, puis réessayez.';
      case 'AbortError':
        return 'L\'ouverture du micro a été interrompue. Réessayez.';
      case 'WorkletLoadError':
        return 'Impossible de charger le module d\'enregistrement audio. Rechargez la page ; si le problème persiste, utilisez un navigateur récent.';
      default:
        return `Erreur inattendue lors de l'accès au micro${err?.message ? ` : ${err.message}` : '.'}`;
    }
  }

  /** @returns {number} fréquence d'échantillonnage du contexte (0 si fermé) */
  get sampleRate() {
    return this._ctx ? this._ctx.sampleRate : 0;
  }

  /** @returns {boolean} */
  get isOpen() {
    return this._ctx !== null && this._node !== null;
  }

  /** @returns {boolean} */
  get isRecording() {
    return this._recording;
  }

  /** @returns {string} libellé de la piste micro en cours */
  get deviceLabel() {
    return this._stream?.getAudioTracks()[0]?.label || '';
  }

  /**
   * Ouvre le micro et la chaîne audio. À appeler depuis un geste utilisateur (clic),
   * sinon le navigateur peut laisser l'AudioContext suspendu (Safari, Chrome).
   * @param {string} [deviceId]
   * @returns {Promise<void>}
   */
  async open(deviceId) {
    if (this._ctx || this._stream) await this.close();
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw namedError('InsecureContextError', 'Contexte non sécurisé (HTTPS requis).');
    }
    if (!AudioRecorder.isSupported()) {
      throw namedError('NotSupportedError', 'Enregistrement audio non pris en charge.');
    }

    // AudioContext créé avant l'attente de getUserMedia pour rester dans le geste utilisateur
    const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    /** @type {AudioContext} */
    const ctx = new Ctx();
    this._ctx = ctx;
    const resumePromise = ctx.resume().catch(() => {});

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      try {
        await ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
      } catch (e) {
        throw namedError('WorkletLoadError', 'Échec du chargement du module AudioWorklet.', e);
      }

      this._source = ctx.createMediaStreamSource(this._stream);
      this._node = new AudioWorkletNode(ctx, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers'
      });
      this._node.port.onmessage = (ev) => this._onMessage(ev.data);
      // Gain nul vers la sortie : le nœud est « tiré » par le graphe mais rien n'est audible
      this._mute = ctx.createGain();
      this._mute.gain.value = 0;
      this._source.connect(this._node);
      this._node.connect(this._mute);
      this._mute.connect(ctx.destination);

      await resumePromise;
      if (ctx.state !== 'running') await ctx.resume();
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  /**
   * S'abonne aux niveaux (environ toutes les 2048 trames, enregistrement ou non).
   * @param {(l: { peak: number, rms: number, peakDbfs: number, rmsDbfs: number }) => void} cb
   * @returns {() => void} désabonnement
   */
  onLevel(cb) {
    this._levelListeners.add(cb);
    return () => this._levelListeners.delete(cb);
  }

  /**
   * Démarre l'enregistrement. Lève une erreur si le micro n'est pas ouvert.
   * @returns {void}
   */
  start() {
    if (!this.isOpen || !this._node || !this._ctx) {
      throw new Error('Le micro n\'est pas ouvert : appelez open() avant start().');
    }
    if (this._ctx.state !== 'running') this._ctx.resume().catch(() => {});
    this._chunks = [];
    const liveLength = Math.ceil(this._ctx.sampleRate * LIVE_SECONDS);
    if (this._live.length !== liveLength) this._live = new Float32Array(liveLength);
    this._liveWrite = 0;
    this._liveCount = 0;
    this._liveCache = null;
    this._recording = true;
    this._node.port.postMessage({ type: 'start' });
  }

  /**
   * Arrête l'enregistrement et renvoie la prise complète.
   * @returns {Promise<{ samples: Float32Array, sampleRate: number, durationSeconds: number }>}
   */
  async stop() {
    const sampleRate = this.sampleRate;
    if (this._node && this._recording) {
      const stopped = new Promise((resolve) => {
        this._stoppedResolve = resolve;
      });
      this._node.port.postMessage({ type: 'stop' });
      // Garde-fou : si le contexte est suspendu, le worklet ne répond jamais
      await Promise.race([
        stopped,
        new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))
      ]);
      this._stoppedResolve = null;
    }
    this._recording = false;
    const samples = concatFloat32(this._chunks);
    this._chunks = [];
    this._liveCount = 0;
    this._liveCache = null;
    return {
      samples,
      sampleRate,
      durationSeconds: sampleRate ? samples.length / sampleRate : 0
    };
  }

  /**
   * Les ~3 dernières secondes enregistrées (forme d'onde en direct). Vide hors enregistrement.
   * Le tableau renvoyé est mis en cache tant qu'aucun nouveau bloc n'arrive : ne pas le modifier.
   * @returns {Float32Array}
   */
  getLiveSamples() {
    if (!this._recording || this._liveCount === 0) return new Float32Array(0);
    if (this._liveCache) return this._liveCache;
    const n = this._liveCount;
    const size = this._live.length;
    const out = new Float32Array(n);
    const start = (this._liveWrite - n + size) % size;
    const firstPart = Math.min(n, size - start);
    out.set(this._live.subarray(start, start + firstPart), 0);
    if (firstPart < n) out.set(this._live.subarray(0, n - firstPart), firstPart);
    this._liveCache = out;
    return out;
  }

  /**
   * Mesure le bruit de fond (hors enregistrement) à partir des messages de niveau.
   * @param {number} [seconds=5]
   * @param {(fraction: number) => void} [onProgress]
   * @returns {Promise<{ rmsDbfs: number, peakDbfs: number }>}
   */
  async measureNoise(seconds = 5, onProgress) {
    if (!this.isOpen) throw new Error('Le micro n\'est pas ouvert : appelez open() avant la mesure du bruit.');
    if (this._recording) throw new Error('Mesure du bruit impossible pendant un enregistrement.');
    if (this._ctx && this._ctx.state !== 'running') await this._ctx.resume().catch(() => {});

    let sumSq = 0;
    let windows = 0;
    let peak = 0;
    const listener = (/** @type {{ peak: number, rms: number }} */ l) => {
      // Fenêtres de taille égale : moyenne des carrés des RMS = RMS global
      sumSq += l.rms * l.rms;
      windows++;
      if (l.peak > peak) peak = l.peak;
    };
    this._rawLevelListeners.add(listener);
    const durationMs = Math.max(0, seconds) * 1000;
    const t0 = performance.now();
    try {
      await new Promise((resolve) => {
        const tick = () => {
          const fraction = durationMs ? Math.min(1, (performance.now() - t0) / durationMs) : 1;
          onProgress?.(fraction);
          if (fraction >= 1) resolve(undefined);
          else setTimeout(tick, 100);
        };
        tick();
      });
    } finally {
      this._rawLevelListeners.delete(listener);
    }
    const rms = windows ? Math.sqrt(sumSq / windows) : 0;
    return { rmsDbfs: toDbfs(rms), peakDbfs: toDbfs(peak) };
  }

  /**
   * Libère le micro et le contexte audio.
   * @returns {Promise<void>}
   */
  async close() {
    this._recording = false;
    this._stoppedResolve?.();
    this._stoppedResolve = null;
    if (this._node) {
      this._node.port.onmessage = null;
      try { this._node.disconnect(); } catch { /* déjà déconnecté */ }
    }
    try { this._source?.disconnect(); } catch { /* idem */ }
    try { this._mute?.disconnect(); } catch { /* idem */ }
    this._stream?.getTracks().forEach((t) => t.stop());
    const ctx = this._ctx;
    this._node = null;
    this._source = null;
    this._mute = null;
    this._stream = null;
    this._ctx = null;
    this._chunks = [];
    this._liveCount = 0;
    this._liveCache = null;
    if (ctx && ctx.state !== 'closed') {
      try { await ctx.close(); } catch { /* ignoré */ }
    }
  }

  /** @param {any} msg */
  _onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'level') {
      const raw = { peak: msg.peak, rms: msg.rms };
      this._rawLevelListeners.forEach((cb) => cb(raw));
      if (this._levelListeners.size) {
        const level = { ...raw, peakDbfs: toDbfs(msg.peak), rmsDbfs: toDbfs(msg.rms) };
        this._levelListeners.forEach((cb) => {
          try { cb(level); } catch (e) { console.error(e); }
        });
      }
    } else if (msg.type === 'chunk') {
      if (!this._recording) return;
      /** @type {Float32Array} */
      const samples = msg.samples;
      this._chunks.push(samples);
      this._pushLive(samples);
    } else if (msg.type === 'stopped') {
      this._stoppedResolve?.();
    }
  }

  /** @param {Float32Array} samples */
  _pushLive(samples) {
    const size = this._live.length;
    if (!size) return;
    let src = samples;
    if (src.length > size) src = src.subarray(src.length - size);
    const first = Math.min(src.length, size - this._liveWrite);
    this._live.set(src.subarray(0, first), this._liveWrite);
    if (first < src.length) this._live.set(src.subarray(first), 0);
    this._liveWrite = (this._liveWrite + src.length) % size;
    this._liveCount = Math.min(size, this._liveCount + src.length);
    this._liveCache = null;
  }
}
