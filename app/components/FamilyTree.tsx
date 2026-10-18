"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Datum } from "family-chart";
import "family-chart/styles/family-chart.css";
import "./family-tree.css";
import { fullName, lifeLine, sortSiblings } from "@/lib/family";
import { updateUnionLinks } from "@/lib/unions";
import { nextTrail, parentsOf, plainName } from "@/lib/navigation";
import TreeNav from "./TreeNav";
import AddPersonDialog from "./AddPersonDialog";
import type { Relation } from "@/lib/editTree";

type F3 = typeof import("family-chart");
type ChartInstance = ReturnType<F3["createChart"]>;

const CARD_W = 200;
const CARD_H = 70;

/** En dessous de cette largeur (px), on considère l'écran comme un téléphone. */
const NARROW_PX = 700;
/** Zoom confortable sur téléphone, et position verticale de la personne centrale (0 = haut, 1 = bas). */
const PHONE_SCALE = 0.85;
const PHONE_ANCHOR = 0.32;

/** Affiche aussi les frères et soeurs de la personne centrale (meilleur repère pour ne pas se perdre). */
const SHOW_SIBLINGS = true;

type Props = {
  /** Fournit les personnes (base de données). Doit être une fonction stable (définie hors du composant). */
  loadData?: () => Promise<Datum[]>;
  /** À défaut de loadData : URL d'un JSON (dans /public), utile pour les essais. */
  dataUrl?: string;
  /** Si fournie, affiche "Se déconnecter" dans le bandeau. */
  onSignOut?: () => void;
  /** Arbre affiché et droit de modification : active le bouton "Ajouter". */
  treeId?: string;
  canEdit?: boolean;
  /** Personne affichée au centre au départ (id). Par défaut : la première du fichier. */
  mainId?: string;
};

