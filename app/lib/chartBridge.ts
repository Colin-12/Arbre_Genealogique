import type { Datum } from "family-chart";
import type { PersonLite } from "./exportSections";

type F3 = typeof import("family-chart");
type ChartInstance = ReturnType<F3["createChart"]>;

/**
 * Passerelle entre l'arbre affiché et l'export : permet à l'export de déplacer la vue
 * sur plusieurs personnes pour tout dessiner, puis de remettre la vue comme elle était.
 */
export type ChartBridge = {
  people: () => PersonLite[];
  /** Identifiants des personnes affichées quand `id` est au centre. */
  coverOf: (id: string) => string[];
  label: (id: string) => string;
  /** Place la personne au centre, sans animation. */
  focus: (id: string) => void;
  /** Remet la personne et le cadrage d'avant l'export. */
  restore: () => void;
};

let current: ChartBridge | null = null;

export function setChartBridge(bridge: ChartBridge | null) {
  current = bridge;
}

export function getChartBridge(): ChartBridge | null {
  return current;
}

export function makeChartBridge(opts: {
  chart: ChartInstance;
  f3: F3;
  label: (d: Datum) => string;
  /** Recadre la vue (même logique que le bouton "Recadrer"), appelé après l'export. */
  reframe: () => void;
}): ChartBridge {
  const { chart, f3, label, reframe } = opts;
  let before: string | undefined;

  const data = () => (chart.store.getData() ?? []) as Datum[];

  return {
    people: () => data().map((d) => ({ id: d.id, parents: d.rels.parents ?? [] })),
    coverOf: (id) => {
      const s = chart.store.state;
      const tree = f3.calculateTree(data(), {
        main_id: id,
        node_separation: s.node_separation,
        level_separation: s.level_separation,
        single_parent_empty_card: s.single_parent_empty_card,
        sortChildrenFunction: s.sortChildrenFunction,
        sortSpousesFunction: s.sortSpousesFunction,
        show_siblings_of_main: s.show_siblings_of_main,
        modifyTreeHierarchy: s.modifyTreeHierarchy,
      });
      return tree.data.filter((n) => !n.data._new_rel_data && !n.is_private).map((n) => n.data.id);
    },
    label: (id) => {
      const d = data().find((x) => x.id === id);
      return d ? label(d) : "";
    },
    focus: (id) => {
      if (before === undefined) before = chart.getMainDatum()?.id ?? "";
      chart.updateMainId(id);
      chart.updateTree({ tree_position: "fit", transition_time: 0 });
    },
    restore: () => {
      if (before === undefined) return;
      const id = before;
      before = undefined;
      if (id && chart.store.getDatum(id)) chart.updateMainId(id);
      reframe();
    },
  };
}
