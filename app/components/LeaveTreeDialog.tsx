"use client";

import { useEffect, useId, useState } from "react";
import { deleteTree, downloadBackup, leaveTree, treeSummary, type MyTree, type TreeSummary } from "@/lib/trees";
import { ROLE_LABEL, type Role } from "@/lib/sharing";

type Props = {
  trees: MyTree[];
  /** Appelé quand un arbre a été quitté ou supprimé. */
  onRemoved: (treeId: string) => Promise<void> | void;
  onBack: () => void;
};

/** Quitter un arbre (membre) ou le supprimer (propriétaire), avec une confirmation avant toute action. */
export default function LeaveTreeDialog({ trees, onRemoved, onBack }: Props) {
  const titleId = useId();
  const [target, setTarget] = useState<MyTree | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || locked) return;
      if (target) setTarget(null);
      else onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked, target, onBack]);

  return (
    <div
      className="arbre-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onBack();
      }}
    >
      <div className="arbre-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Quitter ou supprimer un arbre</h2>

        {!target && (
          <>
            <p className="arbre-hint">
              Quitter un arbre te retire seulement l&apos;accès. Supprimer un arbre (réservé à son propriétaire) l&apos;efface pour tout le monde.
            </p>
            <ul>
              {trees.map((t) => (
                <li key={t.id} className="arbre-link-row">
                  <div className="arbre-link-person">
                    <span>{t.name}</span>
                    <span className="arbre-hint">{ROLE_LABEL[t.role as Role] ?? t.role}</span>
                  </div>
                  <button type="button" className="arbre-btn arbre-btn-danger" onClick={() => setTarget(t)}>
                    {t.role === "owner" ? "Supprimer" : "Quitter"}
                  </button>
                </li>
              ))}
            </ul>
            <div className="arbre-modal-actions">
              <button type="button" className="arbre-btn" onClick={onBack}>
                Retour
              </button>
            </div>
          </>
        )}

        {target && target.role !== "owner" && (
          <LeaveView
            tree={target}
            onCancel={() => setTarget(null)}
            onLock={setLocked}
            onDone={async () => {
              await onRemoved(target.id);
            }}
          />
        )}
        {target && target.role === "owner" && (
          <DeleteView
            tree={target}
            onCancel={() => setTarget(null)}
            onLock={setLocked}
            onDone={async () => {
              await onRemoved(target.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

type ViewProps = { tree: MyTree; onCancel: () => void; onLock: (locked: boolean) => void; onDone: () => Promise<void> };

function LeaveView({ tree, onCancel, onLock, onDone }: ViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    setError(null);
    setBusy(true);
    onLock(true);
    try {
      await leaveTree(tree.id);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      onLock(false);
    }
  }

  return (
    <>
      {error && (
        <div className="arbre-login-error" role="alert">
          {error}
        </div>
      )}
      <div className="arbre-picked">
        <div>
          Quitter <strong>{tree.name}</strong> ? Tu n&apos;y auras plus accès. Pour y revenir, il faudra qu&apos;on t&apos;invite à nouveau ou que tu refasses une demande. Les personnes et les photos que tu as ajoutées restent dans
          l&apos;arbre.
        </div>
      </div>
      <div className="arbre-modal-actions">
        <button type="button" className="arbre-btn" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button type="button" className="arbre-btn arbre-btn-danger-solid" onClick={leave} disabled={busy}>
          {busy ? "..." : "Quitter l'arbre"}
        </button>
      </div>
    </>
  );
}

function DeleteView({ tree, onCancel, onLock, onDone }: ViewProps) {
  const [summary, setSummary] = useState<TreeSummary | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await treeSummary(tree.id);
        if (alive) setSummary(s);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [tree.id]);

  async function backup() {
    setError(null);
    try {
      await downloadBackup(tree.id, tree.name);
      setBackedUp(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    onLock(true);
    try {
      await deleteTree(tree.id, typed.trim(), setProgress);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setProgress(null);
      onLock(false);
    }
  }

  const matches = typed.trim() === tree.name;
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

  return (
    <>
      {error && (
        <div className="arbre-login-error" role="alert">
          {error}
        </div>
      )}
      <div className="arbre-picked">
        <div>
          Supprimer <strong>{tree.name}</strong> ?{" "}
          {summary
            ? `Il contient ${plural(summary.persons, "personne", "personnes")}, ${plural(summary.photos, "photo", "photos")} et ${plural(summary.members, "membre", "membres")} (toi compris). `
            : ""}
          La suppression est <strong>définitive</strong> et vaut pour tout le monde : les autres membres perdront l&apos;accès, et rien ne pourra être récupéré.
        </div>
      </div>

      <div className="arbre-share-actions">
        <button type="button" className="arbre-btn" onClick={backup} disabled={busy}>
          Télécharger une sauvegarde
        </button>
      </div>
      <span className="arbre-hint">
        {backedUp
          ? "Sauvegarde téléchargée. Elle contient les personnes et les liens de parenté, pas les fichiers photo."
          : "Fortement conseillé : un fichier avec les personnes et les liens de parenté (sans les fichiers photo)."}
      </span>

      <label className="arbre-label" htmlFor="delete-confirm">
        Pour confirmer, tape le nom de l&apos;arbre : <strong>{tree.name}</strong>
      </label>
      <input
        id="delete-confirm"
        className="arbre-field"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        disabled={busy}
      />
      {progress && <span className="arbre-hint">{progress}</span>}

      <div className="arbre-modal-actions">
        <button type="button" className="arbre-btn" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button type="button" className="arbre-btn arbre-btn-danger-solid" onClick={remove} disabled={busy || !matches}>
          {busy ? "..." : "Supprimer définitivement"}
        </button>
      </div>
    </>
  );
}
