import { supabase } from "./supabase";

export type MyTree = {
  id: string;
  name: string;
  /** owner, editor, commenter ou viewer */
  role: string;
  joined_at: string;
};

export type NewPerson = {
  first_names: string;
  last_name: string;
  gender: "M" | "F" | "";
  birth_year: string;
  /** Lien avec la première personne (inutile pour la première). */
  relation: "" | "spouse" | "parent" | "child";
};

/** Erreur levée quand un arbre qui ressemble à celui qu'on crée existe déjà dans la base. */
export class SimilarTreeError extends Error {
  constructor() {
    super("SIMILAR_TREE");
  }
}

/** Les arbres de la personne connectée, du plus récemment rejoint au plus ancien. */
export async function listMyTrees(): Promise<MyTree[]> {
  const { data, error } = await supabase.rpc("my_trees");
  if (error) {
    if (/could not find the function|schema cache|PGRST202/i.test(error.message)) {
      throw new Error("Les arbres multiples ne sont pas encore installés (migration 009 non lancée ?).");
    }
    throw new Error(error.message);
  }
  return (Array.isArray(data) ? data : []) as MyTree[];
}

/** Crée un arbre avec ses premières personnes. Retourne l'identifiant du nouvel arbre. */
export async function createTree(name: string, people: NewPerson[], force: boolean): Promise<string> {
  const payload = people.map((p, i) => ({
    first_names: p.first_names.trim(),
    last_name: p.last_name.trim(),
    gender: p.gender,
    birth_year: p.birth_year.trim() === "" ? null : Number(p.birth_year),
    ...(i > 0 ? { relation: p.relation } : {}),
  }));
  const { data, error } = await supabase.rpc("create_tree", { p_name: name, p_people: payload, p_force: force });
  if (error) {
    if (/SIMILAR_TREE/.test(error.message)) throw new SimilarTreeError();
    throw new Error(error.message);
  }
  return String(data);
}

// ---------- Arbre ouvert par défaut ----------

const key = (userId: string) => `arbre_last_tree_${userId}`;

export function storedTreeChoice(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function storeTreeChoice(userId: string, treeId: string): void {
  try {
    localStorage.setItem(key(userId), treeId);
  } catch {
    // navigateur sans stockage : on retombera sur l'arbre rejoint en dernier
  }
}

/**
 * Arbre à ouvrir : celui qu'on vient de rejoindre, sinon le dernier choisi sur cet appareil (s'il existe encore),
 * sinon l'arbre rejoint le plus récemment.
 */
export function pickTree(trees: MyTree[], userId: string, justJoined: boolean): MyTree | undefined {
  if (trees.length === 0) return undefined;
  if (!justJoined) {
    const stored = storedTreeChoice(userId);
    const hit = stored ? trees.find((t) => t.id === stored) : undefined;
    if (hit) return hit;
  }
  return trees[0]; // la liste est triée du plus récent au plus ancien
}
