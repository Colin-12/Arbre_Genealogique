import { supabase } from "./supabase";

/**
 * Notifications sur l'appareil (Web Push). Ne marche que si la clé publique VAPID est configurée,
 * et sur iPhone seulement une fois l'appli ajoutée à l'écran d'accueil.
 */
export type PushState = "unconfigured" | "unsupported" | "needs-install" | "denied" | "off" | "on";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getPushState(): Promise<PushState> {
  if (!VAPID_PUBLIC) return "unconfigured";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Demande l'autorisation, abonne l'appareil et l'enregistre côté base. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Les notifications n'ont pas été autorisées. Tu peux les autoriser dans les réglages du navigateur, puis réessayer.");
  }
  await navigator.serviceWorker.register("/sw.js");
  const reg = await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe(options);
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Cet appareil n'a pas pu être enregistré pour les notifications.");
  const { error } = await supabase.rpc("save_push_subscription", { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
  if (error) throw new Error(/function .* does not exist|schema cache/i.test(error.message) ? "Les notifications ne sont pas encore installées côté base de données (migration 011)." : error.message);
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
}
