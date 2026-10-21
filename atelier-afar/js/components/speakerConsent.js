// Consentement et profil vocal du locuteur.
import { h, icon, fmtDate, fmtDay } from '../utils/dom.js';
import { openModal, toast, confirmDialog } from './ui.js';
import { uid } from '../utils/defaults.js';
import { consentValid } from '../utils/status.js';

export const CONSENT_TEXT_VERSION = 'consentement-v1';
const AGE_RANGES = ['18–25 ans', '26–35 ans', '36–45 ans', '46–55 ans', '56–65 ans', 'Plus de 65 ans'];
const SEXES = ['Femme', 'Homme', 'Autre / ne souhaite pas préciser'];

const today = () => new Date().toISOString().slice(0, 10);

/** Champs du profil vocal ; retourne les éléments et une fonction de lecture des valeurs. */
function profileFields(speaker, dialects) {
  const f = {
    id: h('input', { class: 'input', value: speaker?.id ?? uid('spk').slice(0, 12), required: true, readonly: !!speaker, 'aria-describedby': 'spk-id-help' }),
    name: h('input', { class: 'input', value: speaker?.name ?? '', required: true, autocomplete: 'name' }),
    sexe: h('select', { class: 'input' }, h('option', { value: '' }, '— Non renseigné —'), SEXES.map((s) => h('option', { value: s, selected: speaker?.sexe === s }, s))),
    age: h('select', { class: 'input' }, h('option', { value: '' }, '— Non renseignée —'), AGE_RANGES.map((s) => h('option', { value: s, selected: speaker?.age_range === s }, s))),
    dialect: h('select', { class: 'input', required: true }, dialects.map((d) => h('option', { value: d, selected: speaker?.dialect === d }, d))),
    region: h('input', { class: 'input', value: speaker?.region ?? '', placeholder: 'Ex. : Tadjourah, Obock, Dikhil…' }),
    notes: h('textarea', { class: 'input', rows: 3, value: speaker?.notes ?? '', placeholder: 'Particularités de prononciation, usages régionaux…' }),
  };
  const field = (label, el, help) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el, help && h('span', { class: 'field-help', id: el === f.id ? 'spk-id-help' : undefined }, help));
  const els = [
    h('div', { class: 'grid-2' },
      field('Identifiant du locuteur *', f.id, 'Utilisé dans les noms de fichiers. Non modifiable ensuite.'),
      field('Nom ou pseudonyme *', f.name)),
    h('div', { class: 'grid-2' }, field('Sexe (facultatif)', f.sexe), field('Tranche d\'âge (facultative)', f.age)),
    h('div', { class: 'grid-2' },
      field('Dialecte afar *', f.dialect, 'Liste modifiable dans les paramètres.'),
      field('Région linguistique', f.region)),
    field('Notes sur la prononciation', f.notes),
  ];
  const read = () => ({
    id: f.id.value.trim().replace(/[^A-Za-z0-9_-]+/g, '_'),
    name: f.name.value.trim(),
    sexe: f.sexe.value || null,
    age_range: f.age.value || null,
    dialect: f.dialect.value,
    region: f.region.value.trim(),
    notes: f.notes.value.trim(),
  });
  return { els, read, f };
}

/**
 * Écran de première utilisation : consentement + profil. Rendu dans la page (pas en modale).
 * @param {import('../services/DataService.js').DataService} service
 */
