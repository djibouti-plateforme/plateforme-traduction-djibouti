(() => {
  'use strict';

  const STORE = {
    translations: 'fa.translations.v1',
    customPhrases: 'fa.customPhrases.v1',
    translator: 'fa.translator.v1',
    github: 'fa.github.v1',
  };
  const STATUS_LABELS = { todo: 'À traduire', done: 'Traduite', review: 'À revoir' };
  const HEADERS = ['ID', 'Catégorie', 'Français', 'Afar', 'Notes', 'Statut', 'Traducteur', 'Mis à jour le'];

  const $ = (id) => document.getElementById(id);
  const state = {
    phrases: [],          // [{ id, fr, category }]
    translations: {},     // id -> { afar, notes, status, translator, updatedAt }
  };

  // ---------- Stockage local ----------
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
    saveTimer = setTimeout(() => {
      const ok = save(STORE.translations, state.translations);
      setStatus(ok
        ? 'Enregistré dans le navigateur ✓'
        : 'Impossible d\'enregistrer localement — pensez à exporter en Excel.', !ok);
    }, 400);
  }

  function setStatus(msg, isError = false) {
    const el = $('status');
    el.textContent = msg;
    el.classList.toggle('error', isError);
  }

  const translator = () => $('translatorName').value.trim();

  // ---------- Chargement des phrases ----------
  async function loadPhrases() {
    let base = [];
    try {
      const res = await fetch('data/phrases.json', { cache: 'no-cache' });
      if (res.ok) base = await res.json();
    } catch { /* hors ligne : on continue avec les phrases locales */ }
    const custom = load(STORE.customPhrases, []);
    const seen = new Set();
    state.phrases = [...base, ...custom].filter((p) => p && p.id && p.fr && !seen.has(p.id) && seen.add(p.id));
  }

  function nextCustomId() {
    let n = 1;
    const ids = new Set(state.phrases.map((p) => p.id));
    while (ids.has(`U${String(n).padStart(4, '0')}`)) n++;
    return `U${String(n).padStart(4, '0')}`;
  }

  function addPhrase(fr, category, id) {
    const phrase = { id: id || nextCustomId(), fr: fr.trim(), category: (category || 'Divers').trim() || 'Divers' };
    state.phrases.push(phrase);
    const custom = load(STORE.customPhrases, []);
    custom.push(phrase);
    save(STORE.customPhrases, custom);
    return phrase;
  }

  // ---------- Affichage ----------
  function statusOf(id) {
    return state.translations[id]?.status || 'todo';
  }

  function updateProgress() {
    const total = state.phrases.length;
    const done = state.phrases.filter((p) => statusOf(p.id) === 'done').length;
    $('doneCount').textContent = done;
    $('totalCount').textContent = total;
    $('barFill').style.width = total ? `${(done / total) * 100}%` : '0';
  }

  function fillCategories() {
    const sel = $('filterCategory');
    const current = sel.value;
    const cats = [...new Set(state.phrases.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'fr'));
    sel.innerHTML = '<option value="all">Toutes les catégories</option>' +
      cats.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    sel.value = cats.includes(current) ? current : 'all';
  }

  function render() {
    const q = $('search').value.trim().toLowerCase();
    const fs = $('filterStatus').value;
    const fc = $('filterCategory').value;
    const list = $('list');
    list.innerHTML = '';

    const visible = state.phrases.filter((p) => {
      const t = state.translations[p.id] || {};
      if (fs !== 'all' && statusOf(p.id) !== fs) return false;
      if (fc !== 'all' && p.category !== fc) return false;
      if (q && !(p.fr.toLowerCase().includes(q) || (t.afar || '').toLowerCase().includes(q))) return false;
      return true;
    });

    if (!visible.length) {
      list.innerHTML = '<p class="empty">Aucune phrase ne correspond à ces critères.</p>';
    }
    const frag = document.createDocumentFragment();
    visible.forEach((p) => frag.appendChild(card(p)));
    list.appendChild(frag);
    updateProgress();
  }

  function card(p) {
    const t = state.translations[p.id] || {};
    const el = document.createElement('article');
    el.className = `card ${statusOf(p.id)}`;
    el.innerHTML = `
      <div class="card-head"><span>${escapeHtml(p.id)}</span><span class="badge">${escapeHtml(p.category)}</span></div>
      <p class="fr" lang="fr">${escapeHtml(p.fr)}</p>
      <div class="grid">
        <div class="field">
          <label for="aa-${p.id}">Traduction en afar</label>
          <textarea id="aa-${p.id}" lang="aa" rows="2" placeholder="Qafar af…">${escapeHtml(t.afar || '')}</textarea>
        </div>
        <div class="field">
          <label for="nt-${p.id}">Notes (variante, prononciation…)</label>
          <textarea id="nt-${p.id}" rows="2">${escapeHtml(t.notes || '')}</textarea>
        </div>
      </div>
      <div class="card-foot">
        <span class="meta">${t.updatedAt ? `Modifié le ${formatDate(t.updatedAt)}${t.translator ? ' par ' + escapeHtml(t.translator) : ''}` : 'Pas encore traduite'}</span>
        <select aria-label="Statut">
          ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${statusOf(p.id) === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`;

    const afar = el.querySelector(`#aa-${CSS.escape(p.id)}`);
    const notes = el.querySelector(`#nt-${CSS.escape(p.id)}`);
    const status = el.querySelector('select');
    const meta = el.querySelector('.meta');

    const commit = (explicitStatus) => {
      const prev = state.translations[p.id] || {};
      let s = explicitStatus || prev.status || 'todo';
      // Passe automatiquement en « Traduite » dès qu'une traduction est saisie.
      if (!explicitStatus && afar.value.trim() && s === 'todo') s = 'done';
      if (!explicitStatus && !afar.value.trim() && s === 'done') s = 'todo';
      const entry = {
        afar: afar.value.trim(),
        notes: notes.value.trim(),
        status: s,
        translator: translator() || prev.translator || '',
        updatedAt: new Date().toISOString(),
      };
      state.translations[p.id] = entry;
      status.value = s;
      el.className = `card ${s}`;
      meta.textContent = `Modifié le ${formatDate(entry.updatedAt)}${entry.translator ? ' par ' + entry.translator : ''}`;
      updateProgress();
      scheduleSave();
    };
    afar.addEventListener('input', () => commit());
    notes.addEventListener('input', () => commit());
    status.addEventListener('change', () => commit(status.value));
    return el;
  }

  // ---------- Excel ----------
  function buildWorkbook() {
    const rows = state.phrases.map((p) => {
      const t = state.translations[p.id] || {};
      return [p.id, p.category, p.fr, t.afar || '', t.notes || '', STATUS_LABELS[statusOf(p.id)],
        t.translator || '', t.updatedAt ? formatDate(t.updatedAt) : ''];
    });
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 50 }, { wch: 50 }, { wch: 30 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];
    ws['!autofilter'] = { ref: `A1:H${rows.length + 1}` };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Traductions');
    return wb;
  }

  function fileName() {
    const who = slug(translator()) || 'anonyme';
    return `traductions_fr-afar_${who}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  function exportExcel() {
    if (!window.XLSX) return setStatus('La bibliothèque Excel n\'a pas pu être chargée (connexion internet ?).', true);
    XLSX.writeFile(buildWorkbook(), fileName());
    setStatus('Fichier Excel téléchargé ✓');
  }

  const STATUS_FROM_LABEL = Object.fromEntries(Object.entries(STATUS_LABELS).map(([k, v]) => [v.toLowerCase(), k]));

  async function importExcel(file) {
    if (!window.XLSX) return setStatus('La bibliothèque Excel n\'a pas pu être chargée.', true);
    const wb = XLSX.read(await file.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const pick = (row, ...names) => {
      const key = Object.keys(row).find((k) => names.includes(normalize(k)));
      return key ? String(row[key]).trim() : '';
    };
    let added = 0, updated = 0;
    const byId = new Map(state.phrases.map((p) => [p.id, p]));
    const byFr = new Map(state.phrases.map((p) => [p.fr.toLowerCase(), p]));
    for (const row of rows) {
      const fr = pick(row, 'francais', 'french', 'phrase');
      const id = pick(row, 'id');
      if (!fr && !id) continue;
      let phrase = (id && byId.get(id)) || (fr && byFr.get(fr.toLowerCase()));
      if (!phrase) {
        if (!fr) continue;
        phrase = addPhrase(fr, pick(row, 'categorie', 'category'), id && !byId.has(id) ? id : undefined);
        byId.set(phrase.id, phrase); byFr.set(phrase.fr.toLowerCase(), phrase);
        added++;
      }
      const afar = pick(row, 'afar', 'qafar af', 'traduction');
      const notes = pick(row, 'notes', 'note');
      if (afar || notes) {
        const st = STATUS_FROM_LABEL[pick(row, 'statut', 'status').toLowerCase()] || (afar ? 'done' : 'todo');
        state.translations[phrase.id] = {
          afar, notes, status: st,
          translator: pick(row, 'traducteur', 'translator') || translator(),
          updatedAt: new Date().toISOString(),
        };
        updated++;
      }
    }
    save(STORE.translations, state.translations);
    fillCategories();
    render();
    setStatus(`Import terminé : ${added} phrase(s) ajoutée(s), ${updated} traduction(s) importée(s).`);
  }

  // ---------- Enregistrement dans le dépôt GitHub ----------
  async function syncGitHub() {
    const cfg = load(STORE.github, {});
    if (!cfg.repo || !cfg.token) { openSettings(); return setStatus('Configurez d\'abord le dépôt et le jeton GitHub.', true); }
    if (!translator()) { $('translatorName').focus(); return setStatus('Indiquez votre nom avant d\'enregistrer sur GitHub.', true); }
    if (!window.XLSX) return setStatus('La bibliothèque Excel n\'a pas pu être chargée.', true);

    const path = `data/traductions/${slug(translator())}.xlsx`;
    const api = `https://api.github.com/repos/${cfg.repo}/contents/${path}`;
    const headers = {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const branch = cfg.branch || 'main';
    setStatus('Envoi vers GitHub…');
    try {
      let sha;
      const head = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
      if (head.ok) sha = (await head.json()).sha;
      else if (head.status !== 404) throw new Error(`lecture ${head.status}`);

      const content = XLSX.write(buildWorkbook(), { type: 'base64', bookType: 'xlsx' });
      const res = await fetch(api, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `Traductions afar de ${translator()} (${new Date().toISOString().slice(0, 10)})`,
          content, branch, ...(sha ? { sha } : {}),
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).message || ''}`);
      setStatus(`Enregistré sur GitHub ✓ (${path})`);
    } catch (err) {
      setStatus(`Échec de l'envoi sur GitHub : ${err.message}. Vérifiez le jeton et ses permissions.`, true);
    }
  }

  function openSettings() {
    const cfg = load(STORE.github, {});
    $('ghRepo').value = cfg.repo || guessRepo();
    $('ghBranch').value = cfg.branch || 'main';
    $('ghToken').value = cfg.token || '';
    $('settingsDialog').showModal();
  }

  // Sur https://<org>.github.io/<repo>/, on devine le dépôt automatiquement.
  function guessRepo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return m && repo ? `${m[1]}/${repo}` : '';
  }

  // ---------- Utilitaires ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const escapeAttr = escapeHtml;
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
    state.translations = load(STORE.translations, {});
    $('translatorName').value = load(STORE.translator, '');
    $('translatorName').addEventListener('input', (e) => save(STORE.translator, e.target.value.trim()));

    await loadPhrases();
    fillCategories();
    render();
    setStatus(state.phrases.length ? '' : 'Aucune phrase chargée. Ajoutez-en ou importez un fichier Excel.');

    ['search', 'filterStatus', 'filterCategory'].forEach((id) => $(id).addEventListener('input', render));
    $('exportBtn').addEventListener('click', exportExcel);
    $('syncBtn').addEventListener('click', syncGitHub);
    $('settingsBtn').addEventListener('click', openSettings);
    $('importInput').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) {
        try { await importExcel(f); }
        catch (err) { setStatus(`Fichier illisible : ${err.message}`, true); }
      }
      e.target.value = '';
    });

    $('addBtn').addEventListener('click', () => { $('addForm').reset(); $('addDialog').showModal(); });
    $('addDialog').addEventListener('close', () => {
      if ($('addDialog').returnValue !== 'ok') return;
      const fr = $('newFr').value.trim();
      if (!fr) return;
      const p = addPhrase(fr, $('newCat').value);
      fillCategories();
      render();
      document.getElementById(`aa-${p.id}`)?.focus();
    });

    $('settingsDialog').addEventListener('close', () => {
      if ($('settingsDialog').returnValue !== 'ok') return;
      save(STORE.github, {
        repo: $('ghRepo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''),
        branch: $('ghBranch').value.trim() || 'main',
        token: $('ghToken').value.trim(),
      });
      setStatus('Paramètres GitHub enregistrés.');
    });
  }

  init();
})();
