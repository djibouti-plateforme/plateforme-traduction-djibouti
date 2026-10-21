import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, diffWords, diffStats } from '../js/utils/diff.js';

const MT = 'Qafar afat gaba kalta baxxaqqo: CNSS cotisation salaire brutak loowimta. Taamâ abeyni 6% yaceh, entreprise 15,7% ossah yaceh. Tama lakqo retraite, qaafiyat, xaylo qokol kee taama balaa dacrisoh taamita.';
const CORRIGE = MT.replace('cotisation', 'kaxxa-cotisation').replace('entreprise', 'dirriyya');

test('tokenize : espaces Unicode, ponctuation attachée, pas de vides', () => {
  assert.deepEqual(tokenize('  Bonjour, le\tmonde !\n'), ['Bonjour,', 'le', 'monde', '!']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
});

test('textes identiques → une seule opération equal et 0 %', () => {
  assert.deepEqual(diffWords('a b c', 'a  b\nc'), [{ type: 'equal', value: 'a b c' }]);
  assert.equal(diffStats('a b c', 'a b c').changedPercent, 0);
});

test('remplacement complet → delete puis insert, 100 %', () => {
  assert.deepEqual(diffWords('un deux', 'trois quatre cinq'), [
    { type: 'delete', value: 'un deux' },
    { type: 'insert', value: 'trois quatre cinq' }
  ]);
  const s = diffStats('un deux', 'trois quatre cinq');
  assert.equal(s.changedPercent, 100);
  assert.equal(s.equal, 0);
});

test('insertion au milieu', () => {
  assert.deepEqual(diffWords('a b', 'a z z b'), [
    { type: 'equal', value: 'a' },
    { type: 'insert', value: 'z z' },
    { type: 'equal', value: 'b' }
  ]);
});

test('suppression au milieu', () => {
  assert.deepEqual(diffWords('a x y b', 'a b'), [
    { type: 'equal', value: 'a' },
    { type: 'delete', value: 'x y' },
    { type: 'equal', value: 'b' }
  ]);
});

test('remplacement au milieu : fusion et delete avant insert', () => {
  assert.deepEqual(diffWords('a b c d', 'a x y d'), [
    { type: 'equal', value: 'a' },
    { type: 'delete', value: 'b c' },
    { type: 'insert', value: 'x y' },
    { type: 'equal', value: 'd' }
  ]);
});

test('diffStats : comptes en mots', () => {
  assert.deepEqual(diffStats('a b c d', 'a x y z d'), {
    originalWords: 4, newWords: 5, equal: 2, inserted: 3, deleted: 2, changedPercent: 60
  });
});

test('chaînes vides', () => {
  assert.deepEqual(diffWords('', ''), []);
  assert.deepEqual(diffWords('', 'a b'), [{ type: 'insert', value: 'a b' }]);
  assert.deepEqual(diffWords('a b', ''), [{ type: 'delete', value: 'a b' }]);
  assert.deepEqual(diffStats('', ''), {
    originalWords: 0, newWords: 0, equal: 0, inserted: 0, deleted: 0, changedPercent: 0
  });
  assert.equal(diffStats('', 'a').changedPercent, 100);
});

test('paire de démonstration seg_001 : 2 mots corrigés', () => {
  assert.deepEqual(diffStats(MT, CORRIGE), {
    originalWords: 29, newWords: 29, equal: 27, inserted: 2, deleted: 2, changedPercent: 7
  });
  const ops = diffWords(MT, CORRIGE);
  assert.equal(ops.length, 7);
  assert.deepEqual(ops[1], { type: 'delete', value: 'cotisation' });
  assert.deepEqual(ops[2], { type: 'insert', value: 'kaxxa-cotisation' });
  assert.deepEqual(ops[4], { type: 'delete', value: 'entreprise' });
  assert.deepEqual(ops[5], { type: 'insert', value: 'dirriyya' });
});

test('performance : ~300 mots de chaque côté', () => {
  const a = Array.from({ length: 300 }, (_, i) => `mot${i % 37}`).join(' ');
  const b = Array.from({ length: 300 }, (_, i) => `mot${(i * 7) % 41}`).join(' ');
  const t0 = performance.now();
  const s = diffStats(a, b);
  assert.ok(performance.now() - t0 < 500);
  assert.equal(s.equal + s.deleted, 300);
  assert.equal(s.equal + s.inserted, 300);
});
