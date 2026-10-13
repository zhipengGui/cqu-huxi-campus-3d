import * as THREE from "three";

/** 建筑立面系统：自制窗带纹理图集（Canvas 程序化生成）+ 侧面 UV 按层高对齐。
 *  一张 tile = 一个楼层（3.3m 高 × 8m 宽），垂直重复 = 楼层数，水平按周长重复。
 *  参照 gxu：通用楼全部参数化立面，屋顶浅灰、顶部女儿墙。 */

export type FacadeStyle =
  | "dorm" | "teaching" | "canteen" | "hall" | "lab" | "library" | "office";

export const FLOOR_H = 3.3;
export const TILE_W = 8; // 每张纹理横向覆盖的世界宽度（米）

const WALL_TONES: Record<string, string[]> = {
  // 每种风格给 1-2 种墙面色调（variant 由楼 id 哈希选，同楼稳定）
  dorm: ["#f2efe7", "#e9dcd2"],
  teaching: ["#f3f1ea", "#ecefe9"],
  canteen: ["#f2efe8"],
  hall: ["#f1eee7"],
  lab: ["#eef0ec"],
  library: ["#f3f1ea"],
  office: ["#f4f2ec", "#e9e8e2"],
};

const ROOF_COLOR = 0xd9d9d3;
const PARAPET_COLOR = 0xe9e7e0;
const ROOF_UNIT_COLOR = 0xb9bdbf;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** 把 0..1 的画布画成一张"一层楼"立面 tile */
function drawTile(style: FacadeStyle, wall: string): HTMLCanvasElement {
  const S = 256;
  const [c, g] = canvas(S, S);
  // 墙面底色 + 轻微上下渐变（脏旧感）
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, wall);
  grad.addColorStop(1, shade(wall, -6));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // 楼板线（tile 顶部，浅灰）
  g.fillStyle = "rgba(120,124,128,0.35)";
  g.fillRect(0, 0, S, S * 0.045);

  const win = "#3b4754";
  const winLite = "#55636f";
  if (style === "teaching" || style === "library" || style === "lab") {
    // 横向通窗带：占楼层中部 ~46%，带竖向分格
    const y0 = S * 0.18;
    const h0 = S * 0.46;
    g.fillStyle = win;
    g.fillRect(S * 0.03, y0, S * 0.94, h0);
    g.fillStyle = winLite;
    const n = 8;
    for (let i = 1; i < n; i++) {
      g.fillRect(S * 0.03 + (S * 0.94 * i) / n, y0, 3, h0);
    }
    // 窗台线
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fillRect(S * 0.03, y0 + h0, S * 0.94, 3);
    if (style === "lab") {
      g.fillStyle = "rgba(60,70,80,0.25)";
      g.fillRect(0, S * 0.78, S, S * 0.06);
    }
  } else if (style === "dorm") {
    // 密排竖窗：每 tile 4 樘
    const w0 = S * 0.14;
    const h0 = S * 0.5;
    const y0 = S * 0.22;
    for (let i = 0; i < 4; i++) {
      const x0 = S * (0.08 + i * 0.23);
      g.fillStyle = i % 2 === 0 ? win : winLite;
      g.fillRect(x0, y0, w0, h0);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillRect(x0, y0 + h0, w0, 4);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(x0 + w0 * 0.46, y0, 2, h0); // 窗框中梃
    }
  } else if (style === "canteen" || style === "hall") {
    // 大玻璃面：占楼层下部 ~60%
    const y0 = S * 0.22;
    const h0 = S * 0.6;
    const glass = g.createLinearGradient(0, y0, 0, y0 + h0);
    glass.addColorStop(0, "#4a5a68");
    glass.addColorStop(1, "#33404c");
    g.fillStyle = glass;
    g.fillRect(S * 0.02, y0, S * 0.96, h0);
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i <= 6; i++) {
      g.fillRect(S * 0.02 + (S * 0.96 * i) / 6, y0, 2, h0);
    }
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fillRect(S * 0.02, y0 - 4, S * 0.96, 4);
  } else {
    // office：规整方窗 2×1
    const w0 = S * 0.26;
    const h0 = S * 0.44;
    const y0 = S * 0.24;
    for (const x0 of [S * 0.16, S * 0.58]) {
      g.fillStyle = win;
      g.fillRect(x0, y0, w0, h0);
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillRect(x0, y0 + h0, w0, 3);
    }
  }
  return c;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, v + amt));
  const r = f((n >> 16) & 255);
  const g2 = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g2},${b})`;
}

const tileCache = new Map<string, THREE.Texture>();

export function facadeTexture(style: FacadeStyle, variant: number): THREE.Texture {
  const key = `${style}:${variant}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const tones = WALL_TONES[style] ?? WALL_TONES.office;
  const wall = tones[variant % tones.length];
  const tex = new THREE.CanvasTexture(drawTile(style, wall));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tileCache.set(key, tex);
  return tex;
}

