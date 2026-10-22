// Paramètres : compte, équipe et répartition du travail (administrateurs), affichage, audio, exports.
import { h, icon, mount, fmtBytes, fmtNumber } from '../utils/dom.js';
import { toast, confirmDialog, promptDialog, openModal, progressBar } from '../components/ui.js';
import { ACCENTED_VOWELS } from '../components/accentPalette.js';
import { exportRevisions } from '../utils/exporter.js';
import { runTtsExport } from './dashboard.js';

const DONE = new Set(['valide', 'corrige', 'rejete', 'signale']);

/** @param {HTMLElement} container @param {{ service: import('../services/SupabaseDataService.js').SupabaseDataService }} ctx */
export function mountSettings(container, { service }) {
  const storageEl = h('div', { class: 'storage' });

  async function paintStorage() {
    const info = await service.storageInfo();
    mount(storageEl, h('dl', { class: 'meta-grid' },
      h('div', null, h('dt', null, 'Segments'), h('dd', null, fmtNumber(info.segments))),
      h('div', null, h('dt', null, 'Révisions'), h('dd', null, fmtNumber(info.reviews))),
      h('div', null, h('dt', null, 'Prises audio'), h('dd', null, `${info.takes} (${fmtBytes(info.audioBytes)})`)),
      h('div', null, h('dt', null, 'Membres'), h('dd', null, String(info.members)))));
  }

  function render() {
    const { settings } = service.snapshot();
    const save = (patch, msg = 'Paramètre enregistré') => service.saveSettings(patch).then(() => toast(msg));
    const section = (title, desc, ...body) => h('section', { class: 'card settings-section' }, h('header', { class: 'card-head' }, h('div', null, h('h3', null, title), desc && h('p', { class: 'muted tiny' }, desc))), ...body);
    const numberField = (label, key, step, help) => {
      const input = h('input', { class: 'input input-sm', type: 'number', step, value: settings.audio[key] });
      input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v)) save({ audio: { [key]: v } }); });
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, help && h('span', { class: 'field-help' }, help));
    };
    const toggle = (label, key, help) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: settings[key], onchange: (e) => save({ [key]: e.target.checked }) }),
      h('span', null, label, help && h('span', { class: 'field-help block' }, help)));

    const scale = h('input', { type: 'range', min: 0.8, max: 1.6, step: 0.1, value: settings.textScale, 'aria-label': 'Taille du texte' });
    const scaleVal = h('span', { class: 'pill' }, `${Math.round(settings.textScale * 100)} %`);
    scale.addEventListener('input', () => { scaleVal.textContent = `${Math.round(scale.value * 100)} %`; document.documentElement.style.setProperty('--text-scale', scale.value); });
    scale.addEventListener('change', () => save({ textScale: Number(scale.value) }));

    const dialects = h('input', { class: 'input', value: settings.dialects.join(', ') });
    dialects.addEventListener('change', () => {
      const list = dialects.value.split(',').map((d) => d.trim()).filter(Boolean);
      if (list.length) save({ dialects: list }, 'Liste des dialectes mise à jour');
    });

    mount(container, h('div', { class: 'page-pad settings' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Paramètres'))),

      service.isAdmin ? h('div', { class: 'settings-wide' }, teamSection(), assignmentSection()) : null,

      h('div', { class: 'settings-grid' },
        accountSection(),

        section('Affichage et saisie', 'Préférences propres à ce poste.',
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Taille du texte'), h('div', { class: 'row-gap' }, scale, scaleVal)),
          toggle('Afficher la palette de voyelles accentuées', 'accentPalette', `Boutons ${ACCENTED_VOWELS.join(' ')} sous les champs afar. Les caractères ne sont insérés que sur clic, jamais automatiquement.`),
          toggle('Compte à rebours de 3 secondes avant l\'enregistrement', 'countdown'),
          toggle('Afficher le français pendant l\'enregistrement (par défaut)', 'showFrenchWhileRecording'),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Dialectes proposés (séparés par des virgules)'), dialects)),

        section('Seuils de qualité audio', 'Avertissements indicatifs : ils ne valident ni ne rejettent jamais une prise automatiquement.',
          h('div', { class: 'grid-2' },
            numberField('Saturation (crête, dBFS)', 'clipDbfs', 0.5, 'Avertir au-delà de ce niveau crête.'),
            numberField('Niveau trop faible (RMS, dBFS)', 'lowRmsDbfs', 1, 'Avertir en dessous de ce niveau moyen.'),
            numberField('Durée minimale (s)', 'minDuration', 0.5),
            numberField('Durée maximale (s)', 'maxDuration', 1),
            numberField('Bruit ambiant maximal (RMS, dBFS)', 'noiseWarnDbfs', 1, 'Utilisé par la mesure de 5 s de silence.'))),

        section('Exports', null,
          h('div', { class: 'row-gap wrap' },
            h('button', { class: 'btn btn-primary', onclick: () => { exportRevisions(service, 'jsonl'); toast('revisions.jsonl téléchargé'); } }, icon('download', 15), 'Exporter le corpus FR–Afar'),
            h('button', { class: 'btn btn-secondary', onclick: () => { exportRevisions(service, 'csv'); toast('revisions.csv téléchargé'); } }, 'CSV'),
            h('button', { class: 'btn btn-teal', onclick: () => runTtsExport(service) }, icon('download', 15), 'Exporter le corpus TTS')),
          h('div', { class: 'storage-wrap' }, storageEl),
          service.isAdmin && h('div', { class: 'danger-zone' },
            h('button', {
              class: 'btn btn-outline-danger',
              onclick: async () => {
                const n = service.snapshot().takes.length;
                if (!n) { toast('Aucun enregistrement.', { type: 'info' }); return; }
                if (!await confirmDialog({ title: 'Supprimer tous les enregistrements ?', message: `Les ${n} prise(s) audio de toute l'équipe seront définitivement supprimées. Exportez d'abord le corpus TTS si nécessaire.`, confirmLabel: `Supprimer ${n} prise(s)`, danger: true })) return;
                try { await service.deleteAllTakes(); } catch (err) { toast(err.message, { type: 'error' }); return; }
                toast('Enregistrements supprimés');
                paintStorage();
              },
            }, icon('trash', 15), 'Supprimer tous les enregistrements'))))));
    paintStorage();
  }

  function accountSection() {
    const m = service.member;
    return h('section', { class: 'card settings-section' },
      h('header', { class: 'card-head' }, h('h3', null, 'Mon compte')),
      h('dl', { class: 'meta-grid' },
        h('div', null, h('dt', null, 'Nom'), h('dd', null, m.display_name)),
        h('div', null, h('dt', null, 'Adresse e-mail'), h('dd', null, m.email)),
        h('div', null, h('dt', null, 'Code linguiste'), h('dd', null, h('code', null, m.code))),
        h('div', null, h('dt', null, 'Rôle'), h('dd', null, m.role === 'admin' ? 'Administrateur' : 'Linguiste'))),
      h('div', { class: 'row-gap wrap', style: { marginTop: '14px' } },
        h('button', {
          class: 'btn btn-sm btn-secondary',
          onclick: async () => {
            const name = await promptDialog({ title: 'Modifier mon nom', label: 'Nom affiché', confirmLabel: 'Enregistrer', required: true, initial: m.display_name });
            if (!name) return;
            try { await service.updateMyName(name); toast('Nom mis à jour'); render(); } catch (err) { toast(err.message, { type: 'error' }); }
          },
        }, icon('user', 14), 'Modifier mon nom'),
        h('button', {
          class: 'btn btn-sm btn-secondary',
          onclick: async () => {
            const pw = await promptDialog({ title: 'Changer de mot de passe', label: 'Nouveau mot de passe (8 caractères minimum)', confirmLabel: 'Changer', required: true });
            if (!pw) return;
            if (pw.length < 8) { toast('Le mot de passe doit contenir au moins 8 caractères.', { type: 'warning' }); return; }
            try { await service.changePassword(pw); toast('Mot de passe modifié'); } catch (err) { toast(err.message, { type: 'error' }); }
          },
        }, icon('shield', 14), 'Changer de mot de passe')));
  }

  /** Équipe : invitations par e-mail, nouveaux liens d'accès, suppression. */
  function teamSection() {
    const { members } = service.snapshot();
    const email = h('input', { class: 'input input-sm', type: 'email', placeholder: 'adresse@exemple.com', 'aria-label': 'Adresse e-mail' });
    const name = h('input', { class: 'input input-sm', placeholder: 'Nom affiché', 'aria-label': 'Nom affiché' });
    const code = h('input', { class: 'input input-sm', placeholder: 'Code (ex. ling_02)', 'aria-label': 'Code linguiste' });
    const role = h('select', { class: 'input input-sm', 'aria-label': 'Rôle' }, h('option', { value: 'linguiste' }, 'Linguiste'), h('option', { value: 'admin' }, 'Administrateur'));
    const inviteBtn = h('button', { class: 'btn btn-sm btn-primary' }, icon('plus', 14), 'Inviter');
    inviteBtn.addEventListener('click', async () => {
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim()) || !name.value.trim() || !/^[A-Za-z0-9_-]+$/.test(code.value.trim())) {
        toast('Renseignez une adresse e-mail valide, un nom et un code (lettres, chiffres, _ ou -).', { type: 'warning' });
        return;
      }
      inviteBtn.disabled = true;
      try {
        const res = await service.inviteMember({ email: email.value, display_name: name.value, code: code.value, role: role.value });
        showAccessResult(res.member.display_name, res.member.email, res, 'invite');
        render();
      } catch (err) { toast(err.message, { type: 'error' }); } finally { inviteBtn.disabled = false; }
    });

    return h('section', { class: 'card settings-section' },
      h('header', { class: 'card-head' }, h('div', null, h('h3', null, 'Équipe'), h('p', { class: 'muted tiny' }, 'Seules les personnes listées ici peuvent se connecter à l\'atelier.'))),
      h('ul', { class: 'member-list' }, members.map((m) => {
        const pending = !m.activated_at;
        const self = m.email === service.member.email;
        return h('li', null,
          h('div', null, h('strong', null, m.display_name), ' ', h('span', { class: 'muted tiny' }, `${m.email} · ${m.code}`)),
          h('span', { class: 'row-gap' },
            pending && h('span', { class: 'pill pill-wait' }, 'Invitation en attente'),
            h('span', { class: 'pill' }, m.role === 'admin' ? 'Administrateur' : 'Linguiste'),
            !self && h('button', {
              class: 'link-btn',
              onclick: async () => {
                const msg = pending
                  ? `Un nouveau lien d'activation sera envoyé à ${m.display_name}. Le lien précédent ne fonctionnera plus.`
                  : `Un lien permettant à ${m.display_name} de choisir un nouveau mot de passe sera envoyé. Son mot de passe actuel reste valable tant que le lien n'est pas utilisé.`;
                if (!await confirmDialog({ title: pending ? 'Renvoyer l\'invitation ?' : 'Envoyer un lien de réinitialisation ?', message: msg, confirmLabel: 'Envoyer' })) return;
                try { const res = await service.sendAccessLink(m.email); showAccessResult(m.display_name, m.email, res, res.purpose); } catch (err) { toast(err.message, { type: 'error' }); }
              },
            }, pending ? 'Renvoyer l\'invitation' : 'Réinitialiser le mot de passe'),
            !self && h('button', {
              class: 'link-btn danger',
              onclick: async () => {
                if (!await confirmDialog({ title: 'Supprimer ce compte ?', message: `${m.display_name} (${m.email}) ne pourra plus se connecter. Son travail déjà enregistré est conservé ; ses segments attribués redeviennent non attribués.`, confirmLabel: 'Supprimer le compte', danger: true })) return;
                try { await service.deleteMember(m.email); toast('Compte supprimé'); render(); } catch (err) { toast(err.message, { type: 'error' }); }
              },
            }, 'Supprimer')));
      })),
      h('div', { class: 'member-form' },
        h('div', { class: 'member-form-row' }, email, name, code, role, inviteBtn),
        h('p', { class: 'field-help' }, 'La personne reçoit un lien pour activer son compte : elle confirme son nom et choisit elle-même son mot de passe.')));
  }

  /** Résultat d'une invitation ou d'une réinitialisation : e-mail envoyé, ou lien à transmettre. */
  function showAccessResult(displayName, emailAddr, res, purpose) {
    const invite = purpose === 'invite';
    if (res.mailed) {
      toast(invite ? `Invitation envoyée à ${emailAddr} (lien valable ${res.expires}).` : `Lien de réinitialisation envoyé à ${emailAddr} (valable ${res.expires}).`, { duration: 7000 });
      return;
    }
    openModal({
      title: invite ? 'Invitation créée' : 'Lien de réinitialisation créé',
      render: (close) => {
        const text = invite
          ? `Bonjour ${displayName},\n\nUn compte a été créé pour vous sur l'Atelier Afar. Ouvrez ce lien pour activer votre compte et choisir votre mot de passe (valable ${res.expires}) :\n${res.link}\n\nIdentifiant : ${emailAddr}`
          : `Bonjour ${displayName},\n\nVoici un lien pour choisir un nouveau mot de passe sur l'Atelier Afar (valable ${res.expires}) :\n${res.link}`;
        return [
          h('p', { class: 'modal-text' }, `L'envoi automatique d'e-mails n'est pas encore activé. Transmettez ce message à ${displayName} (e-mail, WhatsApp…). Le lien est personnel et à usage unique.`),
          h('pre', { class: 'credentials' }, text),
          h('div', { class: 'modal-actions' },
            h('a', { class: 'btn btn-secondary', href: `mailto:${encodeURIComponent(emailAddr)}?subject=${encodeURIComponent(invite ? 'Votre accès à l\'Atelier Afar' : 'Réinitialisation de votre mot de passe — Atelier Afar')}&body=${encodeURIComponent(text)}` }, icon('file', 14), 'Ouvrir dans ma messagerie'),
            h('button', { class: 'btn btn-secondary', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copié dans le presse-papiers'); } catch { toast('Copie impossible : sélectionnez le texte manuellement.', { type: 'warning' }); } } }, 'Copier'),
            h('button', { class: 'btn btn-primary', onclick: () => close(true) }, 'Terminé')),
        ];
      },
    });
  }

  /** Répartition des lots entre linguistes. */
  function assignmentSection() {
    const { segments, reviews, members } = service.snapshot();
    const lots = [...new Set(segments.map((s) => s.lot))];
    return h('section', { class: 'card settings-section' },
      h('header', { class: 'card-head' }, h('div', null, h('h3', null, 'Répartition du travail'), h('p', { class: 'muted tiny' }, 'Attribuez chaque lot à un linguiste : il le retrouve dans « Mes segments ». Deux personnes ne peuvent jamais modifier le même segment en même temps.'))),
      h('table', { class: 'team-table' },
        h('thead', null, h('tr', null, ['Lot', 'Segments', 'Avancement', 'Attribué à'].map((t) => h('th', null, t)))),
        h('tbody', null, lots.map((lot) => {
          const inLot = segments.filter((s) => s.lot === lot);
          const done = inLot.filter((s) => DONE.has(reviews[s.id]?.status)).length;
          const owners = [...new Set(inLot.map((s) => s.assigned_to ?? ''))];
          const sel = h('select', { class: 'input input-sm', 'aria-label': `Attribution du ${lot}` },
            h('option', { value: '' }, '— Non attribué —'),
            owners.length > 1 && h('option', { value: '__mixed', selected: true, disabled: true }, 'Plusieurs linguistes'),
            members.map((m) => h('option', { value: m.code, selected: owners.length === 1 && owners[0] === m.code }, m.display_name)));
          sel.addEventListener('change', async () => {
            try { await service.assignLot(lot, sel.value); toast(sel.value ? `${lot} attribué à ${service.memberName(sel.value)}` : `${lot} n'est plus attribué`); } catch (err) { toast(err.message, { type: 'error' }); render(); }
          });
          return h('tr', null,
            h('td', null, lot),
            h('td', null, inLot.length),
            h('td', null, h('div', { class: 'team-progress' }, progressBar(done, inLot.length, { label: lot }), h('span', { class: 'tiny muted' }, `${done}/${inLot.length}`))),
            h('td', null, sel));
        }))));
  }

  render();
  return {
    onData(topic) {
      if (topic === 'takes') paintStorage();
      if ((topic === 'members' || topic === 'segments') && !document.querySelector('dialog[open]') && !container.contains(document.activeElement)) render();
    },
    unmount() {},
  };
}
