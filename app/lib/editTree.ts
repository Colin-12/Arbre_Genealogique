import { supabase } from "./supabase";

export type Relation = "child" | "spouse" | "parent";
/** Ce que propose le menu « Ajouter » : un frère ou une sœur est un enfant des mêmes parents. */
export type AddKind = Relation | "sibling";
export type DatePrecision = "day" | "month" | "year" | "about";

/** Date saisie en trois champs texte (année seule, année + mois, ou date complète). */
export type PartialInput = { year: string; month: string; day: string };
export const EMPTY_DATE: PartialInput = { year: "", month: "", day: "" };

export type DbDate = { date: string | null; precision: DatePrecision | null };

/**
 * Convertit la saisie en (date, précision) pour la base.
 * Retourne une chaîne d'erreur en français si la saisie est incohérente.
 */
export function parsePartialDate(input: PartialInput, label: string): DbDate | string {
  const y = input.year.trim();
  const m = input.month.trim();
  const d = input.day.trim();
  if (!y && !m && !d) return { date: null, precision: null };
  if (!y) return `${label} : l'année est nécessaire.`;
  if (!/^\d{4}$/.test(y)) return `${label} : l'année doit avoir 4 chiffres.`;
  const year = Number(y);
  if (year < 1000 || year > new Date().getFullYear() + 1) return `${label} : année invraisemblable.`;
  if (!m) {
    if (d) return `${label} : choisis aussi le mois.`;
    return { date: `${y}-01-01`, precision: "year" };
  }
  const month = Number(m);
  if (!(month >= 1 && month <= 12)) return `${label} : mois invalide.`;
  const mm = String(month).padStart(2, "0");
  if (!d) return { date: `${y}-${mm}-01`, precision: "month" };
  const day = Number(d);
  const maxDay = new Date(year, month, 0).getDate();
  if (!Number.isInteger(day) || day < 1 || day > maxDay) return `${label} : jour invalide.`;
  return { date: `${y}-${mm}-${String(day).padStart(2, "0")}`, precision: "day" };
}

/** Informations de la fiche (facultatives). Une chaîne vide efface la valeur. */
export type PersonExtra = {
  birthName: string;
  birthPlace: string;
  deathPlace: string;
  notes: string;
};

export type NewPerson = {
  first: string;
  last: string;
  gender: "M" | "F";
  birth: DbDate;
  death: DbDate;
  /** Absent à l'ajout : les champs de la fiche ne sont alors pas touchés. */
  extra?: PersonExtra;
};

/** Longueur maximale du commentaire général. */
export const NOTES_MAX = 4000;

export type AddArgs = {
  treeId: string;
  anchorId: string;
  relation: Relation;
  /** Enfant : l'autre parent (null = inconnu). */
  otherId: string | null;
  /** Personne déjà présente dans l'arbre (choisie dans les suggestions), sinon null. */
  existingId: string | null;
  /** Nouvelle personne (ignorée si existingId est fourni). */
  person?: NewPerson;
};

/** Traduit les erreurs techniques de la base en messages lisibles. */
function friendly(message: string): string {
  if (message.includes("persons_check1")) return "La date de décès est antérieure à la date de naissance.";
  if (message.includes("persons_check")) return "Il faut au moins un prénom ou un nom.";
  if (message.includes("row-level security")) return "Tu n'as pas le droit de modifier cet arbre.";
  return message;
}

/** Ajoute une personne reliée à une autre. Retourne l'identifiant de la personne ajoutée. */
export async function addRelative(a: AddArgs): Promise<string> {
  const p = a.person;
  const { data, error } = await supabase.rpc("add_relative", {
    p_tree: a.treeId,
    p_anchor: a.anchorId,
    p_relation: a.relation,
    p_other: a.otherId,
    p_existing: a.existingId,
    p_first: a.existingId ? null : p?.first ?? null,
    p_last: a.existingId ? null : p?.last ?? null,
    p_gender: a.existingId ? null : p?.gender ?? null,
    p_birth: a.existingId ? null : p?.birth.date ?? null,
    p_birth_precision: a.existingId ? null : p?.birth.precision ?? null,
    p_death: a.existingId ? null : p?.death.date ?? null,
    p_death_precision: a.existingId ? null : p?.death.precision ?? null,
  });
  if (error) throw new Error(friendly(error.message));
  return String(data);
}

