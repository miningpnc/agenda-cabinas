// Supabase Edge Function «enviar-aviso»
// Cuando se crea un aviso (cita nueva, cambiada o cancelada) envía:
//   · una notificación push a los móviles del destinatario
//   · un correo (si están configurados BREVO_API_KEY y EMAIL_FROM)
// La llama el Database Webhook de la tabla «avisos» con la cabecera x-aviso-secreto.
// También admite {"prueba": true} desde la app para enviarte un aviso de prueba a ti.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:avisos@example.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aviso-secreto",
};
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function enviar(userIds: string[], emails: string[], titulo: string, texto: string, tag: string) {
  const appUrl = Deno.env.get("APP_URL") ?? "";
  let push = 0, correos = 0;
  if (userIds.length) {
    const { data: subs } = await sb.from("suscripciones_push").select("id,datos").in("user_id", userIds);
    const payload = JSON.stringify({ title: titulo, body: texto, tag, url: appUrl || "./" });
    for (const s of subs ?? []) {
      try { await webpush.sendNotification(s.datos, payload, { TTL: 86400, urgency: "high" }); push++; }
      catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("suscripciones_push").delete().eq("id", s.id); // móvil que ya no existe
      }
    }
  }
  const key = Deno.env.get("BREVO_API_KEY"), from = Deno.env.get("EMAIL_FROM");
  const destino = [...new Set(emails.filter(Boolean))];
  if (key && from && destino.length) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: Deno.env.get("EMAIL_NOMBRE") ?? "Agenda" },
        to: destino.map((email) => ({ email })),
        subject: `${titulo} · Agenda`,
        htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17213a">
          <h2 style="margin:0 0 8px">${esc(titulo)}</h2><p>${esc(texto)}</p>
          ${appUrl ? `<p><a href="${esc(appUrl)}" style="background:#24406f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir la agenda</a></p>` : ""}
          <p style="color:#5a6680;font-size:13px">Abre la agenda y pulsa «Recibido» para confirmar que lo has visto.</p></div>`,
      }),
    });
    if (r.ok) correos = destino.length; else console.error("Brevo", r.status, await r.text());
  }
  return { push, correos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));

  // Aviso de prueba pedido desde la app por el propio usuario
  if (body.prueba) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = await sb.auth.getUser(token);
    if (!data?.user) return new Response("Sin sesión", { status: 401, headers: cors });
    const r = await enviar([data.user.id], body.correo ? [data.user.email ?? ""] : [], "Aviso de prueba",
      "Si ves esto, los avisos llegan a este dispositivo.", "prueba");
    return Response.json(r, { headers: cors });
  }

  // Llamada del webhook de la tabla «avisos»
  if (req.headers.get("x-aviso-secreto") !== Deno.env.get("AVISO_SECRETO")) {
    return new Response("No autorizado", { status: 401, headers: cors });
  }
  const a = body.record;
  if (!a?.id) return new Response("Sin aviso", { status: 400, headers: cors });

  const { data: perfiles } = a.para_rol === "trabajador"
    ? await sb.from("perfiles").select("user_id,email").eq("trabajador_id", a.para_trabajador_id)
    : await sb.from("perfiles").select("user_id,email").eq("rol", "recepcion");
  const ids = (perfiles ?? []).map((p) => p.user_id);
  let emails = (perfiles ?? []).map((p) => p.email ?? "");
  if (a.para_rol === "trabajador" && !emails.some(Boolean)) {
    const { data: t } = await sb.from("trabajadores").select("email").eq("id", a.para_trabajador_id).maybeSingle();
    if (t?.email) emails = [t.email];
  }
  const titulo = a.tipo === "nueva" ? "Nueva cita" : a.tipo === "cancelada" ? "Cita cancelada" : "Cita modificada";
  const r = await enviar(ids, emails, titulo, a.mensaje, "aviso-" + a.id);
  const ahora = new Date().toISOString();
  await sb.from("avisos").update({
    enviado_push_en: r.push ? ahora : null,
    enviado_email_en: r.correos ? ahora : null,
  }).eq("id", a.id);
  return Response.json(r, { headers: cors });
});
