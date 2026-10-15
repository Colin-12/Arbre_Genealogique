import type { Datum } from "family-chart";

/** Nombre maximum de personnes gardées dans le fil d'Ariane. */
export const MAX_TRAIL = 8;

export function plainName(d: Datum | undefined): string {
  if (!d) return "?";
  const name = `${d.data["first name"] ?? ""} ${d.data["last name"] ?? ""}`.trim();
  return name || "Sans nom";
}

/** Parents connus d'une personne (dans l'ordre du fichier de données). */
export function parentsOf(data: Datum[], id: string): Datum[] {
  const person = data.find((d) => d.id === id);
  if (!person) return [];
  return person.rels.parents
    .map((pid) => data.find((d) => d.id === pid))
    .filter((d): d is Datum => Boolean(d));
}

/**
 * Calcule le nouveau fil d'Ariane quand on se rend sur la personne `id`.
 * - reset : on repart de zéro (retour à la vue initiale)
 * - personne déjà dans le fil : on revient à sa position (on coupe ce qui suit)
 * - sinon : on l'ajoute à la fin, en gardant les MAX_TRAIL dernières
 */
export function nextTrail(trail: string[], id: string, reset = false): string[] {
  if (reset) return [id];
  const i = trail.indexOf(id);
  if (i !== -1) return trail.slice(0, i + 1);
  return [...trail, id].slice(-MAX_TRAIL);
}
