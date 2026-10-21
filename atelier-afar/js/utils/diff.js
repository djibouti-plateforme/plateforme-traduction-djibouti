/**
 * Diff mot à mot (LCS) entre la traduction automatique et la version corrigée.
 * Module pur, sans dépendance.
 */

/**
 * Découpe un texte en mots (séparateurs : espaces Unicode). La ponctuation reste collée.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text) return [];
  return String(text).split(/[\s   ⁠﻿]+/u).filter(Boolean);
}

/**
 * Diff mot à mot de `a` (traduction automatique) vers `b` (texte corrigé).
 * Les opérations consécutives de même type sont fusionnées (mots séparés par un espace) ;
 * dans une zone modifiée, la suppression précède toujours l'insertion.
 * @param {string} a
 * @param {string} b
 * @returns {Array<{ type: 'equal'|'insert'|'delete', value: string }>}
 */
export function diffWords(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;
  const w = m + 1;
  // dp[i][j] = longueur de la LCS des suffixes ta[i..] et tb[j..]
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = ta[i] === tb[j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  /** @type {Array<{ type: string, value: string }>} */
  const raw = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) {
      raw.push({ type: 'equal', value: ta[i] });
      i++; j++;
    } else if (j >= m || (i < n && dp[(i + 1) * w + j] >= dp[i * w + j + 1])) {
      raw.push({ type: 'delete', value: ta[i] });
      i++;
    } else {
      raw.push({ type: 'insert', value: tb[j] });
      j++;
    }
  }

  // Regroupe chaque zone modifiée : suppressions puis insertions, puis fusion
  const ops = [];
  const push = (type, words) => {
    if (!words.length) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.value += ' ' + words.join(' ');
    else ops.push({ type, value: words.join(' ') });
  };
  let dels = [];
  let ins = [];
  const flush = () => { push('delete', dels); push('insert', ins); dels = []; ins = []; };
  for (const op of raw) {
    if (op.type === 'equal') { flush(); push('equal', [op.value]); }
    else if (op.type === 'delete') dels.push(op.value);
    else ins.push(op.value);
  }
  flush();
  return ops;
}

/**
 * Statistiques de modification (en mots).
 * @param {string} a
 * @param {string} b
 * @returns {{ originalWords: number, newWords: number, equal: number, inserted: number, deleted: number, changedPercent: number }}
 */
export function diffStats(a, b) {
  const originalWords = tokenize(a).length;
  const newWords = tokenize(b).length;
  let equal = 0;
  let inserted = 0;
  let deleted = 0;
  for (const op of diffWords(a, b)) {
    const count = tokenize(op.value).length;
    if (op.type === 'equal') equal += count;
    else if (op.type === 'insert') inserted += count;
    else deleted += count;
  }
  const max = Math.max(originalWords, newWords);
  const changedPercent = max === 0 ? 0 : Math.round(100 * (1 - equal / max));
  return { originalWords, newWords, equal, inserted, deleted, changedPercent };
}
