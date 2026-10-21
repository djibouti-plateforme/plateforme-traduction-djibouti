// Onglet 2 — Enregistrement vocal en afar.
import { h, icon, mount, fmtDate, fmtDuration, fmtClock, fmtNumber, fmtBytes, AFAR_INPUT_ATTRS, isTypingTarget, downloadBlob } from '../utils/dom.js';
import { AUDIO_STATUS, buildAudioQueue, consentValid, normalizeSpaces } from '../utils/status.js';
import { detectReadingIssues } from '../utils/detect.js';
import { wavFileName } from '../utils/export.js';
import { AudioRecorder } from '../audio/recorder.js';
import { encodeWav, decodeWavToFloat32 } from '../audio/wav.js';
import { analyzeTake, formatDbfs, toDbfs } from '../audio/levels.js';
import { drawWaveform, drawLiveWaveform } from '../audio/waveform.js';
import { toast, confirmDialog, audioBadge, progressBar, emptyState, callout } from '../components/ui.js';
import { consentScreen, manageSpeaker } from '../components/speakerConsent.js';
import { accentPalette } from '../components/accentPalette.js';
import { loadUi, saveUi } from '../ui-state.js';

const BREAK_REMINDER_MS = 45 * 60 * 1000;
const SESSION_GAP_MS = 10 * 60 * 1000;
const FLAG_LABELS = { bruit: 'Bruit de fond', hesitation: 'Hésitation', prononciation: 'Mauvaise prononciation', erreur_lecture: 'Erreur de lecture' };

// État conservé entre deux visites de l'onglet (même session de navigateur).
const session = { recorder: null, startedAt: 0, lastTakeAt: 0, reminded: false, noise: null };

/**
 * @param {HTMLElement} container
 * @param {{ service: import('../services/DataService.js').DataService, params: { id?: string }, setRoute: (p: string) => void }} ctx
 */
