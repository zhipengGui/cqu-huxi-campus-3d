import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Area } from "./types";

/** 运动场地精细标线（对标 gxu sports.py / basketball.py，配色与几何对齐官方）：
 *  砖红跑道+9条白分道环线+内场20条条纹草坪 / 篮球teal底+橙红key区+白标线+斜拉篮架+镂空浅灰篮网 /
 *  足球白线0.10+罚球弧只画禁区外段+杆件球门 / 网羽排浅灰球网 / 泳池分道线。
 *  分层（logarithmicDepthBuffer 关闭后靠几何高差防 z-fighting）：
 *  绿地底块 0.02 → 球场面层 0.06 → 标线 0.14。 */

type Pt = [number, number];

const Y_COURT = 0.06; // 球场面层
const Y_MARK = 0.14; // 标线（与面层拉开 8cm）
const ARCS = 64;

// ---- 配色（gxu build_campus.py 原值）----
const MARK_COLORS: Record<string, number> = {
  mark: 0xf5f3e7,      // sportWhite 暖白
  trackA: 0xba563f,    // track 砖红
  trackB: 0xb7543e,    // trackAlt 微暗交替
  apron: 0xa9513e,     // trackApron 外圈红铺装
  infield: 0x3d8650,   // fieldGreen
  stripe: 0x458f57,    // fieldStripe
  courtGreen: 0x347e69,// 篮球 teal 底
  courtKey: 0xbd6447,  // 篮球 key 橙红
  courtApron: 0x47746a,// 球场群外围铺装
  dark: 0x246752,      // 篮架框
  metal: 0x879593,     // 金属件
  orange: 0xe5762c,    // 篮圈橙
  glass: 0xa7c7c6,     // 篮板玻璃
  net: 0xc1cabb,      // 球网浅灰（所有网统一）
  goal: 0xf5f3e7,      // 足球门白
  lane: 0x3a6f8a,      // 泳道线
};

// ---- 标线几何工具（凸多边形 fan 三角化，绕向已翻转为朝上）----

function polygonGeo(pts: Pt[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const [px, py] of pts) {
    pos.push(px, y, -py);
    uv.push(0, 0); // 补 uv 占位，保证可与 BoxGeometry/ShapeGeometry 等带 uv 几何合并
  }
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
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

function arcBand(geos: THREE.BufferGeometry[], cx: number, cy: number, r: number, w: number, a0: number, a1: number, y = Y_MARK, segs = ARCS): void {
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + ((a1 - a0) * i) / segs;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    lineMark(geos,
      cx + Math.cos(t0) * r, cy + Math.sin(t0) * r,
      cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, w, y);
  }
}

function circleMark(geos: THREE.BufferGeometry[], cx: number, cy: number, r: number, w: number, y = Y_MARK): void {
  arcBand(geos, cx, cy, r, w, 0, Math.PI * 2, y, ARCS + 8);
}

// 沿闭合折线的带状（用于分道环线）
function closedLineStrip(geos: THREE.BufferGeometry[], pts: Pt[], w: number, y = Y_MARK): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    lineMark(geos, a[0], a[1], b[0], b[1], w, y);
  }
}

// ---- 3D 器材 ----

function boxAt(buckets: Record<string, THREE.BufferGeometry[]>, key: string,
  sx: number, sy: number, sz: number, x: number, y: number, z: number): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  buckets[key].push(g);
}

// ---- 篮球场（5 色块 + 精确标线 + 斜拉篮架 + 镂空篮网）----

function courtFloor(buckets: Record<string, THREE.BufferGeometry[]>,
  x0: number, y0: number, x1: number, y1: number, key: string, longEW: boolean, cx: number, cy: number): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const a = map(x0, y0), b = map(x1, y0), c = map(x1, y1), d = map(x0, y1);
  buckets[key].push(polygonGeo([a, b, c, d], Y_COURT));
}

