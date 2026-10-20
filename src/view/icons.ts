// アイコン（24×24 の線と面）。画面（DOM）とキャンバスの両方で同じ形を使う。
// 仮アセットではなく UI の部品として使い続ける想定（絵の差し替え対象は肖像・背景）。
type Part = [d: string, mode: "f" | "s"];

export const ICONS: Record<string, Part[]> = {
  sword: [
    ["M21 2.5 L21.5 3 L21 6 L10.6 16.4 L7.6 13.4 L18 3 Z", "f"],
    ["M4.6 12.4 L6 11 L13 18 L11.6 19.4 Z", "f"],
    ["M7.4 17 L8.9 18.5 L5.1 22.3 L3.6 20.8 Z", "f"],
  ],
  bow: [
    ["M7 2.5 C17 5.5 17 18.5 7 21.5", "s"],
    ["M7 2.5 L7 21.5", "s"],
    ["M3 12 L18 12", "s"],
    ["M21.5 12 L17 9 L17 15 Z", "f"],
  ],
  // 魔導書（炎・氷・雷）: 本の輪郭＋表紙の紋
  fire: [
    ["M5 3.5 L18.5 3.5 L18.5 20.5 L7 20.5 C5.9 20.5 5 19.6 5 18.5 Z", "s"],
    ["M5 18.5 C5 17.4 5.9 16.5 7 16.5 L18.5 16.5", "s"],
    ["M11.8 5.6 C13 7.8 15.2 8.8 15.2 11.4 C15.2 13.3 13.8 14.6 11.8 14.6 C9.9 14.6 8.4 13.3 8.4 11.5 C8.4 10 9.5 9.1 10.1 8 C10.5 9.1 11 9.6 11.5 9.8 C11.5 8.3 12.1 7 11.8 5.6 Z", "f"],
  ],
  ice: [
    ["M5 3.5 L18.5 3.5 L18.5 20.5 L7 20.5 C5.9 20.5 5 19.6 5 18.5 Z", "s"],
    ["M5 18.5 C5 17.4 5.9 16.5 7 16.5 L18.5 16.5", "s"],
    ["M11.8 5.5 L11.8 14.5 M7.9 7.7 L15.7 12.3 M15.7 7.7 L7.9 12.3", "s"],
  ],
  thunder: [
    ["M5 3.5 L18.5 3.5 L18.5 20.5 L7 20.5 C5.9 20.5 5 19.6 5 18.5 Z", "s"],
    ["M5 18.5 C5 17.4 5.9 16.5 7 16.5 L18.5 16.5", "s"],
    ["M13 5 L9 10.6 L11.6 10.6 L10.6 15 L14.8 9 L12.2 9 Z", "f"],
  ],
  spear: [
    ["M3.5 20.5 L16 8", "s"],
    ["M22 2 L19.6 9.8 L16.6 7.4 L14.2 4.4 Z", "f"],
    ["M6.2 15.2 L8.8 17.8", "s"],
  ],
  axe: [
    ["M4.5 21.5 L15.5 6.5", "s"],
    ["M11.5 2.8 C16 1.2 21.4 3.8 21.8 9.4 C19.8 10.2 16.6 10 14 8.4 C13.6 6.4 12.6 4.4 11.5 2.8 Z", "f"],
  ],
  might: [["M12 2 L14.6 9.2 L22 9.4 L16.2 14 L18.4 21.6 L12 17.2 L5.6 21.6 L7.8 14 L2 9.4 L9.4 9.2 Z", "f"]],
  haste: [["M13.5 1.5 L4.5 13.5 L11 13.5 L10 22.5 L19.5 9.5 L13 9.5 Z", "f"]],
  swift: [["M2.5 8 L9 8", "s"], ["M1.5 12 L8 12", "s"], ["M2.5 16 L9 16", "s"], ["M11 4.5 L21.5 12 L11 19.5 Z", "f"]],
  vigor: [["M12 21 C5 15.6 2 12.6 2 8.6 C2 5.6 4.3 3.5 7 3.5 C9 3.5 10.8 4.6 12 6.4 C13.2 4.6 15 3.5 17 3.5 C19.7 3.5 22 5.6 22 8.6 C22 12.6 19 15.6 12 21 Z", "f"]],
  area: [["M12 3 A9 9 0 1 1 11.99 3 Z", "s"], ["M12 8.5 A3.5 3.5 0 1 1 11.99 8.5 Z", "f"]],
  magnet: [["M5 3 L5 12 A7 7 0 0 0 19 12 L19 3 L15 3 L15 12 A3 3 0 0 1 9 12 L9 3 Z", "f"]],
  heal: [["M9.5 3 L14.5 3 L14.5 9.5 L21 9.5 L21 14.5 L14.5 14.5 L14.5 21 L9.5 21 L9.5 14.5 L3 14.5 L3 9.5 L9.5 9.5 Z", "f"]],
  ghost: [["M5 21.5 L5 10 A7 7 0 0 1 19 10 L19 21.5 L16.6 19.6 L14.2 21.5 L12 19.6 L9.8 21.5 L7.4 19.6 Z", "f"]],
  clock: [["M12 3 A9 9 0 1 1 11.99 3 Z", "s"], ["M12 7 L12 12 L15.5 14", "s"]],
  grit: [["M12 2 L20 5 L20 11 C20 16 16.6 19.6 12 22 C7.4 19.6 4 16 4 11 L4 5 Z", "f"]],
  okuribi: [["M9 4 L15 4 L16 6 L8 6 Z", "f"], ["M7 7 L17 7 L17 18 L7 18 Z", "s"], ["M12 9 C13.5 11 14.5 12 14.5 13.8 C14.5 15.4 13.4 16.5 12 16.5 C10.6 16.5 9.5 15.4 9.5 13.8 C9.5 12.3 11 11.4 12 9 Z", "f"], ["M10 18 L10 21 M14 18 L14 21", "s"]],
  bell: [["M12 3 C8 3 6 6 6 10 L6 15 L4 17 L20 17 L18 15 L18 10 C18 6 16 3 12 3 Z", "f"], ["M10 19.5 A2 2 0 0 0 14 19.5", "s"]],
  pause: [["M7 5 L10 5 L10 19 L7 19 Z", "f"], ["M14 5 L17 5 L17 19 L14 19 Z", "f"]],
};

