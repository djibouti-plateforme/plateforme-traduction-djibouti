// Panneau « Analyse de la traduction » : typologie d'erreurs (inspirée de MQM).
import { h, icon, mount } from '../utils/dom.js';
import { toast } from './ui.js';

export const ERROR_CATEGORIES = {
  exactitude: { label: 'Exactitude', subs: ['Contresens', 'Omission', 'Ajout'] },
  fluidite: { label: 'Fluidité', subs: ['Grammaire', 'Orthographe', 'Formulation'] },
  terminologie: { label: 'Terminologie', subs: ['Terme technique incorrect', 'Incohérence avec le glossaire'] },
  style: { label: 'Style et registre', subs: ['Formulation peu naturelle', 'Registre inadapté'] },
  conventions: { label: 'Conventions', subs: ['Nombres', 'Dates', 'Sigles', 'Unités'] },
};
export const SEVERITIES = { mineure: 'Mineure', majeure: 'Majeure', critique: 'Critique' };

/**
 * @param {import('../services/DataService.js').DataService} service
 * @param {string} segmentId
 */
export function createAnnotationsPanel(service, segmentId) {
  const list = h('div', { class: 'ann-list' });
  const category = h('select', { class: 'input input-sm', 'aria-label': 'Catégorie' },
    Object.entries(ERROR_CATEGORIES).map(([k, c]) => h('option', { value: k }, c.label)));
  const sub = h('select', { class: 'input input-sm', 'aria-label': 'Sous-catégorie' });
  const comment = h('input', { class: 'input input-sm', placeholder: 'Commentaire (facultatif)', 'aria-label': 'Commentaire' });
  let severity = 'mineure';
  const sevGroup = h('div', { class: 'seg-control', role: 'radiogroup', 'aria-label': 'Gravité' },
    Object.entries(SEVERITIES).map(([k, label]) => h('button', {
      type: 'button', role: 'radio', class: `sev sev-${k}`, 'aria-checked': String(k === severity),
      onclick: (e) => {
        severity = k;
        sevGroup.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
      },
    }, label)));

  const fillSubs = () => mount(sub, h('option', { value: '' }, '— Sous-catégorie —'), ERROR_CATEGORIES[category.value].subs.map((s) => h('option', { value: s }, s)));
  category.addEventListener('change', fillSubs);
  fillSubs();

  const add = async () => {
    await service.addAnnotation(segmentId, { category: category.value, subcategory: sub.value || null, severity, comment: comment.value.trim() || null });
    comment.value = '';
    toast('Annotation ajoutée');
    render();
  };

  function render() {
    const { annotations } = service.getReview(segmentId);
    mount(list, annotations.length
      ? annotations.map((a) => h('div', { class: 'ann' },
        h('span', { class: `sev-dot sev-${a.severity}`, title: SEVERITIES[a.severity] }),
        h('div', { class: 'ann-body' },
          h('strong', null, ERROR_CATEGORIES[a.category]?.label ?? a.category, a.subcategory ? ` › ${a.subcategory}` : ''),
          h('span', { class: 'muted' }, ` · ${SEVERITIES[a.severity]}`),
          a.comment && h('div', { class: 'tiny' }, a.comment)),
        h('button', {
          class: 'icon-btn ghost', 'aria-label': 'Supprimer l\'annotation',
          onclick: async () => { await service.removeAnnotation(segmentId, a.id); render(); },
        }, icon('trash', 15))))
      : h('p', { class: 'muted tiny' }, 'Aucune annotation pour ce segment.'));
    summary.textContent = annotations.length ? `Analyse de la traduction (${annotations.length})` : 'Analyse de la traduction';
  }

  const summary = h('span', null);
  const root = h('details', { class: 'card ann-panel' },
    h('summary', { class: 'card-summary' }, icon('activity', 16), summary, h('span', { class: 'muted tiny' }, ' — facultatif')),
    h('div', { class: 'ann-content' },
      list,
      h('div', { class: 'ann-form' },
        h('div', { class: 'ann-row' }, category, sub),
        h('div', { class: 'ann-row' }, sevGroup, comment),
        h('button', { class: 'btn btn-sm btn-secondary', onclick: add }, icon('plus', 14), 'Ajouter l\'annotation'))));
  render();
  if (service.getReview(segmentId).annotations.length) root.open = true;
  return { el: root, render };
}