export type Suggestion = {
  id: string;
  first_names: string | null;
  last_name: string | null;
  birth_date: string | null;
  birth_precision: string | null;
  score: number;
};

/** Personnes de l'arbre qui ressemblent à ce qui est en train d'être saisi (sans tenir compte des accents). */
export async function suggestPersons(treeId: string, query: string): Promise<Suggestion[]> {
  const { data, error } = await supabase.rpc("suggest_persons", { p_tree: treeId, p_query: query, p_limit: 8 });
  if (error) throw new Error(error.message);
  return (data ?? []) as Suggestion[];
}

/** Texte partiel d'une personne ("1984", "1984-05", "1984-05-12") -> champs de saisie. */
export function toPartialInput(raw: unknown): PartialInput {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(raw ?? "").trim());
  if (!m) return { ...EMPTY_DATE };
  return { year: m[1], month: m[2] ? String(Number(m[2])) : "", day: m[3] ? String(Number(m[3])) : "" };
}

/** Valide la saisie d'une personne. Retourne la personne prête à enregistrer, ou un message d'erreur. */
export function buildPerson(
  first: string,
  last: string,
  gender: "" | "M" | "F",
  birth: PartialInput,
  deceased: boolean,
  death: PartialInput,
  extra?: PersonExtra
): NewPerson | string {
  if (!first.trim() && !last.trim()) return "Il faut au moins un prénom ou un nom.";
  if (!gender) return "Indique si c'est un homme ou une femme.";
  const b = parsePartialDate(birth, "Naissance");
  if (typeof b === "string") return b;
  const d = deceased ? parsePartialDate(death, "Décès") : { date: null, precision: null };
  if (typeof d === "string") return d;
  if (b.date && d.date && d.date < b.date) return "La date de décès est antérieure à la date de naissance.";
  if (extra && extra.notes.length > NOTES_MAX) return `Le commentaire est trop long (${NOTES_MAX} caractères au plus).`;
  return { first, last, gender, birth: b, death: d, extra };
}

/** Corrige les informations d'une personne. */
export async function updatePerson(id: string, p: NewPerson): Promise<void> {
  const { data, error } = await supabase
    .from("persons")
    .update({
      first_names: p.first.trim() || null,
      last_name: p.last.trim() || null,
      gender: p.gender,
      birth_date: p.birth.date,
      birth_precision: p.birth.precision,
      death_date: p.death.date,
      death_precision: p.death.precision,
      is_living: p.death.date ? false : null,
      ...(p.extra && {
        birth_last_name: p.extra.birthName.trim() || null,
        birth_place: p.extra.birthPlace.trim() || null,
        death_place: p.extra.deathPlace.trim() || null,
        notes: p.extra.notes.trim() || null,
      }),
    })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(friendly(error.message));
  if (!data || data.length === 0) throw new Error("Modification refusée : tu n'as pas le droit de modifier cet arbre.");
}

/** Retire un lien : 'parent' (détache la personne de son parent) ou 'spouse' (retire le couple). */
export async function removeRelation(treeId: string, personId: string, kind: "parent" | "spouse", otherId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_relation", {
    p_tree: treeId,
    p_person: personId,
    p_kind: kind,
    p_other: otherId,
  });
  if (error) throw new Error(friendly(error.message));
}

/** Suppression douce : la personne disparaît de l'arbre mais reste récupérable (restorePerson). */
async function setDeleted(id: string, deleted: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("persons")
    .update({ deleted_at: deleted ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(friendly(error.message));
  if (!data || data.length === 0) throw new Error("Action refusée : tu n'as pas le droit de modifier cet arbre.");
}
export const softDeletePerson = (id: string) => setDeleted(id, true);
export const restorePerson = (id: string) => setDeleted(id, false);
