import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concatFloat32, encodeWav, parseWavHeader, decodeWavToFloat32 } from '../js/audio/wav.js';

const ascii = (view, offset) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4));

test('encodeWav : champs de l\'en-tête', () => {
  const n = 1000;
  const sr = 48000;
  const buf = encodeWav(new Float32Array(n), sr);
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 44 + 2 * n);
  assert.equal(ascii(v, 0), 'RIFF');
  assert.equal(v.getUint32(4, true), 36 + 2 * n);
  assert.equal(ascii(v, 8), 'WAVE');
  assert.equal(ascii(v, 12), 'fmt ');
  assert.equal(v.getUint32(16, true), 16);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), sr);
  assert.equal(v.getUint32(28, true), sr * 2);
  assert.equal(v.getUint16(32, true), 2);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(ascii(v, 36), 'data');
  assert.equal(v.getUint32(40, true), 2 * n);
});

test('encodeWav : écrêtage des valeurs hors [-1, 1]', () => {
  const buf = encodeWav(new Float32Array([1.5, -2, 1, -1, 0]), 44100);
  const v = new DataView(buf);
  assert.equal(v.getInt16(44, true), 32767);
  assert.equal(v.getInt16(46, true), -32768);
  assert.equal(v.getInt16(48, true), 32767);
  assert.equal(v.getInt16(50, true), -32768);
  assert.equal(v.getInt16(52, true), 0);
});

test('aller-retour encode → parseWavHeader → decodeWavToFloat32', () => {
  const sr = 48000;
  const n = 4800;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / sr);
  const buf = encodeWav(src, sr);
  const h = parseWavHeader(buf);
  assert.deepEqual(h, {
    audioFormat: 1,
    channels: 1,
    sampleRate: sr,
    bitsPerSample: 16,
    dataBytes: 2 * n,
    durationSeconds: 0.1
  });
  const { samples, sampleRate } = decodeWavToFloat32(buf);
  assert.equal(sampleRate, sr);
  assert.equal(samples.length, n);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(samples[i] - src[i]) <= 1 / 32767, `écart trop grand à l'indice ${i}`);
  }
});

test('durée correcte à 48000 et 44100 Hz', () => {
  assert.equal(parseWavHeader(encodeWav(new Float32Array(48000 * 2), 48000)).durationSeconds, 2);
  assert.equal(parseWavHeader(encodeWav(new Float32Array(44100 * 3), 44100)).durationSeconds, 3);
  const h = parseWavHeader(encodeWav(new Float32Array(22050), 44100));
  assert.equal(h.sampleRate, 44100);
  assert.equal(h.durationSeconds, 0.5);
});

test('parseWavHeader parcourt les chunks intermédiaires (LIST)', () => {
  const base = new Uint8Array(encodeWav(new Float32Array([0.5, -0.5]), 16000));
  const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0]); // 'LIST', taille impaire + pad
  const out = new Uint8Array(base.length + list.length);
  out.set(base.subarray(0, 36), 0);
  out.set(list, 36);
  out.set(base.subarray(36), 36 + list.length);
  const h = parseWavHeader(out.buffer);
  assert.equal(h.dataBytes, 4);
  assert.equal(h.sampleRate, 16000);
  assert.equal(decodeWavToFloat32(out.buffer).samples.length, 2);
});

test('parseWavHeader lève une erreur sur des données invalides', () => {
  assert.throws(() => parseWavHeader(new ArrayBuffer(0)), Error);
  assert.throws(() => parseWavHeader(new TextEncoder().encode('ceci n\'est pas un fichier wav du tout !!!!!!!!').buffer), /RIFF/);
  const noWave = new Uint8Array(encodeWav(new Float32Array(4), 8000));
  noWave.set([0x41, 0x56, 0x49, 0x20], 8); // 'AVI '
  assert.throws(() => parseWavHeader(noWave.buffer), /WAVE/);
  const noData = new Uint8Array(encodeWav(new Float32Array(4), 8000)).slice(0, 36);
  assert.throws(() => parseWavHeader(noData.buffer), /data/);
});

test('concatFloat32', () => {
  const out = concatFloat32([new Float32Array([1, 2]), new Float32Array(0), new Float32Array([3])]);
  assert.ok(out instanceof Float32Array);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
  assert.equal(concatFloat32([]).length, 0);
});
