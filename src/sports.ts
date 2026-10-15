import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Area } from "./types";

/** 运动场地精细标线（对标 gxu sports/basketball 程序化方案，运行时生成，非贴图）：
 *  篮球场完整标线+篮架 / 足球场标线+球门 / 网球场标线+球网 /
 *  羽毛球·排球简易标线+球网 / 泳池分道线 / 田径跑道（area≥15000 的地块自动识别）。
 *  坐标约定与 sceneBuilder 一致：几何顶点 (x 东, y 上, -y 北)。 */

type Pt = [number, number];

const Y_MARK = 0.06;

// ---- 标线几何工具（全部平面凸多边形 fan 三角化）----

function polygonGeo(pts: Pt[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [px, py] of pts) pos.push(px, y, -py);
  // 本模块的四边形顶点序为顺时针（俯视），翻转索引使法线朝上（+Y），否则被背面剔除
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lineMark(geos: THREE.BufferGeometry[], x1: number, y1: number, x2: number, y2: number, w: number, y = Y_MARK): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  geos.push(polygonGeo([
    [x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny],
  ], y));
}

function arcBand(geos: THREE.BufferGeometry[], cx: number, cy: number, r: number, w: number, a0: number, a1: number, y = Y_MARK, segs = 28): void {
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + ((a1 - a0) * i) / segs;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    lineMark(geos,
      cx + Math.cos(t0) * r, cy + Math.sin(t0) * r,
      cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, w, y);
  }
}

function circleMark(geos: THREE.BufferGeometry[], cx: number, cy: number, r: number, w: number, y = Y_MARK): void {
  arcBand(geos, cx, cy, r, w, 0, Math.PI * 2, y, 36);
}

// ---- 3D 器材（box/cylinder/torus，按材质桶收集）----

function boxAt(buckets: Record<string, THREE.BufferGeometry[]>, key: string,
  sx: number, sy: number, sz: number, x: number, y: number, z: number): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  buckets[key].push(g);
}

// ---- 篮球场（标准 28×15 标线 + 篮架）----

function basketballCourt(
  marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean,
): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const L = 14, W = 7.5; // 半场
  const w = 0.12;
  // 边界 + 中线
  const c0 = map(-L, -W), c1 = map(L, -W), c2 = map(L, W), c3 = map(-L, W);
  lineMark(marks, c0[0], c0[1], c1[0], c1[1], w);
  lineMark(marks, c1[0], c1[1], c2[0], c2[1], w);
  lineMark(marks, c2[0], c2[1], c3[0], c3[1], w);
  lineMark(marks, c3[0], c3[1], c0[0], c0[1], w);
  const m0 = map(0, -W), m1 = map(0, W);
  lineMark(marks, m0[0], m0[1], m1[0], m1[1], w);
  circleMark(marks, cx, cy, 1.8, w);
  for (const s of [1, -1]) {
    // 禁区（三边）+ 罚球圈
    const k0 = map(s * L, -2.45), k1 = map(s * 8.2, -2.45), k2 = map(s * 8.2, 2.45), k3 = map(s * L, 2.45);
    lineMark(marks, k0[0], k0[1], k1[0], k1[1], w);
    lineMark(marks, k1[0], k1[1], k2[0], k2[1], w);
    lineMark(marks, k2[0], k2[1], k3[0], k3[1], w);
    const ft = map(s * 8.2, 0);
    circleMark(marks, ft[0], ft[1], 1.8, w);
    // 三分线：两段底线直线 + 朝中场 150° 弧（圆心篮下 u=±12.5）
    for (const v of [-6.6, 6.6]) {
      const t0 = map(s * L, v), t1 = map(s * 9.2, v);
      lineMark(marks, t0[0], t0[1], t1[0], t1[1], w);
    }
    const rimC = map(s * 12.5, 0);
    const base = longEW ? 0 : Math.PI / 2;
    const a0 = s > 0 ? base + Math.PI - 1.31 : base - 1.31;
    arcBand(marks, rimC[0], rimC[1], 6.75, w, a0, a0 + 2.62);
    // 篮架：底座/立柱/篮板/篮圈（世界 z = -y 北）
    const pillar = map(s * 14.9, 0);
    const board = map(s * 13.7, 0);
    const rim = map(s * 13.55, 0);
    const pz = -pillar[1], bz = -board[1], rz = -rim[1];
    boxAt(buckets, "dark", 1.1, 0.5, 0.8, pillar[0], 0.25, pz);
    boxAt(buckets, "dark", 0.16, 3.6, 0.16, pillar[0], 1.8, pz);
    boxAt(buckets, "dark", 0.9, 0.12, 0.12, (pillar[0] + board[0]) / 2, 3.4, (pz + bz) / 2);
    const bw = longEW ? 0.06 : 1.8;
    const bd = longEW ? 1.8 : 0.06;
    boxAt(buckets, "board", bw, 1.05, bd, board[0], 3.0, bz);
    const rg = new THREE.TorusGeometry(0.225, 0.02, 8, 20);
    rg.rotateX(Math.PI / 2);
    rg.translate(rim[0], 3.05, rz);
    buckets["orange"].push(rg);
  }
}

