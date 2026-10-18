import { supabase } from "./supabase";
import { resizeToJpeg, signPhotoUrls } from "./photos";

const BUCKET = "photos";
/** Dimension maximale d'une photo de galerie (côté le plus long) : assez grand pour zoomer, environ 300 Ko. */
const GALLERY_SIDE = 1600;

export type GalleryPhoto = {
  id: string;
  path: string;
  caption: string | null;
  created_at: string;
  /** Identifiants des personnes identifiées sur la photo. */
  people: string[];
  /** Adresse temporaire pour afficher l'image (vide si elle n'a pas pu etre signée). */
  url: string;
};

export type Quota = { used: number; max: number };

function fail(message: string): never {
  if (/could not find the function|schema cache|PGRST202/i.test(message)) {
    throw new Error("La galerie n'est pas encore installée (migration 008 non lancée ?).");
  }
  if (/row-level security|permission denied/i.test(message)) throw new Error("Action refusée : tu n'as pas ce droit.");
  throw new Error(message);
}

/** Photos où la personne est identifiée, des plus récentes aux plus anciennes. */
export async function loadGallery(personId: string): Promise<GalleryPhoto[]> {
  const { data, error } = await supabase.rpc("person_gallery", { p_person: personId });
  if (error) fail(error.message);
  const rows = (Array.isArray(data) ? data : []) as Omit<GalleryPhoto, "url">[];
  const urls = await signPhotoUrls(rows.map((r) => r.path));
  return rows.map((r) => ({ ...r, url: urls.get(r.path) ?? "" }));
}

export async function loadQuota(treeId: string): Promise<Quota> {
  const { data, error } = await supabase.rpc("gallery_quota", { p_tree: treeId });
  if (error) fail(error.message);
  return data as Quota;
}

/** Réduit puis envoie une photo, et l'enregistre avec les personnes identifiées. */
export async function addGalleryPhoto(treeId: string, file: File, caption: string | null, people: string[]): Promise<void> {
  const blob = await resizeToJpeg(file, GALLERY_SIDE);
  const path = `${treeId}/gallery/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (up.error) {
    if (/row-level security|unauthorized|403/i.test(up.error.message)) throw new Error("Tu n'as pas le droit d'ajouter des photos à cet arbre.");
    throw new Error(up.error.message);
  }
  const { error } = await supabase.rpc("add_photo", { p_tree: treeId, p_path: path, p_caption: caption, p_people: people });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]); // pas de fichier orphelin
    fail(error.message);
  }
}

export async function setPhotoPeople(photoId: string, people: string[]): Promise<void> {
  const { error } = await supabase.rpc("set_photo_people", { p_photo: photoId, p_people: people });
  if (error) fail(error.message);
}

export async function setPhotoCaption(photoId: string, caption: string): Promise<void> {
  const { error } = await supabase.rpc("set_photo_caption", { p_photo: photoId, p_caption: caption });
  if (error) fail(error.message);
}

export async function deletePhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_photo", { p_photo: photoId });
  if (error) fail(error.message);
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET).remove([data]); // ménage, sans conséquence si échec
}
