// Tracé de formes d'onde sur <canvas> (min/max par colonne de pixels, écrans haute densité).

const DEFAULTS = {
  color: '#2f6f8f',
  background: 'transparent',
  centerLine: 'rgba(0, 0, 0, 0.2)',
  progress: 0,
  progressColor: '#c0562b'
};

/**
 * Ajuste la taille du tampon du canvas à sa taille CSS × devicePixelRatio.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number }}
 */
function prepareCanvas(canvas) {
  const dpr = Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const cssW = canvas.clientWidth || canvas.width / dpr || 300;
  const cssH = canvas.clientHeight || canvas.height / dpr || 80;
  const width = Math.max(1, Math.round(cssW * dpr));
  const height = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { ctx, width, height, dpr };
}

/**
 * Fond + ligne médiane.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width @param {number} height @param {number} dpr
 * @param {{ background: string, centerLine: string }} o
 */
function drawBackground(ctx, width, height, dpr, o) {
  ctx.clearRect(0, 0, width, height);
  if (o.background && o.background !== 'transparent') {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, width, height);
  }
  if (o.centerLine) {
    ctx.fillStyle = o.centerLine;
    const lh = Math.max(1, Math.round(dpr));
    ctx.fillRect(0, Math.floor(height / 2 - lh / 2), width, lh);
  }
}

/**
 * Trace les colonnes min/max. `step` > 1 sous-échantillonne pour la vitesse (tracé en direct).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float32Array} samples
 * @param {number} width @param {number} height
 * @param {string} color @param {string} progressColor @param {number} progress
 * @param {number} step
 */
function drawColumns(ctx, samples, width, height, color, progressColor, progress, step) {
  const n = samples.length;
  const mid = height / 2;
  const amp = height / 2;
  const perColumn = n / width;
  const splitX = Math.round(Math.min(1, Math.max(0, progress)) * width);

  for (let pass = 0; pass < 2; pass++) {
    const x0 = pass === 0 ? 0 : splitX;
    const x1 = pass === 0 ? splitX : width;
    if (x1 <= x0) continue;
    ctx.fillStyle = pass === 0 ? progressColor : color;
    ctx.beginPath();
    for (let x = x0; x < x1; x++) {
      let start = Math.floor(x * perColumn);
      let end = Math.floor((x + 1) * perColumn);
      if (end <= start) end = start + 1;
      if (start >= n) break;
      if (end > n) end = n;
      let min = 1;
      let max = -1;
      for (let i = start; i < end; i += step) {
        const v = samples[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min > max) continue;
      min = Math.max(-1, min);
      max = Math.min(1, max);
      const yTop = mid - max * amp;
      const yBottom = mid - min * amp;
      ctx.rect(x, yTop, 1, Math.max(1, yBottom - yTop));
    }
    ctx.fill();
  }
}

/**
 * Dessine une forme d'onde complète (prise enregistrée).
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} samples
 * @param {{ color?: string, background?: string, centerLine?: string, progress?: number, progressColor?: string }} [opts]
 *   progress : 0..1, la partie déjà lue est dessinée avec progressColor
 * @returns {void}
 */
export function drawWaveform(canvas, samples, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { ctx, width, height, dpr } = prepareCanvas(canvas);
  drawBackground(ctx, width, height, dpr, o);
  if (!samples || samples.length === 0) return;
  drawColumns(ctx, samples, width, height, o.color, o.progressColor, o.progress || 0, 1);
}

/**
 * Dessine la forme d'onde en direct (quelques secondes, ~60 im/s).
 * Sous-échantillonne chaque colonne pour borner le coût par image.
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} samples
 * @param {{ color?: string, background?: string, centerLine?: string, progress?: number, progressColor?: string }} [opts]
 * @returns {void}
 */
export function drawLiveWaveform(canvas, samples, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { ctx, width, height, dpr } = prepareCanvas(canvas);
  drawBackground(ctx, width, height, dpr, o);
  if (!samples || samples.length === 0) return;
  // Au plus ~64 lectures par colonne : suffisant visuellement pour la parole
  const perColumn = samples.length / width;
  const step = Math.max(1, Math.floor(perColumn / 64));
  drawColumns(ctx, samples, width, height, o.color, o.progressColor, o.progress || 0, step);
}