// ---- 足球场（边界/中线/中圈/禁区/球门区/点球点/角弧/球门）----

function soccerField(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean, L: number, W: number, withGoal: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.14;
  const hl = L / 2, hw = W / 2;
  const c0 = map(-hl, -hw), c1 = map(hl, -hw), c2 = map(hl, hw), c3 = map(-hl, hw);
  lineMark(marks, c0[0], c0[1], c1[0], c1[1], w);
  lineMark(marks, c1[0], c1[1], c2[0], c2[1], w);
  lineMark(marks, c2[0], c2[1], c3[0], c3[1], w);
  lineMark(marks, c3[0], c3[1], c0[0], c0[1], w);
  const m0 = map(0, -hw), m1 = map(0, hw);
  lineMark(marks, m0[0], m0[1], m1[0], m1[1], w);
  circleMark(marks, cx, cy, 9.15, w);
  for (const s of [1, -1]) {
    // 禁区 16.5×40.32 + 球门区 5.5×18.32 + 点球点 + 罚球弧
    const pa0 = map(s * hl, -20.16), pa1 = map(s * (hl - 16.5), -20.16),
      pa2 = map(s * (hl - 16.5), 20.16), pa3 = map(s * hl, 20.16);
    lineMark(marks, pa0[0], pa0[1], pa1[0], pa1[1], w);
    lineMark(marks, pa1[0], pa1[1], pa2[0], pa2[1], w);
    lineMark(marks, pa2[0], pa2[1], pa3[0], pa3[1], w);
    const ga0 = map(s * hl, -9.16), ga1 = map(s * (hl - 5.5), -9.16),
      ga2 = map(s * (hl - 5.5), 9.16), ga3 = map(s * hl, 9.16);
    lineMark(marks, ga0[0], ga0[1], ga1[0], ga1[1], w);
    lineMark(marks, ga1[0], ga1[1], ga2[0], ga2[1], w);
    lineMark(marks, ga2[0], ga2[1], ga3[0], ga3[1], w);
    const pk = map(s * (hl - 11), 0);
    arcBand(marks, pk[0], pk[1], 9.15, w, s > 0 ? Math.PI * 0.7 : -Math.PI * 0.3, s > 0 ? Math.PI * 1.3 : Math.PI * 0.3);
    // 角弧
    for (const v of [-hw, hw]) {
      const corner = map(s * hl, v);
      const av = Math.atan2(v, s); // 朝场内
      arcBand(marks, corner[0], corner[1], 1, w, av - Math.PI / 2, av + Math.PI / 2);
    }
    if (withGoal) {
      const gp = map(s * (hl + 0.8), 0);
      const gz = -gp[1];
      const gwAlong = longEW ? 0.12 : 7.32;
      const gwAcross = longEW ? 7.32 : 0.12;
      boxAt(buckets, "goal", gwAlong, 2.44, gwAcross, gp[0], 1.22, gz);
      const wAlong = longEW ? 0.1 : 0.1;
      for (const v of [-3.66, 3.66]) {
        const post = map(s * (hl + 0.8), v);
        boxAt(buckets, "goal", wAlong, 2.44, wAlong, post[0], 1.22, -post[1]);
      }
    }
  }
}

// ---- 网球场（外框+单打线+发球线+球网）----

function tennisCourt(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.1;
  const hl = 11.885, hwD = 5.485, hwS = 4.115;
  const rect = (u0: number, v0: number, u1: number, v1: number): void => {
    const a = map(u0, v0), b = map(u1, v0), c = map(u1, v1), d = map(u0, v1);
    lineMark(marks, a[0], a[1], b[0], b[1], w);
    lineMark(marks, b[0], b[1], c[0], c[1], w);
    lineMark(marks, c[0], c[1], d[0], d[1], w);
    lineMark(marks, d[0], d[1], a[0], a[1], w);
  };
  rect(-hl, -hwD, hl, hwD); // 双打外框
  rect(-hl, -hwS, hl, hwS); // 单打线
  rect(-5.485, -hwD, 5.485, hwD); // 发球线区
  const s0 = map(-5.485, 0), s1 = map(5.485, 0);
  lineMark(marks, s0[0], s0[1], s1[0], s1[1], w); // 中线
  // 球网（灰蓝，避免远处一片黑棒）
  const nz = -cy;
  const nw = longEW ? 0.05 : 12.8;
  const nd = longEW ? 12.8 : 0.05;
  boxAt(buckets, "net", nw, 0.75, nd, cx, 0.41, nz);
  boxAt(buckets, "board", nw, 0.06, nd, cx, 0.81, nz);
  for (const s of [1, -1]) {
    const post = longEW ? [cx, cy + s * 6.55] : [cx + s * 6.55, cy];
    boxAt(buckets, "dark", 0.1, 0.85, 0.1, post[0], 0.42, -post[1]);
  }
}