export function mountRecording(container, { service, params, setRoute }) {
  const ui = loadUi();
  let filter = ui.audioFilter ?? 'all';
  let currentId = params.id ?? ui.lastAudioSegmentId ?? null;
  let showFr = ui.showFrenchWhileRecording ?? service.snapshot().settings.showFrenchWhileRecording;
  const objectUrls = new Set();
  let raf = 0;
  let phase = 'idle'; // idle | countdown | recording | saving
  let liveStats = { sumSq: 0, n: 0, clipUntil: 0, lowSince: 0 };

  const recorder = () => session.recorder ?? (session.recorder = new AudioRecorder());

  function speakerState() {
    const { speakers, consents, settings } = service.snapshot();
    const speaker = speakers.find((s) => s.id === settings.activeSpeakerId) ?? null;
    return { speaker, consent: speaker ? consents[speaker.id] : null };
  }

  // ---------------------------------------------------------------------------
  function render() {
    stopLoop();
    const { speaker, consent } = speakerState();
    if (!service.audioAvailable) {
      mount(container, h('div', { class: 'page-pad' }, callout('error', h('strong', null, 'Stockage audio indisponible. '), service.audioError ?? 'IndexedDB est inaccessible (navigation privée ?).')));
      return;
    }
    if (!speaker || !consentValid(consent)) {
      mount(container, consentScreen(service, render));
      return;
    }
    const queue = buildAudioQueue(service.snapshot().segments, service.snapshot().reviews, service.snapshot().takes, speaker.id);
    if (!queue.some((q) => q.segment.id === currentId)) currentId = queue.find((q) => q.status !== 'enregistre')?.segment.id ?? queue[0]?.segment.id ?? null;
    if (currentId) setRoute(`/enregistrement/${currentId}`);

    const left = h('aside', { class: 'pane pane-list' });
    const main = h('section', { class: 'pane pane-main studio' });
    mount(container, h('div', { class: 'record-layout' }, left, main));
    renderQueue(left, queue, speaker);
    renderStudio(main, queue, speaker);
  }

  // ---- File d'enregistrement -------------------------------------------------------
  function renderQueue(left, queue, speaker) {
    const { takes, speakers } = service.snapshot();
    const done = queue.filter((q) => q.status === 'enregistre').length;
    const minutes = takes.filter((t) => t.current && t.quality_status === 'valide').reduce((a, t) => a + t.duration_seconds, 0) / 60;
    const filterSel = h('select', { class: 'input input-sm', 'aria-label': 'Filtrer par statut audio' },
      h('option', { value: 'all' }, 'Tous les statuts'),
      Object.entries(AUDIO_STATUS).map(([k, l]) => h('option', { value: k, selected: filter === k }, l)));
    filterSel.addEventListener('change', () => { filter = filterSel.value; saveUi({ audioFilter: filter }); render(); });
    const items = queue.filter((q) => filter === 'all' || q.status === filter);
    const speakerSel = h('select', { class: 'input input-sm', 'aria-label': 'Locuteur actif' },
      speakers.map((s) => h('option', { value: s.id, selected: s.id === speaker.id }, `${s.name} (${s.id})`)),
      h('option', { value: '__new' }, '+ Nouveau locuteur…'));
    speakerSel.addEventListener('change', async () => {
      if (speakerSel.value === '__new') await service.saveSettings({ activeSpeakerId: null });
      else await service.saveSettings({ activeSpeakerId: speakerSel.value });
      render();
    });

    mount(left,
      h('div', { class: 'pane-head' },
        h('h2', null, 'File d\'enregistrement'),
        h('div', { class: 'progress-label' }, h('strong', null, `${done} / ${queue.length}`), ' phrases enregistrées'),
        progressBar(done, queue.length, { label: 'Phrases enregistrées', tone: 'teal' }),
        h('div', { class: 'stat-inline' }, icon('clock', 14), h('span', null, h('strong', null, fmtDuration(minutes * 60)), ' d\'audio validé'))),
      h('div', { class: 'filters' },
        h('div', { class: 'speaker-row' }, icon('user', 15), speakerSel,
          h('button', { class: 'icon-btn', title: 'Profil et consentement du locuteur', onclick: () => manageSpeaker(service, speaker.id, render) }, icon('settings', 15))),
        filterSel),
      h('div', { class: 'seg-list' }, queue.length === 0
        ? emptyState('file', 'Aucune phrase à enregistrer', 'Les segments Validés ou Corrigés dans l\'onglet « Révision » apparaissent ici automatiquement.', h('a', { class: 'btn btn-sm btn-secondary', href: '#/revision' }, 'Aller à la révision'))
        : items.length === 0 ? emptyState('search', 'Aucune phrase', 'Aucune phrase avec ce statut.')
          : items.map((q) => h('button', {
            class: ['seg-item', q.segment.id === currentId && 'active', `au-${q.status}`],
            onclick: () => { if (phase !== 'idle') return; currentId = q.segment.id; saveUi({ lastAudioSegmentId: currentId }); render(); },
            disabled: phase !== 'idle' && q.segment.id !== currentId,
          },
          h('div', { class: 'seg-item-top' }, h('span', { class: 'seg-id' }, q.segment.id), audioBadge(q.status)),
          h('p', { class: 'seg-preview', lang: 'aa' }, q.text),
          h('div', { class: 'seg-item-meta' },
            h('span', null, q.currentTake ? fmtDuration(q.currentTake.duration_seconds) : '—'),
            h('span', null, speaker.id),
            h('span', null, q.lastTake ? fmtDate(q.lastTake.recorded_at) : 'jamais'))))));
    left.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- Studio -------------------------------------------------------------------------
  function renderStudio(main, queue, speaker) {
    const item = queue.find((q) => q.segment.id === currentId);
    const micPanel = renderMicPanel();
    if (!item) {
      studio = null;
      mount(main, micPanel, emptyState('mic', 'Rien à enregistrer pour l\'instant', 'Validez ou corrigez des traductions dans l\'onglet « Révision » : elles rejoindront automatiquement cette file.'));
      return;
    }
    const { segment, review } = item;
    const text = review.corrected_afar;
    const { settings, takes } = service.snapshot();
    const segTakes = takes.filter((t) => t.segment_id === segment.id && t.speaker_id === speaker.id).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    const current = segTakes.find((t) => t.current) ?? null;
    const issues = detectReadingIssues(text, { sourceFr: segment.source_fr });

    // Texte prononcé : prise courante, sinon brouillon local, sinon texte affiché.
    const spokenDrafts = loadUi().spokenDrafts ?? {};
    const spoken = h('textarea', { class: 'input spoken-input', rows: 2, 'aria-label': 'Texte prononcé', ...AFAR_INPUT_ATTRS });
    spoken.value = (current && current.text_version === review.text_version ? current.text_spoken : null) ?? spokenDrafts[`${segment.id}:${review.text_version}`] ?? text;
    const spokenWarn = h('div', { class: 'spoken-warn' });
    const paintSpokenWarn = () => {
      const same = normalizeSpaces(spoken.value) === normalizeSpaces(text);
      mount(spokenWarn, issues.length && same
        ? callout('warning', 'Le texte prononcé est identique au texte affiché alors qu\'il contient des éléments à oraliser. Saisissez exactement les mots que vous allez prononcer.')
        : null);
    };
    spoken.addEventListener('input', () => {
      saveUi({ spokenDrafts: { ...(loadUi().spokenDrafts ?? {}), [`${segment.id}:${review.text_version}`]: spoken.value } });
      paintSpokenWarn();
    });
    paintSpokenWarn();

    const frBlock = h('p', { class: 'phrase-fr', lang: 'fr', hidden: !showFr }, segment.source_fr);
    const frToggle = h('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => { showFr = !showFr; frBlock.hidden = !showFr; saveUi({ showFrenchWhileRecording: showFr }); mount(frToggle, icon(showFr ? 'eyeOff' : 'eye', 14), showFr ? 'Masquer le français' : 'Afficher le français'); },
    }, icon(showFr ? 'eyeOff' : 'eye', 14), showFr ? 'Masquer le français' : 'Afficher le français');

    // Enregistreur
    const recBtn = h('button', { class: 'rec-btn', 'aria-label': 'Enregistrer', title: 'Enregistrer / arrêter (barre d\'espace)' }, h('span', { class: 'rec-core' }));
    const recState = h('div', { class: 'rec-state' }, h('span', { class: 'rec-hint' }, 'Appuyez sur le bouton ou la barre d\'espace pour enregistrer'));
    const live = h('canvas', { class: 'live-wave', 'aria-hidden': 'true' });
    const meter = h('div', { class: 'vu' }, h('div', { class: 'vu-fill' }), h('div', { class: 'vu-peak' }), h('span', { class: 'vu-scale' }, '−60', h('i'), '−40', h('i'), '−20', h('i'), '0 dBFS'));
    const meterLabel = h('span', { class: 'vu-label' }, '—');
    const liveWarn = h('div', { class: 'live-warn', 'aria-live': 'polite' });
    const countdownOpt = h('label', { class: 'check check-sm' },
      h('input', { type: 'checkbox', checked: settings.countdown, onchange: (e) => service.saveSettings({ countdown: e.target.checked }) }),
      h('span', null, 'Compte à rebours de 3 s'));

    recBtn.addEventListener('click', () => toggleRecording());

    const review_ = current ? renderTakeReview(current, segment, review, spoken) : null;
    const otherTakes = segTakes.filter((t) => !t.current);

    const nextItem = () => {
      const i = queue.findIndex((q) => q.segment.id === segment.id);
      return queue.slice(i + 1).find((q) => q.status !== 'enregistre') ?? queue[i + 1] ?? null;
    };

    mount(main,
      micPanel,
      h('div', { class: 'main-toolbar' },
        h('div', { class: 'crumbs' }, h('span', { class: 'seg-id lg' }, segment.id), audioBadge(item.status), h('span', { class: 'chip' }, segment.domaine),
          h('span', { class: 'chip chip-ghost' }, icon('user', 13), speaker.name)),
        h('div', { class: 'toolbar-right' },
          frToggle,
          h('button', {
            class: 'btn btn-sm btn-secondary',
            onclick: () => { const n = nextItem(); if (!n) { toast('Dernière phrase de la file.', { type: 'info' }); return; } if (phase !== 'idle') return; currentId = n.segment.id; saveUi({ lastAudioSegmentId: currentId }); render(); },
          }, 'Phrase suivante', icon('chevronRight', 14)))),

      item.status === 'a_refaire' && !current && callout('warning', 'Le texte validé de cette phrase a changé depuis le dernier enregistrement (ou la prise a été marquée à refaire). Les anciennes prises sont conservées ci-dessous comme prises non courantes.'),

      h('article', { class: 'phrase-card' },
        h('span', { class: 'phrase-label' }, 'Phrase à lire — Afar'),
        h('p', { class: 'phrase-afar', lang: 'aa' }, text),
        frBlock,
        review.simulated && h('p', { class: 'tiny muted' }, 'Traduction au statut simulé (démonstration).')),

      issues.length ? h('div', { class: 'issues card' },
        h('header', { class: 'card-head' }, h('h3', null, icon('alert', 16), 'Éléments à oraliser'), h('span', { class: 'muted tiny' }, 'Aucune transcription n\'est générée automatiquement')),
        h('ul', null, issues.map((i) => h('li', null, h('code', null, i.match), ' ', i.message)))) : null,

      h('div', { class: 'card spoken-card' },
        h('label', { class: 'field' },
          h('span', { class: 'field-label' }, 'Texte prononcé ', h('code', { class: 'tiny' }, 'text_spoken')),
          spoken,
          h('span', { class: 'field-help' }, 'Doit correspondre exactement aux mots prononcés dans l\'enregistrement (nombres, sigles et pourcentages écrits tels que vous les dites). Le texte affiché reste conservé séparément (text_display).')),
        settings.accentPalette && accentPalette(() => spoken),
        spokenWarn),

      h('div', { class: 'recorder card' },
        h('div', { class: 'rec-main' }, recBtn, h('div', { class: 'rec-info' }, recState, liveWarn, countdownOpt)),
        h('div', { class: 'rec-visual' }, live, h('div', { class: 'vu-wrap' }, meter, meterLabel))),

      review_,
      otherTakes.length ? h('details', { class: 'card takes-old' },
        h('summary', { class: 'card-summary' }, icon('database', 16), `Prises non courantes (${otherTakes.length})`, h('span', { class: 'muted tiny' }, ' — conservées jusqu\'à suppression explicite')),
        h('ul', { class: 'take-list' }, otherTakes.map((t) => h('li', null,
          h('span', null, fmtDate(t.recorded_at), ' · ', fmtDuration(t.duration_seconds), ' · ', h('em', null, t.invalidated_reason ?? (t.quality_status === 'valide' ? 'remplacée par une nouvelle prise' : t.quality_status === 'a_refaire' ? 'marquée à refaire' : 'brouillon remplacé'))),
          h('span', { class: 'row-gap' },
            h('button', { class: 'link-btn', onclick: () => downloadTake(t) }, 'Télécharger'),
            h('button', {
              class: 'link-btn danger',
              onclick: async () => {
                if (!await confirmDialog({ title: 'Supprimer cette prise ?', message: 'Le fichier audio sera définitivement supprimé de ce navigateur.', confirmLabel: 'Supprimer', danger: true })) return;
                await service.deleteTake(t.id);
                toast('Prise supprimée');
              },
            }, 'Supprimer')))))) : null);

    // Liaisons de l'enregistreur à cette vue
    studio = { recBtn, recState, live, meter, meterLabel, liveWarn, spoken, segment, review, text, speaker };
    paintRecButton();
    levelOff?.();
    levelOff = attachLevels();
  }

  let studio = null;
  let levelOff = null;

  // ---- Panneau microphone -----------------------------------------------------------
  function renderMicPanel() {
    const rec = recorder();
    const { settings } = service.snapshot();
    const supported = AudioRecorder.isSupported();
    const secure = AudioRecorder.isSecureContextOk();
    const deviceSel = h('select', { class: 'input input-sm', 'aria-label': 'Microphone' }, h('option', { value: '' }, 'Microphone par défaut'));
    const status = h('div', { class: 'mic-status' });
    const noiseOut = h('div', { class: 'noise-out' });
    const errBox = h('div');
    const panel = h('details', { class: 'card mic-panel', open: !rec.isOpen },
      h('summary', { class: 'card-summary' }, icon('mic', 16), 'Configuration du microphone', status),
      h('div', { class: 'mic-body' },
        !secure && callout('error', 'Le microphone exige une connexion sécurisée (HTTPS), sauf sur localhost. Ouvrez l\'application via son adresse https://.'),
        !supported && callout('error', 'Ce navigateur ne prend pas en charge la capture audio requise (Web Audio API / AudioWorklet). Utilisez une version récente de Chrome, Firefox, Edge ou Safari (14.1+).'),
        errBox,
        h('div', { class: 'mic-row' },
          deviceSel,
          h('button', { class: 'btn btn-sm btn-primary', disabled: !supported || !secure, onclick: () => openMic(deviceSel.value) }, icon('mic', 14), rec.isOpen ? 'Reconnecter' : 'Autoriser et tester le micro'),
          h('button', { class: 'btn btn-sm btn-secondary', disabled: !rec.isOpen, onclick: measureNoise }, icon('activity', 14), 'Mesurer le bruit ambiant (5 s)')),
        noiseOut,
        h('p', { class: 'tiny muted' }, 'Les traitements automatiques du navigateur (annulation d\'écho, réduction de bruit, gain automatique) sont désactivés lorsque le navigateur le permet. Le son est capturé en PCM à la fréquence native de la carte son, sans rééchantillonnage.')));

    const paintStatus = () => mount(status, rec.isOpen
      ? h('span', { class: 'pill pill-ok' }, `${rec.deviceLabel || 'Micro actif'} · ${fmtNumber(rec.sampleRate)} Hz`)
      : h('span', { class: 'pill' }, 'Micro non activé'));
    paintStatus();

    AudioRecorder.listInputs().then((devices) => {
      mount(deviceSel, h('option', { value: '' }, 'Microphone par défaut'), devices.map((d) => h('option', { value: d.deviceId, selected: d.deviceId && d.deviceId === settings.micDeviceId }, d.label)));
    }).catch(() => {});

    if (session.noise) paintNoise(noiseOut, session.noise);

    async function openMic(deviceId) {
      mount(errBox);
      try {
        await rec.open(deviceId || undefined);
        await service.saveSettings({ micDeviceId: deviceId || null });
        toast(`Microphone activé — ${fmtNumber(rec.sampleRate)} Hz`);
        render();
      } catch (err) {
        mount(errBox, callout('error', AudioRecorder.describeError(err)));
      }
    }

    async function measureNoise() {
      if (phase !== 'idle') return;
      mount(noiseOut, h('div', { class: 'noise-progress' }, h('span', null, 'Restez silencieux… '), progressBar(0, 1)));
      try {
        const res = await rec.measureNoise(5, (f) => {
          const bar = noiseOut.querySelector('.progress-fill');
          if (bar) bar.style.width = `${Math.round(f * 100)}%`;
        });
        session.noise = res;
        paintNoise(noiseOut, res);
      } catch (err) {
        mount(noiseOut, callout('error', AudioRecorder.describeError(err)));
      }
    }
    return panel;
  }

  function paintNoise(el, res) {
    const limit = service.snapshot().settings.audio.noiseWarnDbfs;
    const ok = res.rmsDbfs <= limit;
    mount(el, h('div', { class: `noise-result ${ok ? 'ok' : 'bad'}` },
      icon(ok ? 'checkCircle' : 'alert', 16),
      h('span', null, `Bruit ambiant : RMS ${formatDbfs(res.rmsDbfs)}, crête ${formatDbfs(res.peakDbfs)}. `,
        ok ? 'Environnement suffisamment calme.' : `Bruit supérieur au seuil (${formatDbfs(limit)}) : cherchez un endroit plus calme ou rapprochez-vous du micro.`)));
  }

  // ---- Vumètre ------------------------------------------------------------------------
  function attachLevels() {
    return recorder().onLevel((l) => {
      if (!studio) return;
      const { clipDbfs, lowRmsDbfs } = service.snapshot().settings.audio;
      const pct = (db) => `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
      studio.meter.querySelector('.vu-fill').style.width = pct(l.rmsDbfs);
      studio.meter.querySelector('.vu-peak').style.left = pct(l.peakDbfs);
      studio.meter.classList.toggle('clip', l.peakDbfs >= clipDbfs);
      studio.meterLabel.textContent = `RMS ${formatDbfs(l.rmsDbfs)} · crête ${formatDbfs(l.peakDbfs)}`;
      if (phase === 'recording') {
        liveStats.sumSq += l.rms * l.rms;
        liveStats.n += 1;
        const now = performance.now();
        if (l.peakDbfs >= clipDbfs) liveStats.clipUntil = now + 1500;
        const avgDb = toDbfs(Math.sqrt(liveStats.sumSq / liveStats.n));
        const msgs = [];
        if (now < liveStats.clipUntil) msgs.push(h('span', { class: 'warn-chip clip' }, icon('alert', 13), 'Saturation : éloignez-vous du micro'));
        if (liveStats.n > 40 && avgDb < lowRmsDbfs) msgs.push(h('span', { class: 'warn-chip low' }, icon('info', 13), 'Signal faible : rapprochez-vous du micro'));
        mount(studio.liveWarn, msgs);
      }
    });
  }

  // ---- Enregistrement -------------------------------------------------------------------
  function paintRecButton() {
    if (!studio) return;
    studio.recBtn.classList.toggle('recording', phase === 'recording');
    studio.recBtn.classList.toggle('waiting', phase === 'countdown' || phase === 'saving');
    studio.recBtn.setAttribute('aria-label', phase === 'recording' ? 'Arrêter l\'enregistrement' : 'Enregistrer');
  }

  async function toggleRecording() {
    if (!studio) return;
    if (phase === 'recording') return stopRecording();
    if (phase !== 'idle') return;
    const rec = recorder();
    if (!normalizeSpaces(studio.spoken.value)) { toast('Le texte prononcé est vide.', { type: 'warning' }); studio.spoken.focus(); return; }
    if (!rec.isOpen) {
      try {
        await rec.open(service.snapshot().settings.micDeviceId || undefined);
      } catch (err) {
        toast(AudioRecorder.describeError(err), { type: 'error' });
        return;
      }
      render();
      // Le rendu a recréé l'interface : on relance avec les nouveaux éléments.
      return toggleRecording();
    }
    if (service.snapshot().settings.countdown) {
      phase = 'countdown';
      paintRecButton();
      for (const n of [3, 2, 1]) {
        if (phase !== 'countdown') return;
        mount(studio.recState, h('span', { class: 'countdown' }, n));
        await new Promise((r) => setTimeout(r, 800));
      }
      if (phase !== 'countdown') return;
    }
    try {
      rec.start();
    } catch (err) {
      phase = 'idle';
      paintRecButton();
      toast(AudioRecorder.describeError(err), { type: 'error' });
      return;
    }
    phase = 'recording';
    liveStats = { sumSq: 0, n: 0, clipUntil: 0 };
    const now = Date.now();
    if (!session.startedAt || now - session.lastTakeAt > SESSION_GAP_MS) { session.startedAt = now; session.reminded = false; }
    if (!session.reminded && now - session.startedAt > BREAK_REMINDER_MS) {
      session.reminded = true;
      toast('Vous enregistrez depuis plus de 45 minutes. Pensez à faire une pause et à boire de l\'eau pour reposer votre voix.', { type: 'info', duration: 10000 });
    }
    paintRecButton();
    const t0 = performance.now();
    const loop = () => {
      if (phase !== 'recording' || !studio) return;
      const elapsed = (performance.now() - t0) / 1000;
      mount(studio.recState, h('span', { class: 'rec-dot' }), h('span', { class: 'rec-time' }, fmtClock(elapsed)), h('span', { class: 'muted' }, ' Enregistrement en cours — espace pour arrêter'));
      drawLiveWaveform(studio.live, rec.getLiveSamples(), { color: '#14b8a6' });
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  async function stopRecording() {
    const rec = recorder();
    const ctx = studio;
    phase = 'saving';
    stopLoop();
    paintRecButton();
    mount(ctx.recState, h('span', { class: 'muted' }, 'Enregistrement du fichier…'));
    try {
      const { samples, sampleRate, durationSeconds } = await rec.stop();
      session.lastTakeAt = Date.now();
      if (!samples.length) throw new Error('Aucun son n\'a été capturé. Vérifiez le microphone.');
      const analysis = analyzeTake(samples, sampleRate, service.snapshot().settings.audio);
      const wav = encodeWav(samples, sampleRate);
      await service.saveTake({
        segment_id: ctx.segment.id,
        speaker_id: ctx.speaker.id,
        text_display: ctx.text,
        text_spoken: ctx.spoken.value.trim(),
        text_version: ctx.review.text_version,
        duration_seconds: durationSeconds,
        sample_rate: sampleRate,
        peak_dbfs: Number.isFinite(analysis.peakDbfs) ? Math.round(analysis.peakDbfs * 10) / 10 : null,
        rms_dbfs: Number.isFinite(analysis.rmsDbfs) ? Math.round(analysis.rmsDbfs * 10) / 10 : null,
        warnings: analysis.warnings.map((w) => w.code),
        warning_messages: analysis.warnings.map((w) => w.message),
      }, wav);
      phase = 'idle';
      toast(`Prise enregistrée (${fmtDuration(durationSeconds)}) — réécoutez-la avant de la valider`);
      render();
    } catch (err) {
      phase = 'idle';
      toast(err.message || 'Échec de l\'enregistrement.', { type: 'error' });
      render();
    }
  }

  function stopLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // ---- Contrôle qualité de la prise courante ------------------------------------------
  function renderTakeReview(take, segment, review, spokenField) {
    const canvas = h('canvas', { class: 'take-wave', 'aria-hidden': 'true' });
    const audio = h('audio', { controls: true, preload: 'auto', class: 'take-audio' });
    let samples = null;
    service.getTakeAudio(take.id).then((buf) => {
      if (!buf) { mount(canvas.parentElement, callout('error', 'Fichier audio introuvable dans le stockage local.')); return; }
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      objectUrls.add(url);
      audio.src = url;
      try { samples = decodeWavToFloat32(buf).samples; } catch { samples = new Float32Array(); }
      requestAnimationFrame(() => drawWaveform(canvas, samples, { color: '#94a3b8', progressColor: '#14b8a6', progress: 0 }));
    });
    const paintProgress = () => samples && drawWaveform(canvas, samples, { color: '#94a3b8', progressColor: '#14b8a6', progress: audio.duration ? audio.currentTime / audio.duration : 0 });
    audio.addEventListener('timeupdate', paintProgress);
    audio.addEventListener('ended', paintProgress);
    canvas.addEventListener('click', (e) => {
      if (!audio.duration) return;
      const r = canvas.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
      paintProgress();
    });

    const flags = { ...take.flags };
    const confirm = h('input', { type: 'checkbox', checked: take.confirmed });
    const validateBtn = h('button', { class: 'btn btn-success', disabled: !take.confirmed || take.quality_status === 'valide' }, icon('checkCircle'), take.quality_status === 'valide' ? 'Enregistrement validé' : 'Valider l\'enregistrement');
    confirm.addEventListener('change', () => { validateBtn.disabled = !confirm.checked || take.quality_status === 'valide'; });
    const outdated = take.text_version !== review.text_version;

    validateBtn.addEventListener('click', async () => {
      if (!confirm.checked) return;
      if (normalizeSpaces(spokenField.value) !== normalizeSpaces(take.text_spoken)) {
        const ok = await confirmDialog({
          title: 'Texte prononcé modifié',
          message: `Le texte prononcé a été modifié depuis la prise. Confirmez-vous que l'audio correspond exactement à : « ${spokenField.value.trim()} » ?`,
          confirmLabel: 'Oui, l\'audio correspond à ce texte',
        });
        if (!ok) return;
      }
      try {
        await service.validateTake(take.id, { textSpoken: spokenField.value, flags, confirmed: true });
        toast('Enregistrement validé — ajouté au corpus audio');
        render();
      } catch (err) { toast(err.message, { type: 'warning' }); }
    });

    const warnings = take.warning_messages ?? [];
    return h('article', { class: `card take-review q-${take.quality_status}` },
      h('header', { class: 'card-head' },
        h('h3', null, icon('play', 15), 'Réécoute et contrôle qualité'),
        h('span', { class: `badge badge-take-${take.quality_status}` }, { brouillon: 'À vérifier', valide: 'Validé', a_refaire: 'À refaire' }[take.quality_status])),
      outdated && callout('warning', 'Cette prise correspond à une ancienne version du texte : elle doit être refaite.'),
      h('div', { class: 'take-player' }, canvas, audio),
      h('dl', { class: 'meta-grid' },
        h('div', null, h('dt', null, 'Durée'), h('dd', null, `${fmtNumber(take.duration_seconds, 2)} s`)),
        h('div', null, h('dt', null, 'Format'), h('dd', null, `WAV PCM 16 bits mono · ${fmtNumber(take.sample_rate)} Hz`)),
        h('div', null, h('dt', null, 'Niveaux'), h('dd', null, `crête ${take.peak_dbfs === null ? '—' : formatDbfs(take.peak_dbfs)} · RMS ${take.rms_dbfs === null ? '—' : formatDbfs(take.rms_dbfs)}`)),
        h('div', null, h('dt', null, 'Prise'), h('dd', null, `${fmtDate(take.recorded_at)} · ${fmtBytes(take.size_bytes)}`))),
      warnings.length ? callout('warning', h('strong', null, 'Avertissements de qualité (indicatifs) : '), h('ul', { class: 'warn-list' }, warnings.map((w) => h('li', null, w))), h('span', { class: 'tiny' }, 'La décision finale vous appartient.')) : null,
      h('fieldset', { class: 'flags' },
        h('legend', null, 'Signaler un défaut'),
        Object.entries(FLAG_LABELS).map(([k, label]) => h('label', { class: 'check check-sm' },
          h('input', { type: 'checkbox', checked: !!flags[k], onchange: async (e) => { flags[k] = e.target.checked; await service.updateTake(take.id, { flags: { ...flags } }); } }),
          h('span', null, label)))),
      h('label', { class: 'check confirm-check' }, confirm,
        h('span', null, h('strong', null, 'Je confirme que l\'enregistrement correspond exactement au texte prononcé indiqué.'))),
      h('div', { class: 'actions' },
        validateBtn,
        h('button', { class: 'btn btn-secondary', onclick: () => toggleRecording(), title: 'Nouvelle prise (l\'actuelle est conservée comme prise non courante)' }, icon('rotate'), 'Refaire'),
        h('button', {
          class: 'btn btn-outline-warning',
          disabled: take.quality_status === 'a_refaire',
          onclick: async () => { await service.updateTake(take.id, { quality_status: 'a_refaire', confirmed: false }); toast('Prise marquée « À refaire »', { type: 'info' }); render(); },
        }, icon('flag'), 'Marquer à refaire'),
        h('button', { class: 'btn btn-ghost', onclick: () => downloadTake(take) }, icon('download'), 'Télécharger le WAV')));
  }

  async function downloadTake(take) {
    const buf = await service.getTakeAudio(take.id);
    if (!buf) { toast('Fichier audio introuvable.', { type: 'error' }); return; }
    downloadBlob(wavFileName(take.segment_id, take.speaker_id).replace('.wav', `_${take.id.slice(-6)}.wav`), new Blob([buf], { type: 'audio/wav' }));
  }

  // ---- Raccourci barre d'espace -----------------------------------------------------------
  function onKey(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]') || e.repeat) return;
    if (e.target?.tagName === 'AUDIO') return;
    if (!studio) return;
    e.preventDefault();
    toggleRecording();
  }
  document.addEventListener('keydown', onKey);

  render();

  return {
    onData(topic) {
      if (phase !== 'idle') return; // ne jamais redessiner pendant une prise
      if (['takes', 'reviews', 'speakers', 'reset'].includes(topic)) render();
    },
    unmount() {
      if (phase === 'recording' || phase === 'countdown') {
        phase = 'idle';
        recorder().stop().catch(() => {});
      }
      stopLoop();
      studio = null;
      levelOff?.();
      // Libère le micro en quittant l'onglet (l'indicateur d'enregistrement du navigateur s'éteint).
      recorder().close().catch(() => {});
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
      document.removeEventListener('keydown', onKey);
    },
  };
}
