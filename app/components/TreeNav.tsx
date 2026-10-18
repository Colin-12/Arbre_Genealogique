"use client";

import { useEffect, useRef, useState } from "react";

import type { Relation } from "@/lib/editTree";

export type Crumb = { id: string; label: string };

type Props = {
  /** Personnes visitées, la dernière est la personne centrale. */
  trail: Crumb[];
  /** Nombre de personnes affichées / total dans l'arbre. */
  visible: number;
  total: number;
  /** Parents de la personne centrale (pour le bouton "Remonter"). */
  parents: Crumb[];
  /** Vrai quand la personne centrale est déjà celle de départ. */
  atStart: boolean;
  onGo: (id: string) => void;
  onInitial: () => void;
  onFit: () => void;
  /** Si fournie, affiche un lien "Se déconnecter" dans le bandeau de contexte. */
  onSignOut?: () => void;
  /** Si fournie, affiche le bouton "Ajouter" (réservé aux propriétaires et éditeurs). */
  onAdd?: (relation: Relation) => void;
};

type MenuName = "parents" | "add" | null;

const MAX_VISIBLE_CRUMBS = 4;

export default function TreeNav({ trail, visible, total, parents, atStart, onGo, onInitial, onFit, onSignOut, onAdd }: Props) {
  const [menu, setMenu] = useState<MenuName>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const crumbsRef = useRef<HTMLDivElement>(null);

  // Garde la personne centrale visible quand le fil d'Ariane est long (défilement horizontal)
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [trail]);

  // Ferme le menu des parents avec Échap ou un clic ailleurs
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onClick = (e: MouseEvent) => {
      if (!actionsRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menu]);

  // Avant le chargement des données, on garde la même hauteur pour éviter un saut de mise en page
  const current: Crumb = trail[trail.length - 1] ?? { id: "", label: "Chargement..." };
  const earlier = trail.slice(0, -1);
  const hidden = Math.max(0, earlier.length - (MAX_VISIBLE_CRUMBS - 1));
  const shownEarlier = earlier.slice(hidden);

  const goUp = () => {
    if (parents.length === 1) onGo(parents[0].id);
    else if (parents.length > 1) setMenu((m) => (m === "parents" ? null : "parents"));
  };

  return (
    <nav className="arbre-nav" aria-label="Navigation dans l'arbre">
      <div className="arbre-panel arbre-context">
        <div className="arbre-context-head">
          <span className="arbre-context-label">Vue centrée sur</span>
          {onSignOut && (
            <button type="button" className="arbre-link" onClick={onSignOut}>
              Se déconnecter
            </button>
          )}
        </div>
        <div className="arbre-crumbs" aria-live="polite" ref={crumbsRef}>
          {hidden > 0 && <span className="arbre-sep">…</span>}
          {shownEarlier.map((c) => (
            <span key={c.id} className="arbre-crumb-item">
              <button type="button" className="arbre-crumb" onClick={() => onGo(c.id)}>
                {c.label}
              </button>
              <span className="arbre-sep" aria-hidden="true">›</span>
            </span>
          ))}
          <span className="arbre-crumb-current">{current.label}</span>
        </div>
        <div className="arbre-count">
          {total > 0
            ? `${visible} personne${visible > 1 ? "s" : ""} affichée${visible > 1 ? "s" : ""} sur ${total}`
            : "\u00a0"}
        </div>
      </div>

      <div className="arbre-panel arbre-actions" ref={actionsRef}>
        <button
          type="button"
          className="arbre-btn"
          onClick={goUp}
          disabled={parents.length === 0}
          aria-expanded={parents.length > 1 ? menu === "parents" : undefined}
          title={parents.length === 0 ? "Aucun parent connu" : "Centrer la vue sur un parent"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          Remonter
        </button>
        <button type="button" className="arbre-btn" onClick={onInitial} disabled={atStart} title="Revenir à la vue de départ">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11l9-8 9 8M5 10v10h14V10" />
          </svg>
          Vue initiale
        </button>
        <button type="button" className="arbre-btn" onClick={onFit} title="Recadrer la vue actuelle" aria-label="Recadrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          <span className="arbre-btn-label-optional">Recadrer</span>
        </button>
        {onAdd && (
          <button
            type="button"
            className="arbre-btn arbre-btn-accent"
            onClick={() => setMenu((m) => (m === "add" ? null : "add"))}
            aria-expanded={menu === "add"}
            title="Ajouter une personne reliée à la personne au centre"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Ajouter
          </button>
        )}

        {menu === "add" && onAdd && (
          <div className="arbre-panel arbre-menu arbre-menu-right" role="menu">
            {(
              [
                ["child", "Un enfant"],
                ["spouse", "Un conjoint"],
                ["parent", "Un parent"],
              ] as const
            ).map(([relation, label]) => {
              const full = relation === "parent" && parents.length >= 2;
              return (
                <button
                  key={relation}
                  type="button"
                  role="menuitem"
                  className="arbre-btn"
                  disabled={full}
                  title={full ? "Les deux parents sont déjà connus" : undefined}
                  onClick={() => {
                    setMenu(null);
                    onAdd(relation);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {menu === "parents" && parents.length > 1 && (
          <div className="arbre-panel arbre-menu" role="menu">
            {parents.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                className="arbre-btn"
                onClick={() => {
                  setMenu(null);
                  onGo(p.id);
                }}
              >
                Vers {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
