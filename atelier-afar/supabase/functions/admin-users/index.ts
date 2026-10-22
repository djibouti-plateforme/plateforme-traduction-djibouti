// Comptes de l'atelier : invitations, activation, mot de passe oublié, suppression.
// Actions administrateur (session admin requise) : invite, resend, reset_link, delete.
// Actions publiques (jeton à usage unique) : check_token, activate, request_reset.
// Les e-mails partent via Brevo si les secrets BREVO_API_KEY et MAIL_SENDER sont définis ;
// sinon le lien est renvoyé à l'administrateur pour qu'il le transmette lui-même.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BREVO_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const MAIL_SENDER = Deno.env.get("MAIL_SENDER") ?? "";
const MAIL_SENDER_NAME = Deno.env.get("MAIL_SENDER_NAME") ?? "Atelier Afar";
const INVITE_DAYS = 7;
const RESET_HOURS = 24;
// Les liens ne peuvent pointer que vers l'atelier lui-même.
const ALLOWED_SITES = [/^https:\/\/djibouti-plateforme\.github\.io\/plateforme-traduction-djibouti\/atelier-afar\/$/, /^http:\/\/localhost:\d+\/$/];
const DEFAULT_SITE = "https://djibouti-plateforme.github.io/plateforme-traduction-djibouti/atelier-afar/";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Crée un lien à usage unique (les anciens liens du même type deviennent invalides). */
async function createLink(email: string, purpose: "invite" | "reset", site: string, by: string | null) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const ms = purpose === "invite" ? INVITE_DAYS * 86400e3 : RESET_HOURS * 3600e3;
  await service.from("member_invites").update({ used_at: new Date().toISOString() }).eq("email", email).eq("purpose", purpose).is("used_at", null);
  const { error } = await service.from("member_invites").insert({ email, token_hash: await sha256(token), purpose, expires_at: new Date(Date.now() + ms).toISOString(), created_by: by });
  if (error) throw error;
  return { link: `${site}?${purpose === "invite" ? "invitation" : "reinitialisation"}=${token}`, expires: purpose === "invite" ? `${INVITE_DAYS} jours` : `${RESET_HOURS} heures` };
}

