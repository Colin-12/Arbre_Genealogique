"use client";

import { useState } from "react";
import type { Datum } from "family-chart";
import { linkChildrenToCouple, removeRelation } from "@/lib/editTree";
import { describePerson } from "@/lib/describe";
import { plainName } from "@/lib/navigation";
import Modal from "./Modal";

type Props = {
  treeId: string;
  anchor: Datum;
  people: Datum[];
  onClose: () => void;
  /** Appelé après chaque lien retiré (l'arbre doit être rechargé). */
  onChanged: (message: string) => void;
};

/** Un lien à retirer : removeRelation(personId, kind, otherId). */
type Action = { kind: "parent" | "spouse"; personId: string; otherId: string; label: string };
const keyOf = (a: Action) => `${a.kind}:${a.personId}:${a.otherId}`;

/** Liste les liens d'une personne et permet d'en retirer un (sans supprimer personne). */
export default function LinksDialog({ treeId, anchor, people, onClose, onChanged }: Props) {
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => people.find((p) => p.id === id)).filter((p): p is Datum => Boolean(p));
  const parents = find(anchor.rels.parents);
  const spouses = find(anchor.rels.spouses);
  const children = find(anchor.rels.children);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await removeRelation(treeId, pending.personId, pending.kind, pending.otherId);
      onChanged(`Lien retiré : ${pending.label}`);
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  /** Une ligne : la personne reliée, et le bouton (ou la confirmation) pour retirer le lien. */
  const row = (shown: Datum, action: Action, buttonLabel: string, disabledReason?: string) => {
    const isPending = pending !== null && keyOf(pending) === keyOf(action);
    return (
      <li key={keyOf(action)} className="arbre-link-row">
        <div className="arbre-link-person">
          <strong>{plainName(shown)}</strong>
          <span className="arbre-suggest-info">{describePerson(shown, people) || "aucun détail"}</span>
          {disabledReason && <span className="arbre-hint">{disabledReason}</span>}
        </div>
        {isPending ? (
          <div className="arbre-link-confirm">
            <button type="button" className="arbre-btn" onClick={() => setPending(null)} disabled={busy}>
              Non
            </button>
            <button type="button" className="arbre-btn arbre-btn-danger-solid" onClick={confirm} disabled={busy}>
              {busy ? "..." : "Retirer"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="arbre-btn arbre-btn-danger"
            disabled={Boolean(disabledReason) || busy}
            onClick={() => {
              setError(null);
              setPending(action);
            }}
          >
            {buttonLabel}
          </button>
        )}
      </li>
    );
  };

  // Enfants qui n'ont que cette personne comme parent connu : ils peuvent être rattachés à un conjoint
  const soloChildren = children.filter((c) => c.rels.parents.length === 1);
  const [kids, setKids] = useState<Record<string, string[]>>({});

  async function linkKids(spouse: Datum) {
    const ids = kids[spouse.id] ?? [];
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await linkChildrenToCouple(treeId, anchor.id, spouse.id, ids);
      onChanged(`${ids.length} enfant(s) relié(s) aussi à ${plainName(spouse)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  const nothing = parents.length + spouses.length + children.length === 0;
  const me = plainName(anchor);

  return (
    <Modal
      title={
        <>
          Corriger les liens de <span className="arbre-modal-name">{me}</span>
        </>
      }
      onClose={onClose}
      busy={busy}
    >
      {nothing && <p className="arbre-hint">Cette personne n&apos;a aucun lien dans l&apos;arbre.</p>}

      {parents.length > 0 && (
        <section className="arbre-links-section">
          <h3>Parents</h3>
          <ul>
            {parents.map((p) =>
              row(p, { kind: "parent", personId: anchor.id, otherId: p.id, label: `${me} et ${plainName(p)}` }, "Détacher")
            )}
          </ul>
        </section>
      )}

      {spouses.length > 0 && (
        <section className="arbre-links-section">
          <h3>Conjoints</h3>
          <ul>
            {spouses.map((s) => {
              const shared = children.filter((c) => c.rels.parents.includes(s.id)).length;
              return row(
                s,
                { kind: "spouse", personId: anchor.id, otherId: s.id, label: `couple ${me} et ${plainName(s)}` },
                "Retirer le couple",
                shared > 0 ? `${shared} enfant(s) en commun : détache-les d'abord de leurs parents.` : undefined
              );
            })}
          </ul>
          {soloChildren.length > 0 &&
            spouses.map((s) => {
              const chosen = kids[s.id] ?? [];
              return (
                <div key={`kids-${s.id}`} className="arbre-links-kids">
                  <p className="arbre-hint">
                    Enfants de {me} qui sont aussi ceux de {plainName(s)} ? Coche-les pour les relier aux deux parents :
                  </p>
                  {soloChildren.map((c) => (
                    <label key={c.id} className="arbre-check">
                      <input
                        type="checkbox"
                        checked={chosen.includes(c.id)}
                        disabled={busy}
                        onChange={(e) =>
                          setKids((k) => ({ ...k, [s.id]: e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id) }))
                        }
                      />{" "}
                      {plainName(c)}
                    </label>
                  ))}
                  <button type="button" className="arbre-btn" disabled={busy || chosen.length === 0} onClick={() => linkKids(s)}>
                    Relier à {plainName(s)}
                  </button>
                </div>
              );
            })}
        </section>
      )}

      {children.length > 0 && (
        <section className="arbre-links-section">
          <h3>Enfants</h3>
          <ul>
            {children.map((c) =>
              row(c, { kind: "parent", personId: c.id, otherId: anchor.id, label: `${plainName(c)} et ${me}` }, "Détacher")
            )}
          </ul>
        </section>
      )}

      {error && (
        <div className="arbre-login-error" role="alert">
          {error}
        </div>
      )}

      <p className="arbre-hint">
        Retirer un lien ne supprime personne. Pour rattacher quelqu&apos;un ailleurs : bouton Ajouter, puis choisis la
        personne dans les suggestions (aucun doublon créé). Une personne détachée n&apos;apparaît plus dans l&apos;arbre
        tant qu&apos;elle n&apos;est pas rattachée.
      </p>

      <div className="arbre-modal-actions">
        <button type="button" className="arbre-btn" onClick={onClose} disabled={busy}>
          Fermer
        </button>
      </div>
    </Modal>
  );
}
