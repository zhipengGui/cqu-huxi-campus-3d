import * as THREE from "three";
import type { Area, Road } from "./types";

/** 在绿地内程序化散植示意树（避开水面和道路）。
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

const DENSITY: Record<string, number> = { forest: 1 / 450, park: 1 / 900, grass: 1 / 1800 };
const MAX_PER_AREA = 350;
const MAX_TOTAL = 1800;

export function buildTrees(scene: THREE.Scene, green: Area[], roads: Road[], water: Area[]): number {
  const rng = mulberry32(20261013);

  // 道路段与水面多边形的粗筛结构
  const roadBoxes = roads.map((r) => ({ bbox: bbox(r.pts), half: r.width / 2 + 2.5, pts: r.pts }));
  const waterBoxes = water.map((w) => ({ bbox: bbox(w.outers[0]), pts: w.outers[0] }));

  const positions: Pt[] = [];
  for (const g of green) {
    const density = DENSITY[g.kind ?? "park"];
    if (!density) continue;
    const outer = g.outers[0];
    const n = Math.min(MAX_PER_AREA, Math.floor(shoelace(outer) * density));
    const [x0, y0, x1, y1] = bbox(outer);
    let accepted = 0;
    let attempts = 0;
    while (accepted < n && attempts < n * 10 && positions.length < MAX_TOTAL) {
      attempts++;
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      if (!pointInPoly(x, y, outer)) continue;
      let bad = false;
      for (const wb of waterBoxes) {
        if (x >= wb.bbox[0] && x <= wb.bbox[2] && y >= wb.bbox[1] && y <= wb.bbox[3]
          && pointInPoly(x, y, wb.pts)) { bad = true; break; }
      }
      if (bad) continue;
      for (const rb of roadBoxes) {
        if (x < rb.bbox[0] - rb.half || x > rb.bbox[2] + rb.half
          || y < rb.bbox[1] - rb.half || y > rb.bbox[3] + rb.half) continue;
        const pts = rb.pts;
        for (let i = 0; i < pts.length - 1; i++) {
          if (distPointSeg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < rb.half) {
            bad = true;
            break;
          }
        }
        if (bad) break;
      }
      if (bad) continue;
      positions.push([x, y]);
      accepted++;
    }
  }

  if (!positions.length) return 0;

  const crownGeo = new THREE.IcosahedronGeometry(3.4, 1);
  crownGeo.scale(1, 0.82, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.55, 3.4, 5);
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a7256 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, positions.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  positions.forEach(([x, y], i) => {
    const s = 0.8 + rng() * 0.5; // 树高错落
    m.makeScale(s, s, s);
    m.setPosition(x, 1.7 * s, -y);
    trunks.setMatrixAt(i, m);
    m.setPosition(x, (3.4 + 2.1) * s, -y);
    crowns.setMatrixAt(i, m);
    // 树冠绿色微差异
    c.setHex(0x6fa35e).offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.08);
    crowns.setColorAt(i, c);
  });
  crowns.castShadow = true;
  trunks.castShadow = true;
  scene.add(trunks);
  scene.add(crowns);
  return positions.length;
}
