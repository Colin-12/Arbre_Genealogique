"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { createTree, SimilarTreeError, type NewPerson } from "@/lib/trees";

type Props = {
  onCreated: (treeId: string) => void;
  onClose: () => void;
};

const blank = (): NewPerson => ({ first_names: "", last_name: "", gender: "", birth_year: "", relation: "" });
const MAX_PEOPLE = 5;

/** Création d'un arbre : un nom et 1 à 5 personnes pour commencer. Prévient si un arbre qui ressemble existe déjà. */
export default function CreateTreeDialog({ onCreated, onClose }: Props) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [people, setPeople] = useState<NewPerson[]>([blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function update(i: number, patch: Partial<NewPerson>) {
    setSimilar(false);
    setPeople((list) => list.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  }

  const filled = people.filter((p) => p.first_names.trim() || p.last_name.trim());

  async function submit(force: boolean) {
    setError(null);
    if (filled.length === 0) {
      setError("Indique au moins une personne pour commencer l'arbre.");
      return;
    }
    if (filled.some((p) => p.gender === "")) {
      setError("Indique si chaque personne est un homme ou une femme.");
      return;
    }
    if (filled.slice(1).some((p) => p.relation === "")) {
      setError("Indique le lien de chaque personne avec la première (conjoint, parent ou enfant).");
      return;
    }
    setBusy(true);
    try {
      const id = await createTree(name, filled, force);
      onCreated(id);
    } catch (e) {
      if (e instanceof SimilarTreeError) setSimilar(true);
      else setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(false);
  }

  return (
    <div className="arbre-modal-backdrop">
      <form className="arbre-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={onSubmit}>
        <h2 id={titleId}>Créer un arbre</h2>

        {error && (
          <div className="arbre-login-error" role="alert">
            {error}
          </div>
        )}

        <label className="arbre-label" htmlFor="tree-name">
          Nom de l&apos;arbre
        </label>
        <input
          id="tree-name"
          className="arbre-field"
          value={name}
          maxLength={100}
          placeholder="Ex. : Famille Dupont"
          onChange={(e) => {
            setName(e.target.value);
            setSimilar(false);
          }}
          required
        />

        <span className="arbre-label">Par qui commencer ?</span>
        <span className="arbre-hint">La première personne est le point de départ de l&apos;arbre (par exemple toi). Ajoute si tu veux son conjoint, ses parents ou ses enfants : les autres proches s&apos;ajouteront ensuite depuis l&apos;arbre.</span>

        {people.map((p, i) => (
          <fieldset key={i} className="arbre-fieldset">
            <legend>Personne {i + 1}</legend>
            <div className="arbre-name-row">
              <input
                className="arbre-field"
                placeholder="Prénom"
                aria-label={`Prénom de la personne ${i + 1}`}
                value={p.first_names}
                onChange={(e) => update(i, { first_names: e.target.value })}
              />
              <input
                className="arbre-field"
                placeholder="Nom"
                aria-label={`Nom de la personne ${i + 1}`}
                value={p.last_name}
                onChange={(e) => update(i, { last_name: e.target.value })}
              />
            </div>
            <div className="arbre-name-row">
              <select
                className="arbre-field"
                aria-label={`Sexe de la personne ${i + 1}`}
                value={p.gender}
                onChange={(e) => update(i, { gender: e.target.value as NewPerson["gender"] })}
              >
                <option value="">Homme ou femme ?</option>
                <option value="M">Homme</option>
                <option value="F">Femme</option>
              </select>
              <input
                className="arbre-field"
                inputMode="numeric"
                placeholder="Année de naissance"
                aria-label={`Année de naissance de la personne ${i + 1}`}
                maxLength={4}
                value={p.birth_year}
                onChange={(e) => update(i, { birth_year: e.target.value.replace(/\D/g, "") })}
              />
            </div>
            {i > 0 && (
              <select
                className="arbre-field"
                aria-label={`Lien de la personne ${i + 1} avec la personne 1`}
                value={p.relation}
                onChange={(e) => update(i, { relation: e.target.value as NewPerson["relation"] })}
              >
                <option value="">Lien avec la personne 1 ?</option>
                <option value="spouse">Conjoint ou conjointe de la personne 1</option>
                <option value="parent">Père ou mère de la personne 1</option>
                <option value="child">Enfant de la personne 1</option>
              </select>
            )}
          </fieldset>
        ))}

        {people.length < MAX_PEOPLE && (
          <button type="button" className="arbre-link" onClick={() => setPeople((l) => [...l, blank()])}>
            Ajouter une personne
          </button>
        )}

        {similar && (
          <div className="arbre-picked" role="alert">
            <div>
              <strong>Un arbre qui ressemble à celui-ci existe déjà.</strong> Si c&apos;est ta famille, demande une invitation à son
              propriétaire plutôt que d&apos;en créer un second : vous éviterez d&apos;avoir deux arbres à fusionner plus tard.
            </div>
            <div className="arbre-share-actions">
              <button type="button" className="arbre-btn" disabled={busy} onClick={() => submit(true)}>
                Créer quand même
              </button>
              <button type="button" className="arbre-btn arbre-btn-accent" onClick={onClose}>
                Annuler
              </button>
            </div>
          </div>
        )}

        <div className="arbre-modal-actions">
          <button type="button" className="arbre-btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="arbre-btn arbre-btn-accent" disabled={busy || !name.trim()}>
            {busy ? "Création..." : "Créer l'arbre"}
          </button>
        </div>
      </form>
    </div>
  );
}
