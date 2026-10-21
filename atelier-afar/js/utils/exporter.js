// Exports déclenchés depuis le navigateur (téléchargement de fichiers, archive ZIP vérifiée).
import { downloadBlob } from './dom.js';
import {
  buildRevisionRecords, toJsonl, toCsv, REVISION_CSV_COLUMNS, buildTtsManifest, buildLjspeechCsv, buildSpeakersJson, buildTtsReadme,
} from './export.js';
import { parseWavHeader } from '../audio/wav.js';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/** @param {import('../services/DataService.js').DataService} service */
export function exportRevisions(service, format = 'jsonl') {
  const { segments, reviews } = service.snapshot();
  const records = buildRevisionRecords(segments, reviews);
  if (format === 'csv') {
    downloadBlob(`revisions_${stamp()}.csv`, new Blob([toCsv(records, REVISION_CSV_COLUMNS)], { type: 'text/csv;charset=utf-8' }));
  } else {
    downloadBlob(`revisions_${stamp()}.jsonl`, new Blob([toJsonl(records)], { type: 'application/x-ndjson' }));
  }
  return records.length;
}

/**
 * Construit et télécharge l'archive du corpus TTS. Chaque fichier référencé dans les métadonnées
 * est relu depuis l'archive générée pour vérifier sa présence et la validité de son en-tête WAV.
 * @returns {Promise<{ count: number, excluded: number, seconds: number }>}
 */
export async function exportTts(service, onProgress) {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error('La bibliothèque JSZip n\'a pas pu être chargée (connexion internet requise au premier chargement).');
  const { segments, reviews, takes, consents, speakers, settings } = service.snapshot();
  const { entries, excluded } = buildTtsManifest(segments, reviews, takes, consents, speakers);
  if (!entries.length) {
    const err = new Error('Aucun enregistrement éligible : il faut au moins une prise validée, confirmée, liée à une traduction toujours approuvée et à un consentement valide.');
    err.code = 'empty';
    throw err;
  }

  const root = 'afar_tts_dataset';
  const zip = new JSZip();
  const dir = zip.folder(root);
  let i = 0;
  for (const e of entries) {
    const buf = await service.getTakeAudio(e.take.id);
    if (!buf) throw new Error(`Fichier audio manquant dans le stockage local pour la prise ${e.take.id} (${e.meta.segment_id}).`);
    const header = parseWavHeader(buf);
    if (header.audioFormat !== 1 || header.channels !== 1 || header.bitsPerSample !== 16) throw new Error(`Format inattendu pour ${e.path}.`);
    if (header.sampleRate !== e.meta.sample_rate) throw new Error(`Fréquence incohérente pour ${e.path}.`);
    dir.file(e.path, buf);
    onProgress?.(++i / entries.length / 2);
  }
  const metas = entries.map((e) => e.meta);
  dir.file('metadata.jsonl', toJsonl(metas));
  dir.file('metadata.csv', buildLjspeechCsv(entries));
  dir.file('speakers.json', JSON.stringify(buildSpeakersJson(speakers, consents, entries), null, 2));
  dir.file('README.txt', buildTtsReadme({ projectName: settings.projectName, exportedAt: new Date().toISOString(), entries, excluded }));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => onProgress?.(0.5 + m.percent / 200));

  // Vérification : relecture de l'archive produite.
  const check = await JSZip.loadAsync(blob);
  for (const m of metas) {
    const f = check.file(`${root}/${m.audio_filepath}`);
    if (!f) throw new Error(`Vérification échouée : ${m.audio_filepath} absent de l'archive.`);
    const buf = await f.async('arraybuffer');
    const hd = parseWavHeader(buf);
    if (Math.abs(hd.durationSeconds - m.duration_seconds) > 0.05) throw new Error(`Vérification échouée : durée incohérente pour ${m.audio_filepath}.`);
  }
  for (const name of ['metadata.jsonl', 'metadata.csv', 'speakers.json', 'README.txt']) {
    if (!check.file(`${root}/${name}`)) throw new Error(`Vérification échouée : ${name} absent.`);
  }

  downloadBlob(`afar_tts_dataset_${stamp()}.zip`, blob);
  return { count: entries.length, excluded: excluded.length, seconds: metas.reduce((a, m) => a + m.duration_seconds, 0) };
}
