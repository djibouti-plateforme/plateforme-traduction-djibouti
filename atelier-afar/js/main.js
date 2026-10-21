// Point d'entrée : initialise le service de données, l'en-tête et le routage par fragment d'URL.
import { h, icon, mount, isTypingTarget } from './utils/dom.js';
import { SupabaseDataService } from './services/SupabaseDataService.js';
import { LOCK_TTL_MS } from './config.js';
import { computeStats } from './pages/dashboard.js';
import { mountDashboard } from './pages/dashboard.js';
import { mountReview } from './pages/review.js';
import { mountRecording } from './pages/recording.js';
import { mountSettings } from './pages/settings.js';
import { openModal, toast } from './components/ui.js';

const service = new SupabaseDataService();

const ROUTES = [
  { key: 'dashboard', path: 'tableau-de-bord', label: 'Tableau de bord', icon: 'dashboard', mount: mountDashboard },
  { key: 'review', path: 'revision', label: 'Révision des traductions', icon: 'languages', mount: mountReview, main: true },
  { key: 'recording', path: 'enregistrement', label: 'Enregistrement audio', icon: 'mic', mount: mountRecording, main: true },
  { key: 'settings', path: 'parametres', label: 'Paramètres', icon: 'settings', mount: mountSettings, hidden: true },
];

const app = document.getElementById('app');
let page = null;
let currentPath = '';
let currentRoute = null;

