// Point d'entrée : initialise le service de données, l'en-tête et le routage par fragment d'URL.
import { h, icon, mount, isTypingTarget } from './utils/dom.js';
import { MockDataService } from './services/MockDataService.js';
import { computeStats } from './pages/dashboard.js';
import { mountDashboard } from './pages/dashboard.js';
import { mountReview } from './pages/review.js';
import { mountRecording } from './pages/recording.js';
import { mountSettings } from './pages/settings.js';
import { openModal, toast } from './components/ui.js';
import { loadUi, saveUi } from './ui-state.js';

/** Le jour où un backend existera : remplacer par `new ApiDataService(...)`. */
const service = new MockDataService();

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

function paintHeader() {
  const snap = service.snapshot();
  const st = computeStats(snap);
  const linguist = snap.linguists.find((l) => l.id === snap.settings.activeLinguistId);
  const linguistSel = h('select', { class: 'linguist-select', 'aria-label': 'Linguiste actif (sélection simulée)' },
    snap.linguists.map((l) => h('option', { value: l.id, selected: l.id === linguist?.id }, l.name)));
  linguistSel.addEventListener('change', () => service.saveSettings({ activeLinguistId: linguistSel.value }).then(() => toast('Linguiste actif modifié')));

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
      h('a', { class: 'top-stat', href: '#/revision', title: 'Traductions restant à traiter' }, h('strong', null, st.remaining), h('span', null, 'à valider')),
      h('a', { class: 'top-stat', href: '#/enregistrement', title: 'Phrases avec un enregistrement validé' }, h('strong', null, st.recordedPhrases), h('span', null, 'enregistrées'))),
    h('div', { class: 'top-user' },
      h('span', { class: 'avatar' }, (linguist?.name ?? '?').slice(0, 1).toUpperCase()),
      linguistSel),
    h('button', { class: 'icon-btn on-dark', title: 'Raccourcis clavier (?)', onclick: showShortcuts }, icon('keyboard', 18)),
    h('a', { class: ['icon-btn on-dark', currentRoute?.key === 'settings' && 'active'], href: '#/parametres', title: 'Paramètres' }, icon('settings', 18)));
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

// ---- Démarrage -------------------------------------------------------------------
async function start() {
  mount(app,
    h('div', { class: 'demo-banner', role: 'note' }, icon('info', 15), h('strong', null, 'Mode démonstration — Données fictives — Aucun serveur connecté')),
    header,
    h('main', { class: 'outlet' }, h('div', { class: 'boot' }, h('div', { class: 'spinner' }), 'Chargement…')));
  try {
    await service.init();
  } catch (err) {
    mount(app.querySelector('.outlet'), h('div', { class: 'page-pad' }, h('div', { class: 'callout callout-error' }, icon('alert'),
      h('div', null, h('strong', null, 'Impossible de charger l\'application. '), err.message, h('br'), 'Ouvrez l\'application via un serveur web (GitHub Pages, ou « python3 -m http.server » en local), pas directement depuis le fichier.'))));
    return;
  }
  applySettings();
  service.subscribe((topic) => {
    if (topic === 'settings' || topic === 'reset') applySettings();
    if (topic === 'storage-error') toast('Le stockage local est plein ou indisponible : exportez votre travail.', { type: 'error' });
    paintHeader();
    page?.onData?.(topic);
  });
  window.addEventListener('hashchange', navigate);
  if (!location.hash) history.replaceState(null, '', '#/revision');
  navigate();

  if (!loadUi().storageNoticeSeen) {
    toast('Vos données sont enregistrées dans ce navigateur uniquement. Elles peuvent être perdues si vous effacez les données du site ou changez d\'appareil : exportez régulièrement.', { type: 'info', duration: 12000 });
    saveUi({ storageNoticeSeen: true });
  }
  if (service.audioAvailable === false) toast(`Stockage audio indisponible : ${service.audioError}`, { type: 'warning' });
}

start();
