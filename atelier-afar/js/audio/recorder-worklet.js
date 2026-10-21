// AudioWorkletProcessor de capture PCM mono (canal 0). Chargé via audioWorklet.addModule().

const LEVEL_FRAMES = 2048;
const CHUNK_FRAMES = 4096;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffer = new Float32Array(CHUNK_FRAMES);
    this.filled = 0;
    // Fenêtre de mesure de niveau
    this.levelPeak = 0;
    this.levelSumSq = 0;
    this.levelCount = 0;

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'start') {
        this.filled = 0;
        this.buffer = new Float32Array(CHUNK_FRAMES);
        this.recording = true;
      } else if (msg.type === 'stop') {
        if (this.recording) this.flush();
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  /** Envoie les échantillons accumulés (transfert du buffer, sans copie). */
  flush() {
    if (this.filled === 0) return;
    const samples = this.filled === this.buffer.length
      ? this.buffer
      : this.buffer.slice(0, this.filled);
    this.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
    this.buffer = new Float32Array(CHUNK_FRAMES);
    this.filled = 0;
  }

  /** @param {number} frames */
  addSilentFrames(frames) {
    this.levelCount += frames;
    if (this.levelCount >= LEVEL_FRAMES) this.postLevel();
  }

  postLevel() {
    const rms = this.levelCount ? Math.sqrt(this.levelSumSq / this.levelCount) : 0;
    this.port.postMessage({ type: 'level', peak: this.levelPeak, rms });
    this.levelPeak = 0;
    this.levelSumSq = 0;
    this.levelCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input.length ? input[0] : null;

    if (!channel || channel.length === 0) {
      // Pas d'entrée (flux pas encore connecté) : niveau nul, rien à enregistrer
      this.addSilentFrames(128);
      return true;
    }

    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      const a = s < 0 ? -s : s;
      if (a > this.levelPeak) this.levelPeak = a;
      this.levelSumSq += s * s;
      this.levelCount++;
      if (this.levelCount >= LEVEL_FRAMES) this.postLevel();

      if (this.recording) {
        this.buffer[this.filled++] = s;
        if (this.filled >= CHUNK_FRAMES) this.flush();
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
