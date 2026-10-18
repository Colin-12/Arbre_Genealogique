import type { Datum } from "family-chart";
import { supabase } from "./supabase";
import { signPhotoUrls } from "./photos";

export type PersonRow = {
  id: string;
  first_names: string | null;
  last_name: string | null;
  gender: string | null;
  birth_date: string | null;
  birth_precision: string | null;
  death_date: string | null;
  death_precision: string | null;
  sibling_order: number | null;
  birth_last_name: string | null;
  birth_place: string | null;
  death_place: string | null;
  notes: string | null;
  photo_path: string | null;
};
export type UnionRow = { id: string; partner_a: string; partner_b: string | null };
export type FiliationRow = { child_id: string; union_id: string };

/** Date de la base ("1982-01-01") + précision -> texte partiel ("1982", "1982-05", "1982-05-12"). */
export function partialDate(date: string | null, precision: string | null): string {
  if (!date) return "";
  const [y, m] = date.split("-");
  if (precision === "day") return date;
  if (precision === "month") return `${y}-${m}`;
  return y; // "year" et "about" : l'année seule
}

function addUnique(list: string[], id: string) {
  if (!list.includes(id)) list.push(id);
}

/**
 * Transforme les lignes de la base (personnes, couples, filiations) dans le format attendu
 * par family-chart : pour chaque personne, ses parents, conjoints et enfants.
 */
export function buildDatums(persons: PersonRow[], unions: UnionRow[], filiations: FiliationRow[]): Datum[] {
  const byId = new Map<string, Datum>();
  for (const p of persons) {
    byId.set(p.id, {
      id: p.id,
      data: {
        // family-chart ne connaît que M et F. A faire : un rendu neutre pour "X" / inconnu.
        gender: (p.gender === "M" ? "M" : "F") as "M" | "F",
        "first name": p.first_names ?? "",
        "last name": p.last_name ?? "",
        birthday: partialDate(p.birth_date, p.birth_precision),
        deathday: partialDate(p.death_date, p.death_precision),
        sibling_order: p.sibling_order ?? undefined,
        // Informations de la fiche (pas affichées sur les cartes)
        "birth name": p.birth_last_name ?? "",
        "birth place": p.birth_place ?? "",
        "death place": p.death_place ?? "",
        notes: p.notes ?? "",
        // Chemin de la photo dans le stockage ; l'adresse affichable (avatar) est ajoutée au chargement
        photo_path: p.photo_path ?? "",
      },
      rels: { parents: [], spouses: [], children: [] },
    });
  }

  const unionById = new Map(unions.map((u) => [u.id, u]));

  // Couples : chacun devient conjoint de l'autre
  for (const u of unions) {
    if (!u.partner_b) continue;
    const a = byId.get(u.partner_a);
    const b = byId.get(u.partner_b);
    if (!a || !b) continue;
    addUnique(a.rels.spouses!, b.id);
    addUnique(b.rels.spouses!, a.id);
  }

  // Filiations : l'enfant a pour parents les partenaires de l'union
  for (const f of filiations) {
    const child = byId.get(f.child_id);
    const union = unionById.get(f.union_id);
    if (!child || !union) continue;
    for (const pid of [union.partner_a, union.partner_b]) {
      const parent = pid ? byId.get(pid) : undefined;
      if (!parent) continue;
      addUnique(child.rels.parents, parent.id);
      addUnique(parent.rels.children!, child.id);
    }
  }

  return [...byId.values()];
}

export type TreeMeta = {
  id: string;
  name: string;
  /** owner, editor, commenter ou viewer */
  role: string;
  /** Compte pour lequel ces informations ont été chargées. */
  userId: string;
};

/**
 * Retrouve le premier arbre auquel l'utilisateur connecté a accès, et son rôle dans cet arbre.
 * La base ne renvoie que ce que les règles de sécurité (RLS) autorisent.
 */
export async function loadMyTreeMeta(userId: string): Promise<TreeMeta> {
  const { data: trees, error } = await supabase
    .from("trees")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const tree = trees?.[0];
  if (!tree) {
    throw new Error(
      "Aucun arbre n'est associé à ce compte. Demande une invitation au propriétaire de l'arbre, puis reconnecte-toi avec l'adresse invitée."
    );
  }
  const { data: role, error: roleError } = await supabase.rpc("my_role", { p_tree: tree.id });
  if (roleError) throw new Error(roleError.message);
  return { id: tree.id, name: tree.name, role: String(role ?? "viewer"), userId };
}

/**
 * Charge toutes les personnes d'un arbre, au format de family-chart.
 * Note : Supabase renvoie au plus 1000 lignes par requête ; la pagination viendra avec les grands arbres.
 */
export async function loadTreePeople(treeId: string): Promise<Datum[]> {
  const [persons, unions, filiations] = await Promise.all([
    supabase
      .from("persons")
      .select("id, first_names, last_name, gender, birth_date, birth_precision, death_date, death_precision, sibling_order, birth_last_name, birth_place, death_place, notes, photo_path")
      .eq("tree_id", treeId)
      .is("deleted_at", null),
    supabase.from("unions").select("id, partner_a, partner_b").eq("tree_id", treeId),
    supabase.from("filiations").select("child_id, union_id").eq("tree_id", treeId),
  ]);
  for (const r of [persons, unions, filiations]) if (r.error) throw new Error(r.error.message);

  const people = buildDatums(
    (persons.data ?? []) as PersonRow[],
    (unions.data ?? []) as UnionRow[],
    (filiations.data ?? []) as FiliationRow[]
  );
  if (people.length === 0) throw new Error("Cet arbre est vide.");

  // Photos : le stockage est privé, on demande des adresses temporaires (une seule requête pour tout l'arbre)
  const paths = people.map((p) => String(p.data["photo_path"] ?? "")).filter(Boolean);
  if (paths.length > 0) {
    const urls = await signPhotoUrls(paths);
    for (const p of people) {
      const url = urls.get(String(p.data["photo_path"] ?? ""));
      if (url) p.data["avatar"] = url;
    }
  }
  return people;
}
