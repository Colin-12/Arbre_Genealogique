import type { Datum } from "family-chart";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

type Parts = { y: number; m: number | null; d: number | null };

function parts(raw: unknown): Parts | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(raw ?? "").trim());
  if (!m) return null;
  return { y: Number(m[1]), m: m[2] ? Number(m[2]) : null, d: m[3] ? Number(m[3]) : null };
}

/** "1984-05-12" -> "12 mai 1984", "1984-05" -> "mai 1984", "1984" -> "1984". */
export function formatPartialDate(raw: unknown): string {
  const p = parts(raw);
  if (!p) return "";
  if (p.m && p.d) return `${p.d === 1 ? "1er" : p.d} ${MONTHS[p.m - 1]} ${p.y}`;
  if (p.m) return `${MONTHS[p.m - 1]} ${p.y}`;
  return String(p.y);
}

/** Texte d'âge pour la fiche : exact si le jour de naissance est connu, sinon "environ". */
export function ageText(person: Datum, today: Date = new Date()): string {
  const b = parts(person.data["birthday"]);
  if (!b) return "";
  const dead = parts(person.data["deathday"]);
  const end: Parts = dead ?? { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };

  const exact = Boolean(b.m && b.d && end.m && end.d);
  let age = end.y - b.y;
  if (exact && (end.m! < b.m! || (end.m === b.m && end.d! < b.d!))) age -= 1;
  if (age < 0) return "";

  const unit = age > 1 ? "ans" : "an";
  const value = `${age} ${unit}`;
  const text = exact ? value : `environ ${value}`;
  return dead ? `${text} au décès` : text;
}
