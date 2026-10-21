// Encodage / décodage WAV PCM 16 bits mono. Module pur (aucun DOM), utilisable dans Node.

const HEADER_BYTES = 44;

/**
 * Concatène plusieurs blocs Float32Array en un seul.
 * @param {Float32Array[]} chunks
 * @returns {Float32Array}
 */
export function concatFloat32(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** @param {DataView} view @param {number} offset @param {string} str */
function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** @param {DataView} view @param {number} offset @returns {string} */
function readAscii(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3)
  );
}

/**
 * Encode des échantillons flottants en WAV PCM 16 bits mono (en-tête de 44 octets).
 * Pas de rééchantillonnage : la fréquence fournie est conservée telle quelle.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {ArrayBuffer}
 */
export function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const rate = Math.round(sampleRate);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // taille du chunk fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byteRate = rate * blockAlign
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bits par échantillon
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (!(s === s)) s = 0; // NaN → silence
    s = s > 1 ? 1 : s < -1 ? -1 : s;
    view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
    offset += 2;
  }
  return buffer;
}

/**
 * Parcourt les chunks RIFF et renvoie fmt + position des données.
 * @param {ArrayBuffer} buffer
 */
function readChunks(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) {
    throw new Error('Fichier WAV invalide : données trop courtes.');
  }
  const view = new DataView(buffer);
  if (readAscii(view, 0) !== 'RIFF') throw new Error('Fichier WAV invalide : signature « RIFF » absente.');
  if (readAscii(view, 8) !== 'WAVE') throw new Error('Fichier WAV invalide : format « WAVE » absent.');

  let fmt = null;
  let dataOffset = -1;
  let dataBytes = 0;
  let pos = 12;
  while (pos + 8 <= buffer.byteLength) {
    const id = readAscii(view, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buffer.byteLength) throw new Error('Fichier WAV invalide : chunk « fmt » incomplet.');
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true)
      };
    } else if (id === 'data') {
      dataOffset = body;
      // Tolère une taille déclarée plus grande que le fichier (enregistrement tronqué)
      dataBytes = Math.min(size, buffer.byteLength - body);
      break;
    }
    pos = body + size + (size % 2); // les chunks sont alignés sur 2 octets
  }
  if (!fmt) throw new Error('Fichier WAV invalide : chunk « fmt » introuvable.');
  if (dataOffset < 0) throw new Error('Fichier WAV invalide : chunk « data » introuvable.');
  if (!fmt.channels || !fmt.sampleRate || !fmt.bitsPerSample) {
    throw new Error('Fichier WAV invalide : paramètres audio incohérents.');
  }
  return { view, fmt, dataOffset, dataBytes };
}

/**
 * Lit et valide l'en-tête d'un fichier WAV.
 * @param {ArrayBuffer} buffer
 * @returns {{ audioFormat: number, channels: number, sampleRate: number, bitsPerSample: number, dataBytes: number, durationSeconds: number }}
 */
export function parseWavHeader(buffer) {
  const { fmt, dataBytes } = readChunks(buffer);
  const frameBytes = fmt.channels * (fmt.bitsPerSample / 8);
  return {
    audioFormat: fmt.audioFormat,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample,
    dataBytes,
    durationSeconds: dataBytes / frameBytes / fmt.sampleRate
  };
}

/**
 * Décode un WAV PCM 16 bits mono en Float32Array (pour redessiner la forme d'onde).
 * @param {ArrayBuffer} buffer
 * @returns {{ samples: Float32Array, sampleRate: number }}
 */
export function decodeWavToFloat32(buffer) {
  const { view, fmt, dataOffset, dataBytes } = readChunks(buffer);
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16 || fmt.channels !== 1) {
    throw new Error('Format WAV non pris en charge : seul le PCM 16 bits mono est accepté.');
  }
  const n = Math.floor(dataBytes / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = view.getInt16(dataOffset + i * 2, true);
    samples[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return { samples, sampleRate: fmt.sampleRate };
}
