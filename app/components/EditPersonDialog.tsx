"use client";

import { useEffect, useRef, useState } from "react";
import type { Datum } from "family-chart";
import { NOTES_MAX, buildPerson, toPartialInput, updatePerson } from "@/lib/editTree";
import { plainName } from "@/lib/navigation";
import DateFields from "./DateFields";
import Modal from "./Modal";

type Props = {
  person: Datum;
  onClose: () => void;
  onDone: (label: string) => void;
};

/** Corrige prénom, nom, genre et dates d'une personne déjà dans l'arbre. */
export default function EditPersonDialog({ person, onClose, onDone }: Props) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [first, setFirst] = useState(String(person.data["first name"] ?? ""));
  const [last, setLast] = useState(String(person.data["last name"] ?? ""));
  const [gender, setGender] = useState<"" | "M" | "F">(person.data["gender"] === "M" ? "M" : person.data["gender"] === "F" ? "F" : "");
  const [birth, setBirth] = useState(toPartialInput(person.data["birthday"]));
  const [deceased, setDeceased] = useState(Boolean(person.data["deathday"]));
  const [death, setDeath] = useState(toPartialInput(person.data["deathday"]));
  const [birthName, setBirthName] = useState(String(person.data["birth name"] ?? ""));
  const [birthPlace, setBirthPlace] = useState(String(person.data["birth place"] ?? ""));
  const [deathPlace, setDeathPlace] = useState(String(person.data["death place"] ?? ""));
  const [notes, setNotes] = useState(String(person.data["notes"] ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => firstRef.current?.focus(), []);

  async function submit() {
    setError(null);
    const built = buildPerson(first, last, gender, birth, deceased, death, {
      birthName,
      birthPlace,
      deathPlace: deceased ? deathPlace : "",
      notes,
    });
    if (typeof built === "string") return setError(built);
    setBusy(true);
    try {
      await updatePerson(person.id, built);
      onDone(`${first} ${last}`.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        <>
          Modifier <span className="arbre-modal-name">{plainName(person)}</span>
        </>
      }
      onClose={onClose}
      busy={busy}
      onSubmit={submit}
    >
      <div className="arbre-name-row">
        <label className="arbre-label">
          Prénom
          <input ref={firstRef} className="arbre-field" value={first} autoComplete="off" onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="arbre-label">
          Nom
          <input className="arbre-field" value={last} autoComplete="off" onChange={(e) => setLast(e.target.value)} />
        </label>
      </div>

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

      <label className="arbre-label">
        Nom de naissance (si différent)
        <input className="arbre-field" value={birthName} autoComplete="off" onChange={(e) => setBirthName(e.target.value)} />
      </label>

      <DateFields label="Naissance (facultatif, même partielle)" value={birth} onChange={setBirth} />

      <label className="arbre-label">
        Lieu de naissance
        <input
          className="arbre-field"
          value={birthPlace}
          autoComplete="off"
          placeholder="Ville, pays"
          onChange={(e) => setBirthPlace(e.target.value)}
        />
      </label>

      <label className="arbre-check">
        <input type="checkbox" checked={deceased} onChange={(e) => setDeceased(e.target.checked)} /> Décédé(e)
      </label>
      {deceased && (
        <>
          <DateFields label="Décès (facultatif, même partiel)" value={death} onChange={setDeath} />
          <label className="arbre-label">
            Lieu de décès
            <input
              className="arbre-field"
              value={deathPlace}
              autoComplete="off"
              placeholder="Ville, pays"
              onChange={(e) => setDeathPlace(e.target.value)}
            />
          </label>
        </>
      )}

      <label className="arbre-label">
        Commentaire général
        <textarea
          className="arbre-field arbre-textarea"
          rows={5}
          maxLength={NOTES_MAX}
          value={notes}
          placeholder="Métier, anecdotes, histoire de la personne..."
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

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
          {busy ? "Enregistrement..." : "Enregistrer"}
        </button>
      </div>
    </Modal>
  );
}
