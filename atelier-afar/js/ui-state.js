// Préférences d'affichage propres à ce navigateur (filtres, dernier segment ouvert…).
const KEY = 'atelier-afar.ui';

export function loadUi() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export function saveUi(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadUi(), ...patch })); } catch { /* préférence non essentielle */ }
}
