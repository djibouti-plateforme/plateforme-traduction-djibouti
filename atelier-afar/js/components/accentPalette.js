// Palette facultative de voyelles accentuées : insère un caractère à la position du curseur,
// uniquement sur clic explicite (jamais d'insertion automatique).
import { h } from '../utils/dom.js';

export const ACCENTED_VOWELS = ['á', 'é', 'í', 'ó', 'ú', 'â', 'ê', 'î', 'ô', 'û'];

export function insertAtCursor(field, text) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  field.setRangeText(text, start, end, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.focus();
}

/** @param {() => HTMLInputElement|HTMLTextAreaElement} getField */
export function accentPalette(getField) {
  return h('div', { class: 'accent-palette', role: 'group', 'aria-label': 'Voyelles accentuées' },
    h('span', { class: 'accent-label' }, 'Insérer :'),
    ACCENTED_VOWELS.map((v) => h('button', {
      type: 'button',
      class: 'accent-key',
      title: `Insérer « ${v} »`,
      // mousedown empêché : le champ garde le focus et la sélection
      onmousedown: (e) => e.preventDefault(),
      onclick: () => insertAtCursor(getField(), v),
    }, v)));
}
