import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRevisionRecords, toJsonl, toCsv, buildTtsManifest, buildLjspeechCsv, normalizeText, wavFileName,
} from '../js/utils/export.js';
import { emptyReview, applyReviewAction } from '../js/utils/status.js';

const seg = (id) => ({ id, lot: 'A', domaine: 'Retraite', source_fr: `Phrase ${id}.`, mt_afar: `Mt ${id}.`, mt_model: 'm', mt_prompt_version: 'v', created_at: '2026-10-10T00:00:00Z' });
const ctx = { reviewerId: 'ling_1', now: '2026-10-21T10:00:00Z' };
const take = (over) => ({
  id: 't', segment_id: 'seg_001', speaker_id: 'spk_1', text_display: 'Mt seg_001.', text_spoken: 'Mt  seg_001.',
  text_version: 1, duration_seconds: 2.5, sample_rate: 48000, quality_status: 'valide', current: true, confirmed: true,
  flags: {}, warnings: [], recorded_at: '2026-10-21T10:05:00Z', ...over,
});

test('export des révisions : machine et correction humaine distinctes', () => {
  const segments = [seg('seg_001'), seg('seg_002')];
  const reviews = { seg_001: applyReviewAction(emptyReview('seg_001'), segments[0], 'correct', { ...ctx, text: 'Corrigé.' }).review };
  const rec = buildRevisionRecords(segments, reviews);
  assert.equal(rec[0].mt_afar, 'Mt seg_001.');
  assert.equal(rec[0].corrected_afar, 'Corrigé.');
  assert.equal(rec[0].human_edited, true);
  assert.equal(rec[1].status, 'a_reviser');
  assert.equal(rec[1].corrected_afar, null);
  const lines = toJsonl(rec).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).segment_id, 'seg_001');
});

test('CSV : échappement des guillemets, points-virgules et retours ligne', () => {
  const csv = toCsv([{ a: 'x;y', b: 'il dit "oui"', c: 'l1\nl2' }], ['a', 'b', 'c']);
  assert.ok(csv.startsWith('﻿a;b;c\r\n'));
  assert.ok(csv.includes('"x;y";"il dit ""oui""";"l1\nl2"'));
});

test('manifeste TTS : seules les prises éligibles sont exportées', () => {
  const segments = [seg('seg_001'), seg('seg_002')];
  const reviews = {
    seg_001: applyReviewAction(emptyReview('seg_001'), segments[0], 'validate', ctx).review,
    seg_002: applyReviewAction(emptyReview('seg_002'), segments[1], 'reject', ctx).review,
  };
  const consents = { spk_1: { consent_given: true, training_reuse: true, withdrawn_at: null }, spk_2: { consent_given: true, training_reuse: true, withdrawn_at: '2026-10-20' } };
  const speakers = [{ id: 'spk_1', name: 'A', dialect: 'Aussa' }, { id: 'spk_2', name: 'B', dialect: 'Baadu' }];
  const takes = [
    take({ id: 'ok' }),
    take({ id: 'old', current: false }),
    take({ id: 'rejected', segment_id: 'seg_002', text_display: 'Mt seg_002.' }),
    take({ id: 'noconsent', speaker_id: 'spk_2' }),
  ];
  const { entries, excluded } = buildTtsManifest(segments, reviews, takes, consents, speakers);
  assert.deepEqual(entries.map((e) => e.take.id), ['ok']);
  assert.equal(excluded.length, 3);
  const m = entries[0].meta;
  assert.equal(m.audio_filepath, 'wavs/seg_001_spk_1.wav');
  assert.equal(m.normalized_text, 'Mt seg_001.');
  assert.equal(m.dialect, 'Aussa');
  assert.equal(buildLjspeechCsv(entries), 'seg_001_spk_1|Mt  seg_001.|Mt seg_001.\n');
});

test('normalisation : NFC et espaces uniquement', () => {
  assert.equal(normalizeText(' Taamâ  6% '), 'Taamâ 6%');
  assert.equal(wavFileName('seg 1', 'spk/2'), 'seg_1_spk_2.wav');
});
