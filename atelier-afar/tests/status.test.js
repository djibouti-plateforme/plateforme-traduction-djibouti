import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyReview, applyReviewAction, invalidateTakes, audioStatus, buildAudioQueue, exclusionReason, editorText,
} from '../js/utils/status.js';

const seg = { id: 'seg_001', lot: 'A', domaine: 'Retraite', source_fr: 'Bonjour.', mt_afar: 'Maaqaane taamita.', mt_model: 'm', mt_prompt_version: 'v', created_at: '2026-10-10T00:00:00Z' };
const ctx = (extra = {}) => ({ reviewerId: 'ling_1', now: '2026-10-21T10:00:00Z', ...extra });

const take = (over = {}) => ({
  id: 't1', segment_id: 'seg_001', speaker_id: 'spk_1', text_display: 'Maaqaane taamita.', text_spoken: 'Maaqaane taamita.',
  text_version: 1, duration_seconds: 2, sample_rate: 48000, format: 'wav', size_bytes: 1000, recorded_at: '2026-10-21T10:05:00Z',
  quality_status: 'valide', current: true, confirmed: true, flags: {}, warnings: [], invalidated_reason: null, ...over,
});

test('un brouillon modifié fait passer le segment « En cours »', () => {
  const r = applyReviewAction(emptyReview('seg_001'), seg, 'draft', ctx({ text: 'Maaqaane!' })).review;
  assert.equal(r.status, 'en_cours');
  assert.equal(r.draft_afar, 'Maaqaane!');
});

test('un brouillon identique à la référence est effacé et ne change pas le statut', () => {
  const r = applyReviewAction(emptyReview('seg_001'), seg, 'draft', ctx({ text: '  Maaqaane   taamita. ' })).review;
  assert.equal(r.status, 'a_reviser');
  assert.equal(r.draft_afar, null);
});

test('valider sans modification conserve la traduction machine comme texte approuvé', () => {
  const { review, textChanged } = applyReviewAction(emptyReview('seg_001'), seg, 'validate', ctx());
  assert.equal(review.status, 'valide');
  assert.equal(review.corrected_afar, seg.mt_afar);
  assert.equal(review.text_version, 1);
  assert.equal(textChanged, true);
  assert.equal(review.history.length, 1);
});

test('enregistrer une correction → Corrigé, refusée si identique ou vide', () => {
  const base = emptyReview('seg_001');
  const ok = applyReviewAction(base, seg, 'correct', ctx({ text: 'Maaqaane taamitaay.' }));
  assert.equal(ok.review.status, 'corrige');
  assert.equal(ok.review.corrected_afar, 'Maaqaane taamitaay.');
  assert.ok(applyReviewAction(base, seg, 'correct', ctx({ text: 'Maaqaane  taamita.' })).error);
  assert.ok(applyReviewAction(base, seg, 'correct', ctx({ text: '   ' })).error);
  assert.equal(base.status, 'a_reviser', 'la révision d\'origine n\'est pas modifiée');
});

test('re-valider le même texte ne change pas la version', () => {
  const r1 = applyReviewAction(emptyReview('seg_001'), seg, 'correct', ctx({ text: 'A b c.' })).review;
  const r2 = applyReviewAction(r1, seg, 'correct', ctx({ text: 'A b c.' }));
  assert.equal(r2.review.text_version, 1);
  assert.equal(r2.textChanged, false);
  const r3 = applyReviewAction(r2.review, seg, 'correct', ctx({ text: 'A b d.' }));
  assert.equal(r3.review.text_version, 2);
  assert.equal(r3.textChanged, true);
});

test('rejet et signalement retirent le texte approuvé ; le signalement exige un motif', () => {
  const approved = applyReviewAction(emptyReview('seg_001'), seg, 'validate', ctx()).review;
  const rej = applyReviewAction(approved, seg, 'reject', ctx()).review;
  assert.equal(rej.status, 'rejete');
  assert.equal(rej.corrected_afar, null);
  assert.ok(applyReviewAction(approved, seg, 'flag', ctx({ comment: '' })).error);
  assert.equal(applyReviewAction(approved, seg, 'flag', ctx({ comment: 'Ambigu' })).review.status, 'signale');
});

