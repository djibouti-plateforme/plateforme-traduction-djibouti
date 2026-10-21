(() => {
  'use strict';

  const KEY = {
    user: 'at.user',
    lang: 'at.lang',
    custom: 'at.corpus.custom',
    github: 'at.github',
    tr: (code) => `at.tr.${code}`,
  };
  const STATUS = { todo: 'À traduire', done: 'Traduit', review: 'À revoir' };
  const TYPES = { mot: 'Mot', phrase: 'Phrase', texte: 'Texte' };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const state = {
    langs: [],
    lang: null,          // { code, nom, autonyme, dir, exemple }
    base: [],            // corpus publié dans data/corpus.json
    custom: [],          // corpus chargé par l'utilisateur (navigateur)
    corpus: [],          // base + custom : [{ id, fr, type, lot }]
    tr: {},              // id -> { text, notes, status, translator, updatedAt } pour la langue courante
    view: 'focus',
    focus: { lot: 'all', onlyTodo: true, currentId: null, history: [] },
  };

  // ---------- Stockage ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  let saveTimer;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    if (!save(KEY.tr(state.lang.code), state.tr)) toast('Sauvegarde locale impossible — exportez en Excel.', true);
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2600);
  }

  const user = () => load(KEY.user, '');
  const statusOf = (id) => state.tr[id]?.status || 'todo';

  // ---------- Données ----------
  async function fetchJson(url, fallback) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      return res.ok ? await res.json() : fallback;
    } catch { return fallback; }
  }

  function rebuildCorpus() {
    const seen = new Set();
    state.corpus = [...state.base, ...state.custom]
      .filter((p) => p && p.id && p.fr && !seen.has(p.id) && seen.add(p.id))
      .map((p) => ({ ...p, lot: p.lot || 'Divers', type: p.type || inferType(p.fr) }));
  }

  function setLang(code) {
    if (state.lang) flushSave();
    state.lang = state.langs.find((l) => l.code === code) || state.langs[0];
    save(KEY.lang, state.lang.code);
    state.tr = load(KEY.tr(state.lang.code), {});
    $('langSelect').value = state.lang.code;
    const target = $('fTarget');
    target.lang = state.lang.code;
    target.dir = state.lang.dir || 'ltr';
    target.placeholder = state.lang.exemple || `Traduction en ${state.lang.nom}…`;
    $('fLangName').textContent = `${state.lang.nom} · ${state.lang.autonyme}`;
    refreshAll();
  }

  function lots() {
    const counts = new Map();
    state.corpus.forEach((p) => counts.set(p.lot, (counts.get(p.lot) || 0) + 1));
    return counts;
  }
  const customLots = () => new Set(state.custom.map((p) => p.lot));

  function fillLotSelects() {
    const counts = lots();
    const html = `<option value="all">Tous les lots (${state.corpus.length})</option>` +
      [...counts].map(([lot, n]) => `<option value="${esc(lot)}">${esc(lot)} (${n})</option>`).join('');
    for (const id of ['focusLot', 'filterLot']) {
      const sel = $(id);
      const cur = id === 'focusLot' ? state.focus.lot : sel.value;
      sel.innerHTML = html;
      sel.value = counts.has(cur) ? cur : 'all';
    }
    state.focus.lot = $('focusLot').value;
  }

  function updateProgress() {
    const pool = focusPool();
    const done = pool.filter((p) => statusOf(p.id) === 'done').length;
    $('doneCount').textContent = done;
    $('totalCount').textContent = pool.length;
    $('barFill').style.width = pool.length ? `${(done / pool.length) * 100}%` : '0';
  }

  function refreshAll() {
    fillLotSelects();
    updateProgress();
    if (state.view === 'focus') enterFocus();
    if (state.view === 'list') renderList();
  }

  // ---------- Navigation entre vues ----------
  function showView(view) {
    if (state.view === 'focus') commitCurrent();
    state.view = view;
    document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    ['focus', 'list', 'load'].forEach((v) => { $(`view-${v}`).hidden = v !== view; });
    moveTabIndicator();
    if (view === 'focus') enterFocus();
    if (view === 'list') renderList();
    if (view === 'load') { if (!$('lotName').value) $('lotName').value = defaultLotName(); updatePreview(); }
  }

  function moveTabIndicator() {
    const btn = document.querySelector('.tabs [aria-selected=true]');
    const ind = document.querySelector('.tab-indicator');
    if (!btn) return;
    ind.style.width = `${btn.offsetWidth}px`;
    ind.style.transform = `translateX(${btn.offsetLeft}px)`;
  }

  // ---------- Mode « élément par élément » ----------
  function focusPool() {
    return state.focus.lot === 'all' ? state.corpus : state.corpus.filter((p) => p.lot === state.focus.lot);
  }
  const eligible = (p) => !state.focus.onlyTodo || statusOf(p.id) !== 'done';

  function findNext(fromId, dir = 1) {
    const pool = focusPool();
    if (!pool.length) return null;
    const start = pool.findIndex((p) => p.id === fromId);
    if (state.focus.onlyTodo) {
      // On fait le tour du lot pour trouver le prochain élément non traduit.
      for (let k = 1; k <= pool.length; k++) {
        const p = pool[((start < 0 ? -1 : start) + dir * k + pool.length * 2) % pool.length];
        if (p.id !== fromId && eligible(p)) return p;
      }
      return null;
    }
    return pool[start + dir] || null;
  }

  function enterFocus() {
    const pool = focusPool();
    let cur = pool.find((p) => p.id === state.focus.currentId);
    if (!cur) cur = pool.find(eligible) || null;
    state.focus.currentId = cur?.id || null;
    updateProgress();
    if (cur) showCard(cur, 0); else showDone();
  }

  function showCard(item, dir) {
    const card = $('focusCard');
    $('doneCard').hidden = true;
    $('focusNav').hidden = false;
    card.hidden = false;
    const fill = () => {
      const t = state.tr[item.id] || {};
      $('fType').textContent = TYPES[item.type] || 'Élément';
      $('fLot').textContent = item.lot;
      $('fId').textContent = item.id;
      const src = $('fSource');
      src.textContent = item.fr;
      src.className = `source${item.fr.length > 160 ? ' long' : item.fr.length > 60 ? ' medium' : ''}`;
      $('fTarget').value = t.text || '';
      $('fNotes').value = t.notes || '';
      $('fNotes').closest('details').open = !!t.notes;
      paintStatus(item.id);
      autoGrow($('fTarget'));
      const pool = focusPool();
      $('position').textContent = `Élément ${pool.findIndex((p) => p.id === item.id) + 1} sur ${pool.length}`;
      $('prevBtn').disabled = !state.focus.history.length && !findNext(item.id, -1);
    };

    if (!dir || reduceMotion) {
      fill();
      $('fTarget').focus({ preventScroll: true });
      return;
    }
    const back = dir < 0 ? ' back' : '';
    card.className = `focus-card leave${back}`;
    setTimeout(() => {
      fill();
      card.className = `focus-card enter${back}`;
      paintStatus(item.id);
      $('fTarget').focus({ preventScroll: true });
    }, 160);
    card.addEventListener('animationend', function done(e) {
      if (e.animationName.startsWith('enter')) {
        card.classList.remove('enter', 'back');
        card.removeEventListener('animationend', done);
      }
    });
  }

  function paintStatus(id) {
    const s = statusOf(id);
    const card = $('focusCard');
    card.classList.toggle('is-review', s === 'review');
    $('reviewBtn').setAttribute('aria-pressed', String(s === 'review'));
    const t = state.tr[id];
    $('fMeta').textContent = t?.updatedAt
      ? `${STATUS[s]} · modifié le ${formatDate(t.updatedAt)}${t.translator ? ` par ${t.translator}` : ''}`
      : '';
  }

  function showDone() {
    const pool = focusPool();
    const remaining = pool.filter((p) => statusOf(p.id) !== 'done').length;
    $('focusCard').hidden = true;
    $('focusNav').hidden = true;
    $('doneCard').hidden = false;
    $('position').textContent = '';
    if (!pool.length) {
      $('doneTitle').textContent = 'Rien à traduire pour l\'instant';
      $('doneText').textContent = 'Chargez un texte, des phrases ou des mots en français pour commencer.';
    } else if (remaining) {
      $('doneTitle').textContent = 'Fin du lot';
      $('doneText').textContent = `Il reste ${remaining} élément(s) non traduit(s) ou à revoir dans ce lot.`;
    } else {
      $('doneTitle').textContent = 'Bravo, tout est traduit !';
      $('doneText').textContent = 'Pensez à enregistrer votre travail en Excel ou sur GitHub.';
    }
  }

  function commitCurrent(explicitStatus) {
    const id = state.focus.currentId;
    if (!id || $('focusCard').hidden) return;
    const prev = state.tr[id] || {};
    const text = $('fTarget').value.trim();
    const notes = $('fNotes').value.trim();
    if (!explicitStatus && text === (prev.text || '') && notes === (prev.notes || '')) return;
    let s = explicitStatus || prev.status || 'todo';
    if (!explicitStatus && text && s === 'todo') s = 'done';
    if (!explicitStatus && !text && s === 'done') s = 'todo';
    state.tr[id] = { text, notes, status: s, translator: user() || prev.translator || '', updatedAt: new Date().toISOString() };
    paintStatus(id);
    updateProgress();
    scheduleSave();
  }

  function goNext() {
    commitCurrent();
    flushSave();
    const cur = state.focus.currentId;
    const next = findNext(cur, 1);
    if (cur) state.focus.history.push(cur);
    state.focus.currentId = next?.id || null;
    if (next) showCard(next, 1); else showDone();
  }

  function goPrev() {
    commitCurrent();
    const cur = state.focus.currentId;
    let prevId = state.focus.history.pop();
    while (prevId && !state.corpus.some((p) => p.id === prevId)) prevId = state.focus.history.pop();
    const item = prevId ? state.corpus.find((p) => p.id === prevId) : (cur && findNext(cur, -1));
    if (!item) return;
    state.focus.currentId = item.id;
    showCard(item, -1);
  }

  function toggleReview() {
    const id = state.focus.currentId;
    if (!id) return;
    const isReview = statusOf(id) === 'review';
    commitCurrent(isReview ? ($('fTarget').value.trim() ? 'done' : 'todo') : 'review');
    toast(isReview ? 'Marque « à revoir » retirée' : 'Marqué « à revoir »');
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  // ---------- Vue d'ensemble ----------
  function renderList() {
    const q = normalize($('search').value);
    const fs = $('filterStatus').value;
    const fl = $('filterLot').value;
    $('deleteLotBtn').hidden = !(fl !== 'all' && customLots().has(fl));
    const items = state.corpus.filter((p) => {
      if (fl !== 'all' && p.lot !== fl) return false;
      if (fs !== 'all' && statusOf(p.id) !== fs) return false;
      if (q && !normalize(p.fr).includes(q) && !normalize(state.tr[p.id]?.text || '').includes(q)) return false;
      return true;
    });
    const rows = $('rows');
    if (!items.length) {
      rows.innerHTML = '<p class="empty-state">Aucun élément ne correspond à ces critères.</p>';
      return;
    }
    rows.innerHTML = items.slice(0, 500).map((p) => {
      const t = state.tr[p.id];
      return `<button class="row ${statusOf(p.id)}" data-id="${esc(p.id)}">
        <span class="dot"></span>
        <span class="fr" lang="fr">${esc(p.fr)}</span>
        <span class="tr${t?.text ? '' : ' empty'}" lang="${state.lang.code}" dir="${state.lang.dir || 'ltr'}">${t?.text ? esc(t.text) : STATUS[statusOf(p.id)]}</span>
        <span class="lot">${esc(p.lot)}</span>
      </button>`;
    }).join('') + (items.length > 500 ? `<p class="empty-state">… et ${items.length - 500} autres (affinez la recherche)</p>` : '');
  }

  function openFromList(id) {
    const item = state.corpus.find((p) => p.id === id);
    if (!item) return;
    if (state.focus.lot !== 'all' && state.focus.lot !== item.lot) {
      state.focus.lot = 'all';
      $('focusLot').value = 'all';
    }
    state.focus.currentId = id;
    state.focus.history = [];
    showView('focus');
  }

  function deleteLot() {
    const lot = $('filterLot').value;
    const n = state.custom.filter((p) => p.lot === lot).length;
    if (!confirm(`Supprimer le lot « ${lot} » (${n} élément(s)) de ce navigateur ?\nLes traductions déjà exportées ne sont pas touchées.`)) return;
    state.custom = state.custom.filter((p) => p.lot !== lot);
    save(KEY.custom, state.custom);
    rebuildCorpus();
    $('filterLot').value = 'all';
    refreshAll();
    renderList();
    toast(`Lot « ${lot} » supprimé`);
  }

  // ---------- Chargement de contenu français ----------
  const ELISION = /^(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu)['’]/i;

  function splitContent(text, mode) {
    text = text.replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    if (mode === 'texte') return [text];
    if (mode === 'ligne') return text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (mode === 'mot') {
      let words;
      if (window.Intl?.Segmenter) {
        words = [...new Intl.Segmenter('fr', { granularity: 'word' }).segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
      } else {
        words = text.match(/[\p{L}\p{M}'’-]+/gu) || [];
      }
      return words
        .map((w) => w.replace(ELISION, '').replace(/^['’-]+|['’-]+$/g, '').toLocaleLowerCase('fr'))
        .filter((w) => w && /\p{L}/u.test(w));
    }
    // Phrases : on découpe par paragraphe puis par phrase.
    const out = [];
    const seg = window.Intl?.Segmenter ? new Intl.Segmenter('fr', { granularity: 'sentence' }) : null;
    for (const para of text.split(/\n+/)) {
      const parts = seg ? [...seg.segment(para)].map((s) => s.segment) : para.split(/(?<=[.!?…])\s+/);
      parts.map((s) => s.trim()).filter(Boolean).forEach((s) => out.push(s));
    }
    return out;
  }

  function inferType(fr) {
    const words = fr.trim().split(/\s+/).length;
    if (words === 1) return 'mot';
    return fr.length > 220 || /[.!?…]\s+\S/.test(fr) ? 'texte' : 'phrase';
  }

  let pending = [];
  function updatePreview() {
    const mode = document.querySelector('input[name=split]:checked').value;
    const parts = splitContent($('loadText').value, mode);
    const existing = new Set(state.corpus.map((p) => p.fr.toLocaleLowerCase('fr')));
    const seen = new Set();
    let dup = 0;
    pending = [];
    for (const fr of parts) {
      const k = fr.toLocaleLowerCase('fr');
      if (existing.has(k) || seen.has(k)) { dup++; continue; }
      seen.add(k);
      pending.push({ fr, type: mode === 'mot' ? 'mot' : mode === 'texte' ? 'texte' : inferType(fr) });
    }
    $('previewCount').textContent = pending.length;
    $('previewDup').textContent = dup ? `· ${dup} doublon(s) ignoré(s)` : '';
    $('previewList').innerHTML = pending.slice(0, 60).map((p) => `<li title="${esc(p.fr)}">${esc(p.fr)}</li>`).join('') +
      (pending.length > 60 ? `<li>+ ${pending.length - 60}</li>` : '');
    $('loadBtn').disabled = !pending.length;
  }

  function defaultLotName() {
    return `Lot du ${new Date().toLocaleDateString('fr-FR')}`;
  }

  function addPending() {
    if (!pending.length) return;
    const lot = $('lotName').value.trim() || defaultLotName();
    const prefix = `L${Date.now().toString(36).toUpperCase()}`;
    const items = pending.map((p, i) => ({ id: `${prefix}-${i + 1}`, fr: p.fr, type: p.type, lot }));
    state.custom.push(...items);
    if (!save(KEY.custom, state.custom)) toast('Stockage du navigateur plein : le lot n\'a pas pu être enregistré.', true);
    rebuildCorpus();
    $('loadText').value = '';
    $('lotName').value = '';
    pending = [];
    state.focus.lot = lot;
    state.focus.currentId = items[0].id;
    state.focus.history = [];
    fillLotSelects();
    showView('focus');
    toast(`${items.length} élément(s) ajouté(s) au lot « ${lot} »`);
  }

  async function readLoadFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (/\.txt$/i.test(file.name)) {
      $('loadText').value = await file.text();
    } else {
      if (!window.XLSX) return toast('La bibliothèque Excel n\'a pas pu être chargée.', true);
      const wb = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      let col = 0;
      let start = 0;
      const head = (rows[0] || []).map((h) => normalize(h));
      const found = head.findIndex((h) => ['francais', 'french', 'fr', 'phrase', 'texte', 'mot'].includes(h));
      if (found >= 0) { col = found; start = 1; }
      $('loadText').value = rows.slice(start).map((r) => String(r[col] ?? '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');
      document.querySelector('input[name=split][value=ligne]').checked = true;
    }
    $('lotName').value = name;
    updatePreview();
  }

  // ---------- Excel ----------
  function buildWorkbook() {
    const L = state.lang;
    const header = ['ID', 'Lot', 'Type', 'Français', `${L.nom} (${L.code})`, 'Notes', 'Statut', 'Traducteur', 'Mis à jour le'];
    const rows = state.corpus.map((p) => {
      const t = state.tr[p.id] || {};
      return [p.id, p.lot, TYPES[p.type] || '', p.fr, t.text || '', t.notes || '', STATUS[statusOf(p.id)],
        t.translator || '', t.updatedAt ? formatDate(t.updatedAt) : ''];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 50 }, { wch: 50 }, { wch: 30 }, { wch: 11 }, { wch: 18 }, { wch: 17 }];
    ws['!autofilter'] = { ref: `A1:I${rows.length + 1}` };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, L.nom.slice(0, 31));
    return wb;
  }

  function exportExcel() {
    if (!window.XLSX) return toast('La bibliothèque Excel n\'a pas pu être chargée (connexion internet ?).', true);
    if (state.view === 'focus') commitCurrent();
    const who = slug(user()) || 'anonyme';
    XLSX.writeFile(buildWorkbook(), `traductions_fr-${state.lang.code}_${who}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast('Fichier Excel téléchargé ✓');
  }

  async function importExcel(file) {
    if (!window.XLSX) return toast('La bibliothèque Excel n\'a pas pu être chargée.', true);
    const wb = XLSX.read(await file.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) return toast('Ce fichier est vide.', true);
    const L = state.lang;
    const keys = Object.keys(rows[0]);
    const find = (...names) => keys.find((k) => names.includes(normalize(k)));
    const kId = find('id');
    const kFr = find('francais', 'french', 'fr', 'phrase');
    const kLot = find('lot', 'categorie', 'category');
    const kType = find('type');
    const kNotes = find('notes', 'note');
    const kStatus = find('statut', 'status');
    const kWho = find('traducteur', 'translator');
    const kTr = keys.find((k) => {
      const n = normalize(k);
      return n === L.code || n.startsWith(normalize(L.nom)) || n === normalize(L.autonyme) || n === 'traduction';
    });
    if (!kFr && !kId) return toast('Colonne « Français » introuvable dans ce fichier.', true);

    const byId = new Map(state.corpus.map((p) => [p.id, p]));
    const byFr = new Map(state.corpus.map((p) => [p.fr.toLocaleLowerCase('fr'), p]));
    const statusFromLabel = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [normalize(v), k]));
    const typeFromLabel = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [normalize(v), k]));
    const prefix = `I${Date.now().toString(36).toUpperCase()}`;
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const get = (k) => (k ? String(row[k]).trim() : '');
      const id = get(kId);
      const fr = get(kFr);
      let item = (id && byId.get(id)) || (fr && byFr.get(fr.toLocaleLowerCase('fr')));
      if (!item) {
        if (!fr) return;
        item = { id: id || `${prefix}-${i + 1}`, fr, type: typeFromLabel[normalize(get(kType))] || inferType(fr), lot: get(kLot) || `Import ${file.name}` };
        state.custom.push(item);
        byId.set(item.id, item); byFr.set(fr.toLocaleLowerCase('fr'), item);
        added++;
      }
      const text = get(kTr);
      const notes = get(kNotes);
      if (text || notes) {
        state.tr[item.id] = {
          text, notes,
          status: statusFromLabel[normalize(get(kStatus))] || (text ? 'done' : 'todo'),
          translator: get(kWho) || user(),
          updatedAt: new Date().toISOString(),
        };
        updated++;
      }
    });
    save(KEY.custom, state.custom);
    flushSave();
    rebuildCorpus();
    refreshAll();
    renderList();
    toast(`Import : ${added} élément(s) ajouté(s), ${updated} traduction(s) en ${L.nom}${kTr ? '' : ' (aucune colonne de traduction trouvée)'}`);
  }

  // ---------- Dépôt GitHub ----------
  async function syncGitHub() {
    const cfg = load(KEY.github, {});
    if (!cfg.repo || !cfg.token) { openSettings(); return toast('Configurez d\'abord le dépôt et le jeton GitHub.', true); }
    if (!user()) { openUser(); return toast('Indiquez votre nom avant d\'enregistrer.', true); }
    if (!window.XLSX) return toast('La bibliothèque Excel n\'a pas pu être chargée.', true);
    if (state.view === 'focus') commitCurrent();

    const path = `data/traductions/${state.lang.code}/${slug(user())}.xlsx`;
    const api = `https://api.github.com/repos/${cfg.repo}/contents/${path}`;
    const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const branch = cfg.branch || 'main';
    toast('Envoi vers GitHub…');
    try {
      let sha;
      const head = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
      if (head.ok) sha = (await head.json()).sha;
      else if (head.status !== 404) throw new Error(`lecture ${head.status}`);
      const res = await fetch(api, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `Traductions ${state.lang.nom} de ${user()} (${new Date().toISOString().slice(0, 10)})`,
          content: XLSX.write(buildWorkbook(), { type: 'base64', bookType: 'xlsx' }),
          branch,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).message || ''}`);
      toast(`Enregistré sur GitHub ✓ ${path}`);
    } catch (err) {
      toast(`Échec de l'envoi sur GitHub : ${err.message}. Vérifiez le jeton et ses permissions.`, true);
    }
  }

  function openSettings() {
    const cfg = load(KEY.github, {});
    $('ghRepo').value = cfg.repo || guessRepo();
    $('ghBranch').value = cfg.branch || 'main';
    $('ghToken').value = cfg.token || '';
    $('settingsDialog').showModal();
  }

  // Sur https://<org>.github.io/<dépôt>/, le dépôt est déduit de l'adresse.
  function guessRepo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return m && repo ? `${m[1]}/${repo}` : '';
  }

  // ---------- Traducteur·rice ----------
  function openUser() {
    $('userName').value = user();
    $('userLang').value = state.lang.code;
    $('userDialog').showModal();
  }
  function paintUser() {
    const name = user();
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    $('userBtn').textContent = initials || '?';
    $('userBtn').title = name ? `${name} — changer` : 'Indiquer votre nom';
  }

  // ---------- Utilitaires ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function normalize(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  }
  function slug(s) {
    return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function formatDate(iso) {
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  // ---------- Initialisation ----------
  async function init() {
    const [langs, base] = await Promise.all([fetchJson('data/langues.json', []), fetchJson('data/corpus.json', [])]);
    state.langs = langs.length ? langs : [{ code: 'aa', nom: 'Afar', autonyme: 'Qafar af', dir: 'ltr' }];
    state.base = base;
    state.custom = load(KEY.custom, []);
    rebuildCorpus();

    const langOptions = state.langs.map((l) => `<option value="${esc(l.code)}">${esc(l.nom)}</option>`).join('');
    $('langSelect').innerHTML = langOptions;
    $('userLang').innerHTML = state.langs.map((l) => `<option value="${esc(l.code)}">${esc(l.nom)} — ${esc(l.autonyme)}</option>`).join('');
    setLang(load(KEY.lang, state.langs[0].code));
    paintUser();
    moveTabIndicator();
    if (!user()) openUser();

    // En-tête
    $('langSelect').addEventListener('change', (e) => { commitCurrent(); state.focus.history = []; setLang(e.target.value); toast(`Traduction vers : ${state.lang.nom}`); });
    $('exportBtn').addEventListener('click', exportExcel);
    $('syncBtn').addEventListener('click', syncGitHub);
    $('settingsBtn').addEventListener('click', openSettings);
    $('userBtn').addEventListener('click', openUser);
    document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    addEventListener('resize', moveTabIndicator);
    document.fonts?.ready.then(moveTabIndicator);

    // Mode traduction
    $('fTarget').addEventListener('input', (e) => { autoGrow(e.target); commitCurrent(); });
    $('fNotes').addEventListener('input', () => commitCurrent());
    $('nextBtn').addEventListener('click', goNext);
    $('prevBtn').addEventListener('click', goPrev);
    $('reviewBtn').addEventListener('click', toggleReview);
    $('focusLot').addEventListener('change', (e) => { commitCurrent(); state.focus.lot = e.target.value; state.focus.history = []; state.focus.currentId = null; enterFocus(); });
    $('onlyTodo').addEventListener('change', (e) => { state.focus.onlyTodo = e.target.checked; enterFocus(); });
    $('doneCard').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'export') exportExcel();
      if (act === 'sync') syncGitHub();
      if (act === 'load') showView('load');
    });
    document.addEventListener('keydown', (e) => {
      if (state.view !== 'focus' || document.querySelector('dialog[open]') || $('focusCard').hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); goNext(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    });

    // Vue d'ensemble
    ['search', 'filterStatus', 'filterLot'].forEach((id) => $(id).addEventListener('input', renderList));
    $('rows').addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) openFromList(r.dataset.id); });
    $('deleteLotBtn').addEventListener('click', deleteLot);
    $('importInput').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) { try { await importExcel(f); } catch (err) { toast(`Fichier illisible : ${err.message}`, true); } }
      e.target.value = '';
    });

    // Chargement
    $('loadText').addEventListener('input', updatePreview);
    document.querySelectorAll('input[name=split]').forEach((r) => r.addEventListener('change', updatePreview));
    $('loadBtn').addEventListener('click', addPending);
    $('loadFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) { try { await readLoadFile(f); } catch (err) { toast(`Fichier illisible : ${err.message}`, true); } }
      e.target.value = '';
    });
    const drop = $('dropZone');
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) { try { await readLoadFile(f); } catch (err) { toast(`Fichier illisible : ${err.message}`, true); } }
    });

    // Dialogues
    $('userDialog').addEventListener('close', () => {
      if ($('userDialog').returnValue !== 'ok') return;
      save(KEY.user, $('userName').value.trim());
      paintUser();
      if ($('userLang').value !== state.lang.code) { commitCurrent(); state.focus.history = []; setLang($('userLang').value); }
    });
    $('settingsDialog').addEventListener('close', () => {
      if ($('settingsDialog').returnValue !== 'ok') return;
      save(KEY.github, {
        repo: $('ghRepo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''),
        branch: $('ghBranch').value.trim() || 'main',
        token: $('ghToken').value.trim(),
      });
      toast('Paramètres GitHub enregistrés');
    });
    addEventListener('beforeunload', () => { commitCurrent(); flushSave(); });
  }

  init();
})();
