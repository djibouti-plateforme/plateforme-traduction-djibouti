// Tableau de bord : indicateurs calculés à partir des données locales.
import { h, icon, mount, fmtDuration, fmtNumber } from '../utils/dom.js';
import { REVIEW_STATUS, AUDIO_STATUS, buildAudioQueue } from '../utils/status.js';
import { exportRevisions, exportTts } from '../utils/exporter.js';
import { toast, progressBar } from '../components/ui.js';
import { ERROR_CATEGORIES } from '../components/annotationsPanel.js';

const STATUS_COLORS = { a_reviser: 'var(--st-todo)', en_cours: 'var(--st-progress)', valide: 'var(--st-valid)', corrige: 'var(--st-corrected)', rejete: 'var(--st-rejected)', signale: 'var(--st-flagged)' };

export function computeStats(snapshot) {
  const { segments, reviews, takes, settings } = snapshot;
  const count = Object.fromEntries(Object.keys(REVIEW_STATUS).map((k) => [k, 0]));
  let reviewSeconds = 0;
  let reviewedWithTime = 0;
  const annotations = Object.fromEntries(Object.keys(ERROR_CATEGORIES).map((k) => [k, 0]));
  for (const s of segments) {
    const r = reviews[s.id];
    count[r?.status ?? 'a_reviser'] += 1;
    if (r && ['valide', 'corrige', 'rejete', 'signale'].includes(r.status) && r.duration_seconds > 0) {
      reviewSeconds += r.duration_seconds;
      reviewedWithTime += 1;
    }
    r?.annotations.forEach((a) => { annotations[a.category] = (annotations[a.category] ?? 0) + 1; });
  }
  const treated = count.valide + count.corrige + count.rejete + count.signale;
  const queue = buildAudioQueue(segments, reviews, takes, settings.activeSpeakerId);
  const audioCount = Object.fromEntries(Object.keys(AUDIO_STATUS).map((k) => [k, 0]));
  queue.forEach((q) => { audioCount[q.status] += 1; });
  const validTakes = takes.filter((t) => t.current && t.quality_status === 'valide');
  return {
    total: segments.length,
    count,
    treated,
    remaining: segments.length - treated,
    progress: segments.length ? treated / segments.length : 0,
    avgReview: reviewedWithTime ? reviewSeconds / reviewedWithTime : 0,
    queueSize: queue.length,
    audioCount,
    recordedPhrases: new Set(validTakes.map((t) => t.segment_id)).size,
    audioMinutes: validTakes.reduce((a, t) => a + t.duration_seconds, 0) / 60,
    redo: audioCount.a_refaire,
    annotations,
    takesTotal: takes.length,
  };
}