function basketballCourt(
  marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean,
): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const W = 0.05;
  // 5 色块（teal 底 + 两端中央纵条橙红 key）
  courtFloor(buckets, -7.5, -14, -2.45, 14, "courtGreen", longEW, cx, cy);
  courtFloor(buckets, 2.45, -14, 7.5, 14, "courtGreen", longEW, cx, cy);
  courtFloor(buckets, -2.45, -8.2, 2.45, 8.2, "courtGreen", longEW, cx, cy);
  courtFloor(buckets, -2.45, -14, 2.45, -8.2, "courtKey", longEW, cx, cy);
  courtFloor(buckets, -2.45, 8.2, 2.45, 14, "courtKey", longEW, cx, cy);

  const rect = (u0: number, v0: number, u1: number, v1: number): void => {
    const a = map(u0, v0), b = map(u1, v0), c = map(u1, v1), d = map(u0, v1);
    lineMark(marks, a[0], a[1], b[0], b[1], W);
    lineMark(marks, b[0], b[1], c[0], c[1], W);
    lineMark(marks, c[0], c[1], d[0], d[1], W);
    lineMark(marks, d[0], d[1], a[0], a[1], W);
  };
  rect(-7.525, -14.025, 7.525, 14.025); // 边界
  const m0 = map(0, -7.65), m1 = map(0, 7.65);
  lineMark(marks, m0[0], m0[1], m1[0], m1[1], W); // 中线
  circleMark(marks, cx, cy, 1.775, W); // 中圈

  for (const s of [1, -1]) {
    const end = s * 14, free = s * (14 - 5.775), rim = s * (14 - 1.575);
    rect(-2.425, end, 2.425, free); // 禁区
    // 罚球半圆朝中场实线
    const a0 = s < 0 ? 0 : Math.PI;
    arcBand(marks, cx, cy + free, 1.775, W, a0, a0 + Math.PI, Y_MARK, 32);
    // 内侧虚线（6 段小弧）
    for (let k = 0; k < 6; k++) {
      arcBand(marks, cx, cy + free, 1.775, W,
        a0 + Math.PI + (k * Math.PI) / 6, a0 + Math.PI + (k + 0.55) * Math.PI / 6, Y_MARK, 4);
    }
    // 三分线：底角直线 + 大弧
    const radius = 6.725, side = 6.575;
    const dy = Math.sqrt(radius * radius - side * side);
    const t0 = map(-side, end), t1 = map(-side, rim - s * dy);
    lineMark(marks, t0[0], t0[1], t1[0], t1[1], W);
    const t2 = map(side, end), t3 = map(side, rim - s * dy);
    lineMark(marks, t2[0], t2[1], t3[0], t3[1], W);
    const a1 = s < 0 ? Math.atan2(dy, side) : Math.PI + Math.atan2(dy, side);
    const a2 = s < 0 ? Math.PI - Math.atan2(dy, side) : Math.PI * 2 - Math.atan2(dy, side);
    arcBand(marks, cx, cy + rim, radius, W, a1, a2, Y_MARK, 64);
    // 合理冲撞区
    arcBand(marks, cx, cy + rim, 1.275, W, a0, a0 + Math.PI, Y_MARK, 24);

    // 篮架：底座/立柱/篮板框/篮板玻璃/白条/篮圈/镂空篮网
    const post = map(s * 14.55, 0);
    const board = map(s * 12.815, 0);
    const rimC = map(s * 12.425, 0);
    const pz = -post[1], bz = -board[1], rz = -rimC[1];
    boxAt(buckets, "metal", 0.74, 0.5, 0.12, post[0], 0.06, pz); // 底座
    boxAt(buckets, "dark", 0.22, 2.7, 0.22, post[0], 1.38, pz); // 立柱
    // 斜拉杆（立柱顶到篮板顶）
    const back = map(s * 13.35, 0);
    const braceLen = Math.hypot(back[0] - post[0], back[1] - post[1]) || 0.01;
    const braceMid: [number, number, number] = [
      (post[0] + back[0]) / 2, 3.5, (-post[1] + (-back[1])) / 2,
    ];
    const brace = new THREE.CylinderGeometry(0.05, 0.05, braceLen + 1.8, 6);
    brace.translate(braceMid[0], braceMid[1], braceMid[2]);
    buckets["dark"].push(brace);
    // 篮板（玻璃+框）
    const bw = longEW ? 0.05 : 1.8;
    const bd = longEW ? 1.8 : 0.05;
    boxAt(buckets, "glass", bw, 1.05, bd, board[0], 3.425, bz);
    boxAt(buckets, "mark", (longEW ? 0.06 : 1.86), 1.05, (longEW ? 1.86 : 0.06), board[0], 3.425, bz); // 篮板白框
    // 篮圈（torus 水平）
    const ring = new THREE.TorusGeometry(0.225, 0.018, 8, 24);
    ring.rotateX(Math.PI / 2);
    ring.translate(rimC[0], 3.041, rz);
    buckets["orange"].push(ring);
    // 镂空篮网（2 层×12 角，浅灰细管）
    for (let lvl = 0; lvl < 2; lvl++) {
      const h0 = 3.041 - 0.2 * lvl;
      const h1 = 3.041 - 0.2 * (lvl + 1);
      const r0 = 0.225 - 0.045 * lvl;
      const r1 = 0.225 - 0.045 * (lvl + 1);
      for (let i = 0; i < 12; i++) {
        const a = (i + (lvl % 2) * 0.5) * Math.PI * 2 / 12;
        const b = a + Math.PI / 12;
        const p0: [number, number, number] = [rimC[0] + r0 * Math.cos(a), h0, rz + r0 * Math.sin(a)];
        const p1: [number, number, number] = [rimC[0] + r1 * Math.cos(b), h1, rz + r1 * Math.sin(b)];
        const lineLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 0.01;
        const ng = new THREE.CylinderGeometry(0.006, 0.006, lineLen, 3);
        ng.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
        buckets["net"].push(ng);
      }
    }
  }
}

