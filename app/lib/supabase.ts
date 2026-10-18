import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Faux si le fichier .env.local est absent ou incomplet (l'interface l'indique alors clairement). */
export const supabaseConfigured = Boolean(url && key);

/**
 * Client Supabase côté navigateur. La clé "anon" (ou "publishable") peut être publique :
 * ce sont les règles de sécurité de la base (RLS) qui protègent les données.
 * Ne jamais mettre ici la clé "service_role".
 */
export const supabase = createClient(url ?? "http://localhost:54321", key ?? "missing-key");
