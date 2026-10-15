import type { Datum } from "family-chart";

/**
 * Clé de tri pour une date partielle : "1982", "1982-05" ou "1982-05-12".
 * Retourne null si la date est absente ou illisible.
 */
export function birthKey(d: Datum): number | null {
  const raw = String(d.data["birthday"] ?? "").trim();
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2] ?? 0);
  const day = Number(m[3] ?? 0);
  return year * 10000 + month * 100 + day;
}

/**
 * Tri des frères et soeurs : du plus âgé au plus jeune (de gauche à droite).
 * - date connue avant date inconnue
 * - si les deux dates sont inconnues, ordre manuel (data.sibling_order), sinon ordre d'origine
 */
export function sortSiblings(a: Datum, b: Datum): number {
  const ka = birthKey(a);
  const kb = birthKey(b);

  if (ka !== null && kb !== null) return ka - kb;
  if (ka !== null) return -1;
  if (kb !== null) return 1;

  const oa = Number(a.data["sibling_order"] ?? Number.MAX_SAFE_INTEGER);
  const ob = Number(b.data["sibling_order"] ?? Number.MAX_SAFE_INTEGER);
  return oa === ob ? 0 : oa - ob;
}

/** Échappe le texte avant de l'insérer dans les cartes (qui sont du HTML brut). */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fullName(d: Datum): string {
  const first = esc(d.data["first name"]);
  const last = esc(d.data["last name"]);
  return `${first} ${last}`.trim() || "Sans nom";
}

/**
 * Ligne de vie : "1955" ou "1928 - 2004", avec l'âge calculé.
 * Ne gère que l'année pour l'instant (suffisant tant que les dates sont partielles).
 */
export function lifeLine(d: Datum, today: Date = new Date()): string {
  const birth = yearOf(d.data["birthday"]);
  const death = yearOf(d.data["deathday"]);

  if (birth === null) return death !== null ? `† ${death}` : "";

  if (death !== null) {
    return `${birth} - ${death} (${death - birth} ans)`;
  }
  return `${birth} (${today.getFullYear() - birth} ans)`;
}

function yearOf(raw: unknown): number | null {
  const m = /^(\d{4})/.exec(String(raw ?? "").trim());
  return m ? Number(m[1]) : null;
}
