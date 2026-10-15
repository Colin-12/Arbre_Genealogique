/**
 * Rend les couples lisibles dans le DOM généré par family-chart.
 *
 * Deux problèmes à résoudre :
 * 1. La bibliothèque ne distingue pas un lien de couple d'un lien parent-enfant (même classe CSS).
 *    On lit l'information dans les données d3 de chaque trait et on pose la classe "link-spouse".
 * 2. Quand une personne a plusieurs conjoints, ils sont alignés sur une même ligne et le trait du
 *    deuxième conjoint passe DERRIÈRE le premier : on croirait que les deux conjoints sont mariés
 *    entre eux. On cache ce trait et on dessine à la place un pont au-dessus des cartes
 *    intermédiaires (classe "link-bridge").
 *
 * Note : "__data__" est un détail interne de d3. S'il disparaît dans une future version, les couples
 * perdent leur couleur et leurs ponts, mais l'arbre reste affiché.
 */

type Node = { x: number; y: number };
type LinkDatum = { spouse?: boolean; source?: Node; target?: Node };

const SVG_NS = "http://www.w3.org/2000/svg";

export function updateUnionLinks(container: HTMLElement, cardHeight: number): void {
  const layer = container.querySelector(".links_view");
  if (!layer) return;

  layer.querySelectorAll(".link-bridge").forEach((el) => el.remove());

  const links = Array.from(container.querySelectorAll<SVGPathElement>("path.link")).map((el) => ({
    el,
    d: (el as unknown as { __data__?: LinkDatum }).__data__,
  }));

  // Toutes les cartes connues (une carte de conjoint a toujours un lien de couple)
  const nodes = new Set<Node>();
  for (const { d } of links) {
    if (d?.source) nodes.add(d.source);
    if (d?.target) nodes.add(d.target);
  }

  for (const { el, d } of links) {
    const isUnion = Boolean(d?.spouse && d.source && d.target);
    el.classList.toggle("link-spouse", isUnion);
    el.classList.remove("link-hidden");
    if (!isUnion || !d?.source || !d.target) continue;

    const s = d.source;
    const t = d.target;
    const left = Math.min(s.x, t.x);
    const right = Math.max(s.x, t.x);

    // Cartes situées entre les deux conjoints, sur la même ligne
    let between = 0;
    nodes.forEach((n) => {
      if (n !== s && n !== t && Math.abs(n.y - s.y) < 1 && n.x > left && n.x < right) between++;
    });
    if (between === 0) continue; // conjoints côte à côte : le trait d'origine suffit

    el.classList.add("link-hidden");

    const top = s.y - cardHeight / 2;
    const lift = 24 + 10 * (between - 1);
    const inset = 28; // on évite le milieu de la carte, où arrive le trait des parents
    const r = 8;
    const x1 = left + inset;
    const x2 = right - inset;
    const yTop = top - lift;

    const bridge = document.createElementNS(SVG_NS, "path");
    bridge.setAttribute("class", "link-bridge");
    bridge.setAttribute(
      "d",
      `M${x1},${top} V${yTop + r} Q${x1},${yTop} ${x1 + r},${yTop} H${x2 - r} Q${x2},${yTop} ${x2},${yTop + r} V${top}`
    );
    layer.appendChild(bridge);
  }
}