function parseHash() {
  const [path, id] = location.hash.replace(/^#\/?/, '').split('/');
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[1];
  return { route, id: id ? decodeURIComponent(id) : undefined };
}

/** Met à jour l'URL sans recharger la page (sélection d'un segment, etc.). */
function setRoute(path) {
  currentPath = path;
  if (location.hash !== `#${path}`) history.replaceState(null, '', `#${path}`);
}

function navigate() {
  const target = location.hash.replace(/^#/, '');
  if (target === currentPath && page) return;
  const { route, id } = parseHash();
  page?.unmount();
  currentRoute = route;
  currentPath = target;
  const outlet = h('div', { class: `page page-${route.key}` });
  mount(app.querySelector('.outlet'), outlet);
  page = route.mount(outlet, { service, params: { id }, setRoute });
  paintHeader();
  document.title = `${route.label} — ${service.snapshot().settings.projectName}`;
}

// ---- En-tête -------------------------------------------------------------------
const header = h('header', { class: 'topbar' });

/** Collègues ayant un segment ouvert (verrou récent). */
function activeColleagues() {
  const now = Date.now();
  const names = new Map();
  Object.values(service.snapshot().locks).forEach((l) => {
    if (l.user_id !== service.user?.id && now - new Date(l.locked_at).getTime() < LOCK_TTL_MS) names.set(l.member_code, l.member_name);
  });
  return [...names.values()];
}

function paintHeader() {
  const snap = service.snapshot();
  const st = computeStats(snap);
  const me = snap.me;
  const colleagues = activeColleagues();

  mount(header,
    h('a', { class: 'brand', href: '#/tableau-de-bord', 'aria-label': 'Tableau de bord' },
      h('span', { class: 'brand-mark' }, icon('languages', 20)),
      h('span', { class: 'brand-name' }, snap.settings.projectName)),
    h('nav', { class: 'main-nav', 'aria-label': 'Navigation principale' },
      ROUTES.filter((r) => !r.hidden).map((r) => h('a', {
        href: `#/${r.path}`,
        class: ['nav-link', currentRoute?.key === r.key && 'active'],
        'aria-current': currentRoute?.key === r.key ? 'page' : null,
      }, icon(r.icon, 16), h('span', null, r.label)))),
    h('div', { class: 'top-stats' },
      colleagues.length ? h('span', { class: 'top-stat presence', title: `En train de réviser : ${colleagues.join(', ')}` },
        h('i', { class: 'presence-dot' }), h('span', null, colleagues.length === 1 ? colleagues[0] : `${colleagues.length} collègues`), h('span', null, 'en ligne')) : null,
      h('a', { class: 'top-stat', href: '#/revision', title: 'Traductions restant à traiter' }, h('strong', null, st.remaining), h('span', null, 'à valider')),
      h('a', { class: 'top-stat', href: '#/enregistrement', title: 'Phrases avec un enregistrement validé' }, h('strong', null, st.recordedPhrases), h('span', null, 'enregistrées'))),
    h('div', { class: 'top-user' },
      h('span', { class: 'avatar' }, (me?.display_name ?? '?').slice(0, 1).toUpperCase()),
      h('div', { class: 'user-chip' },
        h('span', { class: 'user-name', title: service.user?.email }, me?.display_name ?? ''),
        h('button', { class: 'link-btn on-dark', onclick: signOut }, 'Se déconnecter'))),
    h('button', { class: 'icon-btn on-dark', title: 'Raccourcis clavier (?)', onclick: showShortcuts }, icon('keyboard', 18)),
    h('a', { class: ['icon-btn on-dark', currentRoute?.key === 'settings' && 'active'], href: '#/parametres', title: 'Paramètres' }, icon('settings', 18)));
}

async function signOut() {
  page?.unmount();
  page = null;
  await service.signOut();
  location.reload();
}

function applySettings() {
  const { textScale } = service.snapshot().settings;
  document.documentElement.style.setProperty('--text-scale', String(textScale));
}

// ---- Aide des raccourcis ---------------------------------------------------------
function showShortcuts() {
  if (document.querySelector('dialog[open]')) return;
  const row = (keys, label) => h('tr', null, h('td', null, keys.map((k, i) => [i ? ' + ' : '', h('kbd', null, k)])), h('td', null, label));
  openModal({
    title: 'Raccourcis clavier',
    render: () => [
      h('h4', { class: 'kbd-title' }, 'Révision des traductions'),
      h('table', { class: 'kbd-table' },
        row(['Ctrl/Cmd', 'Entrée'], 'Enregistrer la correction et passer au suivant'),
        row(['Ctrl/Cmd', 'Maj', 'Entrée'], 'Valider sans modification (confirmation si le texte a été modifié)'),
        row(['Alt', '←'], 'Segment précédent'),
        row(['Alt', '→'], 'Segment suivant (sans valider)'),
        row(['Échap'], 'Quitter l\'éditeur')),
      h('h4', { class: 'kbd-title' }, 'Enregistrement audio'),
      h('table', { class: 'kbd-table' },
        row(['Espace'], 'Démarrer / arrêter l\'enregistrement (hors champ de saisie)')),
      h('h4', { class: 'kbd-title' }, 'Général'),
      h('table', { class: 'kbd-table' }, row(['?'], 'Afficher cette aide')),
      h('p', { class: 'muted tiny' }, 'Les raccourcis sont ignorés lorsqu\'une boîte de dialogue est ouverte, et une touche maintenue enfoncée ne déclenche pas de validation répétée.'),
    ],
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === '?' && !isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    showShortcuts();
  }
});

// ---- Connexion -------------------------------------------------------------------
function renderAuthScreen(state) {
  const outlet = app.querySelector('.outlet');
  if (state.status === 'forbidden') {
    mount(outlet, h('div', { class: 'onboarding' }, h('div', { class: 'onboarding-card card login-card' },
      h('div', { class: 'onb-icon' }, icon('shield', 26)),
      h('h2', null, 'Accès non autorisé'),
      h('p', null, `Le compte ${state.email} n'a pas accès à cet atelier.`),
      h('p', { class: 'muted' }, 'Contactez l\'administrateur du projet.'),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn btn-secondary', onclick: async () => { await service.signOut(); location.reload(); } }, 'Se déconnecter')))));
    return;
  }
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'field-error', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Se connecter');
  const form = h('form', { class: 'login-form' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Adresse e-mail'), email),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Mot de passe'), password),
    err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Connexion…';
    try {
      await service.signIn(email.value, password.value);
      start();
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Se connecter';
    }
  });
  mount(outlet, h('div', { class: 'onboarding' }, h('div', { class: 'onboarding-card card login-card' },
    h('div', { class: 'onb-icon' }, icon('languages', 26)),
    h('h2', null, 'Atelier Afar'),
    h('p', { class: 'muted' }, 'Connectez-vous avec le compte fourni par l\'administrateur du projet.'),
    form,
    h('p', { class: 'tiny muted login-foot' }, 'Mot de passe oublié ? Contactez l\'administrateur.'))));
  setTimeout(() => email.focus(), 50);
}

// ---- Démarrage -------------------------------------------------------------------
let started = false;

async function start() {
  mount(app,
    header,
    h('main', { class: 'outlet' }, h('div', { class: 'boot' }, h('div', { class: 'spinner' }), 'Chargement…')));
  try {
    const state = await service.init();
    if (state.status !== 'ready') { renderAuthScreen(state); return; }
  } catch (err) {
    mount(app.querySelector('.outlet'), h('div', { class: 'page-pad' }, h('div', { class: 'callout callout-error' }, icon('alert'),
      h('div', null, h('strong', null, 'Impossible de charger l\'atelier. '), err.message, h('br'), 'Vérifiez votre connexion internet puis rechargez la page.'))));
    return;
  }
  if (started) return;
  started = true;
  applySettings();
  service.subscribe((topic, detail) => {
    if (topic === 'settings' || topic === 'reset') applySettings();
    if (topic === 'sync-error') toast('Une modification n\'a pas pu être enregistrée : les données ont été rechargées. Réessayez.', { type: 'error' });
    if (topic === 'signed-out') { location.reload(); return; }
    paintHeader();
    page?.onData?.(topic, detail);
  });
  window.addEventListener('hashchange', navigate);
  // Libère les segments réservés en quittant la page (au mieux ; sinon expiration automatique).
  window.addEventListener('pagehide', () => { service.releaseMyLocks().catch(() => {}); });
  // Rafraîchit l'indicateur de présence (expiration des verrous).
  setInterval(paintHeader, 60_000);
  if (!location.hash) history.replaceState(null, '', '#/revision');
  navigate();
}

start();