/** カードやスロットに出すアイコン名（武器・パッシブ・家系の札はそのまま id） */
const ALIAS: Record<string, string> = {
  ember: "fire", frost: "ice", volt: "thunder", edge: "sword", point: "spear", hawk: "bow", medium: "ghost",
  kindle: "fire", chill: "ice", static: "thunder", tempo: "sword", reach: "spear", quiver: "bow", crit: "might", guard: "grit", regen: "heal", hunter: "swift",
};
export function iconFor(id: string): string {
  const a = ALIAS[id] ?? id;
  return ICONS[a] ? a : "heal";
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** DOM 用の SVG（色は currentColor） */
export function iconSvg(name: string, cls = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  for (const [d, mode] of ICONS[iconFor(name)]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    if (mode === "f") p.setAttribute("fill", "currentColor");
    else { p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.8"); p.setAttribute("stroke-linecap", "round"); }
    svg.append(p);
  }
  return svg;
}

const pathCache = new Map<string, Path2D>();

/** キャンバス用。中心 (x, y)、一辺 size で描く */
export function drawIcon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string): void {
  const k = size / 24;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(k, k);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  for (const [d, mode] of ICONS[iconFor(name)]) {
    let p = pathCache.get(d);
    if (!p) { p = new Path2D(d); pathCache.set(d, p); }
    if (mode === "f") ctx.fill(p);
    else ctx.stroke(p);
  }
  ctx.restore();
}
