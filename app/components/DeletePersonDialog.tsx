"use client";

import { useState } from "react";
import type { Datum } from "family-chart";
import { softDeletePerson } from "@/lib/editTree";
import { plainName } from "@/lib/navigation";
import Modal from "./Modal";

type Props = {
  person: Datum;
  people: Datum[];
  onClose: () => void;
  onDone: () => void;
};

/** Demande confirmation avant de supprimer, en montrant ce que la suppression touche. */
export default function DeletePersonDialog({ person, people, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = (ids: string[] | undefined) =>
    (ids ?? [])
      .map((id) => people.find((p) => p.id === id))
      .filter((p): p is Datum => Boolean(p))
      .map(plainName);
  const parents = names(person.rels.parents);
  const spouses = names(person.rels.spouses);
  const children = names(person.rels.children);
  const hasLinks = parents.length + spouses.length + children.length > 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await softDeletePerson(person.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        <>
          Supprimer <span className="arbre-modal-name">{plainName(person)}</span> ?
        </>
      }
      onClose={onClose}
      busy={busy}
    >
      {hasLinks ? (
        <>
          <p className="arbre-hint">Cette personne disparaîtra de l&apos;arbre. Ses liens seront rompus :</p>
          <ul className="arbre-impact">
            {parents.length > 0 && <li>Parents : {parents.join(", ")}</li>}
            {spouses.length > 0 && <li>Conjoint(s) : {spouses.join(", ")}</li>}
            {children.length > 0 && <li>Enfant(s) : {children.join(", ")}</li>}
          </ul>
          <p className="arbre-hint">
            Ces personnes restent dans l&apos;arbre, mais celles qui n&apos;étaient reliées que par elle n&apos;y seront plus
            visibles.
          </p>
        </>
      ) : (
        <p className="arbre-hint">Cette personne n&apos;a aucun lien. Elle disparaîtra de l&apos;arbre.</p>
      )}
      <p className="arbre-hint">Un bouton « Annuler » restera disponible quelques secondes après la suppression.</p>

      {error && (
        <div className="arbre-login-error" role="alert">
          {error}
        </div>
      )}

      <div className="arbre-modal-actions">
        <button type="button" className="arbre-btn" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button type="button" className="arbre-btn arbre-btn-danger-solid" onClick={confirm} disabled={busy}>
          {busy ? "Suppression..." : "Supprimer"}
        </button>
      </div>
    </Modal>
  );
}
