// Gestion des comptes linguistes, réservée aux administrateurs de l'atelier.
// Actions : create (compte + membre), delete (compte + membre), reset_password.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  // Identité de l'appelant (jeton de session) et droit administrateur.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await service.auth.getUser(token);
  if (whoErr || !who?.user?.email) return json({ error: "Session invalide : reconnectez-vous." }, 401);
  const callerEmail = who.user.email.toLowerCase();
  const { data: caller } = await service.from("members").select("role").eq("email", callerEmail).maybeSingle();
  if (caller?.role !== "admin") return json({ error: "Réservé aux administrateurs." }, 403);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Adresse e-mail invalide." }, 400);

  try {
    if (body.action === "create") {
      const display_name = String(body.display_name ?? "").trim();
      const code = String(body.code ?? "").trim();
      const role = body.role === "admin" ? "admin" : "linguiste";
      const password = String(body.password ?? "");
      if (!display_name || !/^[A-Za-z0-9_-]+$/.test(code)) return json({ error: "Nom ou code invalide." }, 400);
      if (password.length < 8) return json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400);
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name } });
      if (created.error) {
        const msg = /already|registered|exists/i.test(created.error.message) ? "Un compte existe déjà avec cette adresse." : created.error.message;
        return json({ error: msg }, 409);
      }
      const ins = await service.from("members").insert({ email, display_name, code, role });
      if (ins.error) {
        await service.auth.admin.deleteUser(created.data.user.id);
        const msg = /duplicate|unique/i.test(ins.error.message) ? "Ce code linguiste ou cette adresse est déjà utilisé." : ins.error.message;
        return json({ error: msg }, 409);
      }
      return json({ ok: true, member: { email, display_name, code, role } });
    }

    if (body.action === "delete") {
      if (email === callerEmail) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      await service.from("segment_locks").delete().in("member_code",
        (await service.from("members").select("code").eq("email", email)).data?.map((m) => m.code) ?? []);
      const del = await service.from("members").delete().eq("email", email);
      if (del.error) throw del.error;
      const id = await findUserId(email);
      if (id) {
        const r = await service.auth.admin.deleteUser(id);
        if (r.error) throw r.error;
      }
      return json({ ok: true });
    }

    if (body.action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400);
      const id = await findUserId(email);
      if (!id) return json({ error: "Compte introuvable." }, 404);
      const r = await service.auth.admin.updateUserById(id, { password });
      if (r.error) throw r.error;
      return json({ ok: true });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? "Erreur interne." }, 500);
  }
});
