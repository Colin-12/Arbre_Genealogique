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
import EditPersonDialog from "./EditPersonDialog";
import PersonSheet from "./PersonSheet";
import LinksDialog from "./LinksDialog";
import DeletePersonDialog from "./DeletePersonDialog";
import type { ManageAction } from "./TreeNav";
import { restorePerson, type Relation } from "@/lib/editTree";

type F3 = typeof import("family-chart");
type ChartInstance = ReturnType<F3["createChart"]>;

const CARD_W = 200;
const CARD_H = 70;

/** En dessous de cette largeur (px), on considère l'écran comme un téléphone (portrait). */
const NARROW_PX = 700;
/** Téléphone en paysage : peu de hauteur disponible. */
const SHORT_PX = 520;
/** Taille minimale des cartes quand on recadre tout l'arbre (1 = taille normale). En dessous, le texte devient illisible. */
const MIN_FIT_SCALE = 0.55;
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
  const [managing, setManaging] = useState<ManageAction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);

  const isNarrow = () => (containerRef.current?.clientWidth ?? Infinity) < NARROW_PX || window.innerHeight < SHORT_PX;

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

  /**
   * Après un recadrage complet : si les cartes sont devenues trop petites pour être lues (grand arbre),
   * on revient à la vue lisible centrée sur la personne (le bouton "Recadrer" garde la vue d'ensemble).
   */
  const keepReadable = useCallback(() => {
    window.setTimeout(() => {
      const container = containerRef.current;
      if (!container || !chartRef.current) return;
      const el = container.querySelector<HTMLElement>(".card-main .card-inner") ?? container.querySelector<HTMLElement>(".card-inner");
      if (el && el.getBoundingClientRect().width / CARD_W < MIN_FIT_SCALE) centerOnMain(400);
    }, 750);
  }, [centerOnMain]);

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
        keepReadable();
      }
      setTrail((t) => nextTrail(t, id, reset));
    },
    [centerOnMain, keepReadable]
  );

  /** Recadre la vue actuelle (utile après avoir déplacé ou zoomé l'arbre). */
  const refit = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (isNarrow()) centerOnMain(400);
    else chart.updateTree({ tree_position: "fit", transition_time: 400 });
  }, [centerOnMain]);

  /**
   * Recharge les personnes depuis la base après une modification, sans perdre la vue ni le fil d'Ariane.
   * mainId : personne à placer au centre ensuite (sinon, celle qui y est déjà).
   */
  const reload = useCallback(
    async (mainId?: string) => {
      const chart = chartRef.current;
      if (!chart || !loadData) return;
      const data = await loadData();
      const ids = new Set(data.map((d) => d.id));
      const previous = chart.getMainDatum()?.id;
      const target = mainId && ids.has(mainId) ? mainId : previous && ids.has(previous) ? previous : data[0]?.id;

      chart.updateData(data);
      if (target && target !== previous) chart.updateMainId(target);
      if (isNarrow()) {
        chart.updateTree({ tree_position: "inherit" });
        centerOnMain(600);
      } else {
        chart.updateTree({ tree_position: "fit" });
        keepReadable();
      }

      setPeople(data);
      if (target) {
        // Le fil d'Ariane et la "vue initiale" ne gardent que des personnes qui existent encore
        setInitialId((id) => (ids.has(id) ? id : target));
        setTrail((t) => nextTrail(t.filter((id) => ids.has(id)), target));
      }
    },
    [loadData, centerOnMain, keepReadable]
  );

  /** Après une modification : recharge l'arbre, ou signale que l'affichage n'a pas pu suivre. */
  const refreshAfter = useCallback(
    (text: string, mainId?: string, undo?: () => Promise<void>) => {
      setNotice({ text, undo });
      reload(mainId).catch((e) =>
        setNotice({ text: `Fait, mais l'affichage n'a pas pu se mettre à jour : ${e instanceof Error ? e.message : e}` })
      );
    },
    [reload]
  );

  useEffect(() => {
    if (!notice) return;
    // Plus de temps quand un bouton "Annuler" est proposé
    const timer = window.setTimeout(() => setNotice(null), notice.undo ? 9000 : 3500);
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

        // Un clic sur une carte la place au centre ; un clic sur la carte déjà au centre ouvre sa fiche
        card.setOnCardClick((_e: MouseEvent, d: { data: { id: string } }) => {
          if (chart.getMainDatum()?.id === d.data.id) setSheetOpen(true);
          else goTo(d.data.id);
        });

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
        else keepReadable();
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
          resizeTimer = window.setTimeout(() => {
            refit();
            if (!isNarrow()) keepReadable();
          }, 150);
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
  }, [loadData, dataUrl, mainId, goTo, centerOnMain, refit, keepReadable]);

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
        onSheet={anchor ? () => setSheetOpen(true) : undefined}
        onAdd={canEdit && treeId && anchor ? setAdding : undefined}
        onManage={canEdit && treeId && anchor ? setManaging : undefined}
        canDelete={people.length > 1}
        searchPeople={people}
      />
      <div ref={containerRef} className="f3 arbre" />
      {sheetOpen && anchor && (
        <PersonSheet
          person={anchor}
          people={people}
          canEdit={canEdit && Boolean(treeId)}
          onClose={() => setSheetOpen(false)}
          onGo={(id) => goTo(id)}
          onEdit={() => {
            setSheetOpen(false);
            setManaging("edit");
          }}
        />
      )}
      {adding && treeId && anchor && (
        <AddPersonDialog
          treeId={treeId}
          anchor={anchor}
          relation={adding}
          people={people}
          onClose={() => setAdding(null)}
          onDone={(name) => {
            setAdding(null);
            refreshAfter(`${name || "Personne"} ajouté(e)`);
          }}
        />
      )}
      {managing === "edit" && anchor && (
        <EditPersonDialog
          person={anchor}
          onClose={() => setManaging(null)}
          onDone={(name) => {
            setManaging(null);
            refreshAfter(`${name || "Personne"} modifié(e)`);
          }}
        />
      )}
      {managing === "links" && treeId && anchor && (
        <LinksDialog
          treeId={treeId}
          anchor={anchor}
          people={people}
          onClose={() => setManaging(null)}
          onChanged={(message) => refreshAfter(message)}
        />
      )}
      {managing === "delete" && anchor && (
        <DeletePersonDialog
          person={anchor}
          people={people}
          onClose={() => setManaging(null)}
          onDone={() => {
            const removed = anchor;
            // Après la suppression, on recentre sur un proche (ou sur n'importe qui s'il n'y en a pas)
            const relatives = [...removed.rels.parents, ...(removed.rels.spouses ?? []), ...(removed.rels.children ?? [])];
            const next = relatives.find((id) => people.some((p) => p.id === id)) ?? people.find((p) => p.id !== removed.id)?.id;
            setManaging(null);
            refreshAfter(`${plainName(removed)} supprimé(e)`, next, async () => {
              await restorePerson(removed.id);
              setNotice({ text: `${plainName(removed)} restauré(e)` });
              await reload(removed.id);
            });
          }}
        />
      )}
      {notice && (
        <div className="arbre-toast" role="status">
          <span>{notice.text}</span>
          {notice.undo && (
            <button
              type="button"
              className="arbre-toast-action"
              onClick={() => {
                const undo = notice.undo;
                setNotice(null);
                undo?.().catch((e) => setNotice({ text: `Annulation impossible : ${e instanceof Error ? e.message : e}` }));
              }}
            >
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}