// ---- 足球场（白线 0.10 + 罚球弧只画禁区外段 + 杆件球门）----

function soccerField(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean, L: number, W: number, withGoal: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.1;
  const hl = L / 2, hw = W / 2;
  const rect = (u0: number, v0: number, u1: number, v1: number): void => {
    const a = map(u0, v0), b = map(u1, v0), c = map(u1, v1), d = map(u0, v1);
    lineMark(marks, a[0], a[1], b[0], b[1], w);
    lineMark(marks, b[0], b[1], c[0], c[1], w);
    lineMark(marks, c[0], c[1], d[0], d[1], w);
    lineMark(marks, d[0], d[1], a[0], a[1], w);
  };
  rect(-hl, -hw, hl, hw);
  const m0 = map(0, -hw), m1 = map(0, hw);
  lineMark(marks, m0[0], m0[1], m1[0], m1[1], w);
  circleMark(marks, cx, cy, 9.15, w);
  for (const s of [1, -1]) {
    rect(s * hl - s * 16.5, -20.16, s * hl, 20.16); // 禁区
    rect(s * hl - s * 5.5, -9.16, s * hl, 9.16); // 球门区
    const pk = map(s * (hl - 11), 0);
    arcBand(marks, pk[0], pk[1], 9.15, w,
      s > 0 ? Math.PI * 0.7 : -Math.PI * 0.3,
      s > 0 ? Math.PI * 1.3 : Math.PI * 0.3, Y_MARK, 48);
    for (const v of [-hw, hw]) {
      const corner = map(s * hl, v);
      const av = Math.atan2(v, s);
      arcBand(marks, corner[0], corner[1], 1, w, av - Math.PI / 2, av + Math.PI / 2, Y_MARK, 16);
    }
    if (withGoal) {
      // 杆件球门：两立柱+横梁+斜背撑
      const gp = map(s * hl, 0);
      const gz = -gp[1];
      for (const v of [-3.66, 3.66]) {
        const post = map(s * hl, v);
        boxAt(buckets, "goal", 0.08, 2.44, 0.08, post[0], 1.22, -post[1]);
      }
      const gwAlong = longEW ? 0.08 : 7.32;
      const gwAcross = longEW ? 7.32 : 0.08;
      boxAt(buckets, "goal", gwAlong, 0.08, gwAcross, gp[0], 2.4, gz); // 横梁
      // 网线（简化：几条竖网线）
      for (let k = 0; k < 6; k++) {
        const v = -3.66 + (k * 7.32) / 5;
        const np = map(s * hl, v);
        const nb = map(s * (hl + 1.5), v);
        const lineLen = Math.hypot(nb[0] - np[0], nb[1] - np[1]) || 0.01;
        const ng = new THREE.CylinderGeometry(0.008, 0.008, lineLen, 3);
        ng.translate((np[0] + nb[0]) / 2, 1.3, (-np[1] - nb[1]) / 2);
        buckets["net"].push(ng);
      }
    }
  }
}

