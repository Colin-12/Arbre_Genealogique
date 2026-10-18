"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import FamilyTree from "./FamilyTree";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { loadMyTreeMeta, loadTreePeople, type TreeMeta } from "@/lib/loadTree";
import { friendlyLoginError, joinPendingTrees, pendingJoinToken, stashJoinToken } from "@/lib/sharing";

type Status = "idle" | "sending" | "sent" | "error";

/** Connexion par lien magique, puis affichage de l'arbre de l'utilisateur. */
export default function TreeApp() {
  // undefined = on ne sait pas encore (lecture de la session sauvegardée dans le navigateur)
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [meta, setMeta] = useState<TreeMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Lien d'invitation (?join=...) : on garde le jeton de côté, le temps de se connecter
  useEffect(() => {
    stashJoinToken();
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Arbre du compte connecté (et rôle dans cet arbre)
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      // Rejoint l'arbre d'un lien de partage et accepte les invitations faites à cette adresse
      const joinNotice = await joinPendingTrees().catch(() => null);
      try {
        const m = await loadMyTreeMeta(userId);
        if (!cancelled) setMeta(m);
      } catch (e) {
        if (cancelled) return;
        const base = e instanceof Error ? e.message : String(e);
        setMetaError(joinNotice ? `${joinNotice} ${base}` : base);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const treeId = meta?.userId === userId ? meta?.id : undefined;
  const loadData = useCallback(() => loadTreePeople(treeId ?? ""), [treeId]);

  if (!supabaseConfigured) {
    return (
      <Notice title="Configuration manquante">
        Crée le fichier <code>.env.local</code> à la racine du projet avec NEXT_PUBLIC_SUPABASE_URL et
        NEXT_PUBLIC_SUPABASE_ANON_KEY, puis relance <code>npm run dev</code>.
      </Notice>
    );
  }

  if (session === undefined) return <div className="arbre-login" aria-busy="true" />;
  if (session === null) return <LoginForm />;

  if (metaError) {
    return (
      <Notice title="Impossible d'afficher l'arbre">
        <p>{metaError}</p>
        <button type="button" className="arbre-link" onClick={() => supabase.auth.signOut()}>
          Se déconnecter
        </button>
      </Notice>
    );
  }
  if (!treeId || !meta) return <div className="arbre-login" aria-busy="true" />;

  return (
    <FamilyTree
      loadData={loadData}
      treeId={treeId}
      canEdit={meta.role === "owner" || meta.role === "editor"}
      role={meta.role}
      treeName={meta.name}
      userId={meta.userId}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="arbre-login">
      <div className="arbre-panel arbre-login-card">
        <h1>{title}</h1>
        <div className="arbre-notice-body">{children}</div>
      </div>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  // Lien d'invitation ouvert avant la connexion : le jeton permet de créer le compte
  const [joinToken] = useState(() => pendingJoinToken());

  async function send(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, ...(joinToken ? { data: { join_token: joinToken } } : {}) },
    });
    if (error) {
      setStatus("error");
      setMessage(friendlyLoginError(error.message));
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
            {joinToken && <p className="arbre-join-banner">Tu as reçu une invitation à rejoindre un arbre. Connecte-toi pour l&apos;ouvrir.</p>}
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
