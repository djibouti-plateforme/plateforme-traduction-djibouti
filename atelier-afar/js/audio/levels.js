// Mesures de niveau et contrôles qualité d'une prise. Module pur, utilisable dans Node.

const CLIP_SAMPLE = 0.999;
const SILENCE_PEAK_DBFS = -60;

/**
 * Convertit une amplitude linéaire (0..1) en dBFS.
 * @param {number} linear
 * @returns {number} -Infinity si linear <= 0
 */
export function toDbfs(linear) {
  if (!(linear > 0)) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * Formate une valeur dBFS à la française, ex. '-12,3 dBFS' ou '−∞ dBFS'.
 * @param {number} db
 * @returns {string}
 */
export function formatDbfs(db) {
  if (db === -Infinity || Number.isNaN(db)) return '−∞ dBFS';
  const rounded = Math.round(db * 10) / 10;
  const value = Object.is(rounded, -0) ? 0 : rounded;
  return `${value.toFixed(1).replace('.', ',')} dBFS`;
}

/** @param {number} n */
function formatNumber(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/**
 * Crête, RMS et taux d'écrêtage d'un signal.
 * @param {Float32Array} samples
 * @returns {{ peak: number, rms: number, peakDbfs: number, rmsDbfs: number, clippedRatio: number }}
 */
export function analyzeSamples(samples) {
  const n = samples.length;
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += a * a;
    if (a >= CLIP_SAMPLE) clipped++;
  }
  const rms = n ? Math.sqrt(sumSq / n) : 0;
  return {
    peak,
    rms,
    peakDbfs: toDbfs(peak),
    rmsDbfs: toDbfs(rms),
    clippedRatio: n ? clipped / n : 0
  };
}

/**
 * Analyse une prise et produit des avertissements (jamais de validation automatique).
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {{ clipDbfs?: number, lowRmsDbfs?: number, minDuration?: number, maxDuration?: number }} [thresholds]
 * @returns {{ durationSeconds: number, peakDbfs: number, rmsDbfs: number, clippedRatio: number,
 *   warnings: Array<{ code: 'clipping'|'too_quiet'|'too_short'|'too_long'|'silence', message: string }> }}
 */
export function analyzeTake(samples, sampleRate, thresholds = {}) {
  const {
    clipDbfs = -1,
    lowRmsDbfs = -40,
    minDuration = 1,
    maxDuration = 15
  } = thresholds;
  const stats = analyzeSamples(samples);
  const durationSeconds = sampleRate > 0 ? samples.length / sampleRate : 0;
  /** @type {Array<{ code: 'clipping'|'too_quiet'|'too_short'|'too_long'|'silence', message: string }>} */
  const warnings = [];

  if (stats.peakDbfs < SILENCE_PEAK_DBFS) {
    warnings.push({
      code: 'silence',
      message: 'Aucun signal détecté : vérifiez que le bon micro est sélectionné et qu\'il n\'est pas coupé.'
    });
  } else {
    if (stats.peakDbfs >= clipDbfs) {
      warnings.push({
        code: 'clipping',
        message: `Signal saturé : le niveau crête atteint ${formatDbfs(stats.peakDbfs)}. Éloignez-vous du micro ou baissez le gain.`
      });
    }
    if (stats.rmsDbfs < lowRmsDbfs) {
      warnings.push({
        code: 'too_quiet',
        message: `Niveau trop faible (${formatDbfs(stats.rmsDbfs)} RMS) : rapprochez-vous du micro ou augmentez le gain.`
      });
    }
  }
  if (durationSeconds < minDuration) {
    warnings.push({
      code: 'too_short',
      message: `Durée inférieure à ${formatNumber(minDuration)} s : vérifiez que la phrase est complète.`
    });
  }
  if (durationSeconds > maxDuration) {
    warnings.push({
      code: 'too_long',
      message: `Durée supérieure à ${formatNumber(maxDuration)} s : une phrase plus courte est préférable pour l'entraînement TTS.`
    });
  }

  return {
    durationSeconds,
    peakDbfs: stats.peakDbfs,
    rmsDbfs: stats.rmsDbfs,
    clippedRatio: stats.clippedRatio,
    warnings
  };
}