export default function FamilyTree({ loadData, dataUrl = "/sample_family.json", onSignOut, treeId, canEdit = false, mainId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const f3Ref = useRef<F3 | null>(null);

  const [people, setPeople] = useState<Datum[]>([]);
  const [initialId, setInitialId] = useState("");
  const [trail, setTrail] = useState<string[]>([]);
  const [visible, setVisible] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Relation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isNarrow = () => (containerRef.current?.clientWidth ?? Infinity) < NARROW_PX;

  /** Téléphone : place la personne centrale en haut de l'écran, avec un zoom lisible. */
  const centerOnMain = useCallback((transition: number) => {
    const chart = chartRef.current;
    const f3 = f3Ref.current;
    if (!chart || !f3) return;
    const rect = chart.svg.getBoundingClientRect();
    f3.handlers.cardToMiddle({
      datum: chart.store.getTreeMainDatum(),
      svg: chart.svg,
      // cardToMiddle centre dans la hauteur qu'on lui donne : une hauteur réduite remonte la carte
      svg_dim: { width: rect.width, height: rect.height * PHONE_ANCHOR * 2 },
      scale: PHONE_SCALE,
      transition_time: transition,
    });
  }, []);

  /** Se rend sur une personne : la recentre et met à jour le fil d'Ariane. */
  const goTo = useCallback(
    (id: string, reset = false) => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.updateMainId(id);
      if (isNarrow()) {
        chart.updateTree({ tree_position: "inherit" });
        centerOnMain(600);
      } else {
        chart.updateTree({ tree_position: "fit" });
      }
      setTrail((t) => nextTrail(t, id, reset));
    },
    [centerOnMain]
  );

  /** Recadre la vue actuelle (utile après avoir déplacé ou zoomé l'arbre). */
  const refit = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (isNarrow()) centerOnMain(400);
    else chart.updateTree({ tree_position: "fit", transition_time: 400 });
  }, [centerOnMain]);

  /** Recharge les personnes depuis la base après un ajout, sans perdre la vue ni le fil d'Ariane. */
  const reload = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart || !loadData) return;
    const data = await loadData();
    chart.updateData(data);
    if (isNarrow()) {
      chart.updateTree({ tree_position: "inherit" });
      centerOnMain(600);
    } else {
      chart.updateTree({ tree_position: "fit" });
    }
    setPeople(data);
  }, [loadData, centerOnMain]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer = 0;
    let frame = 0;

    async function init() {
      try {
        let data: Datum[];
        if (loadData) {
          data = await loadData();
        } else {
          const res = await fetch(dataUrl);
          if (!res.ok) throw new Error(`Impossible de charger ${dataUrl} (${res.status})`);
          data = await res.json();
        }

        // Import dynamique : la bibliothèque manipule le DOM, elle ne doit tourner que côté navigateur.
        const f3 = await import("family-chart");
        if (cancelled || !container) return;
        f3Ref.current = f3;

        // En développement, React monte le composant deux fois : on repart d'un conteneur vide.
        container.innerHTML = "";

        const chart = f3
          .createChart(container, data)
          .setTransitionTime(600)
          .setSortChildrenFunction(sortSiblings)
          .setShowSiblingsOfMain(SHOW_SIBLINGS)
          // Pas de cartes "ADD" fantômes pour les parents inconnus (mode consultation)
          .setSingleParentEmptyCard(false);
        chartRef.current = chart;

        const card = chart
          .setCardHtml()
          .setCardDisplay([(d: Datum) => fullName(d), (d: Datum) => lifeLine(d)])
          .setCardDim({ w: CARD_W, h: CARD_H });

        // Un clic sur une carte la place au centre et l'ajoute au fil d'Ariane
        card.setOnCardClick((_e: MouseEvent, d: { data: { id: string } }) => goTo(d.data.id));

        const startId = mainId ?? data[0]?.id ?? "";
        if (mainId) chart.updateMainId(mainId);

        setPeople(data);
        setInitialId(startId);
        setTrail(startId ? [startId] : []);

        // Après chaque mise à jour de l'arbre, on repeint les liens de couple et on compte les cartes.
        // On débranche l'observateur pendant nos propres modifications pour éviter une boucle.
        const observe = () => observer?.observe(container, { childList: true, subtree: true });
        const refresh = () => {
          frame = 0;
          observer?.disconnect();
          updateUnionLinks(container, CARD_H);
          const ids = new Set<string>();
          container.querySelectorAll<HTMLElement>(".card[data-id]").forEach((el) => {
            if (el.dataset.id) ids.add(el.dataset.id);
          });
          setVisible(ids.size);
          observe();
        };
        observer = new MutationObserver(() => {
          if (!frame) frame = requestAnimationFrame(refresh);
        });
        observe();

        chart.updateTree({ initial: true });
        if (isNarrow()) centerOnMain(0);
        refresh();

        // Rotation du téléphone, redimensionnement de la fenêtre : on recadre (sans le premier appel,
        // déclenché par l'observation elle-même)
        let firstResize = true;
        resizeObserver = new ResizeObserver(() => {
          if (firstResize) {
            firstResize = false;
            return;
          }
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(refit, 150);
        });
        resizeObserver.observe(container);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    init();

    return () => {
      cancelled = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.clearTimeout(resizeTimer);
      if (frame) cancelAnimationFrame(frame);
      chartRef.current = null;
      if (container) container.innerHTML = "";
    };
  }, [loadData, dataUrl, mainId, goTo, centerOnMain, refit]);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600">Erreur : {error}</p>
        {onSignOut && (
          <button type="button" className="arbre-link mt-4" onClick={onSignOut}>
            Se déconnecter
          </button>
        )}
      </div>
    );
  }

  const current = trail[trail.length - 1] ?? "";
  const label = (id: string) => plainName(people.find((p) => p.id === id));
  const crumbs = trail.map((id) => {
    const person = people.find((p) => p.id === id);
    const year = /^(\d{4})/.exec(String(person?.data["birthday"] ?? ""))?.[1];
    return { id, label: id === current && year ? `${plainName(person)} (${year})` : plainName(person) };
  });
  const parents = parentsOf(people, current).map((p) => ({ id: p.id, label: label(p.id) }));
  const anchor = people.find((p) => p.id === current);

  return (
    <div className="arbre-shell">
      <TreeNav
        trail={crumbs}
        visible={visible}
        total={people.length}
        parents={parents}
        atStart={current === initialId}
        onGo={(id) => goTo(id)}
        onInitial={() => goTo(initialId, true)}
        onFit={refit}
        onSignOut={onSignOut}
        onAdd={canEdit && treeId && anchor ? setAdding : undefined}
      />
      <div ref={containerRef} className="f3 arbre" />
      {adding && treeId && anchor && (
        <AddPersonDialog
          treeId={treeId}
          anchor={anchor}
          relation={adding}
          people={people}
          onClose={() => setAdding(null)}
          onDone={(name) => {
            setAdding(null);
            setNotice(`${name || "Personne"} ajouté(e)`);
            reload().catch((e) => setNotice(`Ajout fait, mais l'affichage n'a pas pu se mettre à jour : ${e instanceof Error ? e.message : e}`));
          }}
        />
      )}
      {notice && (
        <div className="arbre-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
