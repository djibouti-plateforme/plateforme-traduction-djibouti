// Paramètres et gestion des données locales.
import { h, icon, mount, fmtBytes, fmtNumber } from '../utils/dom.js';
import { toast, confirmDialog, promptDialog, callout } from '../components/ui.js';
import { ACCENTED_VOWELS } from '../components/accentPalette.js';
import { exportRevisions } from '../utils/exporter.js';
import { runTtsExport } from './dashboard.js';

/** @param {HTMLElement} container @param {{ service: import('../services/DataService.js').DataService }} ctx */
export function mountSettings(container, { service }) {
  const storageEl = h('div', { class: 'storage' }, 'Calcul…');

  const cloud = service.mode === 'supabase';

  async function paintStorage() {
    const info = await service.storageInfo();
    if (info.remote) {
      mount(storageEl, h('dl', { class: 'meta-grid' },
        h('div', null, h('dt', null, 'Hébergement'), h('dd', null, `Supabase — ${info.region}`)),
        h('div', null, h('dt', null, 'Prises audio'), h('dd', null, `${info.takes} (${fmtBytes(info.audioBytes)})`)),
        h('div', null, h('dt', null, 'Révisions'), h('dd', null, String(info.reviews))),
        h('div', null, h('dt', null, 'Membres'), h('dd', null, String(info.members)))));
      return;
    }
    const pct = info.usage && info.quota ? Math.round((info.usage / info.quota) * 100) : null;
    mount(storageEl,
      h('dl', { class: 'meta-grid' },
        h('div', null, h('dt', null, 'Prises audio'), h('dd', null, `${info.takes} (${fmtBytes(info.audioBytes)})`)),
        h('div', null, h('dt', null, 'Révisions et réglages'), h('dd', null, fmtBytes(info.localBytes))),
        h('div', null, h('dt', null, 'Espace utilisé (estimation navigateur)'), h('dd', null, info.usage !== null ? `${fmtBytes(info.usage)}${pct !== null ? ` sur ${fmtBytes(info.quota)} (${pct} %)` : ''}` : 'non disponible')),
        h('div', null, h('dt', null, 'Stockage persistant'), h('dd', null, info.persisted === null ? 'inconnu' : info.persisted ? 'oui' : 'non (le navigateur peut l\'effacer en cas de manque d\'espace)'))),
      info.persisted === false && navigator.storage?.persist ? h('button', {
        class: 'btn btn-sm btn-secondary',
        onclick: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Stockage persistant accordé par le navigateur' : 'Le navigateur a refusé le stockage persistant', { type: ok ? 'success' : 'warning' }); paintStorage(); },
      }, icon('shield', 14), 'Demander un stockage persistant') : null);
  }

  function render() {
    const { settings, linguists } = service.snapshot();
    const save = (patch, msg = 'Paramètre enregistré') => service.saveSettings(patch).then(() => toast(msg));
    const section = (title, desc, ...body) => h('section', { class: 'card settings-section' }, h('header', { class: 'card-head' }, h('div', null, h('h3', null, title), desc && h('p', { class: 'muted tiny' }, desc))), ...body);
    const numberField = (label, key, step, help) => {
      const input = h('input', { class: 'input input-sm', type: 'number', step, value: settings.audio[key] });
      input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v)) save({ audio: { [key]: v } }); });
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, help && h('span', { class: 'field-help' }, help));
    };

    const projectName = h('input', { class: 'input', value: settings.projectName });
    projectName.addEventListener('change', () => save({ projectName: projectName.value.trim() || 'Atelier Afar' }, 'Nom du projet mis à jour'));

    const linguistSel = h('select', { class: 'input' }, linguists.map((l) => h('option', { value: l.id, selected: l.id === settings.activeLinguistId }, `${l.name} (${l.id})`)));
    linguistSel.addEventListener('change', () => save({ activeLinguistId: linguistSel.value }, 'Profil de linguiste actif modifié'));

    const scale = h('input', { type: 'range', min: 0.8, max: 1.6, step: 0.1, value: settings.textScale, 'aria-label': 'Taille du texte' });
    const scaleVal = h('span', { class: 'pill' }, `${Math.round(settings.textScale * 100)} %`);
    scale.addEventListener('input', () => { scaleVal.textContent = `${Math.round(scale.value * 100)} %`; document.documentElement.style.setProperty('--text-scale', scale.value); });
    scale.addEventListener('change', () => save({ textScale: Number(scale.value) }));

    const dialects = h('input', { class: 'input', value: settings.dialects.join(', ') });
    dialects.addEventListener('change', () => {
      const list = dialects.value.split(',').map((d) => d.trim()).filter(Boolean);
      if (list.length) save({ dialects: list }, 'Liste des dialectes mise à jour');
    });

    const toggle = (label, key, help) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: settings[key], onchange: (e) => save({ [key]: e.target.checked }) }),
      h('span', null, label, help && h('span', { class: 'field-help block' }, help)));

    function accountSection() {
      const m = service.member;
      return section('Mon compte', null,
        h('dl', { class: 'meta-grid' },
          h('div', null, h('dt', null, 'Nom'), h('dd', null, m.display_name)),
          h('div', null, h('dt', null, 'Adresse e-mail'), h('dd', null, m.email)),
          h('div', null, h('dt', null, 'Code linguiste'), h('dd', null, h('code', null, m.code))),
          h('div', null, h('dt', null, 'Rôle'), h('dd', null, m.role === 'admin' ? 'Administrateur' : 'Linguiste'))),
        h('p', { class: 'field-help' }, 'Le code linguiste est enregistré dans chaque révision (reviewer_id).'),
        h('div', { class: 'row-gap wrap', style: { marginTop: '12px' } },
          h('button', {
            class: 'btn btn-sm btn-secondary',
            onclick: async () => {
              const pw = await promptDialog({ title: 'Changer de mot de passe', label: 'Nouveau mot de passe (8 caractères minimum)', confirmLabel: 'Changer', required: true });
              if (!pw) return;
              if (pw.length < 8) { toast('Le mot de passe doit contenir au moins 8 caractères.', { type: 'warning' }); return; }
              try { await service.changePassword(pw); toast('Mot de passe modifié'); } catch (err) { toast(err.message, { type: 'error' }); }
            },
          }, icon('shield', 14), 'Changer de mot de passe'),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await service.signOut(); location.reload(); } }, 'Se déconnecter')));
    }

    function membersSection() {
      const { members } = service.snapshot();
      const email = h('input', { class: 'input input-sm', type: 'email', placeholder: 'adresse@exemple.com' });
      const name = h('input', { class: 'input input-sm', placeholder: 'Nom affiché' });
      const code = h('input', { class: 'input input-sm', placeholder: 'Code (ex. ling_02)' });
      const role = h('select', { class: 'input input-sm' }, h('option', { value: 'linguiste' }, 'Linguiste'), h('option', { value: 'admin' }, 'Administrateur'));
      const add = async () => {
        if (!/^\S+@\S+\.\S+$/.test(email.value.trim()) || !name.value.trim() || !/^[A-Za-z0-9_-]+$/.test(code.value.trim())) {
          toast('Renseignez une adresse e-mail valide, un nom et un code (lettres, chiffres, _ ou -).', { type: 'warning' });
          return;
        }
        try {
          await service.addMember({ email: email.value, display_name: name.value, code: code.value, role: role.value });
          toast('Membre autorisé. Créez maintenant son compte dans Supabase (voir l\'aide ci-dessous).', { duration: 8000 });
          render();
        } catch (err) { toast(err.message, { type: 'error' }); }
      };
      return section('Membres du projet', 'Seules les adresses listées ici peuvent voir et modifier les données.',
        h('ul', { class: 'member-list' }, members.map((m) => h('li', null,
          h('div', null, h('strong', null, m.display_name), ' ', h('span', { class: 'muted tiny' }, `${m.email} · ${m.code}`)),
          h('span', { class: 'row-gap' },
            h('span', { class: 'pill' }, m.role === 'admin' ? 'Administrateur' : 'Linguiste'),
            m.email !== service.member.email && h('button', {
              class: 'link-btn danger',
              onclick: async () => {
                if (!await confirmDialog({ title: 'Retirer ce membre ?', message: `${m.display_name} (${m.email}) n'aura plus accès aux données. Son travail déjà enregistré est conservé.`, confirmLabel: 'Retirer l\'accès', danger: true })) return;
                try { await service.removeMember(m.email); toast('Accès retiré'); render(); } catch (err) { toast(err.message, { type: 'error' }); }
              },
            }, 'Retirer'))))),
        h('div', { class: 'member-form' }, h('div', { class: 'grid-2' }, email, name, code, role),
          h('button', { class: 'btn btn-sm btn-primary', onclick: add }, icon('plus', 14), 'Autoriser ce membre')),
        h('p', { class: 'field-help' }, 'Étape 2 : dans le tableau de bord Supabase, ouvrez Authentication → Users → « Add user » → « Create new user », saisissez la même adresse et un mot de passe provisoire, cochez « Auto Confirm User », puis communiquez le mot de passe à la personne (elle pourra le changer dans « Mon compte »).'));
    }

    mount(container, h('div', { class: 'page-pad settings' },
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Paramètres'), h('p', { class: 'muted' }, 'Réglages enregistrés dans ce navigateur uniquement.'))),

      cloud
        ? callout('info', h('strong', null, 'Où sont mes données ? '), 'Révisions, annotations, glossaire, locuteurs, consentements et enregistrements sont stockés sur Supabase (Francfort, UE) et partagés entre les membres du projet. Seuls les réglages d\'affichage ci-dessous restent propres à ce navigateur.')
        : callout('info', h('strong', null, 'Où sont mes données ? '), 'Révisions, glossaire et réglages sont stockés dans le localStorage ; les enregistrements audio dans IndexedDB. Tout reste sur cet appareil : les données peuvent être perdues si vous effacez les données du site, utilisez la navigation privée ou changez d\'appareil. Exportez régulièrement votre travail.'),

      h('div', { class: 'settings-grid' },
        !cloud ? section('Projet et linguiste', null,
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nom du projet'), projectName),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Profil de linguiste actif'), linguistSel,
            h('span', { class: 'field-help' }, 'Sélection simulée, sans authentification. L\'identifiant est enregistré dans chaque révision (reviewer_id).')),
          h('button', {
            class: 'btn btn-sm btn-secondary',
            onclick: async () => {
              const name = await promptDialog({ title: 'Nouveau profil de linguiste', label: 'Nom', confirmLabel: 'Ajouter', required: true });
              if (!name) return;
              const l = await service.addLinguist(name);
              await service.saveSettings({ activeLinguistId: l.id });
              toast(`Profil « ${l.name} » créé et activé`);
              render();
            },
          }, icon('plus', 14), 'Ajouter un profil')) : null,
        cloud ? accountSection() : null,
        cloud && service.isAdmin ? membersSection() : null,
        section('Affichage et saisie', null,
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Taille du texte'), h('div', { class: 'row-gap' }, scale, scaleVal)),
          toggle('Afficher la palette de voyelles accentuées', 'accentPalette', `Boutons ${ACCENTED_VOWELS.join(' ')} sous les champs afar. Les caractères ne sont insérés que sur clic, jamais automatiquement.`),
          toggle('Compte à rebours de 3 secondes avant l\'enregistrement', 'countdown'),
          toggle('Afficher le français pendant l\'enregistrement (par défaut)', 'showFrenchWhileRecording'),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Dialectes proposés (séparés par des virgules)'), dialects,
            h('span', { class: 'field-help' }, 'Dénominations de démonstration, à confirmer avec le linguiste.'))),

        section('Seuils de qualité audio', 'Avertissements indicatifs : ils ne valident ni ne rejettent jamais une prise automatiquement.',
          h('div', { class: 'grid-2' },
            numberField('Saturation (crête, dBFS)', 'clipDbfs', 0.5, 'Avertir au-delà de ce niveau crête.'),
            numberField('Niveau trop faible (RMS, dBFS)', 'lowRmsDbfs', 1, 'Avertir en dessous de ce niveau moyen.'),
            numberField('Durée minimale (s)', 'minDuration', 0.5),
            numberField('Durée maximale (s)', 'maxDuration', 1),
            numberField('Bruit ambiant maximal (RMS, dBFS)', 'noiseWarnDbfs', 1, 'Utilisé par la mesure de 5 s de silence.'))),

        section('Exports', 'Les fichiers sont générés dans le navigateur et téléchargés.',
          h('div', { class: 'row-gap wrap' },
            h('button', { class: 'btn btn-primary', onclick: () => { exportRevisions(service, 'jsonl'); toast('revisions.jsonl téléchargé'); } }, icon('download', 15), 'Exporter le corpus FR–Afar'),
            h('button', { class: 'btn btn-secondary', onclick: () => { exportRevisions(service, 'csv'); toast('revisions.csv téléchargé'); } }, 'CSV'),
            h('button', { class: 'btn btn-teal', onclick: () => runTtsExport(service) }, icon('download', 15), 'Exporter le corpus TTS'))),

        section(cloud ? 'Stockage' : 'Stockage local', null, storageEl,
          (!cloud || service.isAdmin) && h('div', { class: 'danger-zone' },
            h('button', {
              class: 'btn btn-outline-warning',
              onclick: async () => {
                if (!await confirmDialog({ title: 'Réinitialiser les données de démonstration ?', message: (cloud ? 'Action partagée par tous les membres. ' : '') + 'Toutes les révisions, annotations et modifications du glossaire seront remplacées par le jeu de démonstration d\'origine (avec ses statuts simulés). Les locuteurs et les enregistrements audio sont conservés ; les prises liées à des traductions qui ne sont plus approuvées seront exclues des exports.', confirmLabel: 'Réinitialiser', danger: true })) return;
                try { await service.resetDemo(); } catch (err) { toast(err.message, { type: 'error' }); return; }
                toast('Données de démonstration réinitialisées');
                render();
              },
            }, icon('restore', 15), 'Réinitialiser les données de démonstration'),
            h('button', {
              class: 'btn btn-outline-danger',
              onclick: async () => {
                const n = service.snapshot().takes.length;
                if (!n) { toast('Aucun enregistrement local.', { type: 'info' }); return; }
                if (!await confirmDialog({ title: 'Supprimer tous les enregistrements ?', message: `Les ${n} prise(s) audio stockée(s) dans ce navigateur seront définitivement supprimées. Exportez d'abord le corpus TTS si nécessaire.`, confirmLabel: `Supprimer ${n} prise(s)`, danger: true })) return;
                try { await service.deleteAllTakes(); } catch (err) { toast(err.message, { type: 'error' }); return; }
                toast(cloud ? 'Enregistrements supprimés du serveur' : 'Enregistrements locaux supprimés');
                paintStorage();
              },
            }, icon('trash', 15), cloud ? 'Supprimer tous les enregistrements' : 'Supprimer les enregistrements locaux')))),

      h('p', { class: 'muted tiny' }, cloud
        ? `Mode : Supabase · ${fmtNumber(service.snapshot().segments.length)} segments (données de démonstration fictives).`
        : `Mode : démonstration locale · ${fmtNumber(service.snapshot().segments.length)} segments fictifs · aucun serveur connecté.`)));
    paintStorage();
  }

  render();
  return { onData(topic) { if (topic === 'takes') paintStorage(); }, unmount() {} };
}
