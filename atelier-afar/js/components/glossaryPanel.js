// Panneau latéral du glossaire français–afar, et surlignage des termes dans le texte source.
import { h, icon, mount, escapeRegExp, AFAR_INPUT_ATTRS, fmtDate } from '../utils/dom.js';
import { openModal, toast, emptyState } from './ui.js';

export const GLOSSARY_STATUS = {
  non_verifie: 'Non vérifié',
  propose: 'Correction proposée',
  valide_linguiste: 'Terme validé par un linguiste',
};

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Découpe le texte français en nœuds, en entourant les termes du glossaire (insensible à la casse ;
 * les termes les plus longs sont prioritaires).
 */
export function highlightTerms(text, glossary, onTermClick) {
  const terms = glossary.filter((g) => g.fr?.trim()).sort((a, b) => b.fr.length - a.fr.length);
  if (!terms.length) return [text];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map((t) => escapeRegExp(t.fr.trim())).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const byKey = new Map(terms.map((t) => [t.fr.trim().toLowerCase(), t]));
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const entry = byKey.get(m[1].toLowerCase());
    if (!entry) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('mark', {
      class: 'gl-term',
      tabindex: 0,
      title: `Glossaire : ${entry.afar || '—'} (${GLOSSARY_STATUS[entry.status]})`,
      onclick: () => onTermClick?.(entry),
      onkeydown: (e) => { if (e.key === 'Enter') onTermClick?.(entry); },
    }, m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * @param {import('../services/DataService.js').DataService} service
 */
export function createGlossaryPanel(service) {
  let query = '';
  const listEl = h('div', { class: 'gl-list' });
  const search = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Rechercher un terme…', 'aria-label': 'Rechercher dans le glossaire' });
  search.addEventListener('input', () => { query = search.value; render(); });

  const root = h('div', { class: 'glossary' },
    h('div', { class: 'panel-head' },
      h('h3', null, icon('book', 16), 'Glossaire FR–Afar'),
      h('button', { class: 'btn btn-sm btn-secondary', onclick: () => editEntry(null) }, icon('plus', 14), 'Ajouter')),
    search,
    listEl);

  function render() {
    const { glossary } = service.snapshot();
    const q = fold(query.trim());
    const items = glossary.filter((g) => !q || fold(g.fr).includes(q) || fold(g.afar || '').includes(q));
    if (!items.length) {
      mount(listEl, emptyState('book', 'Aucun terme', q ? 'Aucun terme ne correspond à la recherche.' : 'Le glossaire est vide.'));
      return;
    }
    mount(listEl, items.map((g) => h('article', { class: 'gl-item' },
      h('div', { class: 'gl-fr' }, g.fr),
      h('div', { class: 'gl-afar', lang: 'aa' }, g.afar || h('em', { class: 'muted' }, 'pas de traduction')),
      h('div', { class: 'gl-meta' },
        h('span', { class: `gl-status gl-${g.status}` }, GLOSSARY_STATUS[g.status]),
        g.domaine && h('span', { class: 'muted tiny' }, g.domaine)),
      g.proposals?.length ? h('details', { class: 'gl-proposals' },
        h('summary', null, `${g.proposals.length} proposition(s)`),
        g.proposals.map((p) => h('p', { class: 'tiny' }, h('strong', { lang: 'aa' }, p.afar), p.comment ? ` — ${p.comment}` : '', h('span', { class: 'muted' }, ` (${fmtDate(p.at)})`)))) : null,
      h('div', { class: 'gl-actions' },
        h('button', { class: 'link-btn', onclick: () => propose(g) }, 'Proposer une correction'),
        h('button', { class: 'link-btn', onclick: () => editEntry(g) }, 'Modifier')))));
  }

  function editEntry(entry) {
    openModal({
      title: entry ? 'Modifier le terme' : 'Ajouter un terme',
      render: (close) => {
        const fr = h('input', { class: 'input', value: entry?.fr ?? '', required: true, lang: 'fr' });
        const afar = h('input', { class: 'input', value: entry?.afar ?? '', ...AFAR_INPUT_ATTRS });
        const domaine = h('input', { class: 'input', value: entry?.domaine ?? '' });
        const notes = h('textarea', { class: 'input', rows: 3, value: entry?.notes ?? '' });
        const save = async () => {
          if (!fr.value.trim()) { fr.focus(); return; }
          await service.saveGlossaryEntry({ ...(entry ? { id: entry.id } : {}), fr: fr.value.trim(), afar: afar.value.trim(), domaine: domaine.value.trim(), notes: notes.value.trim() });
          toast(entry ? 'Terme mis à jour dans le glossaire local' : 'Terme ajouté au glossaire local');
          close(true);
        };
        setTimeout(() => (entry ? afar : fr).focus(), 30);
        return [
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Terme français'), fr),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Traduction afar (Qafar af)'), afar),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Domaine'), domaine),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes d\'usage'), notes),
          h('p', { class: 'muted tiny' }, 'Le statut « Terme validé par un linguiste » sera attribué lors de l\'intégration du processus de validation.'),
          h('div', { class: 'modal-actions' },
            h('button', { class: 'btn btn-ghost', onclick: () => close(false) }, 'Annuler'),
            h('button', { class: 'btn btn-primary', onclick: save }, 'Enregistrer')),
        ];
      },
    });
  }

  function propose(entry) {
    openModal({
      title: `Proposer une correction — « ${entry.fr} »`,
      render: (close) => {
        const afar = h('input', { class: 'input', value: entry.afar ?? '', ...AFAR_INPUT_ATTRS });
        const comment = h('textarea', { class: 'input', rows: 3, placeholder: 'Justification, usage régional…' });
        setTimeout(() => afar.select(), 30);
        return [
          h('p', { class: 'modal-text' }, 'Traduction actuelle : ', h('strong', { lang: 'aa' }, entry.afar || '—')),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Traduction proposée'), afar),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Commentaire'), comment),
          h('div', { class: 'modal-actions' },
            h('button', { class: 'btn btn-ghost', onclick: () => close(false) }, 'Annuler'),
            h('button', {
              class: 'btn btn-primary',
              onclick: async () => {
                if (!afar.value.trim()) { afar.focus(); return; }
                await service.proposeGlossaryCorrection(entry.id, { afar: afar.value.trim(), comment: comment.value.trim() });
                toast('Proposition enregistrée localement');
                close(true);
              },
            }, 'Proposer')),
        ];
      },
    });
  }

  render();
  return {
    el: root,
    render,
    focusTerm(entry) {
      search.value = entry.fr;
      query = entry.fr;
      render();
    },
  };
}
