import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectReadingIssues, hasReadingIssues } from '../js/utils/detect.js';

const FR = 'Brève explication en afar : la cotisation CNSS est calculée sur le salaire brut. Le salarié verse 6 %, et l\'entreprise verse en plus 15,7 %. Cet argent sert à couvrir la retraite, la santé, les prestations familiales et les accidents du travail.';
const AF = 'Qafar afat gaba kalta baxxaqqo: CNSS cotisation salaire brutak loowimta. Taamâ abeyni 6% yaceh, entreprise 15,7% ossah yaceh. Tama lakqo retraite, qaafiyat, xaylo qokol kee taama balaa dacrisoh taamita.';

const brief = (issues) => issues.map(({ type, match }) => [type, match]);

test('phrase de démonstration sans source : pourcentages et sigle', () => {
  const issues = detectReadingIssues(AF);
  assert.deepEqual(brief(issues), [
    ['sigle', 'CNSS'],
    ['pourcentage', '6%'],
    ['pourcentage', '15,7%']
  ]);
  for (const it of issues) assert.equal(AF.slice(it.index, it.index + it.match.length), it.match);
});

test('phrase de démonstration avec source : emprunts', () => {
  const issues = detectReadingIssues(AF, { sourceFr: FR });
  assert.deepEqual(brief(issues), [
    ['sigle', 'CNSS'],
    ['emprunt', 'cotisation'],
    ['emprunt', 'salaire'],
    ['pourcentage', '6%'],
    ['emprunt', 'entreprise'],
    ['pourcentage', '15,7%'],
    ['emprunt', 'retraite']
  ]);
  const cot = issues.find((i) => i.match === 'cotisation');
  assert.equal(cot.message, 'Mot identique au texte français (« cotisation ») : emprunt possible, vérifiez sa prononciation en afar.');
  // « brut » (4 lettres) et « brutak » ne sont pas des emprunts
  assert.ok(!issues.some((i) => /brut/.test(i.match)));
});

test('pourcentage avec espace : signalé une seule fois', () => {
  assert.deepEqual(brief(detectReadingIssues('Taux : 15,7 % cette année.')), [['pourcentage', '15,7 %']]);
});

test('montant en FDJ → nombre + sigle', () => {
  const issues = detectReadingIssues('Montant : 100 000 FDJ par mois.');
  assert.deepEqual(brief(issues), [['nombre', '100 000'], ['sigle', 'FDJ']]);
  assert.equal(issues[0].message, 'Nombre « 100 000 » : saisissez la forme prononcée en toutes lettres dans le champ « Texte prononcé ».');
});

test('séparateurs de milliers et décimales', () => {
  assert.deepEqual(brief(detectReadingIssues('1.500 et 2 300 puis 3,25.')), [
    ['nombre', '1.500'], ['nombre', '2 300'], ['nombre', '3,25']
  ]);
});

test('n° 12 → abréviation + nombre', () => {
  const issues = detectReadingIssues('Dossier n° 12');
  assert.deepEqual(brief(issues), [['abreviation', 'n°'], ['nombre', '12']]);
});

test('sigles variés et symboles', () => {
  assert.deepEqual(brief(detectReadingIssues('O.M.S. et COVID-19, ÉTÉ & 50 €')), [
    ['sigle', 'O.M.S.'], ['sigle', 'COVID-19'], ['sigle', 'ÉTÉ'], ['symbole', '&'], ['nombre', '50'], ['symbole', '€']
  ]);
});

test('abréviations françaises', () => {
  assert.deepEqual(brief(detectReadingIssues('M. Ali, Mme Hawa, Dr Omar, cf. art. 3, etc.')), [
    ['abreviation', 'M.'], ['abreviation', 'Mme'], ['abreviation', 'Dr'], ['abreviation', 'cf.'],
    ['abreviation', 'art.'], ['nombre', '3'], ['abreviation', 'etc.']
  ]);
});

test('texte afar sans difficulté → []', () => {
  const plain = 'Tama lakqo qaafiyat kee taama balaa dacrisoh taamita.';
  assert.deepEqual(detectReadingIssues(plain), []);
  assert.deepEqual(detectReadingIssues(plain, { sourceFr: FR }), []);
  assert.equal(hasReadingIssues(plain), false);
  assert.equal(hasReadingIssues(AF), true);
  assert.deepEqual(detectReadingIssues(''), []);
});
