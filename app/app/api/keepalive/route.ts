import { timingSafeEqual } from "node:crypto";

/**
 * Évite que Supabase mette le projet en pause pour inactivité (offre gratuite : pause après 7 jours sans activité).
 * Vercel appelle cette adresse une fois par jour (voir vercel.json) ; elle envoie une toute petite requête à la base.
 * Elle appelle la fonction keepalive() (migration 017), qui renvoie seulement l'heure du serveur : aucune donnée n'est lue ni modifiée.
 *
 * Protégée par CRON_SECRET (à renseigner dans Vercel) : Vercel l'envoie tout seul dans l'en-tête Authorization.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json({ ok: false, error: "CRON_SECRET manquant ou trop court" }, { status: 503 });
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, error: "Configuration Supabase manquante" }, { status: 503 });
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/keepalive`, {
      method: "POST",
      // La clé publique va seulement dans « apikey » : les nouvelles clés Supabase ne sont pas des jetons et sont refusées dans « Authorization »
      headers: { apikey: key, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`keepalive : Supabase a répondu ${res.status}`);
      return Response.json({ ok: false, status: res.status }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error(`keepalive : Supabase injoignable (${e instanceof Error ? e.name : "erreur"})`);
    return Response.json({ ok: false, error: "Supabase ne répond pas" }, { status: 502 });
  }
}