export function consentScreen(service, onDone) {
  const { speakers, consents, settings } = service.snapshot();
  const profile = profileFields(null, settings.dialects);
  const cConsent = h('input', { type: 'checkbox' });
  const cTraining = h('input', { type: 'checkbox' });
  const date = h('input', { class: 'input', type: 'date', value: today(), max: today() });
  const err = h('p', { class: 'field-error', hidden: true });

  const submit = async () => {
    const p = profile.read();
    const problems = [];
    if (!p.id) problems.push('l\'identifiant');
    if (!p.name) problems.push('le nom ou pseudonyme');
    if (!cConsent.checked) problems.push('la confirmation du consentement');
    if (!cTraining.checked) problems.push('l\'autorisation de réutilisation pour l\'entraînement');
    if (!date.value) problems.push('la date du consentement');
    if (speakers.some((s) => s.id === p.id)) problems.push('un identifiant non utilisé');
    if (problems.length) { err.hidden = false; err.textContent = `Merci de renseigner : ${problems.join(', ')}.`; return; }
    await service.saveSpeaker(p);
    await service.saveConsent({ speaker_id: p.id, speaker_name: p.name, consent_given: true, training_reuse: true, consent_date: date.value, text_version: CONSENT_TEXT_VERSION });
    await service.saveSettings({ activeSpeakerId: p.id });
    toast('Consentement et profil enregistrés localement');
    onDone();
  };

  const existing = speakers.filter((s) => consentValid(consents[s.id]));
  return h('div', { class: 'onboarding' },
    h('div', { class: 'onboarding-card card' },
      h('div', { class: 'onb-icon' }, icon('shield', 26)),
      h('h2', null, 'Avant d\'enregistrer votre voix'),
      existing.length ? h('div', { class: 'callout callout-info' }, icon('info', 18), h('div', null,
        'Un profil avec consentement existe déjà : ',
        existing.map((s) => h('button', { class: 'link-btn', onclick: async () => { await service.saveSettings({ activeSpeakerId: s.id }); onDone(); } }, `utiliser « ${s.name} »`)))) : null,
      h('section', { class: 'consent-text' },
        h('h3', null, 'Utilisation de vos enregistrements'),
        h('p', null, 'Les phrases que vous lirez seront enregistrées avec votre microphone. Les enregistrements, le texte prononcé et les informations de votre profil vocal ',
          h('strong', null, 'pourront être utilisés pour entraîner et évaluer un modèle de synthèse vocale (TTS) en afar.')),
        h('ul', null,
          h('li', null, 'Aucun enregistrement ne démarre sans action explicite de votre part.'),
          h('li', null, 'Les enregistrements sont conservés de façon sécurisée et ne sont accessibles qu\'aux membres du projet.'),
          h('li', null, 'Vous pouvez retirer votre consentement et supprimer vos enregistrements locaux à tout moment.'))),
      h('h3', { class: 'section-title' }, 'Profil vocal'),
      profile.els,
      h('h3', { class: 'section-title' }, 'Consentement'),
      h('label', { class: 'check' }, cConsent, h('span', null, 'Je confirme avoir lu les informations ci-dessus et je consens à l\'enregistrement de ma voix.')),
      h('label', { class: 'check' }, cTraining, h('span', null, 'J\'autorise explicitement la réutilisation de mes enregistrements pour entraîner et évaluer des modèles de synthèse vocale.')),
      h('label', { class: 'field field-inline' }, h('span', { class: 'field-label' }, 'Date du consentement'), date),
      err,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn btn-primary btn-lg', onclick: submit }, icon('check'), 'Enregistrer mon consentement'))));
}

/** Gestion du locuteur actif : modification du profil, retrait du consentement. */
export function manageSpeaker(service, speakerId, onChange) {
  const { speakers, consents, settings, takes } = service.snapshot();
  const speaker = speakers.find((s) => s.id === speakerId);
  if (!speaker) return;
  const consent = consents[speakerId];
  const profile = profileFields(speaker, settings.dialects);
  openModal({
    title: `Locuteur — ${speaker.name}`,
    size: 'lg',
    render: (close) => [
      profile.els,
      h('div', { class: 'consent-status' },
        icon('shield', 16),
        consentValid(consent)
          ? h('span', null, `Consentement donné le ${fmtDay(consent.consent_date)} (enregistré le ${fmtDate(consent.recorded_at)}), réutilisation pour l'entraînement autorisée.`)
          : h('span', null, 'Consentement absent ou retiré.')),
      h('div', { class: 'modal-actions spread' },
        h('button', {
          class: 'btn btn-outline-danger',
          onclick: async () => {
            const n = takes.filter((t) => t.speaker_id === speakerId).length;
            const ok = await confirmDialog({
              title: 'Retirer le consentement ?',
              message: `Le consentement de « ${speaker.name} » sera retiré et ses ${n} enregistrement(s) local(aux) ainsi que son profil seront définitivement supprimés de ce navigateur.`,
              confirmLabel: 'Retirer et supprimer', danger: true,
            });
            if (!ok) return;
            await service.withdrawConsent(speakerId, { deleteRecordings: true });
            toast('Consentement retiré, données locales du locuteur supprimées');
            close(true);
            onChange();
          },
        }, icon('trash', 15), 'Retirer le consentement'),
        h('div', { class: 'row-gap' },
          h('button', { class: 'btn btn-ghost', onclick: () => close(false) }, 'Fermer'),
          h('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              const p = profile.read();
              if (!p.name) { profile.f.name.focus(); return; }
              await service.saveSpeaker({ ...speaker, ...p, id: speaker.id });
              toast('Profil mis à jour');
              close(true);
              onChange();
            },
          }, 'Enregistrer le profil'))),
    ],
  });
}

