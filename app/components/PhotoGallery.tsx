"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Datum } from "family-chart";
import { plainName } from "@/lib/navigation";
import {
  addGalleryPhoto,
  deletePhoto,
  loadGallery,
  loadQuota,
  setPhotoCaption,
  setPhotoPeople,
  type GalleryPhoto,
  type Quota,
} from "@/lib/gallery";
import type { Role } from "@/lib/sharing";

type Props = {
  treeId: string;
  personId: string;
  people: Datum[];
  role: Role | undefined;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Galerie d'une personne : miniatures, ajout de photos, et visionneuse avec légende et personnes identifiées. */
export default function PhotoGallery({ treeId, personId, people, role }: Props) {
  const canAdd = role === "owner" || role === "editor";
  const canCaption = canAdd || role === "commenter";

  const fileRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<GalleryPhoto[] | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await loadGallery(personId);
    setPhotos(list);
    if (canAdd) setQuota(await loadQuota(treeId).catch(() => null));
  }, [personId, treeId, canAdd]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();
      } catch (e) {
        if (!alive) return;
        setPhotos([]);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  async function onFiles(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (fileRef.current) fileRef.current.value = "";
    if (list.length === 0) return;
    setError(null);
    let done = 0;
    try {
      for (const f of list) {
        setProgress(`Envoi ${done + 1} sur ${list.length}...`);
        await addGalleryPhoto(treeId, f, null, [personId]);
        done++;
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setError(done > 0 ? `${done} photo${done > 1 ? "s" : ""} ajoutée${done > 1 ? "s" : ""}, puis : ${why}` : why);
    } finally {
      setProgress(null);
      await refresh().catch(() => {});
    }
  }

  const openIndex = photos && openId ? photos.findIndex((p) => p.id === openId) : -1;
  const open = openIndex >= 0 && photos ? photos[openIndex] : null;

  return (
    <section className="arbre-sheet-section arbre-gallery">
      <h3>Photos{photos && photos.length > 0 ? ` (${photos.length})` : ""}</h3>

      {error && (
        <div className="arbre-login-error" role="alert">
          {error}
        </div>
      )}

      {photos === null && <span className="arbre-hint">Chargement...</span>}

      {photos && photos.length > 0 && (
        <ul className="arbre-gallery-grid">
          {photos.map((p) => (
            <li key={p.id}>
              <button type="button" className="arbre-gallery-thumb" onClick={() => setOpenId(p.id)} aria-label={p.caption ? `Ouvrir la photo : ${p.caption}` : "Ouvrir la photo"}>
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.caption ?? ""} loading="lazy" />
                ) : (
                  <span className="arbre-hint">Photo indisponible</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {photos && photos.length === 0 && !error && (
        <p className="arbre-hint">Aucune photo pour l&apos;instant.{canAdd ? " Ajoute les premières ci-dessous." : ""}</p>
      )}

      {canAdd && (
        <div className="arbre-gallery-add">
          <button type="button" className="arbre-btn" disabled={progress !== null || photos === null} onClick={() => fileRef.current?.click()}>
            {progress ?? "Ajouter des photos"}
          </button>
          {quota && (
            <span className="arbre-hint">
              {quota.used} / {quota.max} photos dans l&apos;arbre
            </span>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} aria-label="Choisir des photos" />
        </div>
      )}

      {open && photos && (
        <Viewer
          key={open.id}
          photo={open}
          index={openIndex}
          count={photos.length}
          people={people}
          canAdd={canAdd}
          canCaption={canCaption}
          onClose={() => setOpenId(null)}
          onStep={(d) => setOpenId(photos[(openIndex + d + photos.length) % photos.length].id)}
          onChanged={async () => {
            await refresh();
          }}
        />
      )}
    </section>
  );
}

type ViewerProps = {
  photo: GalleryPhoto;
  index: number;
  count: number;
  people: Datum[];
  canAdd: boolean;
  canCaption: boolean;
  onClose: () => void;
  onStep: (delta: number) => void;
  onChanged: () => Promise<void>;
};

function Viewer({ photo, index, count, people, canAdd, canCaption, onClose, onStep, onChanged }: ViewerProps) {
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if (e.key === "Escape" && !busy) onClose();
      else if (!typing && count > 1 && e.key === "ArrowLeft") onStep(-1);
      else if (!typing && count > 1 && e.key === "ArrowRight") onStep(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, count, onClose, onStep]);

  const tagged = useMemo(
    () => photo.people.map((id) => people.find((p) => p.id === id)).filter((p): p is Datum => Boolean(p)),
    [photo.people, people]
  );
  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    return people
      .filter((p) => !photo.people.includes(p.id) && norm(plainName(p)).includes(q))
      .sort((a, b) => plainName(a).localeCompare(plainName(b), "fr"))
      .slice(0, 6);
  }, [people, photo.people, query]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const changed = caption.trim() !== (photo.caption ?? "").trim();

  return (
    <div className="arbre-lightbox arbre-viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="arbre-viewer-top">
        <span className="arbre-viewer-count">{count > 1 ? `${index + 1} / ${count}` : ""}</span>
        <button type="button" className="arbre-viewer-close" onClick={onClose} disabled={busy}>
          Fermer
        </button>
      </div>

      <div className="arbre-viewer-stage">
        {count > 1 && (
          <button type="button" className="arbre-viewer-nav is-prev" onClick={() => onStep(-1)} aria-label="Photo précédente" disabled={busy}>
            ‹
          </button>
        )}
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={photo.caption ?? "Photo"} />
        ) : (
          <span className="arbre-hint">Photo indisponible</span>
        )}
        {count > 1 && (
          <button type="button" className="arbre-viewer-nav is-next" onClick={() => onStep(1)} aria-label="Photo suivante" disabled={busy}>
            ›
          </button>
        )}
      </div>

      <div className="arbre-viewer-panel">
        {error && (
          <div className="arbre-login-error" role="alert">
            {error}
          </div>
        )}

        {canCaption ? (
          <div className="arbre-viewer-block">
            <label className="arbre-viewer-label" htmlFor="photo-caption">
              Légende
            </label>
            <textarea
              id="photo-caption"
              className="arbre-field"
              rows={2}
              maxLength={500}
              placeholder="Ex. : Mariage de Pierre et Claire, Brest, 1980"
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                setSaved(false);
              }}
            />
            <div className="arbre-viewer-row">
              <button
                type="button"
                className="arbre-btn arbre-btn-accent"
                disabled={busy || !changed}
                onClick={() =>
                  run(async () => {
                    await setPhotoCaption(photo.id, caption);
                    setSaved(true);
                    await onChanged();
                  })
                }
              >
                Enregistrer la légende
              </button>
              {saved && !changed && <span className="arbre-hint">Légende enregistrée.</span>}
            </div>
          </div>
        ) : (
          photo.caption && <p className="arbre-viewer-caption">{photo.caption}</p>
        )}

        <div className="arbre-viewer-block">
          <span className="arbre-viewer-label">Qui est sur cette photo ?</span>
          {tagged.length === 0 && <span className="arbre-hint">Personne n&apos;est identifié(e).</span>}
          <ul className="arbre-chips">
            {tagged.map((p) => (
              <li key={p.id} className="arbre-chip">
                <span>{plainName(p)}</span>
                {canAdd && photo.people.length > 1 && (
                  <button
                    type="button"
                    className="arbre-chip-remove"
                    disabled={busy}
                    aria-label={`Retirer ${plainName(p)} de cette photo`}
                    onClick={() =>
                      run(async () => {
                        await setPhotoPeople(photo.id, photo.people.filter((id) => id !== p.id));
                        await onChanged();
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canAdd && photo.people.length === 1 && (
            <span className="arbre-hint">Une photo reste associée à au moins une personne. Ajoute-en une autre avant de retirer celle-ci, ou supprime la photo.</span>
          )}
          {canAdd && (
            <>
              <input
                className="arbre-field"
                type="search"
                autoComplete="off"
                placeholder="Ajouter une personne (tape un nom)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Ajouter une personne sur la photo"
              />
              {matches.length > 0 && (
                <ul className="arbre-viewer-matches">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="arbre-sheet-relative"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await setPhotoPeople(photo.id, [...photo.people, p.id]);
                            setQuery("");
                            await onChanged();
                          })
                        }
                      >
                        {plainName(p)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {canAdd && (
          <div className="arbre-viewer-block">
            {confirmDelete ? (
              <div className="arbre-picked">
                <div>Supprimer cette photo pour tout le monde ? Pour ne l&apos;enlever qu&apos;à une personne, retire-la de la liste ci-dessus.</div>
                <div className="arbre-share-actions">
                  <button
                    type="button"
                    className="arbre-btn arbre-btn-danger-solid"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await deletePhoto(photo.id);
                        onClose();
                        await onChanged();
                      })
                    }
                  >
                    Supprimer
                  </button>
                  <button type="button" className="arbre-btn" onClick={() => setConfirmDelete(false)}>
                    Garder
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="arbre-btn arbre-btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Supprimer la photo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
