import { supabase } from "./supabase";

export type Role = "owner" | "editor" | "commenter" | "viewer";
/** Rôles qu'on peut donner (le propriétaire est unique). */
export type GrantableRole = Exclude<Role, "owner">;

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Propriétaire",
  editor: "Éditeur",
  commenter: "Commentateur",
  viewer: "Lecteur",
};

export const ROLE_HELP: Record<GrantableRole, string> = {
  editor: "peut ajouter et modifier des personnes, des lieux et des photos",
  commenter: "consulte l'arbre (les commentaires arriveront bientôt)",
  viewer: "consulte l'arbre sans rien modifier",
};

export const GRANTABLE: GrantableRole[] = ["editor", "commenter", "viewer"];

export type Member = { user_id: string; display_name: string; email: string | null; role: Role; joined_at: string };
export type Invitation = { id: string; email: string; role: GrantableRole; expires_at: string };
export type ShareLink = { id: string; token: string; role: GrantableRole; expires_at: string | null };

/** Les messages levés par la base sont déjà en français : on les garde tels quels. */
function fail(message: string): never {
  if (/row-level security|permission denied/i.test(message)) throw new Error("Action refusée : tu n'as pas ce droit.");
  throw new Error(message);
}

export async function listMembers(treeId: string): Promise<Member[]> {
  const { data, error } = await supabase.rpc("list_members", { p_tree: treeId });
  if (error) fail(error.message);
  return (data ?? []) as Member[];
}

export async function listInvitations(treeId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, role, expires_at")
    .eq("tree_id", treeId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []) as Invitation[];
}

export async function listShareLinks(treeId: string): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from("share_links")
    .select("id, token, role, expires_at")
    .eq("tree_id", treeId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  const now = Date.now();
  return ((data ?? []) as ShareLink[]).filter((l) => !l.expires_at || new Date(l.expires_at).getTime() > now);
}

/**
 * Envoie à l'adresse invitée le lien de connexion (e-mail Supabase). L'invitation étant déjà enregistrée,
 * la personne peut créer son compte, et elle rejoint l'arbre à sa première connexion.
 * Retourne null si l'e-mail est parti, sinon un message d'explication.
 */
export async function sendInvitationEmail(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  });
  return error ? friendlyLoginError(error.message) : null;
}

/** Enregistre l'invitation puis envoie l'e-mail. Retourne null si tout est parti, sinon la raison de l'échec de l'e-mail. */
export async function createInvitation(treeId: string, email: string, role: GrantableRole): Promise<string | null> {
  const { error } = await supabase.rpc("create_invitation", { p_tree: treeId, p_email: email.trim(), p_role: role });
  if (error) fail(error.message);
  return sendInvitationEmail(email);
}

export async function revokeInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation: id });
  if (error) fail(error.message);
}

export async function createShareLink(treeId: string, role: GrantableRole): Promise<void> {
  const { error } = await supabase.rpc("create_share_link", { p_tree: treeId, p_role: role });
  if (error) fail(error.message);
}

export async function revokeShareLink(id: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_share_link", { p_link: id });
  if (error) fail(error.message);
}

export async function changeMemberRole(treeId: string, userId: string, role: GrantableRole): Promise<void> {
  const { error } = await supabase.rpc("change_member_role", { p_tree: treeId, p_user: userId, p_role: role });
  if (error) fail(error.message);
}