// ---- 羽毛球场（边界+中线+前发球线+网）----

function badmintonCourt(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.08;
  const hl = 6.7, hw = 3.05;
  const a = map(-hl, -hw), b = map(hl, -hw), c = map(hl, hw), d = map(-hl, hw);
  lineMark(marks, a[0], a[1], b[0], b[1], w);
  lineMark(marks, b[0], b[1], c[0], c[1], w);
  lineMark(marks, c[0], c[1], d[0], d[1], w);
  lineMark(marks, d[0], d[1], a[0], a[1], w);
  const m0 = map(-hl, 0), m1 = map(hl, 0);
  lineMark(marks, m0[0], m0[1], m1[0], m1[1], w);
  for (const s of [1, -1]) {
    const f0 = map(s * 4.72, -hw), f1 = map(s * 4.72, hw);
    lineMark(marks, f0[0], f0[1], f1[0], f1[1], w);
  }
  const nw = longEW ? 0.04 : 6.5;
  const nd = longEW ? 6.5 : 0.04;
  boxAt(buckets, "net", nw, 1.35, nd, cx, 0.71, -cy);
}

// ---- 排球场（边界+中线+进攻线+网）----

function volleyballCourt(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.1;
  const hl = 9, hw = 4.5;
  const a = map(-hl, -hw), b = map(hl, -hw), c = map(hl, hw), d = map(-hl, hw);
  lineMark(marks, a[0], a[1], b[0], b[1], w);
  lineMark(marks, b[0], b[1], c[0], c[1], w);
  lineMark(marks, c[0], c[1], d[0], d[1], w);
  lineMark(marks, d[0], d[1], a[0], a[1], w);
  for (const s of [1, -1]) {
    const a0 = map(s * 3, -hw), a1 = map(s * 3, hw);
    lineMark(marks, a0[0], a0[1], a1[0], a1[1], w);
  }
  const nw = longEW ? 0.05 : 9.5;
  const nd = longEW ? 9.5 : 0.05;
  boxAt(buckets, "net", nw, 1.15, nd, cx, 0.62, -cy);
}

// ---- 田径跑道（胶囊环带 8 道 + 内场 + 内场足球标线）----

function stadiumPath(cx: number, cy: number, halfStraight: number, R: number): Pt[] {
  const pts: Pt[] = [];
  const seg = 24;
  pts.push([cx + R, cy - halfStraight]);
  pts.push([cx + R, cy + halfStraight]);
  for (let i = 1; i < seg; i++) {
    const a = (Math.PI * i) / seg;
    pts.push([cx + Math.cos(a) * R, cy + halfStraight + Math.sin(a) * R]);
  }
  pts.push([cx - R, cy + halfStraight]);
  pts.push([cx - R, cy - halfStraight]);
  for (let i = 1; i < seg; i++) {
    const a = Math.PI + (Math.PI * i) / seg;
    pts.push([cx + Math.cos(a) * R, cy - halfStraight + Math.sin(a) * R]);
  }
  return pts;
}

function bandFromClosedPath(geos: THREE.BufferGeometry[], pts: Pt[], width: number, y: number): void {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[(i + 1) % n];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (width / 2);
    const ny = (dx / l) * (width / 2);
    const j = (i + 1) % n;
    geos.push(polygonGeo([
      [pts[i][0] + nx, pts[i][1] + ny], [pts[j][0] + nx, pts[j][1] + ny],
      [pts[j][0] - nx, pts[j][1] - ny], [pts[i][0] - nx, pts[i][1] - ny],
    ], y));
  }
}

