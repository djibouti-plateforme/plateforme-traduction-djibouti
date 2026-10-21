// Onglet 1 — Révision des traductions FR → Afar (travail à plusieurs : verrous, répartition, temps réel).
import { h, icon, mount, debounce, fmtDate, fmtDuration, AFAR_INPUT_ATTRS, isTypingTarget } from '../utils/dom.js';
import { diffWords, diffStats } from '../utils/diff.js';
import { REVIEW_STATUS, editorText, normalizeSpaces } from '../utils/status.js';
import { toast, confirmDialog, promptDialog, reviewBadge, progressBar, emptyState } from '../components/ui.js';
import { createGlossaryPanel, highlightTerms } from '../components/glossaryPanel.js';
import { createAnnotationsPanel } from '../components/annotationsPanel.js';
import { accentPalette } from '../components/accentPalette.js';
import { loadUi, saveUi } from '../ui-state.js';
import { LOCK_HEARTBEAT_MS } from '../config.js';

const DONE = new Set(['valide', 'corrige', 'rejete', 'signale']);
const TODO = new Set(['a_reviser', 'en_cours']);
const IDLE_LIMIT_MS = 90_000;
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * @param {HTMLElement} container
 * @param {{ service: import('../services/SupabaseDataService.js').SupabaseDataService, params: { id?: string }, setRoute: (path: string) => void }} ctx
 */
