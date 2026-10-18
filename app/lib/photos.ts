import { supabase } from "./supabase";

const BUCKET = "photos";
/** Durée de validité des adresses signées (secondes) : 6 h, plus longue qu'une séance d'usage. */
const SIGNED_SECONDS = 6 * 3600;
/** On réutilise une adresse signée tant qu'il lui reste au moins 1 h (évite de recharger les images). */
const REUSE_MS = (SIGNED_SECONDS - 3600) * 1000;
/** Taille maximale du fichier choisi (avant réduction) et dimension de la photo enregistrée. */
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_SIDE = 900;
const JPEG_QUALITY = 0.8;

const signed = new Map<string, { url: string; at: number }>();

/** Adresses temporaires (signées) pour afficher des photos du stockage privé. Ne lève jamais d'erreur. */
export async function signPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const missing: string[] = [];
  for (const p of new Set(paths)) {
    const hit = signed.get(p);
    if (hit && now - hit.at < REUSE_MS) out.set(p, hit.url);
    else missing.push(p);
  }
  if (missing.length > 0) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(missing, SIGNED_SECONDS);
      if (!error) {
        for (const row of data ?? []) {
          if (row.path && row.signedUrl) {
            signed.set(row.path, { url: row.signedUrl, at: now });
            out.set(row.path, row.signedUrl);
          }
        }
      }
    } catch {
      // Sans adresse, la personne s'affiche simplement sans photo
    }
  }
  return out;
}

/** Charge l'image choisie en tenant compte de l'orientation (photos de téléphone). */
async function loadBitmap(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // repli ci-dessous
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Réduit la photo (900 px au plus) et la convertit en JPEG léger (environ 100 Ko). */
export async function resizeToJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une image.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Cette image est trop lourde (30 Mo au plus).");
  let bmp;
  try {
    bmp = await loadBitmap(file);
  } catch {
    throw new Error("Impossible de lire cette image (format non pris en charge ?).");
  }
  try {
    const ratio = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * ratio));
    const h = Math.max(1, Math.round(bmp.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Impossible de traiter cette image.");
    ctx.fillStyle = "#fff"; // fond blanc pour les PNG transparents
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp.source, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("Impossible de traiter cette image.");
    return blob;
  } finally {
    bmp.close();
  }
}

function friendlyStorage(message: string): string {
  if (/row-level security|violates|not authorized|unauthorized|403/i.test(message)) return "Tu n'as pas le droit de modifier les photos de cet arbre.";
  if (/bucket not found|not found/i.test(message)) return "Le stockage des photos n'est pas configuré (migration 005 non lancée ?).";
  if (/exceeded|too large|payload/i.test(message)) return "Cette photo est trop lourde.";
  return message;
}

/** Enregistre (ou remplace) la photo d'une personne. Retourne le nouveau chemin. */
export async function setPersonPhoto(treeId: string, personId: string, blob: Blob, previousPath: string | null): Promise<string> {
  const path = `${treeId}/${personId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (up.error) throw new Error(friendlyStorage(up.error.message));

  const { data, error } = await supabase.from("persons").update({ photo_path: path }).eq("id", personId).select("id");
  if (error || !data || data.length === 0) {
    await supabase.storage.from(BUCKET).remove([path]); // on ne laisse pas de fichier orphelin
    throw new Error(error ? friendlyStorage(error.message) : "Modification refusée : tu n'as pas le droit de modifier cet arbre.");
  }
  if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]); // ménage, sans conséquence si échec
  return path;
}

/** Retire la photo d'une personne. */
export async function removePersonPhoto(personId: string, previousPath: string): Promise<void> {
  const { data, error } = await supabase.from("persons").update({ photo_path: null }).eq("id", personId).select("id");
  if (error) throw new Error(friendlyStorage(error.message));
  if (!data || data.length === 0) throw new Error("Modification refusée : tu n'as pas le droit de modifier cet arbre.");
  await supabase.storage.from(BUCKET).remove([previousPath]);
}