// ---- 网球场 ----

function tennisCourt(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.06;
  const hl = 11.885, hwD = 5.485, hwS = 4.115;
  const rect = (u0: number, v0: number, u1: number, v1: number): void => {
    const a = map(u0, v0), b = map(u1, v0), c = map(u1, v1), d = map(u0, v1);
    lineMark(marks, a[0], a[1], b[0], b[1], w);
    lineMark(marks, b[0], b[1], c[0], c[1], w);
    lineMark(marks, c[0], c[1], d[0], d[1], w);
    lineMark(marks, d[0], d[1], a[0], a[1], w);
  };
  rect(-hl, -hwD, hl, hwD);
  rect(-hl, -hwS, hl, hwS);
  rect(-5.485, -hwD, 5.485, hwD);
  const s0 = map(-5.485, 0), s1 = map(5.485, 0);
  lineMark(marks, s0[0], s0[1], s1[0], s1[1], w);
  // 浅灰球网 + 白顶带
  const nw = longEW ? 0.05 : 12.8;
  const nd = longEW ? 12.8 : 0.05;
  boxAt(buckets, "net", nw, 0.85, nd, cx, 0.46, -cy);
  boxAt(buckets, "mark", nw, 0.06, nd, cx, 0.91, -cy);
  for (const s of [1, -1]) {
    const post = longEW ? [cx, cy + s * 6.55] : [cx + s * 6.55, cy];
    boxAt(buckets, "metal", 0.1, 1.07, 0.1, post[0], 0.53, -post[1]);
  }
}

// ---- 羽毛球场 ----

function badmintonCourt(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.06;
  const hl = 6.7, hw = 3.05;
  const rect = (u0: number, v0: number, u1: number, v1: number): void => {
    const a = map(u0, v0), b = map(u1, v0), c = map(u1, v1), d = map(u0, v1);
    lineMark(marks, a[0], a[1], b[0], b[1], w);
    lineMark(marks, b[0], b[1], c[0], c[1], w);
    lineMark(marks, c[0], c[1], d[0], d[1], w);
    lineMark(marks, d[0], d[1], a[0], a[1], w);
  };
  rect(-hl, -hw, hl, hw);
  const m0 = map(-hl, 0), m1 = map(hl, 0);
  lineMark(marks, m0[0], m0[1], m1[0], m1[1], w);
  for (const s of [1, -1]) {
    const f0 = map(s * 4.72, -hw), f1 = map(s * 4.72, hw);
    lineMark(marks, f0[0], f0[1], f1[0], f1[1], w);
  }
  const nw = longEW ? 0.04 : 6.5;
  const nd = longEW ? 6.5 : 0.04;
  boxAt(buckets, "net", nw, 1.45, nd, cx, 0.74, -cy);
}

// ---- 排球场 ----

function volleyballCourt(marks: THREE.BufferGeometry[], buckets: Record<string, THREE.BufferGeometry[]>,
  cx: number, cy: number, longEW: boolean): void {
  const map = (u: number, v: number): Pt => (longEW ? [cx + u, cy + v] : [cx + v, cy + u]);
  const w = 0.07;
  const hl = 9, hw = 4.5;
  const rect = (u0: number, v0: number, u1: number, v1: number): void => {
    const a = map(u0, v0), b = map(u1, v0), c = map(u1, v1), d = map(u0, v1);
    lineMark(marks, a[0], a[1], b[0], b[1], w);
    lineMark(marks, b[0], b[1], c[0], c[1], w);
    lineMark(marks, c[0], c[1], d[0], d[1], w);
    lineMark(marks, d[0], d[1], a[0], a[1], w);
  };
  rect(-hl, -hw, hl, hw);
  for (const s of [1, -1]) {
    const a0 = map(s * 3, -hw), a1 = map(s * 3, hw);
    lineMark(marks, a0[0], a0[1], a1[0], a1[1], w);
  }
  const nw = longEW ? 0.05 : 9.5;
  const nd = longEW ? 9.5 : 0.05;
  boxAt(buckets, "net", nw, 1.15, nd, cx, 0.62, -cy);
}

