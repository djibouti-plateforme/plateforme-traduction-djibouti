/**
 * Détection des éléments à oraliser avant l'enregistrement (nombres, sigles, symboles…).
 * Ne génère JAMAIS de forme prononcée : se contente d'avertir le locuteur.
 * Module pur, sans dépendance.
 */

// Nombre : milliers séparés par espace / espace insécable / point, décimales à virgule
const NUM = String.raw`\d{1,3}(?:[   .]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?`;

const RE_POURCENTAGE = new RegExp(String.raw`(?<!\p{N})(?:${NUM})[   ]?[%‰]`, 'gu');
const RE_SIGLE = new RegExp(
  String.raw`(?<![\p{L}\p{N}.])(?:\p{Lu}\.){2,}` +
  String.raw`|(?<![\p{L}\p{N}])\p{Lu}{2,}(?:-?\d+)?(?![\p{L}\p{N}])`,
  'gu'
);
const RE_NOMBRE = new RegExp(String.raw`(?<![\p{N},.])(?:${NUM})(?!\p{N})`, 'gu');
const RE_ABREVIATION = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:` +
  String.raw`M\.(?=\s)|Mme\b\.?|Dr\b\.?|[Ee]tc\.|[Aa]rt\.|[Nn]°|p\.(?=\s)|[Aa]v\.|bd\b\.?|[Cc]f\.|[Ee]x\.` +
  String.raw`)(?!\p{L})`,
  'gu'
);
const RE_SYMBOLE = /[§€$&@#+=/°‰%]/gu;
const RE_MOT = /\p{L}+/gu;

const MESSAGES = {
  pourcentage: (m) => `Pourcentage « ${m} » : saisissez la forme prononcée en toutes lettres dans le champ « Texte prononcé ».`,
  nombre: (m) => `Nombre « ${m} » : saisissez la forme prononcée en toutes lettres dans le champ « Texte prononcé ».`,
  sigle: (m) => `Sigle « ${m} » : indiquez comment il est prononcé (épelé ou lu comme un mot) dans le champ « Texte prononcé ».`,
  symbole: (m) => `Symbole « ${m} » : saisissez le mot prononcé correspondant dans le champ « Texte prononcé ».`,
  abreviation: (m) => `Abréviation « ${m} » : saisissez la forme complète prononcée dans le champ « Texte prononcé ».`,
  emprunt: (m) => `Mot identique au texte français (« ${m} ») : emprunt possible, vérifiez sa prononciation en afar.`
};

/** Normalise un mot : minuscules, sans accents. */
function normalize(word) {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * @typedef {{ type: 'nombre'|'pourcentage'|'sigle'|'symbole'|'abreviation'|'emprunt', match: string, index: number, message: string }} ReadingIssue
 */

/**
 * Repère les éléments du texte afar qui demandent une forme orale saisie à la main.
 * @param {string} text Texte afar à lire.
 * @param {{ sourceFr?: string }} [opts] `sourceFr` : texte français source (détection d'emprunts).
 * @returns {ReadingIssue[]} Triés par position, sans chevauchement.
 */
export function detectReadingIssues(text, opts = {}) {
  if (!text) return [];
  const str = String(text);
  /** @type {ReadingIssue[]} */
  const issues = [];
  const overlaps = (start, end) => issues.some((it) => start < it.index + it.match.length && it.index < end);

  // Ordre de priorité : le premier type qui couvre une zone l'emporte
  const passes = [
    ['pourcentage', RE_POURCENTAGE],
    ['sigle', RE_SIGLE],
    ['abreviation', RE_ABREVIATION],
    ['nombre', RE_NOMBRE],
    ['symbole', RE_SYMBOLE]
  ];
  for (const [type, re] of passes) {
    for (const m of str.matchAll(re)) {
      const match = m[0];
      if (overlaps(m.index, m.index + match.length)) continue;
      issues.push({ type, match, index: m.index, message: MESSAGES[type](match) });
    }
  }

  // Emprunts : mots (≥ 5 lettres) présents tels quels dans le français
  if (opts.sourceFr) {
    const frWords = new Set();
    for (const m of String(opts.sourceFr).matchAll(RE_MOT)) frWords.add(normalize(m[0]));
    const seen = new Set();
    for (const m of str.matchAll(RE_MOT)) {
      const word = m[0];
      if (word.length < 5) continue;
      const key = normalize(word);
      if (seen.has(key) || !frWords.has(key)) continue;
      if (overlaps(m.index, m.index + word.length)) continue;
      seen.add(key);
      issues.push({ type: 'emprunt', match: word, index: m.index, message: MESSAGES.emprunt(word) });
    }
  }

  return issues.sort((x, y) => x.index - y.index);
}

/**
 * Indique si le texte contient au moins un élément à oraliser.
 * @param {string} text
 * @param {{ sourceFr?: string }} [opts]
 * @returns {boolean}
 */
export function hasReadingIssues(text, opts) {
  return detectReadingIssues(text, opts).length > 0;
}
