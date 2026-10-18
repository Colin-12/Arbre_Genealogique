"use client";

import { useId, useEffect } from "react";
import type { Datum } from "family-chart";
import { ageText, formatPartialDate } from "@/lib/dates";
import { sortSiblings } from "@/lib/family";
import { plainName } from "@/lib/navigation";

type Props = {
  person: Datum;
  people: Datum[];
  /** Vrai pour les propriétaires et éditeurs : affiche "Modifier". */
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
  /** Un clic sur un proche le place au centre de l'arbre (la fiche suit). */
  onGo: (id: string) => void;
};

function text(person: Datum | undefined, key: string): string {
  return String(person?.data[key] ?? "").trim();
}

/** "12 mai 1984 à Brest", "1984", "à Brest" : date et lieu sur une même ligne. */
function when(date: string, place: string): string {
  const d = formatPartialDate(date);
  if (d && place) return `${d} à ${place}`;
  return d || (place ? `à ${place}` : "");
}

function Relatives({ title, list, onGo }: { title: string; list: Datum[]; onGo: (id: string) => void }) {
  if (list.length === 0) return null;
  return (
    <section className="arbre-sheet-section">
      <h3>{title}</h3>
      <ul className="arbre-sheet-relatives">
        {list.map((r) => {
          const year = /^(\d{4})/.exec(text(r, "birthday"))?.[1];
          return (
            <li key={r.id}>
              <button type="button" className="arbre-sheet-relative" onClick={() => onGo(r.id)}>
                {plainName(r)}
                {year ? <span className="arbre-hint-inline"> ({year})</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Fiche d'une personne : dates, lieux, âge, proches et commentaire général. */
export default function PersonSheet({ person, people, canEdit, onEdit, onClose, onGo }: Props) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byId = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => people.find((p) => p.id === id)).filter((p): p is Datum => Boolean(p));
  const parents = byId(person.rels.parents);
  const spouses = byId(person.rels.spouses);
  // Enfants du plus âgé au plus jeune, comme dans l'arbre
  const children = byId(person.rels.children).sort(sortSiblings);

  const born = when(text(person, "birthday"), text(person, "birth place"));
  const died = when(text(person, "deathday"), text(person, "death place"));
  const age = ageText(person);
  const birthName = text(person, "birth name");
  const feminine = person.data["gender"] === "F";
  const notes = text(person, "notes");
  const empty = !born && !died && !notes && parents.length + spouses.length + children.length === 0;

  return (
    <div
      className="arbre-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="arbre-modal arbre-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="arbre-sheet-title">
          {plainName(person)}
        </h2>
        {birthName && birthName !== text(person, "last name") && (
          <div className="arbre-sheet-sub">{feminine ? "née" : "né"} {birthName}</div>
        )}

        <dl className="arbre-sheet-facts">
          {born && (
            <>
              <dt>{feminine ? "Née" : "Né"}</dt>
              <dd>{born}</dd>
            </>
          )}
          {died && (
            <>
              <dt>Décès</dt>
              <dd>{died}</dd>
            </>
          )}
          {age && (
            <>
              <dt>Âge</dt>
              <dd>{age}</dd>
            </>
          )}
        </dl>

        <Relatives title="Parents" list={parents} onGo={onGo} />
        <Relatives title={spouses.length > 1 ? "Conjoints" : "Conjoint"} list={spouses} onGo={onGo} />
        <Relatives title="Enfants" list={children} onGo={onGo} />

        {notes && (
          <section className="arbre-sheet-section">
            <h3>Commentaire</h3>
            <p className="arbre-sheet-notes">{notes}</p>
          </section>
        )}

        {empty && (
          <p className="arbre-hint">
            Aucune information pour l&apos;instant.{canEdit ? " Utilise « Modifier » pour ajouter des dates, des lieux ou un commentaire." : ""}
          </p>
        )}

        <div className="arbre-modal-actions">
          <button type="button" className="arbre-btn" onClick={onClose}>
            Fermer
          </button>
          {canEdit && (
            <button type="button" className="arbre-btn arbre-btn-accent" onClick={onEdit}>
              Modifier
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
