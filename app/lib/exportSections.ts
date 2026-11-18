/**
 * Choisit les personnes à placer "au centre" pour que l'export montre TOUT l'arbre.
 *
 * L'affichage de l'appli est toujours centré sur une personne : il montre ses ancêtres, ses descendants,
 * leurs conjoints et les frères et soeurs de la personne centrale. Les familles des conjoints (leurs parents,
 * leurs frères et soeurs) n'y sont pas, et les personnes non reliées non plus. Pour tout exporter, on empile
 * donc plusieurs vues : la plus grande d'abord, puis, tant qu'il reste des personnes absentes, celle qui en
 * ajoute le plus.
 */
export type PersonLite = { id: string; parents: string[] };

export function planSections(
  people: PersonLite[],
  coverOf: (mainId: string) => string[],
  maxSections = 60
): string[] {
  const all = new Set(people.map((p) => p.id));
  const cache = new Map<string, Set<string>>();
  const cover = (id: string) => {
    let s = cache.get(id);
    if (!s) {
      s = new Set(coverOf(id).filter((x) => all.has(x)));
      cache.set(id, s);
    }
    return s;
  };

  // Une personne sans parent connu voit tous ses descendants : ces candidats suffisent presque toujours.
  let candidates = people.filter((p) => p.parents.length === 0).map((p) => p.id);
  const uncovered = new Set(all);
  const mains: string[] = [];

  const pick = (pool: string[]) => {
    let best = "";
    let bestNew = 0;
    let bestTotal = 0;
    for (const id of pool) {
      const c = cover(id);
      let gain = 0;
      for (const x of c) if (uncovered.has(x)) gain++;
      if (gain > bestNew || (gain === bestNew && gain > 0 && c.size > bestTotal)) {
        best = id;
        bestNew = gain;
        bestTotal = c.size;
      }
    }
    return bestNew > 0 ? best : "";
  };

  while (uncovered.size > 0 && mains.length < maxSections) {
    let next = pick(candidates);
    if (!next) {
      // Cas rare (liens incohérents) : on essaie toutes les personnes restantes
      candidates = [...uncovered];
      next = pick(candidates);
      if (!next) break;
    }
    mains.push(next);
    for (const x of cover(next)) uncovered.delete(x);
  }
  return mains;
}
