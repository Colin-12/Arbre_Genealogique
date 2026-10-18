"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import FamilyTree from "./FamilyTree";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { loadTreePeople } from "@/lib/loadTree";
import { listMyTrees, pickTree, storeTreeChoice, type MyTree } from "@/lib/trees";
import CreateTreeDialog from "./CreateTreeDialog";
import TreesDialog from "./TreesDialog";
import { friendlyLoginError, joinPendingTrees, pendingJoinToken, stashJoinToken } from "@/lib/sharing";

type Status = "idle" | "sending" | "sent" | "error";

/** Connexion par lien magique, puis affichage de l'arbre de l'utilisateur. */
export default function TreeApp() {
  // undefined = on ne sait pas encore (lecture de la session sauvegardée dans le navigateur)
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Arbres de la personne connectée (du plus récemment rejoint au plus ancien) et arbre ouvert
  const [trees, setTrees] = useState<MyTree[] | null>(null);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"trees" | "create" | null>(null);

  // Lien d'invitation (?join=...) : on garde le jeton de côté, le temps de se connecter
  useEffect(() => {
    stashJoinToken();
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        // Déconnexion : on oublie les arbres du compte précédent
        setTrees(null);
        setCurrentId(undefined);
        setMetaError(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      // Accepte les invitations faites à cette adresse (et le lien de partage éventuel), puis liste les arbres
      const join = await joinPendingTrees().catch(() => ({ notice: null as string | null, joined: false }));
      try {
        const list = await listMyTrees();
        if (cancelled) return;
        setTrees(list);
        setCurrentId(pickTree(list, userId, join.joined)?.id);
      } catch (e) {
        if (cancelled) return;
        const base = e instanceof Error ? e.message : String(e);
        setMetaError(join.notice ? `${join.notice} ${base}` : base);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const meta = trees?.find((t) => t.id === currentId);
  const treeId = meta?.id;
  const loadData = useCallback(() => loadTreePeople(treeId ?? ""), [treeId]);

  function switchTo(id: string) {
    if (userId) storeTreeChoice(userId, id);
    setCurrentId(id);
    setDialog(null);
  }

  async function onCreated(id: string) {
    try {
      const list = await listMyTrees();
      setTrees(list);
    } catch {
      // la liste se rechargera à la prochaine ouverture
    }
    switchTo(id);
  }

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
  if (trees === null) return <div className="arbre-login" aria-busy="true" />;

  const dialogs = (
    <>
      {dialog === "trees" && (
        <TreesDialog
          trees={trees}
          currentId={currentId}
          onSwitch={switchTo}
          onCreate={() => setDialog("create")}
          onSignOut={() => supabase.auth.signOut()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "create" && <CreateTreeDialog onCreated={onCreated} onClose={() => setDialog(trees.length > 0 ? "trees" : null)} />}
    </>
  );

  // Compte sans arbre : on propose d'en créer un, ou d'attendre une invitation
  if (!treeId || !meta) {
    return (
      <>
        <Notice title="Bienvenue">
          <p>Tu n&apos;as pas encore d&apos;arbre. Tu peux créer le tien, ou attendre l&apos;invitation d&apos;un proche : elle te donnera accès à son arbre dès que tu te connectes avec cette adresse.</p>
          <div className="arbre-share-actions">
            <button type="button" className="arbre-btn arbre-btn-accent" onClick={() => setDialog("create")}>
              Créer mon arbre
            </button>
            <button type="button" className="arbre-link" onClick={() => supabase.auth.signOut()}>
              Se déconnecter
            </button>
          </div>
        </Notice>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <FamilyTree
        key={treeId}
        loadData={loadData}
        treeId={treeId}
        canEdit={meta.role === "owner" || meta.role === "editor"}
        role={meta.role}
        treeName={meta.name}
        userId={userId}
        onTrees={() => setDialog("trees")}
        onSignOut={() => supabase.auth.signOut()}
      />
      {dialogs}
    </>
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
