"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { Datum } from "family-chart";
import {
  EMPTY_DATE,
  addRelative,
  parsePartialDate,
  suggestPersons,
  type PartialInput,
  type Relation,
  type Suggestion,
} from "@/lib/editTree";
import { plainName } from "@/lib/navigation";

type Props = {
  treeId: string;
  /** Personne à laquelle on rattache la nouvelle personne. */
  anchor: Datum;
  relation: Relation;
  people: Datum[];
  onClose: () => void;
  /** Appelé après un ajout réussi, avec le nom de la personne ajoutée. */
  onDone: (label: string) => void;
};

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const TITLES: Record<Relation, string> = {
  child: "Ajouter un enfant à",
  spouse: "Ajouter un conjoint à",
  parent: "Ajouter un parent à",
};

/** "née en 1984, fille de Anne et Karim" : ce qui permet de reconnaître la bonne personne. */
function describe(person: Datum | undefined, people: Datum[]): string {
  if (!person) return "";
  const gender = person.data["gender"];
  const year = /^(\d{4})/.exec(String(person.data["birthday"] ?? ""))?.[1];
  const parts: string[] = [];
  if (year) parts.push(`${gender === "F" ? "née" : "né"} en ${year}`);
  const parents = person.rels.parents
    .map((id) => people.find((p) => p.id === id))
    .map((p) => String(p?.data["first name"] ?? "").trim())
    .filter(Boolean);
  if (parents.length > 0) {
    parts.push(`${gender === "F" ? "fille" : gender === "M" ? "fils" : "enfant"} de ${parents.join(" et ")}`);
  }
  return parts.join(", ");
}

function DateFields({ label, value, onChange }: { label: string; value: PartialInput; onChange: (v: PartialInput) => void }) {
  return (
    <fieldset className="arbre-fieldset">
      <legend>{label}</legend>
      <div className="arbre-date-row">
        <input
          className="arbre-field"
          inputMode="numeric"
          placeholder="Année"
          maxLength={4}
          value={value.year}
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, "") })}
          aria-label={`${label} : année`}
        />
        <select
          className="arbre-field"
          value={value.month}
          onChange={(e) => onChange({ ...value, month: e.target.value, day: e.target.value ? value.day : "" })}
          aria-label={`${label} : mois`}
        >
          <option value="">Mois</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="arbre-field"
          inputMode="numeric"
          placeholder="Jour"
          maxLength={2}
          value={value.day}
          disabled={!value.month}
          onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, "") })}
          aria-label={`${label} : jour`}
        />
      </div>
    </fieldset>
  );
}

export default function AddPersonDialog({ treeId, anchor, relation, people, onClose, onDone }: Props) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);

  const spouses = useMemo(
    () => anchor.rels.spouses?.map((id) => people.find((p) => p.id === id)).filter((p): p is Datum => Boolean(p)) ?? [],
    [anchor, people]
  );

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
      if (!first.trim() && !last.trim()) return setError("Il faut au moins un prénom ou un nom.");
      if (!gender) return setError("Indique si c'est un homme ou une femme.");
      const b = parsePartialDate(birth, "Naissance");
      if (typeof b === "string") return setError(b);
      const d = deceased ? parsePartialDate(death, "Décès") : { date: null, precision: null };
      if (typeof d === "string") return setError(d);
      person = { first, last, gender, birth: b, death: d };
    }

    setBusy(true);
    try {
      await addRelative({
        treeId,
        anchorId: anchor.id,
        relation,
        otherId: relation === "child" && other !== "none" ? other : null,
        existingId: picked?.id ?? null,
        person,
      });
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
