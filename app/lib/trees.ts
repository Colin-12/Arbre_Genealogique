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

// ---------- Quitter ou supprimer un arbre ----------

export type TreeSummary = { persons: number; photos: number; members: number };

/** Ce que contient un arbre (propriétaire seulement). */
export async function treeSummary(treeId: string): Promise<TreeSummary> {
  const { data, error } = await supabase.rpc("tree_summary", { p_tree: treeId });
  if (error) throw new Error(friendly(error.message));
  return data as TreeSummary;
}

/** Quitter un arbre dont on n'est pas propriétaire. */
export async function leaveTree(treeId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_tree", { p_tree: treeId });
  if (error) throw new Error(friendly(error.message));
}

/**
 * Supprime un arbre pour tout le monde (propriétaire seulement). Les fichiers du stockage sont effacés d'abord,
 * tant qu'on a encore le droit de le faire, puis l'arbre lui-même. Le nom doit être celui de l'arbre.
 */
export async function deleteTree(treeId: string, name: string, onProgress?: (text: string) => void): Promise<void> {
  const { data: paths, error: pathsError } = await supabase.rpc("tree_file_paths", { p_tree: treeId });
  if (pathsError) throw new Error(friendly(pathsError.message));
  const files = Array.isArray(paths) ? (paths as string[]) : [];
  for (let i = 0; i < files.length; i += 100) {
    onProgress?.(`Suppression des photos (${Math.min(i + 100, files.length)} sur ${files.length})...`);
    const { error } = await supabase.storage.from("photos").remove(files.slice(i, i + 100));
    if (error) throw new Error(`Les photos n'ont pas pu être supprimées : ${error.message}`);
  }
  onProgress?.("Suppression de l'arbre...");
  const { error } = await supabase.rpc("delete_tree", { p_tree: treeId, p_name: name });
  if (error) throw new Error(friendly(error.message));
}

/** Télécharge une sauvegarde de l'arbre (personnes et liens de parenté, sans les fichiers photo). */
export async function downloadBackup(treeId: string, treeName: string): Promise<void> {
  const [persons, unions, filiations] = await Promise.all([
    supabase.from("persons").select("*").eq("tree_id", treeId).is("deleted_at", null),
    supabase.from("unions").select("*").eq("tree_id", treeId),
    supabase.from("filiations").select("*").eq("tree_id", treeId),
  ]);
  const failure = persons.error ?? unions.error ?? filiations.error;
  if (failure) throw new Error(failure.message);

  const backup = {
    format: "arbre-genealogique-sauvegarde",
    version: 1,
    exported_at: new Date().toISOString(),
    tree: { id: treeId, name: treeName },
    persons: persons.data,
    unions: unions.data,
    filiations: filiations.data,
  };
  const slug = treeName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `sauvegarde-${slug || "arbre"}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function friendly(message: string): string {
  if (/could not find the function|schema cache|PGRST202/i.test(message)) {
    return "Cette fonction n'est pas encore installée côté base de données (migration 013 non lancée ?).";
  }
  return message;
}