export function mountReview(container, { service, params, setRoute }) {
  const ui = loadUi();
  const segs = () => service.snapshot().segments;
  const myCode = service.snapshot().me?.code;
  const hasMine = segs().some((s) => s.assigned_to === myCode);
  const filters = { q: '', status: 'all', lot: 'all', domaine: 'all', assignee: hasMine ? 'mine' : 'all', ...(ui.reviewFilters ?? {}) };
  let currentId = null;

  // ---- Colonne gauche ----------------------------------------------------
  const searchInput = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Rechercher (français, afar, identifiant)…', value: filters.q, 'aria-label': 'Recherche plein texte' });
  const assigneeSel = h('select', { class: 'input input-sm', 'aria-label': 'Filtrer par linguiste' });
  const statusSel = h('select', { class: 'input input-sm', 'aria-label': 'Filtrer par statut' },
    h('option', { value: 'all' }, 'Statut : tous'),
    h('option', { value: 'todo' }, 'À traiter'),
    Object.entries(REVIEW_STATUS).map(([k, l]) => h('option', { value: k }, l)));
  const lotSel = h('select', { class: 'input input-sm', 'aria-label': 'Filtrer par lot' });
  const domSel = h('select', { class: 'input input-sm', 'aria-label': 'Filtrer par domaine' });

  function fillFilterOptions() {
    const uniq = (key) => [...new Set(segs().map((s) => s[key]))].sort((a, b) => a.localeCompare(b, 'fr'));
    mount(lotSel, h('option', { value: 'all' }, 'Lot : tous'), uniq('lot').map((v) => h('option', { value: v }, v)));
    mount(domSel, h('option', { value: 'all' }, 'Domaine : tous'), uniq('domaine').map((v) => h('option', { value: v }, v)));
    mount(assigneeSel,
      h('option', { value: 'mine' }, 'Mes segments'),
      h('option', { value: 'all' }, 'Tous les segments'),
      h('option', { value: 'unassigned' }, 'Non attribués'),
      service.snapshot().members.filter((m) => m.code !== myCode).map((m) => h('option', { value: `m:${m.code}` }, `Attribués à ${m.display_name}`)));
    statusSel.value = filters.status; lotSel.value = filters.lot; domSel.value = filters.domaine; assigneeSel.value = filters.assignee;
    if (assigneeSel.value !== filters.assignee) { filters.assignee = 'all'; assigneeSel.value = 'all'; }
    if (lotSel.value !== filters.lot) { filters.lot = 'all'; lotSel.value = 'all'; }
  }
  fillFilterOptions();

  const progressEl = h('div', { class: 'list-progress' });
  const listEl = h('div', { class: 'seg-list', role: 'listbox', 'aria-label': 'Segments à réviser' });
  const onFilter = () => {
    Object.assign(filters, { q: searchInput.value, status: statusSel.value, lot: lotSel.value, domaine: domSel.value, assignee: assigneeSel.value });
    saveUi({ reviewFilters: filters });
    renderList();
  };
  searchInput.addEventListener('input', debounce(onFilter, 120));
  [statusSel, lotSel, domSel, assigneeSel].forEach((s) => s.addEventListener('change', onFilter));

  const left = h('aside', { class: 'pane pane-list' },
    h('div', { class: 'pane-head' }, h('h2', null, 'Segments'), progressEl),
    h('div', { class: 'filters' },
      h('div', { class: 'search-wrap' }, icon('search', 15), searchInput),
      assigneeSel,
      h('div', { class: 'filter-row' }, statusSel, lotSel, domSel)),
    listEl);

  // ---- Colonne droite (glossaire) ---------------------------------------------
  const glossary = createGlossaryPanel(service);
  const right = h('aside', { class: 'pane pane-side' }, glossary.el);

  // ---- Zone centrale -----------------------------------------------------------
  const center = h('section', { class: 'pane pane-main', 'aria-live': 'off' });

  // Sur tablette, le glossaire s'ouvre en tiroir par-dessus l'éditeur : fermé par défaut.
  const narrow = matchMedia('(max-width: 1280px)').matches;
  const layout = h('div', { class: `review-layout${ui.glossaryHidden || narrow ? ' no-side' : ''}` }, left, center, right);
  mount(container, layout);

  function filtered() {
    const { reviews } = service.snapshot();
    const q = fold(filters.q.trim());
    return segs().filter((s) => {
      const r = reviews[s.id];
      const st = r?.status ?? 'a_reviser';
      if (filters.status === 'todo' ? !TODO.has(st) : (filters.status !== 'all' && st !== filters.status)) return false;
      if (filters.lot !== 'all' && s.lot !== filters.lot) return false;
      if (filters.domaine !== 'all' && s.domaine !== filters.domaine) return false;
      if (filters.assignee === 'mine' && s.assigned_to !== myCode) return false;
      if (filters.assignee === 'unassigned' && s.assigned_to) return false;
      if (filters.assignee.startsWith('m:') && s.assigned_to !== filters.assignee.slice(2)) return false;
      if (q && ![s.id, s.source_fr, s.mt_afar, r?.corrected_afar ?? '', r?.draft_afar ?? ''].some((t) => fold(t).includes(q))) return false;
      return true;
    });
  }

  function renderList() {
    const { reviews } = service.snapshot();
    const scope = filters.assignee === 'mine' ? segs().filter((s) => s.assigned_to === myCode) : segs();
    const done = scope.filter((s) => DONE.has(reviews[s.id]?.status)).length;
    mount(progressEl,
      h('div', { class: 'progress-label' }, h('strong', null, `${done} / ${scope.length}`), filters.assignee === 'mine' ? ' de mes segments traités' : ' segments traités'),
      progressBar(done, scope.length, { label: 'Segments traités' }));
    const items = filtered();
    if (!items.length) {
      mount(listEl, emptyState('search', 'Aucun segment', filters.assignee === 'mine' ? 'Aucun segment ne vous est attribué avec ces filtres. Choisissez « Tous les segments ».' : 'Modifiez la recherche ou les filtres.'));
      return;
    }
    mount(listEl, items.map((s) => {
      const r = reviews[s.id];
      const st = r?.status ?? 'a_reviser';
      const lock = service.lockOf(s.id);
      return h('button', {
        class: ['seg-item', s.id === currentId && 'active', `st-${st}`, lock && 'locked'],
        role: 'option',
        'aria-selected': String(s.id === currentId),
        onclick: () => select(s.id),
      },
      h('div', { class: 'seg-item-top' }, h('span', { class: 'seg-id' }, s.id), reviewBadge(st)),
      h('p', { class: 'seg-preview' }, s.source_fr),
      h('div', { class: 'seg-item-meta' },
        h('span', null, s.domaine),
        s.assigned_to ? h('span', { class: s.assigned_to === myCode ? 'mine' : '' }, s.assigned_to === myCode ? 'à moi' : service.memberName(s.assigned_to)) : h('span', null, s.lot.replace(/ —.*/, ''))),
      lock && h('div', { class: 'lock-line' }, icon('user', 12), `${lock.member_name} y travaille`));
    }));
    listEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- Chronomètre de révision ------------------------------------------------
  let pendingSeconds = 0;
  let shownSeconds = 0;
  let lastActivity = Date.now();
  const timerEl = h('span', { class: 'timer', title: 'Temps de révision actif sur ce segment (pause après 90 s d\'inactivité)' });
  const markActivity = () => { lastActivity = Date.now(); };
  ['keydown', 'mousemove', 'mousedown', 'scroll'].forEach((t) => document.addEventListener(t, markActivity, { passive: true }));
  const flushTime = () => {
    if (currentId && pendingSeconds > 0 && !readOnly) service.addReviewTime(currentId, pendingSeconds);
    pendingSeconds = 0;
  };
  const tick = setInterval(() => {
    if (!currentId || readOnly || document.visibilityState !== 'visible' || Date.now() - lastActivity > IDLE_LIMIT_MS) return;
    pendingSeconds += 1;
    shownSeconds += 1;
    timerEl.replaceChildren(icon('clock', 14), ` ${fmtDuration(shownSeconds)}`);
    if (pendingSeconds >= 10) flushTime();
  }, 1000);

  // ---- Verrou du segment ouvert --------------------------------------------------
  let readOnly = false;
  const heartbeat = setInterval(async () => {
    if (!currentId || readOnly || document.visibilityState !== 'visible') return;
    const res = await service.claimSegment(currentId);
    if (!res.ok && res.lock) {
      toast(`${res.lock.member_name} a pris la main sur ${currentId}.`, { type: 'warning' });
      renderCenter();
    }
  }, LOCK_HEARTBEAT_MS);

  // ---- Rendu du segment courant ---------------------------------------------------
  /** @type {HTMLTextAreaElement|null} */
  let editor = null;
  let saveDraft = null;
  let annotations = null;

  async function select(id, { force = false } = {}) {
    if (id === currentId && !force) return;
    saveDraft?.flush();
    flushTime();
    const previous = currentId;
    currentId = id;
    saveUi({ lastSegmentId: id });
    setRoute(`/revision/${id}`);
    if (previous && previous !== id) service.releaseSegment(previous).catch(() => {});
    await service.claimSegment(id, { force }).catch(() => {});
    if (currentId !== id) return; // l'utilisateur a déjà changé de segment
    renderCenter();
    renderList();
  }

  function neighbour(dir) {
    const items = filtered();
    const i = items.findIndex((s) => s.id === currentId);
    return items[i + dir]?.id ?? null;
  }

  /** Prochain segment à traiter, libre, dans la liste filtrée (en reprenant au début si besoin). */
  function nextTodo() {
    const { reviews } = service.snapshot();
    const items = filtered();
    const i = items.findIndex((s) => s.id === currentId);
    const ordered = [...items.slice(i + 1), ...items.slice(0, Math.max(i, 0))];
    return ordered.find((s) => TODO.has(reviews[s.id]?.status ?? 'a_reviser') && !service.lockOf(s.id))?.id ?? null;
  }

  function goNext() {
    const id = neighbour(1);
    if (id) select(id); else toast('Dernier segment de la liste filtrée.', { type: 'info' });
  }
  function goPrev() {
    const id = neighbour(-1);
    if (id) select(id); else toast('Premier segment de la liste filtrée.', { type: 'info' });
  }

  function renderCenter() {
    const segment = segs().find((s) => s.id === currentId);
    if (!segment) { mount(center, emptyState('file', 'Aucun segment', 'Aucun segment à afficher.')); return; }
    const lock = service.lockOf(segment.id);
    readOnly = !!lock;
    // Ouvrir un segment « À réviser » le fait passer « En cours » (mise à jour synchrone de l'état local).
    if (!readOnly && service.getReview(segment.id).status === 'a_reviser') service.touchReview(segment.id).catch(() => {});
    const review = service.getReview(segment.id);
    shownSeconds = Math.round(review.duration_seconds || 0);
    timerEl.replaceChildren(icon('clock', 14), ` ${fmtDuration(shownSeconds)}`);
    const { settings, glossary: gl } = service.snapshot();

    // A. Texte source
    const source = h('div', { class: 'text-source', lang: 'fr' }, highlightTerms(segment.source_fr, gl, (entry) => {
      if (layout.classList.contains('no-side')) toggleSide();
      glossary.focusTerm(entry);
    }));

    // C. Éditeur
    editor = h('textarea', { class: 'editor', rows: 5, 'aria-label': 'Traduction corrigée en afar', readonly: readOnly, ...AFAR_INPUT_ATTRS });
    editor.value = editorText(review, segment);
    const draftInfo = h('span', { class: 'draft-info' });
    const diffBox = h('div', { class: 'diff', lang: 'aa' });
    const diffMeta = h('div', { class: 'diff-meta' });

    const reference = () => service.getReview(segment.id).corrected_afar ?? segment.mt_afar;
    const paintDraftInfo = () => {
      const r = service.getReview(segment.id);
      const dirty = normalizeSpaces(editor.value) !== normalizeSpaces(reference());
      draftInfo.className = `draft-info${dirty ? ' dirty' : ''}`;
      draftInfo.textContent = dirty
        ? (r.draft_saved_at ? `Brouillon enregistré automatiquement à ${new Date(r.draft_saved_at).toLocaleTimeString('fr-FR')} — non validé` : 'Modifications en cours…')
        : (r.corrected_afar ? `Version enregistrée le ${fmtDate(r.reviewed_at)}${r.reviewer_id ? ` par ${service.memberName(r.reviewer_id)}` : ''}` : 'Identique à la traduction automatique');
    };
    const paintDiff = () => {
      const ops = diffWords(segment.mt_afar, editor.value);
      const st = diffStats(segment.mt_afar, editor.value);
      mount(diffBox, st.inserted + st.deleted === 0
        ? h('span', { class: 'muted' }, 'Aucune différence avec la traduction automatique.')
        : ops.map((op) => (op.type === 'equal' ? h('span', null, op.value, ' ')
          : op.type === 'insert' ? [h('ins', { title: 'Ajouté' }, op.value), ' '] : [h('del', { title: 'Supprimé' }, op.value), ' '])));
      mount(diffMeta,
        h('span', { class: 'diff-pct' }, h('strong', null, `${st.changedPercent} %`), ' de mots modifiés'),
        h('span', { class: 'diff-add' }, `+${st.inserted}`),
        h('span', { class: 'diff-del' }, `−${st.deleted}`),
        h('span', { class: 'muted' }, `${st.newWords} mots`));
    };
    saveDraft = debounce(async () => {
      if (!editor || !editor.isConnected || readOnly) return;
      await service.saveDraft(segment.id, editor.value).catch(() => {});
      paintDraftInfo();
      renderList();
    }, 700);
    const repaintDiff = debounce(paintDiff, 80);
    editor.addEventListener('input', () => { repaintDiff(); saveDraft(); draftInfo.className = 'draft-info dirty'; draftInfo.textContent = 'Modifications en cours…'; });

    const restore = async () => {
      if (normalizeSpaces(editor.value) === normalizeSpaces(segment.mt_afar)) { toast('Le texte est déjà identique à la traduction automatique.', { type: 'info' }); return; }
      const ok = await confirmDialog({ title: 'Restaurer la version originale ?', message: 'Le texte de l\'éditeur sera remplacé par la traduction automatique. Les modifications non enregistrées seront perdues.', confirmLabel: 'Restaurer', danger: true });
      if (!ok) return;
      editor.value = segment.mt_afar;
      paintDiff();
      saveDraft.flush();
      toast('Version originale restaurée dans l\'éditeur');
    };

    annotations = createAnnotationsPanel(service, segment.id);

    // Historique : version machine + dernière version enregistrée.
    const lastSaved = [...review.history].reverse().find((v) => v.status === 'corrige' || v.status === 'valide');
    const history = h('details', { class: 'card history' },
      h('summary', { class: 'card-summary' }, icon('restore', 16), 'Historique des versions', h('span', { class: 'muted tiny' }, ` — ${review.history.length} décision(s)`)),
      h('div', { class: 'history-body' },
        h('div', { class: 'hist-item' }, h('span', { class: 'hist-label' }, 'Version machine (conservée)'), h('p', { lang: 'aa' }, segment.mt_afar)),
        lastSaved ? h('div', { class: 'hist-item' }, h('span', { class: 'hist-label' }, `Dernière version enregistrée — ${REVIEW_STATUS[lastSaved.status]}, ${fmtDate(lastSaved.saved_at)}`), h('p', { lang: 'aa' }, lastSaved.text)) : null,
        review.history.length ? h('ol', { class: 'hist-log' }, [...review.history].reverse().map((v) => h('li', null, `${fmtDate(v.saved_at)} — ${REVIEW_STATUS[v.status]} (${service.memberName(v.reviewer_id)})`))) : null,
        review.flag_comment ? h('p', { class: 'tiny' }, h('strong', null, 'Motif : '), review.flag_comment) : null));

    const actions = h('div', { class: ['actions', readOnly && 'is-disabled'] },
      h('button', { class: 'btn btn-success', disabled: readOnly, onclick: () => act('validate'), title: 'Ctrl/Cmd + Maj + Entrée' }, icon('checkCircle'), 'Valider sans modification'),
      h('button', { class: 'btn btn-primary', disabled: readOnly, onclick: () => act('correct'), title: 'Ctrl/Cmd + Entrée' }, icon('save'), 'Enregistrer la correction'),
      h('span', { class: 'actions-sep' }),
      h('button', { class: 'btn btn-outline-danger', disabled: readOnly, onclick: () => act('reject') }, icon('x'), 'Rejeter — À retraduire'),
      h('button', { class: 'btn btn-outline-warning', disabled: readOnly, onclick: () => act('flag') }, icon('flag'), 'Signaler un problème'),
      h('button', { class: 'btn btn-ghost', onclick: goNext, title: 'Alt + →' }, 'Passer au suivant', icon('chevronRight')));

    const scaleBtns = h('div', { class: 'btn-group', role: 'group', 'aria-label': 'Taille du texte' },
      h('button', { class: 'icon-btn', title: 'Réduire le texte', onclick: () => setScale(-0.1) }, icon('zoomOut', 16)),
      h('button', { class: 'icon-btn', title: 'Agrandir le texte', onclick: () => setScale(0.1) }, icon('zoomIn', 16)));

    const lockBanner = lock && h('div', { class: 'lock-banner' },
      icon('user', 16),
      h('span', null, h('strong', null, lock.member_name), ` révise ce segment en ce moment (depuis ${new Date(lock.locked_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}). Lecture seule.`),
      h('span', { class: 'actions-sep' }),
      h('button', {
        class: 'btn btn-sm btn-secondary',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Prendre la main sur ce segment ?', message: `${lock.member_name} ne pourra plus enregistrer ses modifications sur ce segment tant que vous y travaillez. Prévenez-le si possible.`, confirmLabel: 'Prendre la main' });
          if (ok) select(segment.id, { force: true });
        },
      }, 'Prendre la main'),
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => { const n = nextTodo(); if (n) select(n); else toast('Aucun autre segment libre à traiter.', { type: 'info' }); } }, 'Segment libre suivant', icon('chevronRight', 14)));

    const seqIdx = segs().findIndex((s) => s.id === segment.id) + 1;
    mount(center,
      h('div', { class: 'main-toolbar' },
        h('div', { class: 'crumbs' },
          h('span', { class: 'seg-id lg' }, segment.id),
          reviewBadge(review.status),
          h('span', { class: 'chip' }, segment.domaine),
          h('span', { class: 'chip chip-ghost' }, segment.lot),
          segment.assigned_to && h('span', { class: 'chip chip-ghost' }, icon('user', 12), segment.assigned_to === myCode ? 'Attribué à moi' : `Attribué à ${service.memberName(segment.assigned_to)}`)),
        h('div', { class: 'toolbar-right' },
          timerEl,
          scaleBtns,
          h('button', { class: 'icon-btn', title: 'Segment précédent (Alt + ←)', onclick: goPrev }, icon('chevronLeft')),
          h('span', { class: 'muted tiny' }, `${seqIdx} / ${segs().length}`),
          h('button', { class: 'icon-btn', title: 'Segment suivant (Alt + →)', onclick: goNext }, icon('chevronRight')),
          h('button', { class: 'icon-btn', title: layout.classList.contains('no-side') ? 'Afficher le glossaire' : 'Masquer le glossaire', onclick: toggleSide }, icon('book', 16)))),

      lockBanner,

      h('article', { class: 'card text-card' },
        h('header', { class: 'card-head' }, h('h3', null, 'Texte original — Français'), h('span', { class: 'muted tiny' }, 'Termes du glossaire surlignés')),
        source),

      h('article', { class: 'card text-card mt-card' },
        h('header', { class: 'card-head' }, h('h3', null, 'Traduction automatique — Claude')),
        h('div', { class: 'text-mt', lang: 'aa' }, segment.mt_afar),
        h('dl', { class: 'meta-grid' },
          h('div', null, h('dt', null, 'Modèle'), h('dd', null, segment.mt_model)),
          h('div', null, h('dt', null, 'Version du prompt'), h('dd', null, segment.mt_prompt_version)),
          h('div', null, h('dt', null, 'Générée le'), h('dd', null, fmtDate(segment.created_at))),
          h('div', null, h('dt', null, 'Segment'), h('dd', null, segment.id)))),

      h('article', { class: ['card text-card editor-card', readOnly && 'is-readonly'] },
        h('header', { class: 'card-head' },
          h('h3', null, 'Traduction corrigée — Afar (Qafar af)'),
          !readOnly && h('button', { class: 'btn btn-sm btn-ghost', onclick: restore, title: 'Remplacer par la traduction automatique' }, icon('restore', 14), 'Restaurer l\'original')),
        editor,
        settings.accentPalette && !readOnly && accentPalette(() => editor),
        h('div', { class: 'editor-foot' }, draftInfo, h('span', { class: 'muted tiny' }, 'Correction orthographique désactivée'))),

      actions,

      h('article', { class: 'card diff-card' },
        h('header', { class: 'card-head' }, h('h3', null, 'Comparaison avec la traduction automatique'), diffMeta),
        diffBox),

      annotations.el,
      history);

    paintDiff();
    paintDraftInfo();
  }

  function setScale(delta) {
    const s = service.snapshot().settings;
    const next = Math.min(1.6, Math.max(0.8, Math.round((s.textScale + delta) * 10) / 10));
    service.saveSettings({ textScale: next });
  }

  function toggleSide() {
    layout.classList.toggle('no-side');
    if (!matchMedia('(max-width: 1280px)').matches) saveUi({ glossaryHidden: layout.classList.contains('no-side') });
  }

  // ---- Actions ---------------------------------------------------------------------
  let busy = false;
  async function act(action) {
    if (busy || !currentId || readOnly) return;
    const segment = segs().find((s) => s.id === currentId);
    const text = editor?.value ?? '';
    const dirtyVsMt = normalizeSpaces(text) !== normalizeSpaces(segment.mt_afar);
    let payload = { text };

    if (action === 'validate' && dirtyVsMt) {
      const ok = await confirmDialog({
        title: 'Valider la traduction automatique ?',
        message: 'Le texte de l\'éditeur diffère de la traduction automatique. En validant sans modification, vos corrections non enregistrées seront abandonnées.',
        confirmLabel: 'Abandonner mes modifications et valider', danger: true,
      });
      if (!ok) return;
    }
    if (action === 'correct' && !dirtyVsMt) {
      toast('Aucune modification par rapport à la traduction automatique. Utilisez « Valider sans modification » (Ctrl/Cmd + Maj + Entrée).', { type: 'info' });
      return;
    }
    if (action === 'reject') {
      const comment = await promptDialog({
        title: 'Rejeter la traduction ?',
        message: 'La traduction sera marquée « Rejeté — À retraduire » et devra être régénérée. Le texte de l\'éditeur est conservé dans l\'historique.',
        label: 'Motif du rejet (facultatif)', confirmLabel: 'Rejeter', danger: true,
      });
      if (comment === null) return;
      payload = { ...payload, comment };
    }
    if (action === 'flag') {
      const comment = await promptDialog({
        title: 'Signaler un problème dans le texte source',
        message: 'Décrivez l\'ambiguïté ou l\'erreur du texte français original.',
        label: 'Description du problème', placeholder: 'Ex. : le sigle « ITS » n\'est pas défini…', confirmLabel: 'Signaler', required: true,
      });
      if (comment === null) return;
      payload = { ...payload, comment };
    }

    busy = true;
    try {
      saveDraft?.cancel();
      flushTime();
      const res = await service.reviewAction(currentId, action, payload);
      if (!res.ok) { toast(res.error, { type: 'warning' }); return; }
      const label = { validate: 'Traduction validée', correct: 'Correction enregistrée — statut « Corrigé »', reject: 'Traduction rejetée — à retraduire', flag: 'Problème signalé' }[action];
      toast(label);
      if (res.invalidatedTakes) toast('Le texte approuvé a changé : l\'enregistrement audio de ce segment passe « À refaire » (l\'ancienne prise est conservée).', { type: 'warning' });
      const next = nextTodo() ?? neighbour(1);
      if (next) select(next); else { renderCenter(); renderList(); toast('Tous les segments de cette liste sont traités.', { type: 'info' }); }
    } finally {
      busy = false;
    }
  }

  // ---- Raccourcis ------------------------------------------------------------------
  function onKey(e) {
    if (document.querySelector('dialog[open]') || e.repeat) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      act(e.shiftKey ? 'validate' : 'correct');
    } else if (e.altKey && !mod && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      if (e.key === 'ArrowRight') goNext(); else goPrev();
    } else if (e.key === 'Escape' && document.activeElement === editor) {
      editor.blur();
    } else if (e.key === 'Enter' && !isTypingTarget(e.target) && e.target === document.body) {
      editor?.focus();
    }
  }
  document.addEventListener('keydown', onKey);

  // Segment de départ : celui demandé, sinon le dernier ouvert, sinon le premier libre à traiter.
  const all = segs();
  const startId = all.some((s) => s.id === params.id) ? params.id
    : all.some((s) => s.id === ui.lastSegmentId) ? ui.lastSegmentId
      : (filtered().find((s) => TODO.has(service.getReview(s.id).status) && !service.lockOf(s.id)) ?? filtered()[0] ?? all[0])?.id;
  renderList();
  if (startId) select(startId); else mount(center, emptyState('file', 'Aucun segment', 'Aucun segment n\'est encore chargé.'));

  return {
    onData(topic, detail) {
      if (topic === 'glossary') { glossary.render(); renderCenterSourceOnly(); }
      if (topic === 'reviews' || topic === 'locks') renderList();
      if (topic === 'segments' || topic === 'members') { fillFilterOptions(); renderList(); }
      if (topic === 'reset') { fillFilterOptions(); renderList(); renderCenter(); }
      // Un collègue a modifié le segment affiché en lecture seule : on montre sa version.
      if (topic === 'reviews' && detail?.remote && detail.segmentId === currentId && readOnly) renderCenter();
      // Le segment ouvert vient d'être libéré ou pris par un collègue.
      if (topic === 'locks' && currentId && !!service.lockOf(currentId) !== readOnly) {
        if (!readOnly) { saveDraft?.flush(); toast('Un collègue a pris la main sur ce segment.', { type: 'warning' }); }
        renderCenter();
      }
      if (topic === 'settings') {
        const pal = center.querySelector('.accent-palette');
        if (!!pal !== (service.snapshot().settings.accentPalette && !readOnly)) renderCenter();
      }
    },
    unmount() {
      saveDraft?.flush();
      flushTime();
      clearInterval(tick);
      clearInterval(heartbeat);
      if (currentId) service.releaseSegment(currentId).catch(() => {});
      document.removeEventListener('keydown', onKey);
      ['keydown', 'mousemove', 'mousedown', 'scroll'].forEach((t) => document.removeEventListener(t, markActivity));
    },
  };

  function renderCenterSourceOnly() {
    const segment = segs().find((s) => s.id === currentId);
    const el = center.querySelector('.text-source');
    if (segment && el) mount(el, highlightTerms(segment.source_fr, service.snapshot().glossary, (entry) => glossary.focusTerm(entry)));
  }
}
