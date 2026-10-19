import { supabase } from "./supabase";

const OFF_KEY = "arbre_tutorial_off"; // "ne plus me montrer ça" (copie locale, au cas où la base ne répond pas)
const SEEN_KEY = "arbre_tutorial_seen"; // déjà proposé pendant cette visite : on ne le remet pas à chaque rechargement

function read(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function write(store: "local" | "session", key: string, value: string) {
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    // stockage indisponible (navigation privée...) : on s'en passe
  }
}

/** Vrai si le tutoriel a déjà été proposé pendant cette visite. */
export function tutorialSeenThisVisit(): boolean {
  return read("session", SEEN_KEY) === "1";
}

export function markTutorialSeenThisVisit() {
  write("session", SEEN_KEY, "1");
}

/** Cette personne a-t-elle demandé à ne plus voir le tutoriel ? En cas de doute (base pas à jour), on ne l'embête pas. */
export async function tutorialDismissed(): Promise<boolean> {
  if (read("local", OFF_KEY) === "1") return true;
  const { data, error } = await supabase.rpc("tutorial_dismissed");
  if (error) return true;
  if (data === true) write("local", OFF_KEY, "1");
  return data === true;
}

/** « Ne plus me montrer ça » : retenu sur le compte (donc sur tous ses appareils) et sur cet appareil. */
export async function dismissTutorial(): Promise<void> {
  write("local", OFF_KEY, "1");
  await supabase.rpc("dismiss_tutorial");
}
