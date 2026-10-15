"use client";

import { useEffect, useRef, useState } from "react";
import type { Datum } from "family-chart";
import "family-chart/styles/family-chart.css";
import "./family-tree.css";
import { fullName, lifeLine, sortSiblings } from "@/lib/family";
import { updateUnionLinks } from "@/lib/unions";

const CARD_W = 200;
const CARD_H = 70;
const PHONE_SCALE = 0.85;

type Props = {
  /** URL du JSON (dans /public). Remplacé plus tard par la base de données. */
  dataUrl?: string;
  /** Personne affichée au centre au départ (id). Par défaut : la première du fichier. */
  mainId?: string;
};

export default function FamilyTree({ dataUrl = "/sample_family.json", mainId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let frame = 0;

    async function init() {
      try {
        const res = await fetch(dataUrl);
        if (!res.ok) throw new Error(`Impossible de charger ${dataUrl} (${res.status})`);
        const data: Datum[] = await res.json();

        // Import dynamique : la bibliothèque manipule le DOM, elle ne doit tourner que côté navigateur.
        const f3 = await import("family-chart");
        if (cancelled || !container) return;

        // En développement, React monte le composant deux fois : on repart d'un conteneur vide.
        container.innerHTML = "";

        const chart = f3
          .createChart(container, data)
          .setTransitionTime(600)
          .setSortChildrenFunction(sortSiblings)
          // Pas de cartes "ADD" fantômes pour les parents inconnus (mode consultation)
          .setSingleParentEmptyCard(false);

        // Sur téléphone, faire tenir tout l'arbre dans la largeur rend les cartes illisibles :
        // on centre plutôt sur la personne principale avec un zoom confortable.
        const narrow = container.clientWidth < 700;
        const phoneView = { tree_position: "main_to_middle" as const, scale: PHONE_SCALE };

        const card = chart
          .setCardHtml()
          .setCardDisplay([(d: Datum) => fullName(d), (d: Datum) => lifeLine(d)])
          .setCardDim({ w: CARD_W, h: CARD_H });

        // Un clic sur une carte la place au centre (comportement par défaut de la bibliothèque,
        // sauf que sur téléphone on garde le zoom confortable au lieu de tout redézoomer).
        card.setOnCardClick((_e: MouseEvent, d: { data: { id: string } }) => {
          chart.updateMainId(d.data.id);
          chart.updateTree(narrow ? phoneView : {});
        });

        if (mainId) chart.updateMainId(mainId);

        // Après chaque mise à jour de l'arbre, on repeint les liens de couple.
        // On débranche l'observateur pendant nos propres modifications pour éviter une boucle.
        const observe = () => observer?.observe(container, { childList: true, subtree: true });
        const refreshUnions = () => {
          frame = 0;
          observer?.disconnect();
          updateUnionLinks(container, CARD_H);
          observe();
        };
        observer = new MutationObserver(() => {
          if (!frame) frame = requestAnimationFrame(refreshUnions);
        });
        observe();

        chart.updateTree({ initial: true });
        if (narrow) chart.updateTree({ initial: false, transition_time: 0, ...phoneView });
        refreshUnions();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    init();

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (container) container.innerHTML = "";
    };
  }, [dataUrl, mainId]);

  if (error) {
    return <p className="p-6 text-red-600">Erreur : {error}</p>;
  }

  return <div ref={containerRef} className="f3 arbre" />;
}
