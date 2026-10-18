"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import FamilyTree from "./FamilyTree";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { loadMyTree } from "@/lib/loadTree";

type Status = "idle" | "sending" | "sent" | "error";

/** Connexion par lien magique, puis affichage de l'arbre de l'utilisateur. */
export default function TreeApp() {
  // undefined = on ne sait pas encore (lecture de la session sauvegardée dans le navigateur)
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <div className="arbre-login">
        <div className="arbre-panel arbre-login-card">
          <h1>Configuration manquante</h1>
          <p>
            Crée le fichier <code>.env.local</code> à la racine du projet avec NEXT_PUBLIC_SUPABASE_URL et
            NEXT_PUBLIC_SUPABASE_ANON_KEY, puis relance <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  if (session === undefined) return <div className="arbre-login" aria-busy="true" />;
  if (session === null) return <LoginForm />;

  return <FamilyTree loadData={loadMyTree} onSignOut={() => supabase.auth.signOut()} />;
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function send(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="arbre-login">
      <form className="arbre-panel arbre-login-card" onSubmit={send}>
        <h1>Arbre généalogique</h1>
        {status === "sent" ? (
          <>
            <p>
              Un lien de connexion vient d&apos;être envoyé à <strong>{email}</strong>. Ouvre-le depuis cet appareil
              (pense à regarder dans les courriers indésirables).
            </p>
            <button type="button" className="arbre-link" onClick={() => setStatus("idle")}>
              Utiliser une autre adresse
            </button>
          </>
        ) : (
          <>
            <p>Entre ton adresse email : tu recevras un lien pour te connecter, sans mot de passe.</p>
            <input
              className="arbre-field"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="ton.adresse@exemple.fr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Adresse email"
            />
            <button type="submit" className="arbre-btn arbre-btn-primary" disabled={status === "sending"}>
              {status === "sending" ? "Envoi..." : "Recevoir le lien"}
            </button>
            {status === "error" && <div className="arbre-login-error">{message}</div>}
          </>
        )}
      </form>
    </div>
  );
}
