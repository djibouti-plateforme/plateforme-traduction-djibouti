// Composants transverses : notifications, boîtes de dialogue, badges, barres de progression.
import { h, icon } from '../utils/dom.js';
import { REVIEW_STATUS, AUDIO_STATUS } from '../utils/status.js';

// --- Notifications ---------------------------------------------------------
let toastHost;
/**
 * @param {string} message
 * @param {{ type?: 'success'|'info'|'warning'|'error', duration?: number }} [opts]
 */
export function toast(message, { type = 'success', duration } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const iconName = { success: 'checkCircle', info: 'info', warning: 'alert', error: 'alert' }[type];
  const el = h('div', { class: `toast toast-${type}` }, icon(iconName, 18), h('span', null, message),
    h('button', { class: 'toast-close', 'aria-label': 'Fermer', onclick: () => close() }, icon('x', 14)));
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  setTimeout(close, duration ?? (type === 'error' || type === 'warning' ? 7000 : 3200));
}

// --- Dialogues ----------------------------------------------------------------
/**
 * Ouvre une boîte de dialogue modale. `render(close)` retourne le contenu.
 * @returns {{ close: (value?: any) => void, result: Promise<any>, el: HTMLDialogElement }}
 */
export function openModal({ title, render, size = 'md', dismissable = true }) {
  const dlg = h('dialog', { class: `modal modal-${size}`, 'aria-label': title });
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  let done = false;
  const close = (value) => {
    if (done) return;
    done = true;
    dlg.classList.add('closing');
    setTimeout(() => { dlg.close(); dlg.remove(); }, 160);
    resolve(value);
  };
  dlg.append(
    h('header', { class: 'modal-head' },
      h('h2', null, title),
      dismissable && h('button', { class: 'icon-btn ghost', 'aria-label': 'Fermer', onclick: () => close(undefined) }, icon('x'))),
    h('div', { class: 'modal-body' }, render(close)),
  );
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissable) close(undefined); });
  document.body.append(dlg);
  dlg.showModal();
  return { close, result, el: dlg };
}

/** Confirmation explicite. @returns {Promise<boolean>} */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return openModal({
    title,
    size: 'sm',
    render: (close) => [
      h('p', { class: 'modal-text' }, message),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => close(false) }, 'Annuler'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, autofocus: true, onclick: () => close(true) }, confirmLabel)),
    ],
  }).result.then((v) => v === true);
}

/** Saisie d'un texte (motif de signalement, etc.). @returns {Promise<string|null>} */
export function promptDialog({ title, message, label, placeholder = '', confirmLabel = 'Valider', required = false, danger = false, initial = '' }) {
  return openModal({
    title,
    render: (close) => {
      const input = h('textarea', { class: 'input', rows: 4, placeholder, value: initial });
      const err = h('p', { class: 'field-error', hidden: true }, 'Ce champ est obligatoire.');
      const submit = () => {
        if (required && !input.value.trim()) { err.hidden = false; input.focus(); return; }
        close(input.value.trim());
      };
      input.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); } });
      setTimeout(() => input.focus(), 30);
      return [
        message && h('p', { class: 'modal-text' }, message),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input),
        err,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn btn-ghost', onclick: () => close(null) }, 'Annuler'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: submit }, confirmLabel)),
      ];
    },
  }).result.then((v) => (typeof v === 'string' ? v : null));
}

// --- Badges et progression -----------------------------------------------------
export const reviewBadge = (status, simulated) =>
  h('span', { class: `badge badge-${status}` }, REVIEW_STATUS[status] ?? status, simulated && h('span', { class: 'badge-sim', title: 'Statut simulé pour la démonstration' }, ' · simulé'));

export const audioBadge = (status) => h('span', { class: `badge badge-audio-${status}` }, AUDIO_STATUS[status] ?? status);

export function progressBar(value, total, { label, tone = 'accent' } = {}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': value, 'aria-label': label ?? 'Progression' },
    h('div', { class: `progress-fill tone-${tone}`, style: { width: `${pct}%` } }));
}

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 26)), h('h3', null, title), text && h('p', null, text), action);
}

/** Bandeau d'avertissement en ligne. */
export const callout = (type, ...content) =>
  h('div', { class: `callout callout-${type}` }, icon(type === 'info' ? 'info' : 'alert', 18), h('div', null, ...content));
