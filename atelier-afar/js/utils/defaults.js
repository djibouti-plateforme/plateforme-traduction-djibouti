// Valeurs par défaut et identifiants.

export const DEFAULT_DIALECTS = ['Aussa', 'Baadu', 'Afar central', 'Afar du Nord', 'Autre'];

export const uid = (prefix) =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 12)}`;

/** Préférences propres à chaque poste (affichage, micro, seuils audio). */
export function defaultSettings() {
  return {
    projectName: 'Atelier Afar',
    activeSpeakerId: null,
    textScale: 1,
    accentPalette: false,
    countdown: true,
    showFrenchWhileRecording: true,
    micDeviceId: null,
    audio: { clipDbfs: -1, lowRmsDbfs: -40, minDuration: 1, maxDuration: 15, noiseWarnDbfs: -50 },
    dialects: [...DEFAULT_DIALECTS],
  };
}
