"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { Datum } from "family-chart";
import {
  EMPTY_DATE,
  addRelative,
  linkChildrenToCouple,
  buildPerson,
  suggestPersons,
  type AddKind,
  type PartialInput,
  type Suggestion,
} from "@/lib/editTree";
import { plainName } from "@/lib/navigation";
import { describePerson as describe } from "@/lib/describe";
import DateFields from "./DateFields";

type Props = {
  treeId: string;
  /** Personne à laquelle on rattache la nouvelle personne. */
  anchor: Datum;
  relation: AddKind;
  people: Datum[];
  onClose: () => void;
  /** Appelé après un ajout réussi, avec le nom de la personne ajoutée. */
  onDone: (label: string) => void;
};


const TITLES: Record<AddKind, string> = {
  sibling: "Ajouter un frère ou une sœur à",
  child: "Ajouter un enfant à",
  spouse: "Ajouter un conjoint à",
  parent: "Ajouter un parent à",
};

export default function AddPersonDialog({ treeId, anchor, relation, people, onClose, onDone }: Props) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);

  const spouses = useMemo(
    () => anchor.rels.spouses?.map((id) => people.find((p) => p.id === id)).filter((p): p is Datum => Boolean(p)) ?? [],
    [anchor, people]
  );

  // Conjoint : enfants de la personne qui n'ont qu'elle comme parent connu (ils sont peut-être aussi ceux du conjoint)
  const soloChildren = useMemo(
    () =>
      relation === "spouse"
        ? (anchor.rels.children ?? [])
            .map((id) => people.find((p) => p.id === id))
            .filter((c): c is Datum => Boolean(c) && (c as Datum).rels.parents.length === 1)
        : [],
    [anchor, people, relation]
  );
  const [sharedKids, setSharedKids] = useState<string[]>([]);

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [gender, setGender] = useState<"" | "M" | "F">("");
  const [birth, setBirth] = useState<PartialInput>(EMPTY_DATE);
  const [deceased, setDeceased] = useState(false);
  const [death, setDeath] = useState<PartialInput>(EMPTY_DATE);
  // Enfant : "" = pas encore choisi, "none" = autre parent inconnu, sinon id du conjoint
  const [other, setOther] = useState(spouses.length === 0 ? "none" : spouses.length === 1 ? spouses[0].id : "");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = `${first} ${last}`.trim();

  useEffect(() => firstRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Suggestions pendant la frappe (après une courte pause)
  useEffect(() => {
    if (picked || query.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      suggestPersons(treeId, query)
        .then((rows) => {
          if (!cancelled) setSuggestions(rows.filter((r) => r.id !== anchor.id));
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, picked, treeId, anchor.id]);

  const shownSuggestions = !picked && query.length >= 2 ? suggestions : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (relation === "child" && other === "") {
      setError("Choisis l'autre parent (ou « inconnu »).");
      return;
    }

    let person;
    if (!picked) {
      const built = buildPerson(first, last, gender, birth, deceased, death);
      if (typeof built === "string") return setError(built);
      person = built;
    }

    setBusy(true);
    try {
      // Un frère ou une sœur est ajouté comme enfant des mêmes parents que la personne
      const sibling = relation === "sibling";
      const parentIds = anchor.rels.parents ?? [];
      if (sibling && parentIds.length === 0) throw new Error("Aucun parent connu : ajoute d'abord un parent.");
      const newId = await addRelative({
        treeId,
        anchorId: sibling ? parentIds[0] : anchor.id,
        relation: sibling ? "child" : relation,
        otherId: sibling ? (parentIds[1] ?? null) : relation === "child" && other !== "none" ? other : null,
        existingId: picked?.id ?? null,
        person,
      });
      if (relation === "spouse" && sharedKids.length > 0) {
        try {
          await linkChildrenToCouple(treeId, anchor.id, newId, sharedKids);
        } catch (err) {
          setError(`Le conjoint est ajouté, mais les enfants n'ont pas pu être reliés : ${err instanceof Error ? err.message : err}. Tu peux le refaire via Modifier, puis Corriger les liens.`);
          setBusy(false);
          return;
        }
      }
      onDone(picked ? [picked.first_names, picked.last_name].filter(Boolean).join(" ") : `${first} ${last}`.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const pickedName = picked ? [picked.first_names, picked.last_name].filter(Boolean).join(" ") : "";
  const pickedDatum = picked ? people.find((p) => p.id === picked.id) : undefined;

  return (
    <div className="arbre-modal-backdrop">
      <form className="arbre-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <h2 id={titleId}>
          {TITLES[relation]} <span className="arbre-modal-name">{plainName(anchor)}</span>
        </h2>

        {relation === "child" && spouses.length > 0 && (
          <label className="arbre-label">
            Autre parent
            <select className="arbre-field" value={other} onChange={(e) => setOther(e.target.value)}>
              {spouses.length > 1 && <option value="">Choisir...</option>}
              {spouses.map((s) => (
                <option key={s.id} value={s.id}>
                  {plainName(s)}
                </option>
              ))}
              <option value="none">Autre parent inconnu</option>
            </select>
          </label>
        )}

        {picked ? (
          <div className="arbre-picked">
            <div>
              <strong>{pickedName}</strong> est déjà dans l&apos;arbre
              {pickedDatum && describe(pickedDatum, people) ? <span> ({describe(pickedDatum, people)})</span> : null}. Elle sera
              simplement reliée, sans créer de doublon.
            </div>
            <button type="button" className="arbre-link" onClick={() => setPicked(null)}>
              Créer une nouvelle personne à la place
            </button>
          </div>
        ) : (
          <>
            <div className="arbre-name-row">
              <label className="arbre-label">
                Prénom
                <input
                  ref={firstRef}
                  className="arbre-field"
                  value={first}
                  autoComplete="off"
                  onChange={(e) => setFirst(e.target.value)}
                />
              </label>
              <label className="arbre-label">
                Nom
                <input className="arbre-field" value={last} autoComplete="off" onChange={(e) => setLast(e.target.value)} />
              </label>
            </div>

            {shownSuggestions.length > 0 && (
              <div className="arbre-suggest" role="listbox" aria-label="Personnes déjà dans l'arbre">
                <div className="arbre-suggest-title">Déjà dans l&apos;arbre ? Choisis la personne pour éviter un doublon :</div>
                {shownSuggestions.map((s) => {
                  const datum = people.find((p) => p.id === s.id);
                  const name = [s.first_names, s.last_name].filter(Boolean).join(" ");
                  return (
                    <button key={s.id} type="button" role="option" aria-selected={false} className="arbre-suggest-item" onClick={() => setPicked(s)}>
                      <span className="arbre-suggest-name">{name}</span>
                      <span className="arbre-suggest-info">{describe(datum, people) || "aucun détail"}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <fieldset className="arbre-fieldset">
              <legend>Genre</legend>
              <div className="arbre-radios">
                <label>
                  <input type="radio" name="gender" checked={gender === "M"} onChange={() => setGender("M")} /> Homme
                </label>
                <label>
                  <input type="radio" name="gender" checked={gender === "F"} onChange={() => setGender("F")} /> Femme
                </label>
              </div>
            </fieldset>

            <DateFields label="Naissance (facultatif, même partielle)" value={birth} onChange={setBirth} />

            <label className="arbre-check">
              <input type="checkbox" checked={deceased} onChange={(e) => setDeceased(e.target.checked)} /> Décédé(e)
            </label>
            {deceased && <DateFields label="Décès (facultatif, même partiel)" value={death} onChange={setDeath} />}
          </>
        )}

        {relation === "spouse" && soloChildren.length > 0 && (
          <fieldset className="arbre-fieldset">
            <legend>Enfants déjà dans l&apos;arbre</legend>
            <p className="arbre-hint">
              Ces enfants n&apos;ont pour l&apos;instant que {plainName(anchor)} comme parent connu. Coche ceux qui sont aussi les enfants de ce
              conjoint (ne coche rien si aucun).
            </p>
            {soloChildren.map((c) => (
              <label key={c.id} className="arbre-check">
                <input
                  type="checkbox"
                  checked={sharedKids.includes(c.id)}
                  onChange={(e) => setSharedKids((k) => (e.target.checked ? [...k, c.id] : k.filter((x) => x !== c.id)))}
                />{" "}
                {plainName(c)}
              </label>
            ))}
          </fieldset>
        )}

        {error && (
          <div className="arbre-login-error" role="alert">
            {error}
          </div>
        )}

        <div className="arbre-modal-actions">
          <button type="button" className="arbre-btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="arbre-btn arbre-btn-accent" disabled={busy}>
            {busy ? "Ajout..." : picked ? "Relier" : "Ajouter"}
          </button>
        </div>
      </form>
    </div>
  );
}