export async function removeMember(treeId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_member", { p_tree: treeId, p_user: userId });
  if (error) fail(error.message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Invitations en lot ----------

/** Nombre maximum d'adresses par envoi (le service d'e-mail limite le nombre de messages par heure). */
export const MAX_BATCH = 20;

const EMAIL = /^[^\s@<>,;()]+@[^\s@<>,;()]+\.[^\s@<>,;()]{2,}$/;

/** Extrait les adresses d'un texte collé (séparées par des espaces, virgules, points-virgules ou retours à la ligne ; "Nom <adresse>" accepté). */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim().replace(/^<|>$/g, "");
    if (!token) continue;
    if (!EMAIL.test(token)) {
      // un morceau de "Prénom Nom <a@b.fr>" (le prénom ou le nom) n'est pas une erreur si une adresse suit
      if (!/@/.test(token)) continue;
      invalid.push(token);
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(key);
  }
  return { valid, invalid };
}

export type BatchResult = { address: string; status: "sent" | "recorded" | "failed"; detail: string | null };

/**
 * Invite plusieurs adresses avec le même rôle, une par une. Une adresse en échec n'arrête pas les autres,
 * sauf si le service d'e-mail refuse d'en envoyer davantage (les suivantes sont alors seulement enregistrées).
 */
export async function createInvitations(treeId: string, addresses: string[], role: GrantableRole): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  let mailBlocked: string | null = null;
  for (const address of addresses) {
    try {
      if (mailBlocked) {
        const { error } = await supabase.rpc("create_invitation", { p_tree: treeId, p_email: address, p_role: role });
        if (error) fail(error.message);
        out.push({ address, status: "recorded", detail: mailBlocked });
        continue;
      }
      const mailError = await createInvitation(treeId, address, role);
      if (!mailError) out.push({ address, status: "sent", detail: null });
      else {
        out.push({ address, status: "recorded", detail: mailError });
        if (/trop de demandes|rate limit/i.test(mailError)) mailBlocked = mailError;
      }
    } catch (e) {
      out.push({ address, status: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ---------- Demandes d'accès (lien à partager, le propriétaire valide) ----------

export type AccessRequest = { id: string; user_id: string; display_name: string; email: string | null; message: string | null; created_at: string };
export type TreeForCode = { id: string; name: string; member: boolean; requested: boolean };
export type MyAccessRequest = { id: string; tree_name: string; created_at: string };

export async function getJoinCode(treeId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_join_code", { p_tree: treeId });
  if (error) fail(error.message);
  return String(data);
}

export async function regenerateJoinCode(treeId: string): Promise<string> {
  const { data, error } = await supabase.rpc("regenerate_join_code", { p_tree: treeId });
  if (error) fail(error.message);
  return String(data);
}

export async function pendingRequestsCount(treeId: string): Promise<number> {
  const { data, error } = await supabase.rpc("pending_requests_count", { p_tree: treeId });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

export async function listAccessRequests(treeId: string): Promise<AccessRequest[]> {
  const { data, error } = await supabase.rpc("list_access_requests", { p_tree: treeId });
  if (error) fail(error.message);
  return (Array.isArray(data) ? data : []) as AccessRequest[];
}

export async function answerAccessRequest(id: string, accept: boolean, role: GrantableRole): Promise<void> {
  const { error } = await supabase.rpc("answer_access_request", { p_request: id, p_accept: accept, p_role: role });
  if (error) fail(error.message);
}

export async function treeForCode(code: string): Promise<TreeForCode> {
  const { data, error } = await supabase.rpc("tree_for_code", { p_code: code });
  if (error) fail(error.message);
  return data as TreeForCode;
}

export async function requestAccess(code: string, message: string): Promise<void> {
  const { error } = await supabase.rpc("request_access", { p_code: code, p_message: message.trim() || null });
  if (error) fail(error.message);
}

export async function myAccessRequests(): Promise<MyAccessRequest[]> {
  const { data, error } = await supabase.rpc("my_access_requests");
  if (error) return [];
  return (Array.isArray(data) ? data : []) as MyAccessRequest[];
}

/** Adresse à envoyer aux proches : ils se connectent puis demandent l'accès. */
export function accessUrl(code: string): string {
  return `${window.location.origin}/?rejoindre=${code}`;
}

const ACCESS_KEY = "arbre_access_code";

/** Lit ?rejoindre=... dans l'adresse, le garde de côté (le temps de se connecter) et nettoie l'adresse. */
export function stashAccessCode(): void {
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("rejoindre");
    if (code === null) return;
    if (UUID.test(code)) localStorage.setItem(ACCESS_KEY, code.toLowerCase());
    url.searchParams.delete("rejoindre");
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  } catch {
    // navigateur sans stockage : le lien devra être rouvert après la connexion
  }
}

export function pendingAccessCode(): string | null {
  try {
    const c = localStorage.getItem(ACCESS_KEY);
    return c && UUID.test(c) ? c : null;
  } catch {
    return null;
  }
}

export function clearAccessCode(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
  } catch {
    // sans importance
  }
}

/** Adresse à envoyer à un proche pour rejoindre l'arbre avec un lien de partage. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/?join=${token}`;
}

// ---------- Rejoindre un arbre (côté invité) ----------

const JOIN_KEY = "arbre_join_token";

/** Lit ?join=... dans l'adresse, le garde de côté (le temps de se connecter) et nettoie l'adresse. */
export function stashJoinToken(): void {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("join");
    if (token === null) return;
    if (UUID.test(token)) localStorage.setItem(JOIN_KEY, token);
    url.searchParams.delete("join");
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  } catch {
    // navigateur sans stockage : le lien devra être rouvert après la connexion
  }
}

export function pendingJoinToken(): string | null {
  try {
    const t = localStorage.getItem(JOIN_KEY);
    return t && UUID.test(t) ? t : null;
  } catch {
    return null;
  }
}

function clearJoinToken(): void {
  try {
    localStorage.removeItem(JOIN_KEY);
  } catch {
    // sans importance
  }
}

/**
 * Après connexion : rejoint l'arbre d'un lien de partage (s'il y en a un) et accepte les invitations
 * faites à l'adresse du compte. Retourne un message d'erreur éventuel, et si l'on vient de rejoindre au moins un arbre.
 */
export async function joinPendingTrees(): Promise<{ notice: string | null; joined: boolean }> {
  let notice: string | null = null;
  let joined = false;
  const token = pendingJoinToken();
  if (token) {
    const { error } = await supabase.rpc("join_with_link", { p_token: token });
    clearJoinToken();
    if (error) notice = error.message;
    else joined = true;
  }
  const { data, error: inviteError } = await supabase.rpc("accept_my_invitations");
  if (inviteError && !notice) notice = inviteError.message;
  if (!inviteError && typeof data === "number" && data > 0) joined = true;
  return { notice, joined };
}

/** Traduit les refus d'inscription (adresse non invitée) en message clair. */
export function friendlyLoginError(message: string): string {
  if (/database error saving new user|signups not allowed|signup.*disabled/i.test(message)) {
    return "Cette adresse n'a pas été invitée. Demande une invitation au propriétaire de l'arbre, puis réessaie avec l'adresse invitée.";
  }
  if (/only request this after|after \d+ seconds/i.test(message)) {
    return "Un e-mail vient d'être envoyé à cette adresse. Attends une minute avant d'en renvoyer un.";
  }
  if (/rate limit/i.test(message)) return "Trop de demandes de lien. Attends un peu avant de réessayer.";
  return message;
}