// ---- 田径跑道（胶囊环带 8 道 + apron + 9 白分道环线 + 内场 20 条纹 + 足球标线）----

function stadiumPath(cx: number, cy: number, halfStraight: number, R: number): Pt[] {
  const pts: Pt[] = [];
  const seg = 32;
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
  const lanes = 8;
  const innerR = R - lanes * laneW; // 内沿半径
  // apron 外圈红铺装
  const outerEdge = stadiumPath(cx, cy, halfStraight, R + 1.5);
  bandFromClosedPath(buckets["apron"], outerEdge, 1.5, Y_COURT);
  // 8 道环带（相邻交替 track/trackAlt）
  for (let lane = 0; lane < lanes; lane++) {
    const rMid = innerR + lane * laneW + laneW / 2;
    bandFromClosedPath(buckets[lane % 2 === 0 ? "trackA" : "trackB"],
      stadiumPath(cx, cy, halfStraight, rMid), laneW, Y_COURT);
  }
  // 内场填充（胶囊 Shape）
  const innerPath = stadiumPath(cx, cy, halfStraight, innerR);
  const innerShape = new THREE.Shape(innerPath.map(([x, y]) => new THREE.Vector2(x, y)));
  const infieldGeo = new THREE.ShapeGeometry(innerShape);
  infieldGeo.rotateX(-Math.PI / 2);
  infieldGeo.translate(0, Y_COURT, 0);
  buckets["infield"].push(infieldGeo);
  // 条纹：内场已整体填 fieldGreen，只画 fieldStripe 隔条（10 条），避免与 ShapeGeometry 混入同一合并桶
  const fieldL = 2 * halfStraight;
  const fieldW = 2 * innerR;
  const stripeW = fieldL / 20;
  for (let i = 0; i < 20; i += 2) {
    const y0 = cy - fieldL / 2 + i * stripeW;
    const stripGeo = polygonGeo(
      [[cx - fieldW / 2, y0], [cx + fieldW / 2, y0], [cx + fieldW / 2, y0 + stripeW], [cx - fieldW / 2, y0 + stripeW]],
      Y_COURT + 0.008,
    );
    buckets["stripe"].push(stripGeo);
  }
  // 9 条白色分道环线（内沿、8 条道间、外沿）
  for (let k = 0; k <= lanes; k++) {
    const r = innerR + k * laneW;
    closedLineStrip(marks, stadiumPath(cx, cy, halfStraight, r), 0.07, Y_MARK);
  }
  // 终点线（直道）
  const fin0 = [cx + R, cy - halfStraight + 9];
  const fin1 = [cx + innerR, cy - halfStraight + 9];
  lineMark(marks, fin0[0], fin0[1], fin1[0], fin1[1], 0.07);
  // 内场足球标线
  const fL = Math.max(Math.min(2 * innerR - 8, 76), 40);
  const fW = Math.max(Math.min(2 * halfStraight - 8, 54), 30);
  soccerField(marks, buckets, cx, cy, true, fL, fW, false);
}

// ---- 主入口 ----

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
      const R = Math.min(44, bw / 2 - 10.2);
      const hs = Math.max(bh / 2 - (R + 9.76), 20);
      athleticsTrack(marks, buckets, cx, cy, hs, R);
      continue;
    }
    if (a.kind !== "pitch" && a.kind !== "pool") continue;

    if (a.kind === "pool") {
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
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
    if (!merged) {
      // 属性不一致合并失败：跳过该桶，绝不让 null mesh 进入场景导致全局崩溃
      console.warn("[sports] mergeGeometries failed, skip bucket");
      return;
    }
    const mat = new THREE.MeshLambertMaterial({
      color,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
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
