"use client";

import { useId, useEffect, useRef, useState } from "react";
import type { Datum } from "family-chart";
import { ageText, formatPartialDate } from "@/lib/dates";
import { sortSiblings } from "@/lib/family";
import { plainName } from "@/lib/navigation";
import { removePersonPhoto, resizeToJpeg, setPersonPhoto } from "@/lib/photos";

type Props = {
  treeId?: string;
  person: Datum;
  people: Datum[];
  /** Vrai pour les propriétaires et éditeurs : affiche "Modifier". */
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
  /** Un clic sur un proche le place au centre de l'arbre (la fiche suit). */
  onGo: (id: string) => void;
  /** Appelé après l'ajout, le remplacement ou le retrait d'une photo (l'arbre se recharge). */
  onPhotoChanged: () => void;
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
export default function PersonSheet({ treeId, person, people, canEdit, onEdit, onClose, onGo, onPhotoChanged }: Props) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const photo = text(person, "avatar");
  const photoPath = text(person, "photo_path");
  const canPhoto = canEdit && Boolean(treeId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoom) setZoom(false);
      else if (!busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, zoom, busy]);

  // Le message de confirmation disparaît seul
  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => setInfo(null), 3000);
    return () => window.clearTimeout(timer);
  }, [info]);

  async function choose(file: File | undefined) {
    if (!file || !treeId) return;
    setPhotoError(null);
    setInfo(null);
    setBusy(true);
    try {
      const blob = await resizeToJpeg(file);
      await setPersonPhoto(treeId, person.id, blob, photoPath || null);
      setInfo("Photo enregistrée");
      onPhotoChanged();
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    if (!photoPath) return;
    setPhotoError(null);
    setInfo(null);
    setBusy(true);
    try {
      await removePersonPhoto(person.id, photoPath);
      setInfo("Photo retirée");
      onPhotoChanged();
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
    <>
    <div
      className="arbre-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="arbre-modal arbre-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="arbre-sheet-head">
          {photo ? (
            <button type="button" className="arbre-sheet-photo" onClick={() => setZoom(true)} aria-label="Voir la photo en grand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`Photo de ${plainName(person)}`} />
            </button>
          ) : (
            <div className={`arbre-sheet-photo is-empty ${feminine ? "is-female" : "is-male"}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z" />
              </svg>
            </div>
          )}
          <div className="arbre-sheet-ident">
            <h2 id={titleId} className="arbre-sheet-title">
              {plainName(person)}
            </h2>
            {birthName && birthName !== text(person, "last name") && (
              <div className="arbre-sheet-sub">{feminine ? "née" : "né"} {birthName}</div>
            )}
            {canPhoto && (
              <div className="arbre-sheet-photo-actions">
                <button type="button" className="arbre-link" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? "Envoi en cours..." : photo ? "Changer la photo" : "Ajouter une photo"}
                </button>
                {photo && !busy && (
                  <button type="button" className="arbre-link" onClick={remove}>
                    Retirer
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => choose(e.target.files?.[0])}
                  aria-label="Choisir une photo"
                />
              </div>
            )}
          </div>
        </div>
        {info && (
          <div className="arbre-sheet-info" role="status">
            {info}
          </div>
        )}
        {photoError && (
          <div className="arbre-login-error" role="alert">
            {photoError}
          </div>
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
    {zoom && photo && (
      <div className="arbre-lightbox" role="dialog" aria-label="Photo en grand" onClick={() => setZoom(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt={`Photo de ${plainName(person)}`} />
        <button type="button" className="arbre-lightbox-close" aria-label="Fermer la photo">×</button>
      </div>
    )}
    </>
  );
}