/** @param {HTMLElement} container @param {{ service: import('../services/DataService.js').DataService }} ctx */
export function mountDashboard(container, { service }) {
  function render() {
    const snap = service.snapshot();
    const st = computeStats(snap);
    const kpi = (label, value, sub, tone = '') => h('div', { class: `kpi ${tone}` }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), sub && h('span', { class: 'kpi-sub' }, sub));

    const stack = h('div', { class: 'stack-bar', role: 'img', 'aria-label': 'Répartition des statuts de révision' },
      Object.entries(st.count).filter(([, n]) => n).map(([k, n]) => h('span', { style: { flex: n, background: STATUS_COLORS[k] }, title: `${REVIEW_STATUS[k]} : ${n}` })));
    const legend = h('ul', { class: 'legend' }, Object.entries(st.count).map(([k, n]) => h('li', null, h('i', { style: { background: STATUS_COLORS[k] } }), `${REVIEW_STATUS[k]} `, h('strong', null, n))));

    const byDomain = [...new Set(snap.segments.map((s) => s.domaine))].map((d) => {
      const segs = snap.segments.filter((s) => s.domaine === d);
      const done = segs.filter((s) => ['valide', 'corrige', 'rejete', 'signale'].includes(snap.reviews[s.id]?.status)).length;
      return { d, done, total: segs.length };
    });

    const audioPct = st.queueSize ? Math.round((st.audioCount.enregistre / st.queueSize) * 100) : 0;
    const maxAnn = Math.max(1, ...Object.values(st.annotations));

    const exportBtn = (label, fn, cls = 'btn-secondary') => h('button', { class: `btn ${cls}`, onclick: fn }, icon('download', 16), label);

    mount(container, h('div', { class: 'page-pad dashboard' },
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Tableau de bord'), h('p', { class: 'muted' }, 'Indicateurs mis à jour en temps réel pour toute l\'équipe.')),
        h('div', { class: 'row-gap' },
          exportBtn('Exporter le corpus FR–Afar', () => { const n = exportRevisions(service, 'jsonl'); toast(`revisions.jsonl téléchargé (${n} segments)`); }, 'btn-primary'),
          exportBtn('CSV', () => { exportRevisions(service, 'csv'); toast('revisions.csv téléchargé'); }),
          exportBtn('Exporter le corpus TTS', () => runTtsExport(service), 'btn-teal'))),

      h('section', { class: 'kpis' },
        kpi('Segments français', st.total, `${new Set(snap.segments.map((x) => x.lot)).size} lots`),
        kpi('Validés', st.count.valide, 'sans modification', 'tone-valid'),
        kpi('Corrigés', st.count.corrige, 'par le linguiste', 'tone-corrected'),
        kpi('Rejetés', st.count.rejete, `+ ${st.count.signale} signalé(s)`, 'tone-rejected'),
        kpi('Restants', st.remaining, `${Math.round(st.progress * 100)} % traités`),
        kpi('Temps moyen de révision', st.avgReview ? fmtDuration(st.avgReview) : '—', 'par segment traité')),

      h('section', { class: 'kpis' },
        kpi('Phrases enregistrées', st.recordedPhrases, `sur ${st.queueSize} disponibles`, 'tone-teal'),
        kpi('Minutes audio validées', fmtNumber(st.audioMinutes, st.audioMinutes < 10 ? 2 : 1), `${fmtDuration(st.audioMinutes * 60)} · ${st.takesTotal} prise(s) au total`, 'tone-teal'),
        kpi('Prises à refaire', st.redo, null, st.redo ? 'tone-warning' : ''),
        kpi('Annotations d\'erreurs', Object.values(st.annotations).reduce((a, b) => a + b, 0), 'toutes catégories')),

      h('div', { class: 'dash-grid' },
        h('article', { class: 'card' },
          h('header', { class: 'card-head' }, h('h3', null, 'Révision des traductions'), h('span', { class: 'muted tiny' }, `${st.treated} / ${st.total} traités`)),
          stack, legend),
        h('article', { class: 'card' },
          h('header', { class: 'card-head' }, h('h3', null, 'Corpus audio'), h('span', { class: 'muted tiny' }, 'locuteur actif')),
          h('div', { class: 'donut-wrap' },
            h('div', { class: 'donut', style: { background: `conic-gradient(var(--teal) ${audioPct * 3.6}deg, var(--line) 0)` } }, h('span', null, `${audioPct} %`)),
            h('ul', { class: 'legend legend-col' }, Object.entries(st.audioCount).map(([k, n]) => h('li', null, `${AUDIO_STATUS[k]} `, h('strong', null, n)))))),
        h('article', { class: 'card' },
          h('header', { class: 'card-head' }, h('h3', null, 'Avancement par domaine')),
          h('ul', { class: 'bars' }, byDomain.map((b) => h('li', null, h('span', { class: 'bar-label' }, b.d), progressBar(b.done, b.total, { label: b.d }), h('span', { class: 'bar-val' }, `${b.done}/${b.total}`))))),
        h('article', { class: 'card' },
          h('header', { class: 'card-head' }, h('h3', null, 'Erreurs annotées par catégorie')),
          h('ul', { class: 'bars' }, Object.entries(ERROR_CATEGORIES).map(([k, c]) => h('li', null,
            h('span', { class: 'bar-label' }, c.label),
            h('div', { class: 'progress' }, h('div', { class: 'progress-fill tone-warning', style: { width: `${(st.annotations[k] / maxAnn) * 100}%` } })),
            h('span', { class: 'bar-val' }, st.annotations[k])))))),

      linguistTable(snap),

      h('p', { class: 'muted tiny' }, 'Les minutes audio comptent uniquement les prises courantes validées.')));
  }

  render();
  return { onData: render, unmount() {} };
}

export async function runTtsExport(service) {
  toast('Préparation de l\'archive TTS…', { type: 'info', duration: 2000 });
  try {
    const res = await exportTts(service);
    toast(`Archive TTS téléchargée et vérifiée : ${res.count} enregistrement(s), ${fmtDuration(res.seconds)}${res.excluded ? ` (${res.excluded} prise(s) exclue(s))` : ''}.`, { duration: 6000 });
  } catch (err) {
    toast(err.message, { type: err.code === 'empty' ? 'warning' : 'error' });
  }
}

/** Avancement par linguiste : segments attribués, traités, corrigés, temps moyen. */
function linguistTable(snap) {
  const { members = [], segments, reviews } = snap;
  if (!members.length) return null;
  const rows = members.map((m) => {
    const assigned = segments.filter((s) => s.assigned_to === m.code);
    const mine = Object.values(reviews).filter((r) => r.reviewer_id === m.code && ['valide', 'corrige', 'rejete', 'signale'].includes(r.status));
    const corrected = mine.filter((r) => r.status === 'corrige').length;
    const doneAssigned = assigned.filter((s) => ['valide', 'corrige', 'rejete', 'signale'].includes(reviews[s.id]?.status)).length;
    const time = mine.reduce((a, r) => a + (r.duration_seconds || 0), 0);
    return { m, assigned: assigned.length, doneAssigned, treated: mine.length, corrected, avg: mine.length ? time / mine.length : 0 };
  });
  return h('article', { class: 'card team-card' },
    h('header', { class: 'card-head' }, h('h3', null, 'Avancement par linguiste')),
    h('table', { class: 'team-table' },
      h('thead', null, h('tr', null, ['Linguiste', 'Segments attribués', 'Progression du lot', 'Traités', 'Corrigés', 'Temps moyen'].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, h('strong', null, r.m.display_name), h('span', { class: 'muted tiny' }, ` ${r.m.role === 'admin' ? '· admin' : ''}`)),
        h('td', null, r.assigned || '—'),
        h('td', null, r.assigned ? h('div', { class: 'team-progress' }, progressBar(r.doneAssigned, r.assigned, { label: r.m.display_name }), h('span', { class: 'tiny muted' }, `${r.doneAssigned}/${r.assigned}`)) : h('span', { class: 'muted tiny' }, 'aucun lot attribué')),
        h('td', null, r.treated),
        h('td', null, r.corrected),
        h('td', null, r.avg ? fmtDuration(r.avg) : '—'))))));
}
