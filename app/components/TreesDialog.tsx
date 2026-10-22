"use client";

import { useEffect, useId, useState } from "react";
import type { MyTree } from "@/lib/trees";
import { exportTree, type ExportFormat } from "@/lib/exportTree";
import { ROLE_LABEL, type MyAccessRequest, type Role } from "@/lib/sharing";

type Props = {
  trees: MyTree[];
  currentId: string | undefined;
  onSwitch: (treeId: string) => void;
  /** Demandes d'accès envoyées et pas encore acceptées. */
  pending?: MyAccessRequest[];
  onCreate: () => void;
  /** Ouvre l'écran "Quitter ou supprimer un arbre". */
  onManage: () => void;
  /** Propriétaire : ouvre « Renommer l'arbre ». */
  onRename: () => void;
  /** Ouvre le tutoriel. */
  onHelp: () => void;
  /** Adresse du compte connecté. */
  email?: string;
  onSignOut: () => void;
  onClose: () => void;
};

/** Mes arbres : changer d'arbre, en créer un nouveau, se déconnecter. */
export default function TreesDialog({ trees, currentId, onSwitch, pending = [], onCreate, onManage, onRename, onHelp, email, onSignOut, onClose }: Props) {
  const titleId = useId();
  const current = trees.find((t) => t.id === currentId);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportMsg, setExportMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function doExport(format: ExportFormat) {
    if (!current) return;
    setExporting(format);
    setExportMsg(null);
    try {
      await exportTree(format, current.name);
      setExportMsg({ text: format === "png" ? "Image téléchargée." : "PDF téléchargé.", error: false });
    } catch (err) {
      setExportMsg({ text: `Export impossible : ${err instanceof Error ? err.message : err}`, error: true });
    }
    setExporting(null);
  }

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

        {current && (
          <section className="arbre-current-tree" aria-label="Arbre ouvert">
            <div className="arbre-current-title">
              Arbre ouvert : <strong>{current.name}</strong>
            </div>
            <div className="arbre-share-actions">
              <button type="button" className="arbre-btn" onClick={() => doExport("png")} disabled={exporting !== null}>
                {exporting === "png" ? "Préparation..." : "Exporter en image"}
              </button>
              <button type="button" className="arbre-btn" onClick={() => doExport("pdf")} disabled={exporting !== null}>
                {exporting === "pdf" ? "Préparation..." : "Exporter en PDF"}
              </button>
              {current.role === "owner" && (
                <button type="button" className="arbre-btn" onClick={onRename} disabled={exporting !== null}>
                  Renommer l&apos;arbre
                </button>
              )}
            </div>
            <p className="arbre-hint">L&apos;export reprend l&apos;arbre tel qu&apos;il est affiché à l&apos;écran.</p>
            {exportMsg && (
              <p className={exportMsg.error ? "arbre-login-error" : "arbre-hint"} role={exportMsg.error ? "alert" : "status"}>
                {exportMsg.text}
              </p>
            )}
          </section>
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
          {trees.length > 0 && (
            <button type="button" className="arbre-btn" onClick={onManage}>
              Quitter ou supprimer un arbre
            </button>
          )}
        </div>

        <button type="button" className="arbre-link" onClick={onHelp}>
          Comment ça marche ?
        </button>

        {email && <p className="arbre-hint arbre-account">Connecté avec {email}</p>}

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