export function variantCount(style: FacadeStyle): number {
  return (WALL_TONES[style] ?? WALL_TONES.office).length;
}

export const roofMaterial = new THREE.MeshLambertMaterial({ color: ROOF_COLOR });
export const parapetMaterial = new THREE.MeshLambertMaterial({ color: PARAPET_COLOR });
export const roofUnitMaterial = new THREE.MeshLambertMaterial({ color: ROOF_UNIT_COLOR });

function hash01(id: number | string): number {
  let n: number;
  if (typeof id === "number" && Number.isFinite(id)) {
    n = id;
  } else {
    n = 0;
    for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) | 0;
    n = Math.abs(n);
  }
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function styleVariant(style: FacadeStyle, id: number | string): number {
  return Math.floor(hash01(String(id) + "v") * variantCount(style));
}

/** 稳定 0..1 随机（楼栋色调微差异用） */
export function idHash01(id: number | string): number {
  return hash01(id);
}

/** 重写侧面 UV：v 按 3.3m 楼层对齐，u 按轮廓周长展开。
 *  poly 为 scene 坐标（东,北）；geo 已经过 rotateX(-PI/2)（世界 x=东, z=-北）。 */
export function rewriteFacadeUV(
  geo: THREE.BufferGeometry,
  poly: [number, number][],
  floors: number,
): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  if (!uv) return;

  // 周长累计表
  const cum: number[] = [0];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    cum.push(cum[i] + Math.hypot(x2 - x1, y2 - y1));
  }
  const arcAt = (wx: number, wy: number): number => {
    let bestD = Infinity;
    let bestS = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((wx - x1) * dx + (wy - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const d = Math.hypot(wx - px, wy - py);
      if (d < bestD) {
        bestD = d;
        bestS = cum[i] + t * Math.sqrt(len2);
      }
    }
    return bestS / TILE_W;
  };

  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    if (Math.abs(ny) > 0.5) continue; // 顶/底面交给 roof 材质
    const wx = pos.getX(i);
    const wy = -pos.getZ(i); // 世界 z -> 北
    const height = pos.getY(i);
    uv.setXY(i, arcAt(wx, wy), height / (FLOOR_H * Math.max(1, floors)));
  }
  uv.needsUpdate = true;
}

/** 多边形顶点式内缩（斜接钳制），女儿墙内环用 */
export function offsetPolygon(poly: [number, number][], d: number): [number, number][] {
  const n = poly.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = poly[(i - 1 + n) % n];
    const [cx, cy] = poly[i];
    const [nx, ny] = poly[(i + 1) % n];
    const seg = (ax: number, ay: number, bx: number, by: number): [number, number] => {
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      return [dy / len, -dx / len];
    };
    const [n1x, n1y] = seg(px, py, cx, cy);
    const [n2x, n2y] = seg(cx, cy, nx, ny);
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const cosHalf = Math.max(0.45, mx * n2x + my * n2y);
    const scale = Math.min(1 / cosHalf, 2.5) * d;
    out.push([cx + mx * scale, cy + my * scale]);
  }
  return out;
}

export { PARAPET_COLOR, ROOF_UNIT_COLOR };