test('editorText : brouillon > texte approuvé > traduction machine', () => {
  assert.equal(editorText(undefined, seg), seg.mt_afar);
  assert.equal(editorText({ ...emptyReview('x'), corrected_afar: 'C' }, seg), 'C');
  assert.equal(editorText({ ...emptyReview('x'), corrected_afar: 'C', draft_afar: 'D' }, seg), 'D');
});

test('file audio : seuls les segments Validés ou Corrigés y figurent', () => {
  const segs = [seg, { ...seg, id: 'seg_002' }, { ...seg, id: 'seg_003' }];
  const reviews = {
    seg_001: applyReviewAction(emptyReview('seg_001'), seg, 'validate', ctx()).review,
    seg_002: applyReviewAction(emptyReview('seg_002'), seg, 'correct', ctx({ text: 'X y.' })).review,
    seg_003: applyReviewAction(emptyReview('seg_003'), seg, 'reject', ctx()).review,
  };
  const q = buildAudioQueue(segs, reviews, [], 'spk_1');
  assert.deepEqual(q.map((i) => i.segment.id), ['seg_001', 'seg_002']);
  assert.ok(q.every((i) => i.status === 'a_enregistrer'));
  assert.equal(q[1].text, 'X y.');
});

test('statut audio selon la prise courante', () => {
  const review = applyReviewAction(emptyReview('seg_001'), seg, 'validate', ctx()).review;
  assert.equal(audioStatus(review, []), 'a_enregistrer');
  assert.equal(audioStatus(review, [take({ quality_status: 'brouillon' })]), 'en_cours');
  assert.equal(audioStatus(review, [take()]), 'enregistre');
  assert.equal(audioStatus(review, [take({ quality_status: 'a_refaire' })]), 'a_refaire');
  assert.equal(audioStatus({ ...review, status: 'rejete' }, [take()]), null);
});

test('modifier une traduction déjà enregistrée rend la prise « À refaire » sans la supprimer', () => {
  let review = applyReviewAction(emptyReview('seg_001'), seg, 'validate', ctx()).review;
  let takes = [take(), take({ id: 'other', segment_id: 'seg_002' })];
  assert.equal(audioStatus(review, takes.filter((t) => t.segment_id === 'seg_001')), 'enregistre');

  const res = applyReviewAction(review, seg, 'correct', ctx({ text: 'Maaqaane taamitaay.' }));
  assert.equal(res.textChanged, true);
  review = res.review;
  const inv = invalidateTakes(takes, 'seg_001', 'Texte modifié');
  takes = inv.takes;

  assert.deepEqual(inv.changed, ['t1']);
  assert.equal(takes.length, 2, 'aucune prise supprimée');
  assert.equal(takes[0].current, false);
  assert.equal(takes[0].quality_status, 'a_refaire');
  assert.equal(takes[1].current, true, 'les autres segments ne sont pas touchés');
  assert.equal(audioStatus(review, takes.filter((t) => t.segment_id === 'seg_001')), 'a_refaire');
});

test('une prise dont la version de texte est dépassée est « À refaire » même si courante', () => {
  const review = { ...applyReviewAction(emptyReview('seg_001'), seg, 'validate', ctx()).review, text_version: 2 };
  assert.equal(audioStatus(review, [take({ text_version: 1 })]), 'a_refaire');
});

test('éligibilité à l\'export TTS', () => {
  const review = applyReviewAction(emptyReview('seg_001'), seg, 'validate', ctx()).review;
  const consent = { speaker_id: 'spk_1', consent_given: true, training_reuse: true, withdrawn_at: null };
  assert.equal(exclusionReason(take(), review, consent), null);
  assert.ok(exclusionReason(take({ confirmed: false }), review, consent));
  assert.ok(exclusionReason(take({ quality_status: 'brouillon' }), review, consent));
  assert.ok(exclusionReason(take({ current: false }), review, consent));
  assert.ok(exclusionReason(take(), { ...review, status: 'rejete' }, consent));
  assert.ok(exclusionReason(take({ text_version: 0 }), review, consent));
  assert.ok(exclusionReason(take(), review, { ...consent, withdrawn_at: '2026-10-21' }));
  assert.ok(exclusionReason(take(), review, { ...consent, training_reuse: false }));
  assert.ok(exclusionReason(take(), review, null));
});
