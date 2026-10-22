"use client";

import { useEffect, useRef, useState } from "react";
import { renameTree } from "@/lib/trees";
import Modal from "./Modal";

type Props = {
  treeId: string;
  currentName: string;
  onClose: () => void;
  /** Appelé après un renommage réussi, avec le nouveau nom. */
  onDone: (name: string) => void;
};

/** Renommer un arbre (propriétaire). */
export default function RenameTreeDialog({ treeId, currentName, onClose, onDone }: Props) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = name.trim();
  const unchanged = trimmed === currentName.trim();

  async function save() {
    setError(null);
    if (trimmed.length === 0) return setError("Donne un nom à l'arbre.");
    if (trimmed.length > 100) return setError("Le nom est trop long (100 caractères au maximum).");
    setBusy(true);
    try {
      onDone(await renameTree(treeId, trimmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Renommer l'arbre" onClose={onClose} busy={busy} onSubmit={save}>
      <label className="arbre-label">
        Nom de l&apos;arbre
        <input
          ref={inputRef}
          className="arbre-field"
          value={name}
          maxLength={100}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="arbre-hint">Le nouveau nom est visible tout de suite par tous les membres de l&apos;arbre.</p>

      {error && (
        <div className="arbre-login-error" role="alert">
          {error}
        </div>
      )}

      <div className="arbre-modal-actions">
        <button type="button" className="arbre-btn" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button type="submit" className="arbre-btn arbre-btn-accent" disabled={busy || unchanged || trimmed.length === 0}>
          {busy ? "Enregistrement..." : "Enregistrer"}
        </button>
      </div>
    </Modal>
  );
}
