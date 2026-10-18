"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import FamilyTree from "./FamilyTree";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { loadTreePeople } from "@/lib/loadTree";
import { listMyTrees, pickTree, storeTreeChoice, type MyTree } from "@/lib/trees";
import CreateTreeDialog from "./CreateTreeDialog";
import PushToggle from "./PushToggle";
import TreesDialog from "./TreesDialog";
import {
  clearAccessCode,
  friendlyLoginError,
  joinPendingTrees,
  myAccessRequests,
  pendingAccessCode,
  pendingJoinToken,
  requestAccess,
  stashAccessCode,
  stashJoinToken,
  treeForCode,
  type MyAccessRequest,
  type TreeForCode,
} from "@/lib/sharing";

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
  // Lien de demande d'accès (?rejoindre=...) ouvert par cette personne, et demandes qu'elle a déjà envoyées
  const [access, setAccess] = useState<{ code: string; info: TreeForCode | null; error: string | null } | null>(null);
  const [requests, setRequests] = useState<MyAccessRequest[]>([]);

  // Liens reçus (?join=... ancien lien d'invitation, ?rejoindre=... demande d'accès) : on garde le code de côté, le temps de se connecter
  useEffect(() => {
    stashJoinToken();
    stashAccessCode();
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
        setAccess(null);
        setRequests([]);
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
        let openId = pickTree(list, userId, join.joined)?.id;

        // Lien de demande d'accès : si l'arbre est déjà le sien on l'ouvre, sinon on propose de demander l'accès
        const code = pendingAccessCode();
        if (code) {
          try {
            const info = await treeForCode(code);
            if (cancelled) return;
            if (info.member) {
              clearAccessCode();
              openId = info.id;
              storeTreeChoice(userId, info.id);
            } else {
              setAccess({ code, info, error: null });
            }
          } catch (e) {
            if (cancelled) return;
            setAccess({ code, info: null, error: e instanceof Error ? e.message : String(e) });
          }
        }
        setRequests(await myAccessRequests());
        if (cancelled) return;
        setCurrentId(openId);
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

  if (access) {
    return (
      <AccessScreen
        access={access}
        hasTrees={trees.length > 0}
        onDone={async () => {
          clearAccessCode();
          setAccess(null);
          setRequests(await myAccessRequests());
        }}
      />
    );
  }

  const dialogs = (
    <>
      {dialog === "trees" && (
        <TreesDialog
          trees={trees}
          currentId={currentId}
          onSwitch={switchTo}
          pending={requests}
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
          {requests.length > 0 ? (
            <p>
              Ta demande d&apos;accès à <strong>{requests.map((r) => r.tree_name).join(", ")}</strong> est en attente : le propriétaire de l&apos;arbre doit la valider. Reviens
              ici ensuite, avec cette adresse.
            </p>
          ) : (
            <p>
              Tu n&apos;as pas encore d&apos;arbre. Pour rejoindre celui d&apos;un proche, ouvre le lien qu&apos;il t&apos;a envoyé (ou attends son invitation par e-mail). Tu peux aussi
              créer le tien.
            </p>
          )}
          {requests.length > 0 && (
            <PushToggle
              offText="Reçois aussi une notification sur cet appareil dès que ta demande est acceptée."
              onText="Les notifications sont activées sur cet appareil : tu seras prévenu dès que ta demande est acceptée."
              fallback="Tu seras prévenu par e-mail."
            />
          )}
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

/** Écran affiché à quelqu'un qui ouvre un lien de demande d'accès : il écrit un mot, le propriétaire décide. */
function AccessScreen({
  access,
  hasTrees,
  onDone,
}: {
  access: { code: string; info: TreeForCode | null; error: string | null };
  hasTrees: boolean;
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">(access.info?.requested ? "sent" : "idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      await requestAccess(access.code, message);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  if (!access.info) {
    return (
      <Notice title="Lien invalide">
        <p>{access.error ?? "Ce lien n'est plus valide."} Demande au propriétaire de l&apos;arbre de t&apos;en envoyer un nouveau.</p>
        <button type="button" className="arbre-btn arbre-btn-accent" onClick={onDone}>
          Continuer
        </button>
      </Notice>
    );
  }

  if (state === "sent") {
    return (
      <Notice title="Demande envoyée">
        <p>
          Le propriétaire de <strong>{access.info.name}</strong> va recevoir ta demande. Dès qu&apos;il l&apos;aura acceptée, l&apos;arbre s&apos;ouvrira quand tu te connecteras avec cette adresse.
        </p>
        <PushToggle
          offText="Reçois aussi une notification sur cet appareil dès que ta demande est acceptée. Tu seras de toute façon prévenu par e-mail."
          onText="Les notifications sont activées sur cet appareil : tu seras prévenu dès que ta demande est acceptée."
          fallback="Tu seras prévenu par e-mail."
        />
        <button type="button" className="arbre-btn arbre-btn-accent" onClick={onDone}>
          Continuer
        </button>
      </Notice>
    );
  }

  return (
    <div className="arbre-login">
      <form className="arbre-panel arbre-login-card" onSubmit={send}>
        <h1>Rejoindre un arbre</h1>
        <p>
          Tu as reçu le lien de l&apos;arbre <strong>{access.info.name}</strong>. Pour y entrer, le propriétaire doit accepter ta demande.
        </p>
        <label className="arbre-label" htmlFor="access-msg">
          Un mot pour te présenter (facultatif)
        </label>
        <textarea
          id="access-msg"
          className="arbre-field arbre-access-msg"
          maxLength={300}
          placeholder="Ex. : Pierre, le fils de Marie"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {error && <div className="arbre-login-error">{error}</div>}
        <button type="submit" className="arbre-btn arbre-btn-primary" disabled={state === "sending"}>
          {state === "sending" ? "Envoi..." : "Demander l'accès"}
        </button>
        <button type="button" className="arbre-link" onClick={onDone}>
          {hasTrees ? "Plus tard" : "Non merci"}
        </button>
      </form>
    </div>
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
  const [hasAccessLink] = useState(() => pendingAccessCode() !== null);

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
            {hasAccessLink && <p className="arbre-join-banner">Tu as reçu le lien d&apos;un arbre. Connecte-toi, puis tu pourras demander à le rejoindre.</p>}
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
