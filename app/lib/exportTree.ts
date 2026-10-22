export type ExportFormat = "png" | "pdf";

const PAD = 48; // marge autour de l'arbre (px)
const MAX_SIDE = 8000; // plus grand côté de l'image exportée (px), pour rester dans ce que les navigateurs savent dessiner
const BLANK_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "arbre"
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Lit translate(x, y) scale(k) dans un style ou un attribut transform. */
function readTransform(value: string | null): { x: number; y: number; k: number } {
  const t = /translate\(\s*(-?[\d.]+)(?:px)?[\s,]+(-?[\d.]+)(?:px)?\s*\)/.exec(value ?? "");
  const s = /scale\(\s*(-?[\d.]+)/.exec(value ?? "");
  return { x: t ? Number(t[1]) : 0, y: t ? Number(t[2]) : 0, k: s ? Number(s[1]) || 1 : 1 };
}

function pageBackground(container: HTMLElement): string {
  for (const el of [container, document.body]) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") return c;
  }
  return "#ffffff";
}

/** Dessine tout l'arbre affiché (pas seulement la partie visible à l'écran) et renvoie une image PNG. */
async function renderTreePng(treeName: string): Promise<{ dataUrl: string; width: number; height: number; ratio: number }> {
  const container = document.querySelector<HTMLElement>(".f3.arbre");
  const cardsView = container?.querySelector<HTMLElement>("div.cards_view");
  const view = container?.querySelector<SVGGElement>("g.view");
  if (!container || !cardsView || !view) throw new Error("L'arbre n'est pas encore affiché.");

  const cards = Array.from(container.querySelectorAll<HTMLElement>(".card[data-id]"));
  if (cards.length === 0) throw new Error("Il n'y a aucune personne à exporter.");

  // Emplacement de tout l'arbre, dans le repère de l'arbre (indépendant du zoom et du déplacement actuels)
  const cv = readTransform(cardsView.style.transform);
  const origin = container.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    minX = Math.min(minX, (r.left - origin.left - cv.x) / cv.k);
    maxX = Math.max(maxX, (r.right - origin.left - cv.x) / cv.k);
    minY = Math.min(minY, (r.top - origin.top - cv.y) / cv.k);
    maxY = Math.max(maxY, (r.bottom - origin.top - cv.y) / cv.k);
  }
  try {
    const b = view.getBBox();
    if (b.width > 0 && b.height > 0) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
  } catch {
    // getBBox peut échouer sur un élément masqué : les cartes suffisent alors
  }
  const treeW = Math.ceil(maxX - minX) + PAD * 2;
  const treeH = Math.ceil(maxY - minY) + PAD * 2;
  const shiftX = PAD - minX;
  const shiftY = PAD - minY;

  const bg = pageBackground(container);
  const HEADER_H = 84;

  // Copie hors écran, remise à l'échelle 1 et cadrée sur tout l'arbre
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-hidden", "true");
  Object.assign(wrapper.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${treeW}px`,
    background: bg,
    fontFamily: getComputedStyle(document.body).fontFamily,
    color: getComputedStyle(document.body).color,
  } satisfies Partial<CSSStyleDeclaration>);

  const header = document.createElement("div");
  Object.assign(header.style, { height: `${HEADER_H}px`, padding: `${PAD / 2}px ${PAD}px 0`, boxSizing: "border-box" });
  const title = document.createElement("div");
  title.textContent = treeName;
  Object.assign(title.style, { fontSize: "30px", fontWeight: "600", lineHeight: "1.2" });
  const sub = document.createElement("div");
  sub.textContent = `Arbre généalogique · ${cards.length} personne${cards.length > 1 ? "s" : ""} · ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
  Object.assign(sub.style, { fontSize: "15px", opacity: "0.65", marginTop: "4px" });
  header.append(title, sub);

  const stage = document.createElement("div");
  Object.assign(stage.style, { position: "relative", width: `${treeW}px`, height: `${treeH}px`, overflow: "hidden" });
  const clone = container.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, { position: "absolute", left: "0", top: "0", width: `${treeW}px`, height: `${treeH}px`, background: "transparent" });
  clone.querySelectorAll(".f3-nav-cont, .fit_screen_icon").forEach((el) => el.remove());
  const placement = `translate(${shiftX}px, ${shiftY}px) scale(1)`;
  clone.querySelector<SVGGElement>("g.view")?.style.setProperty("transform", placement);
  const clonedCards = clone.querySelector<HTMLElement>("div.cards_view");
  if (clonedCards) clonedCards.style.transform = placement;
  stage.appendChild(clone);
  wrapper.append(header, stage);
  document.body.appendChild(wrapper);

  // Les traits sont des éléments SVG : on écrit leurs couleurs et épaisseurs directement dessus,
  // sinon ils ressortent blancs (ou noirs) dans l'image, qui n'a pas accès aux feuilles de style.
  clone.querySelectorAll<SVGElement>("svg path, svg line, svg polyline, svg rect, svg circle").forEach((el) => {
    const cs = getComputedStyle(el);
    el.setAttribute("stroke", cs.stroke);
    el.setAttribute("stroke-width", cs.strokeWidth);
    el.setAttribute("stroke-linecap", cs.strokeLinecap);
    el.setAttribute("stroke-linejoin", cs.strokeLinejoin);
    el.setAttribute("fill", cs.fill);
    el.style.setProperty("animation", "none");
    el.style.setProperty("vector-effect", "none");
  });

  try {
    const width = treeW;
    const height = treeH + HEADER_H;
    const ratio = Math.max(0.4, Math.min(2, MAX_SIDE / Math.max(width, height)));
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(wrapper, {
      pixelRatio: ratio,
      backgroundColor: bg,
      width,
      height,
      imagePlaceholder: BLANK_GIF,
      // la copie est hors écran : dans l'image, elle doit être à sa place
      style: { position: "static", left: "0", top: "0" },
    });
    return { dataUrl, width, height, ratio };
  } finally {
    wrapper.remove();
  }
}

/** Fichier PDF d'une page contenant une seule image JPEG, à la taille de l'arbre (zoomable, imprimable en ajustant à la page). */
function pdfFromJpeg(jpeg: Uint8Array, imgW: number, imgH: number, pageW: number, pageH: number): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push("\nendstream\nendobj\n");
  const content = `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  let table = "xref\n0 6\n0000000000 65535 f \n";
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(`${table}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

async function jpegFromPng(dataUrl: string): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossible de préparer le PDF sur cet appareil.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Impossible de préparer le PDF sur cet appareil.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

/** Exporte l'arbre affiché en image (PNG) ou en PDF et lance le téléchargement. */
export async function exportTree(format: ExportFormat, treeName: string): Promise<void> {
  const { dataUrl, width, height } = await renderTreePng(treeName);
  const base = `arbre-${slugify(treeName)}-${new Date().toISOString().slice(0, 10)}`;

  if (format === "png") {
    const blob = await (await fetch(dataUrl)).blob();
    download(blob, `${base}.png`);
    return;
  }

  const jpeg = await jpegFromPng(dataUrl);
  // 1 px d'écran = 0,75 point ; on plafonne la taille de page (limite des lecteurs PDF : environ 14 400 points)
  const scale = Math.min(0.75, 14000 / Math.max(width, height));
  download(pdfFromJpeg(jpeg.bytes, jpeg.width, jpeg.height, width * scale, height * scale), `${base}.pdf`);
}
