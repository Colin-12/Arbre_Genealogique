import { timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import webpush from "web-push";

/**
 * Appelée par la base de données (Supabase) quand quelqu'un demande l'accès à un arbre.
 * Envoie un e-mail et une notification sur le téléphone aux propriétaires de l'arbre.
 *
 * Protégée par un secret partagé (en-tête x-notify-secret) : sans lui, personne ne peut faire envoyer de message.
 * Variables d'environnement (à renseigner dans Vercel, jamais dans le dépôt) :
 *   NOTIFY_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
 * Facultatives : VAPID_SUBJECT, APP_URL.
 */

type Recipient = { email: string };
type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type Payload = {
  treeName: string;
  requesterName: string;
  requesterEmail: string;
  message: string;
  recipients: Recipient[];
  subscriptions: Subscription[];
};

const EMAIL = /^[^\s@<>,;()]+@[^\s@<>,;()]+\.[^\s@<>,;()]{2,}$/;

const clean = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, max);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vérifie la forme du message reçu et en garde seulement les champs attendus, tronqués. */
function parse(body: unknown): Payload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.kind !== "access_request") return null;

  const recipients: Recipient[] = [];
  if (Array.isArray(b.recipients)) {
    for (const r of b.recipients.slice(0, 5)) {
      const email = clean((r as Record<string, unknown>)?.email, 200);
      if (EMAIL.test(email)) recipients.push({ email });
    }
  }
  const subscriptions: Subscription[] = [];
  if (Array.isArray(b.subscriptions)) {
    for (const s of b.subscriptions.slice(0, 10)) {
      const o = s as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
      const endpoint = typeof o?.endpoint === "string" ? o.endpoint : "";
      const p256dh = typeof o?.keys?.p256dh === "string" ? o.keys.p256dh : "";
      const auth = typeof o?.keys?.auth === "string" ? o.keys.auth : "";
      if (endpoint.startsWith("https://") && endpoint.length <= 1000 && p256dh && auth) {
        subscriptions.push({ endpoint, keys: { p256dh, auth } });
      }
    }
  }
  return {
    treeName: clean(b.tree_name, 100) || "l'arbre",
    requesterName: clean(b.requester_name, 100) || "Quelqu'un",
    requesterEmail: clean(b.requester_email, 200),
    message: clean(b.message, 300),
    recipients,
    subscriptions,
  };
}

async function sendEmails(p: Payload, appUrl: string): Promise<{ sent: number; failed: number }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass || p.recipients.length === 0) return { sent: 0, failed: 0 };

  const host = process.env.SMTP_HOST; // réservé aux tests : un serveur SMTP local
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport(
    host ? { host, port, secure: false, ignoreTLS: true, auth: { user, pass } } : { host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } }
  );

  const who = p.requesterEmail ? `${p.requesterName} (${p.requesterEmail})` : p.requesterName;
  const subject = `Demande d'accès à « ${p.treeName} »`;
  const text = [
    "Bonjour,",
    "",
    `${who} demande à rejoindre l'arbre « ${p.treeName} ».`,
    ...(p.message ? ["", `Son message : « ${p.message} »`] : []),
    "",
    "Pour répondre, ouvre l'appli, touche « Inviter » puis « Demandes d'accès » :",
    appUrl,
  ].join("\n");
  const html =
    `<p>Bonjour,</p>` +
    `<p><strong>${escapeHtml(p.requesterName)}</strong>${p.requesterEmail ? ` (${escapeHtml(p.requesterEmail)})` : ""} demande à rejoindre l'arbre « ${escapeHtml(p.treeName)} ».</p>` +
    (p.message ? `<p>Son message : « ${escapeHtml(p.message)} »</p>` : "") +
    `<p>Pour répondre, ouvre l'appli, touche « Inviter » puis « Demandes d'accès » :</p>` +
    `<p><a href="${escapeHtml(appUrl)}">Ouvrir l'arbre généalogique</a></p>`;

  const results = await Promise.allSettled(
    p.recipients.map((r) => transport.sendMail({ from: `Arbre généalogique <${user}>`, to: r.email, subject, text, html }))
  );
  const failed = results.filter((r) => r.status === "rejected");
  failed.forEach((r) => console.error("notify: e-mail non envoyé :", (r as PromiseRejectedResult).reason?.message ?? "erreur"));
  return { sent: results.length - failed.length, failed: failed.length };
}

async function sendPushes(p: Payload, appUrl: string): Promise<{ sent: number; failed: number }> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey || p.subscriptions.length === 0) return { sent: 0, failed: 0 };

  const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.GMAIL_USER ?? "contact@example.com"}`;
  const body = JSON.stringify({
    title: "Demande d'accès",
    body: `${p.requesterName} veut rejoindre « ${p.treeName} »`,
    url: appUrl,
    tag: "access-request",
  });
  const results = await Promise.allSettled(
    p.subscriptions.map((s) => webpush.sendNotification(s, body, { vapidDetails: { subject, publicKey, privateKey }, TTL: 3 * 24 * 3600 }))
  );
  const failed = results.filter((r) => r.status === "rejected");
  failed.forEach((r) => {
    const reason = (r as PromiseRejectedResult).reason as { statusCode?: number; message?: string };
    console.error("notify: notification non envoyée :", reason?.statusCode ?? "", reason?.message ?? "erreur");
  });
  return { sent: results.length - failed.length, failed: failed.length };
}

export async function POST(req: Request) {
  const expected = process.env.NOTIFY_SECRET;
  if (!expected || expected.length < 16) {
    return Response.json({ error: "Notifications non configurées." }, { status: 503 });
  }
  if (!secretMatches(req.headers.get("x-notify-secret"), expected)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Message illisible." }, { status: 400 });
  }
  const payload = parse(json);
  if (!payload) return Response.json({ error: "Message invalide." }, { status: 400 });

  const appUrl = process.env.APP_URL || new URL(req.url).origin;
  const [email, push] = await Promise.all([sendEmails(payload, appUrl), sendPushes(payload, appUrl)]);
  return Response.json({ email, push });
}
