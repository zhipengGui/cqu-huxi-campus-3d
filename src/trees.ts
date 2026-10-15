import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Area, Building, Road } from "./types";

/** 绿地内程序化散植示意树（避开水面、道路与建筑）。
 *  三种模板（阔叶/小阔叶/棕榈）+ Standard 材质 + 实例色，对标 gxu 植被方案（运行时简化版）。
 *  OSM 无树点数据，此处为装饰性分布，密度按绿地类型区分。 */

type Pt = [number, number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bbox(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function shoelace(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const DENSITY: Record<string, number> = { forest: 1 / 300, park: 1 / 350, grass: 1 / 700 };
const MAX_PER_AREA = 500;
const MAX_TOTAL = 3500;
const AVENUE_STEP = 14; // 行道树间距（米）

// ---- 三种树冠模板（低模椭球团，单棵 ≤200 三角形）----

function ellipsoid(sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function broadleafCrown(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [ellipsoid(2.3, 1.9, 2.3, 0, 5.4, 0)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(ellipsoid(1.7, 1.4, 1.7, Math.cos(a) * 1.9, 4.4 + (i % 2) * 0.7, Math.sin(a) * 1.9));
  }
  return mergeGeometries(parts)!;
}

function smallCrown(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [ellipsoid(1.8, 1.6, 1.8, 0, 4.6, 0)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(ellipsoid(1.3, 1.1, 1.3, Math.cos(a) * 1.3, 3.8, Math.sin(a) * 1.3));
  }
  return mergeGeometries(parts)!;
}

function palmCrown(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(2.6, 0.22, 0.55);
    g.rotateZ(-0.45);
    g.rotateY(-a);
    g.translate(Math.cos(a) * 1.5, 5.3 - (i % 2) * 0.3, Math.sin(a) * 1.5);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

const CROWN_PALETTES: number[][] = [
  [0x5d8a4f, 0x6fa35e, 0x54824a], // 阔叶
  [0x74a862, 0x86b573, 0x6a9c58], // 小阔叶
  [0x6f9c52, 0x82a95e], // 棕榈
];

export function buildTrees(
  parent: THREE.Object3D,
  green: Area[],
  roads: Road[],
  water: Area[],
  buildings: Building[],
): number {
  const rng = mulberry32(20261013);

  // 避让结构：水面多边形 / 道路段 / 楼栋多边形（均带 bbox 粗筛）
  const roadBoxes = roads.map((r) => ({ bbox: bbox(r.pts), half: r.width / 2 + 2.5, pts: r.pts }));
  const waterBoxes = water.map((w) => ({ bbox: bbox(w.outers[0]), pts: w.outers[0] }));
  const buildingBoxes = buildings.map((b) => ({ bbox: bbox(b.polygon), pts: b.polygon }));

  function blocked(x: number, y: number): boolean {
    for (const wb of waterBoxes) {
      if (x >= wb.bbox[0] && x <= wb.bbox[2] && y >= wb.bbox[1] && y <= wb.bbox[3]
        && pointInPoly(x, y, wb.pts)) return true;
    }
    for (const rb of roadBoxes) {
      if (x < rb.bbox[0] - rb.half || x > rb.bbox[2] + rb.half
        || y < rb.bbox[1] - rb.half || y > rb.bbox[3] + rb.half) continue;
      const pts = rb.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distPointSeg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < rb.half) return true;
      }
    }
    for (const bb of buildingBoxes) {
      if (x < bb.bbox[0] - 2 || x > bb.bbox[2] + 2 || y < bb.bbox[1] - 2 || y > bb.bbox[3] + 2) continue;
      if (pointInPoly(x, y, bb.pts)) return true;
    }
    return false;
  }

  // 采样布点：绿地内散植
  const templates: Pt[][] = [[], [], []]; // 0 阔叶 / 1 小阔叶 / 2 棕榈
  let total = 0;
  for (const g of green) {
    const density = DENSITY[g.kind ?? "park"];
    if (!density) continue;
    const outer = g.outers[0];
    const n = Math.min(MAX_PER_AREA, Math.floor(shoelace(outer) * density));
    const [x0, y0, x1, y1] = bbox(outer);
    let accepted = 0;
    let attempts = 0;
    while (accepted < n && attempts < n * 10 && total < MAX_TOTAL) {
      attempts++;
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      if (!pointInPoly(x, y, outer)) continue;
      if (blocked(x, y)) continue;
      const r = rng();
      const ti = r < 0.66 ? 0 : r < 0.91 ? 1 : 2;
      templates[ti].push([x, y]);
      accepted++;
      total++;
    }
  }

  // 行道树：沿校园主路/次路两侧交替种植（path 级小路不种）
  for (const r of roads) {
    const k = r.kind;
    if (k === "footway" || k === "path" || k === "steps" || k === "track" || k === "cycleway") continue;
    const pts = r.pts;
    if (pts.length < 2) continue;
    const off = r.width / 2 + 3.5;
    let acc = AVENUE_STEP * 0.5;
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      if (!segLen) continue;
      const dx = (x2 - x1) / segLen;
      const dy = (y2 - y1) / segLen;
      while (acc < segLen) {
        const px = x1 + dx * acc;
        const py = y1 + dy * acc;
        const side = n % 2 === 0 ? 1 : -1;
        const tx = px - dy * off * side;
        const ty = py + dx * off * side;
        n++;
        acc += AVENUE_STEP;
        if (blocked(tx, ty)) continue;
        const r2 = rng();
        const ti = r2 < 0.7 ? 0 : r2 < 0.94 ? 1 : 2;
        templates[ti].push([tx, ty]);
        total++;
      }
      acc -= segLen;
    }
  }
  if (!total) return 0;

  // 材质与几何
  const crownGeos = [broadleafCrown(), smallCrown(), palmCrown()];
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.4, 4.2, 6);
  trunkGeo.translate(0, 2.1, 0);
  const palmTrunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 5.6, 6);
  palmTrunkGeo.translate(0, 2.8, 0);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7256, roughness: 0.95 });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();

  const trunksGeo = [trunkGeo, trunkGeo, palmTrunkGeo];
  for (let ti = 0; ti < 3; ti++) {
    const pts = templates[ti];
    if (!pts.length) continue;
    const crowns = new THREE.InstancedMesh(crownGeos[ti], crownMat, pts.length);
    const trunks = new THREE.InstancedMesh(trunksGeo[ti], trunkMat, pts.length);
    const palette = CROWN_PALETTES[ti];
    pts.forEach(([x, y], i) => {
      const sc = 0.9 + rng() * 0.5; // 树高错落
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      v.set(x, 0, -y);
      s.set(sc, sc, sc);
      m.compose(v, q, s);
      trunks.setMatrixAt(i, m);
      v.set(x, 0, -y);
      m.compose(v, q, s);
      crowns.setMatrixAt(i, m);
      c.setHex(palette[Math.floor(rng() * palette.length)]);
      c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.07);
      crowns.setColorAt(i, c);
    });
    crowns.castShadow = true;
    trunks.castShadow = true;
    parent.add(trunks);
    parent.add(crowns);
  }
  return total;
}