async function sendMail(to: string, name: string, purpose: "invite" | "reset", link: string, expires: string): Promise<boolean> {
  if (!BREVO_KEY || !MAIL_SENDER) return false;
  const invite = purpose === "invite";
  const subject = invite ? "Votre accès à l'Atelier Afar" : "Réinitialisation de votre mot de passe — Atelier Afar";
  const intro = invite
    ? "Un compte a été créé pour vous sur l'Atelier Afar, la plateforme de révision des traductions français–afar et d'enregistrement vocal."
    : "Une réinitialisation du mot de passe de votre compte Atelier Afar a été demandée. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.";
  const action = invite ? "Activer mon compte" : "Choisir un nouveau mot de passe";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#13294b;color:#ffffff;padding:20px 28px;font-size:18px;font-weight:bold">Atelier Afar</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 14px">Bonjour ${esc(name)},</p>
<p style="margin:0 0 22px;line-height:1.5">${intro}</p>
<p style="margin:0 0 26px"><a href="${link}" style="display:inline-block;background:#0f9f94;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:bold">${action}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#64748b">Ce lien est personnel et valable ${expires}. Identifiant de connexion : ${esc(to)}</p>
<p style="margin:0;font-size:12px;color:#94a3b8;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${link}</p>
</td></tr></table></td></tr></table></body></html>`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: MAIL_SENDER, name: MAIL_SENDER_NAME }, to: [{ email: to, name }], subject, htmlContent: html }),
  });
  if (!res.ok) console.error("Brevo", res.status, await res.text());
  return res.ok;
}

async function tokenRow(token: string) {
  if (!token || token.length < 20) return null;
  const { data } = await service.from("member_invites").select("*").eq("token_hash", await sha256(token)).maybeSingle();
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }
  const action = String(body.action ?? "");
  const site = ALLOWED_SITES.some((re) => re.test(String(body.site ?? ""))) ? String(body.site) : DEFAULT_SITE;

  try {
    // ---------- Actions publiques ----------
    if (action === "check_token" || action === "activate") {
      const row = await tokenRow(String(body.token ?? ""));
      if (!row) return json({ error: "Ce lien n'est plus valide (déjà utilisé ou expiré). Demandez un nouveau lien." }, 410);
      const { data: member } = await service.from("members").select("email, display_name").eq("email", row.email).maybeSingle();
      if (!member) return json({ error: "Ce compte n'existe plus." }, 410);
      if (action === "check_token") return json({ email: member.email, display_name: member.display_name, purpose: row.purpose });

      const password = String(body.password ?? "");
      const display_name = String(body.display_name ?? "").trim() || member.display_name;
      if (password.length < 8) return json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400);
      const mu = await service.from("members").update({ display_name, activated_at: new Date().toISOString() }).eq("email", row.email);
      if (mu.error) throw mu.error;
      // Membre autorisé sans compte de connexion (ajout manuel) : le compte est créé à l'activation.
      const id = await findUserId(row.email);
      const up = id
        ? await service.auth.admin.updateUserById(id, { password, email_confirm: true, user_metadata: { display_name } })
        : await service.auth.admin.createUser({ email: row.email, password, email_confirm: true, user_metadata: { display_name } });
      if (up.error) throw up.error;
      const used = await service.from("member_invites").update({ used_at: new Date().toISOString() }).eq("id", row.id);
      if (used.error) throw used.error;
      return json({ ok: true, email: row.email });
    }

    if (action === "request_reset") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const { data: member } = await service.from("members").select("email, display_name, activated_at").eq("email", email).maybeSingle();
      // Réponse identique que le compte existe ou non (pas de divulgation des adresses).
      if (!member || !BREVO_KEY || !MAIL_SENDER) return json({ ok: true, mail: !!(BREVO_KEY && MAIL_SENDER) });
      const { data: recent } = await service.from("member_invites").select("created_at").eq("email", email).eq("purpose", "reset")
        .gte("created_at", new Date(Date.now() - 120e3).toISOString()).limit(1);
      if (recent?.length) return json({ ok: true, mail: true });
      const purpose = member.activated_at ? "reset" : "invite";
      const { link, expires } = await createLink(email, purpose, site, null);
      await sendMail(email, member.display_name, purpose, link, expires);
      return json({ ok: true, mail: true });
    }

    // ---------- Actions administrateur ----------
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await service.auth.getUser(jwt);
    const callerEmail = who?.user?.email?.toLowerCase();
    if (!callerEmail) return json({ error: "Session invalide : reconnectez-vous." }, 401);
    const { data: caller } = await service.from("members").select("role, code").eq("email", callerEmail).maybeSingle();
    if (caller?.role !== "admin") return json({ error: "Réservé aux administrateurs." }, 403);

    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Adresse e-mail invalide." }, 400);

    if (action === "invite") {
      const display_name = String(body.display_name ?? "").trim();
      const code = String(body.code ?? "").trim();
      const role = body.role === "admin" ? "admin" : "linguiste";
      if (!display_name || !/^[A-Za-z0-9_-]+$/.test(code)) return json({ error: "Nom ou code invalide." }, 400);
      // Compte créé avec un mot de passe aléatoire inconnu de tous : la personne choisit le sien via le lien.
      const created = await service.auth.admin.createUser({ email, password: b64url(crypto.getRandomValues(new Uint8Array(24))), email_confirm: true, user_metadata: { display_name } });
      if (created.error) {
        const msg = /already|registered|exists/i.test(created.error.message) ? "Un compte existe déjà avec cette adresse." : created.error.message;
        return json({ error: msg }, 409);
      }
      const ins = await service.from("members").insert({ email, display_name, code, role, activated_at: null });
      if (ins.error) {
        await service.auth.admin.deleteUser(created.data.user.id);
        const msg = /duplicate|unique/i.test(ins.error.message) ? "Ce code linguiste ou cette adresse est déjà utilisé." : ins.error.message;
        return json({ error: msg }, 409);
      }
      const { link, expires } = await createLink(email, "invite", site, caller.code);
      const mailed = await sendMail(email, display_name, "invite", link, expires);
      return json({ ok: true, member: { email, display_name, code, role, activated_at: null }, mailed, link: mailed ? null : link, expires });
    }

    if (action === "resend" || action === "reset_link") {
      const { data: member } = await service.from("members").select("display_name, activated_at").eq("email", email).maybeSingle();
      if (!member) return json({ error: "Membre introuvable." }, 404);
      const purpose = action === "resend" || !member.activated_at ? "invite" : "reset";
      const { link, expires } = await createLink(email, purpose, site, caller.code);
      const mailed = await sendMail(email, member.display_name, purpose, link, expires);
      return json({ ok: true, mailed, link: mailed ? null : link, expires, purpose });
    }

    if (action === "delete") {
      if (email === callerEmail) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      const { data: m } = await service.from("members").select("code").eq("email", email).maybeSingle();
      if (m) await service.from("segment_locks").delete().eq("member_code", m.code);
      await service.from("member_invites").delete().eq("email", email);
      const del = await service.from("members").delete().eq("email", email);
      if (del.error) throw del.error;
      const id = await findUserId(email);
      if (id) {
        const r = await service.auth.admin.deleteUser(id);
        if (r.error) throw r.error;
      }
      return json({ ok: true });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message ?? "Erreur interne." }, 500);
  }
});