function athleticsTrack(
  marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, halfStraight: number, R: number,
): void {
  const laneW = 1.22;
  const y = 0.045;
  // 内场填充（胶囊 Shape → 三角化）
  const shape = new THREE.Shape();
  shape.moveTo(cx + R, cy - halfStraight);
  shape.lineTo(cx + R, cy + halfStraight);
  shape.absarc(cx, cy + halfStraight, R, 0, Math.PI, false);
  shape.lineTo(cx - R, cy - halfStraight);
  shape.absarc(cx, cy - halfStraight, R, Math.PI, Math.PI * 2, false);
  const infield = new THREE.ShapeGeometry(shape);
  infield.rotateX(-Math.PI / 2);
  buckets["infield"].push(infield);
  // 8 道交替色
  for (let i = 0; i < 8; i++) {
    const rMid = R + i * laneW + laneW / 2;
    bandFromClosedPath(buckets[i % 2 === 0 ? "trackA" : "trackB"],
      stadiumPath(cx, cy, halfStraight, rMid), laneW, y);
  }
  // 内场足球 96×62（长轴南北）
  soccerField(marks, buckets, cx, cy, false, 96, 62, false);
}

// ---- 主入口 ----

const MARK_COLORS: Record<string, number> = {
  mark: 0xf2f4ee,
  trackA: 0xc9735c,
  trackB: 0xd6826b,
  infield: 0x7fae66,
  dark: 0x3d4348,
  board: 0xe8eae6,
  orange: 0xd9662f,
  net: 0x5f6a72,
  goal: 0xf0f2ee,
  lane: 0x3a6f8a,
};

export function buildSportsMarks(parent: THREE.Object3D, green: Area[]): void {
  const marks: THREE.BufferGeometry[] = [];
  const buckets: Record<string, THREE.BufferGeometry[]> = {};
  for (const k of Object.keys(MARK_COLORS)) buckets[k] = [];

  for (const a of green) {
    const outer = a.outers[0];
    if (!outer) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of outer) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const bw = x1 - x0;
    const bh = y1 - y0;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const area = bw * bh;

    if (a.kind === "pitch" && !a.sport && area >= 15000) {
      // 田径跑道（虎溪主田径场，OSM 未标 track）
      athleticsTrack(marks, buckets, cx, cy, (bh - 2 * 44 - 9.76) / 2, 44);
      continue;
    }
    if (a.kind !== "pitch" && a.kind !== "pool") continue;

    if (a.kind === "pool") {
      // 分道线：沿长轴，每 2.5m 一道
      const longEW = bw >= bh;
      const Lmax = longEW ? bw : bh;
      const Wmax = longEW ? bh : bw;
      const lanes = Math.max(2, Math.floor(Wmax / 2.5) - 1);
      for (let i = 1; i <= lanes; i++) {
        const v = -Wmax / 2 + (Wmax * i) / (lanes + 1);
        const p0 = longEW ? [cx - Lmax / 2 + 2, cy + v] : [cx + v, cy - Lmax / 2 + 2];
        const p1 = longEW ? [cx + Lmax / 2 - 2, cy + v] : [cx + v, cy + Lmax / 2 - 2];
        lineMark(buckets["lane"], p0[0], p0[1], p1[0], p1[1], 0.1);
      }
      continue;
    }

    const longEW = bw >= bh;
    const Lmax = longEW ? bw : bh;
    const Wmax = longEW ? bh : bw;
    switch (a.sport) {
      case "basketball":
        if (Lmax >= 27 && Lmax <= 32 && Wmax >= 14 && Wmax <= 17) {
          basketballCourt(marks, buckets, cx, cy, longEW);
        }
        break;
      case "soccer":
        if (Lmax >= 90) soccerField(marks, buckets, cx, cy, longEW, Lmax - 8, Wmax - 8, true);
        else if (Lmax >= 40) soccerField(marks, buckets, cx, cy, longEW, Lmax - 6, Wmax - 6, false);
        break;
      case "tennis":
        if (Lmax >= 22 && Wmax >= 12) tennisCourt(marks, buckets, cx, cy, longEW);
        break;
      case "badminton":
        if (Lmax >= 12 && Wmax >= 5.5) badmintonCourt(marks, buckets, cx, cy, longEW);
        break;
      case "volleyball":
      case "beachvolleyball":
        if (Lmax >= 16 && Wmax >= 8) volleyballCourt(marks, buckets, cx, cy, longEW);
        break;
      default:
        break;
    }
  }

  const addMerged = (geos: THREE.BufferGeometry[], color: number): void => {
    if (!geos.length) return;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
    const mat = new THREE.MeshLambertMaterial({
      color,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    parent.add(mesh);
  };
  addMerged(marks, MARK_COLORS.mark);
  for (const k of Object.keys(MARK_COLORS)) {
    if (k === "mark") continue;
    addMerged(buckets[k], MARK_COLORS[k]);
  }
}
