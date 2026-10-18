"use client";

import { useEffect, useId } from "react";
import type { MyTree } from "@/lib/trees";
import { ROLE_LABEL, type MyAccessRequest, type Role } from "@/lib/sharing";

type Props = {
  trees: MyTree[];
  currentId: string | undefined;
  onSwitch: (treeId: string) => void;
  /** Demandes d'accès envoyées et pas encore acceptées. */
  pending?: MyAccessRequest[];
  onCreate: () => void;
  onSignOut: () => void;
  onClose: () => void;
};

/** Mes arbres : changer d'arbre, en créer un nouveau, se déconnecter. */
export default function TreesDialog({ trees, currentId, onSwitch, pending = [], onCreate, onSignOut, onClose }: Props) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="arbre-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="arbre-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Mes arbres</h2>

        {trees.length === 0 ? (
          <p className="arbre-hint">Tu n&apos;as pas encore d&apos;arbre.</p>
        ) : (
          <ul className="arbre-treelist">
            {trees.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={t.id === currentId ? "arbre-treeitem is-current" : "arbre-treeitem"}
                  onClick={() => (t.id === currentId ? onClose() : onSwitch(t.id))}
                  aria-current={t.id === currentId ? "true" : undefined}
                >
                  <span className="arbre-treeitem-name">{t.name}</span>
                  <span className="arbre-hint">
                    {ROLE_LABEL[t.role as Role] ?? t.role}
                    {t.id === currentId ? " · ouvert" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {pending.length > 0 && (
          <p className="arbre-hint">
            Demande{pending.length > 1 ? "s" : ""} en attente de réponse : {pending.map((r) => r.tree_name).join(", ")}.
          </p>
        )}

        <div className="arbre-share-actions">
          <button type="button" className="arbre-btn arbre-btn-accent" onClick={onCreate}>
            Créer un arbre
          </button>
        </div>

        <div className="arbre-modal-actions">
          <button type="button" className="arbre-link" onClick={onSignOut}>
            Se déconnecter
          </button>
          <button type="button" className="arbre-btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
