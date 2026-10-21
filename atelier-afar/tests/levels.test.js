import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDbfs, formatDbfs, analyzeSamples, analyzeTake } from '../js/audio/levels.js';

const SR = 48000;

/** Sinus de crête `peak` (linéaire) sur `seconds` secondes. */
function sine(seconds, peak, freq = 220) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = peak * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

const codes = (r) => r.warnings.map((w) => w.code).sort();

test('toDbfs', () => {
  assert.equal(toDbfs(1), 0);
  assert.ok(Math.abs(toDbfs(0.5) - -6.0206) < 0.001);
  assert.equal(toDbfs(0), -Infinity);
  assert.equal(toDbfs(-0.3), -Infinity);
});

test('formatDbfs utilise la virgule décimale', () => {
  assert.equal(formatDbfs(-12.34), '-12,3 dBFS');
  assert.equal(formatDbfs(0), '0,0 dBFS');
  assert.equal(formatDbfs(-0.04), '0,0 dBFS');
  assert.equal(formatDbfs(-Infinity), '−∞ dBFS');
});

test('analyzeSamples', () => {
  const r = analyzeSamples(new Float32Array([1, -1, 0, 0]));
  assert.equal(r.peak, 1);
  assert.equal(r.peakDbfs, 0);
  assert.ok(Math.abs(r.rms - Math.SQRT1_2) < 1e-9);
  assert.equal(r.clippedRatio, 0.5);
  assert.equal(analyzeSamples(new Float32Array(0)).rmsDbfs, -Infinity);
});

test('analyzeTake : sinus propre de 3 s à -12 dBFS, aucun avertissement', () => {
  const r = analyzeTake(sine(3, 10 ** (-12 / 20)), SR);
  assert.deepEqual(r.warnings, []);
  assert.ok(Math.abs(r.durationSeconds - 3) < 1e-9);
  assert.ok(Math.abs(r.peakDbfs - -12) < 0.05);
  assert.equal(r.clippedRatio, 0);
});

test('analyzeTake : saturation', () => {
  const s = sine(3, 1.2).map((x) => Math.max(-1, Math.min(1, x)));
  const r = analyzeTake(s, SR);
  assert.deepEqual(codes(r), ['clipping']);
  assert.ok(r.clippedRatio > 0);
  assert.match(r.warnings[0].message, /^Signal saturé : le niveau crête atteint 0,0 dBFS\./);
});

test('analyzeTake : trop court / trop long', () => {
  const short = analyzeTake(sine(0.5, 0.25), SR);
  assert.deepEqual(codes(short), ['too_short']);
  assert.equal(short.warnings[0].message, 'Durée inférieure à 1 s : vérifiez que la phrase est complète.');
  const long = analyzeTake(sine(16, 0.25), SR);
  assert.deepEqual(codes(long), ['too_long']);
  assert.equal(long.warnings[0].message,
    'Durée supérieure à 15 s : une phrase plus courte est préférable pour l\'entraînement TTS.');
});

test('analyzeTake : silence (sans too_quiet)', () => {
  assert.deepEqual(codes(analyzeTake(new Float32Array(SR * 2), SR)), ['silence']);
  assert.deepEqual(codes(analyzeTake(sine(2, 10 ** (-70 / 20)), SR)), ['silence']);
});

test('analyzeTake : niveau trop faible', () => {
  // crête -45 dBFS → RMS ≈ -48 dBFS < -40, mais > -60 (pas du silence)
  const r = analyzeTake(sine(2, 10 ** (-45 / 20)), SR);
  assert.deepEqual(codes(r), ['too_quiet']);
  assert.match(r.warnings[0].message, /dBFS/);
});

test('analyzeTake : seuils personnalisés', () => {
  const r = analyzeTake(sine(3, 10 ** (-12 / 20)), SR, { maxDuration: 2, clipDbfs: -13 });
  assert.deepEqual(codes(r), ['clipping', 'too_long']);
});
