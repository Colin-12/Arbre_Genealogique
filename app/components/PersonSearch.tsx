"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Datum } from "family-chart";
import { describePerson } from "@/lib/describe";
import { plainName } from "@/lib/navigation";

type Props = {
  people: Datum[];
  /** Appelé quand on choisit une personne (clic ou Entrée). */
  onPick: (id: string) => void;
  autoFocus?: boolean;
};

const MAX_RESULTS = 20;

/** Minuscules et sans accents : "Léa" et "lea" se valent. */
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Recherche dans toutes les personnes de l'arbre, visibles à l'écran ou non. */
export default function PersonSearch({ people, onPick, autoFocus = false }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const index = useMemo(
    () =>
      people.map((p) => ({
        person: p,
        name: norm(plainName(p)),
        // Mots du nom ("pierre-louis le gall" -> pierre, louis, le, gall)
        words: norm(plainName(p)).split(/[\s'-]+/).filter(Boolean),
        first: norm(String(p.data["first name"] ?? "")),
        last: norm(String(p.data["last name"] ?? "")),
      })),
    [people]
  );

  const results = useMemo(() => {
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return index
      // Chaque mot tapé doit être le début d'un mot du nom ("le" trouve Léa et Le Gall, pas Camille)
      .filter((e) => tokens.every((t) => e.words.some((w) => w.startsWith(t))))
      .map((e) => ({
        ...e,
        // Prénom ou nom qui commence par ce qui est tapé : en premier
        rank: tokens.some((t) => e.first.startsWith(t) || e.last.startsWith(t)) ? 0 : 1,
      }))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, MAX_RESULTS);
  }, [index, query]);

  const pick = (id: string) => {
    setQuery("");
    setActive(0);
    onPick(id);
  };

  const open = query.trim().length > 0;

  return (
    <div className="arbre-search-box">
      <input
        ref={inputRef}
        className="arbre-field arbre-search-input"
        type="search"
        placeholder="Rechercher une personne"
        aria-label="Rechercher une personne dans l'arbre"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${results[active].person.id}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (results[active]) pick(results[active].person.id);
          } else if (e.key === "Escape") {
            setQuery("");
          }
        }}
      />
      {open && (
        <div className="arbre-panel arbre-search-results" id={listId} role="listbox">
          {results.length === 0 ? (
            <div className="arbre-search-empty">Aucune personne trouvée.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.person.id}
                id={`${listId}-${r.person.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? "arbre-suggest-item is-active" : "arbre-suggest-item"}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r.person.id)}
              >
                <span className="arbre-suggest-name">{plainName(r.person)}</span>
                <span className="arbre-suggest-info">{describePerson(r.person, people) || "aucun détail"}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
