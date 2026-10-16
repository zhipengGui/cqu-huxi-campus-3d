import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Area, Building, Road, SceneData } from "./types";
import { detailedSport } from './sports';
import {
  facadeTexture,
  idHash01,
  offsetPolygon,
  parapetMaterial,
  rewriteFacadeUV,
  roofMaterial,
  roofUnitMaterial,
  styleVariant,
  type FacadeStyle,
} from "./facades";

/** 场景坐标系约定：scene.json 的 X(东)/Y(北) 映射到 three.js 世界
 *  x = 东, z = -北（即 -z 朝北）, y 向上。 */

export const COLORS = {
  ground: 0xb7c6a2, // 草地基调（对齐 gxu 观感）
  building: 0xf5f2ec,
  water: 0x4f8b94,
  shore: 0xd8cdb0,
  paving: 0xc8c4b5,
  park: 0xa4bc88,
  grass: 0xb2c697,
  forest: 0x88ad79,
  roadAsphalt: 0x59655f,
  roadPath: 0xcbbfa5,
  sidewalk: 0xd4d2c4,
  roadMark: 0xe6e8e6,
};

const GREEN_COLORS: Record<string, number> = {
  park: COLORS.park,
  grass: COLORS.grass,
  forest: COLORS.forest,
  pitch: 0xa8bf92,
  track: 0xc9735c,
  pool: 0x74b9d8,
};

const SPORT_COLORS: Record<string, number> = {
  soccer: 0x8fbf7a,
  basketball: 0xa4b496,
  tennis: 0x86a8b0,
  badminton: 0xb3c2a0,
  volleyball: 0xb3c2a0,
  running: 0xc9735c,
  multisport: 0xa4b496,
};

const ROAD_CLASS: Record<string, "major" | "campus" | "path"> = {
  motorway: "major", trunk: "major",
  primary: "major", secondary: "major", tertiary: "major",
  primary_link: "major", secondary_link: "major", tertiary_link: "major",
  service: "campus", residential: "campus", unclassified: "campus",
  living_street: "campus", pedestrian: "campus", road: "campus",
  footway: "path", path: "path", track: "path", cycleway: "path",
};

function hash01(id: number | string): number {
  return idHash01(id);
}

function ensureCCW(pts: [number, number][]): [number, number][] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a >= 0 ? pts : [...pts].reverse();
}

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shapeFromRings(outer: [number, number][], holes: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  return shape;
}

export function buildGround(scene: THREE.Scene): void {
  const geo = new THREE.PlaneGeometry(20000, 20000);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      color: 0xd6d8c8,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  );
  mesh.position.y = -0.2;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function flatAreaMeshes(geos: THREE.BufferGeometry[], color: number, y: number, parent: THREE.Object3D): void {
  if (!geos.length) return;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshLambertMaterial({
      color,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  mesh.position.y = y;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

export function buildGreen(greenGroup: THREE.Object3D, sportsGroup: THREE.Object3D, green: Area[]): void {
  const buckets = new Map<string, { parent: THREE.Object3D; color: number; geos: THREE.BufferGeometry[] }>();
  for (const a of green) {
    if (detailedSport(a)) continue;
    const isSport = a.kind === "pitch" || a.kind === "track" || a.kind === "pool";
    const parent = isSport ? sportsGroup : greenGroup;
    const color = isSport && a.sport && SPORT_COLORS[a.sport] ? SPORT_COLORS[a.sport]
      : a.kind === "track" ? 0xc9735c
      : a.kind === "pool" ? 0x74b9d8
      : GREEN_COLORS[a.kind ?? "park"] ?? COLORS.park;
    const key = (isSport ? "s" : "g") + color;
    if (!buckets.has(key)) buckets.set(key, { parent, color, geos: [] });
    for (const outer of a.outers) {
      const geo = new THREE.ShapeGeometry(shapeFromRings(outer, a.inners));
      geo.rotateX(-Math.PI / 2);
      buckets.get(key)!.geos.push(geo);
    }
  }
  for (const { parent, color, geos } of buckets.values()) {
    flatAreaMeshes(geos, color, 0.02, parent);
  }
}

export function buildPaving(parent: THREE.Object3D, paving: Area[]): void {
  const geos: THREE.BufferGeometry[] = [];
  for (const a of paving) {
    for (const outer of a.outers) {
      const geo = new THREE.ShapeGeometry(shapeFromRings(outer, a.inners));
      geo.rotateX(-Math.PI / 2);
      geos.push(geo);
    }
  }
  flatAreaMeshes(geos, COLORS.paving, 0.015, parent);
}

/** 程序化水面波纹法线贴图（两方向正弦叠加的高度场 → Sobel 梯度法线） */
function rippleNormalTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d")!;
  const img = g.createImageData(s, s);
  const height = (u: number, v: number): number =>
    Math.sin(u * Math.PI * 6 + Math.sin(v * Math.PI * 4) * 1.6) * 0.6 +
    Math.sin(v * Math.PI * 8 + Math.sin(u * Math.PI * 5) * 1.2) * 0.4;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s;
      const v = y / s;
      const e = 1 / s;
      const dx = height(u + e, v) - height(u - e, v);
      const dy = height(u, v + e) - height(u, v - e);
      const nx = -dx * 1.4;
      const ny = -dy * 1.4;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * s + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 水面材质（导出供渲染循环做波纹流动动画） */
export const waterMaterial: THREE.MeshStandardMaterial = (() => {
  const normalMap = rippleNormalTexture();
  normalMap.repeat.set(1 / 26, 1 / 26); // ShapeGeometry uv 单位 = 米，约 26m 重复一波纹块
  const m = new THREE.MeshStandardMaterial({
    color: COLORS.water,
    roughness: 0.48,
    metalness: 0.12,
    normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });
  m.name = "waterMat";
  return m;
})();

/** 湖面：Standard 反光材质 + 波纹法线贴图；湖岸升级为砌石岸壁 + 压顶石 */
export function buildWater(parent: THREE.Object3D, water: Area[]): void {
  const waterGeos: THREE.BufferGeometry[] = [];
  const wallGeos: THREE.BufferGeometry[] = [];
  const curbGeos: THREE.BufferGeometry[] = [];
  for (const a of water) {
    for (const outer of a.outers) {
      const geo = new THREE.ShapeGeometry(shapeFromRings(outer, a.inners));
      geo.rotateX(-Math.PI / 2);
      waterGeos.push(geo);
      // 砌石岸壁：外扩 0.9m 环带垂直挤出 0.55m（石色）
      const ccwRing = ensureCCW(outer);
      const outerRing = offsetPolygon(ccwRing, 0.9);
      const wall = new THREE.Shape(outerRing.map(([x, y]) => new THREE.Vector2(x, y)));
      wall.holes.push(new THREE.Path(ccwRing.map(([x, y]) => new THREE.Vector2(x, y))));
      const wg = new THREE.ExtrudeGeometry(wall, { depth: 0.55, bevelEnabled: false });
      wg.rotateX(-Math.PI / 2);
      wallGeos.push(wg);
      // 压顶石：外扩 0.9→1.5m 的环带平面（浅石色）
      const curbRing = offsetPolygon(ccwRing, 1.5);
      const curb = new THREE.Shape(curbRing.map(([x, y]) => new THREE.Vector2(x, y)));
      curb.holes.push(new THREE.Path(outerRing.map(([x, y]) => new THREE.Vector2(x, y))));
      const cg = new THREE.ShapeGeometry(curb);
      cg.rotateX(-Math.PI / 2);
      curbGeos.push(cg);
    }
  }
  const stone = new THREE.MeshStandardMaterial({ color: 0xb0aca2, roughness: 0.9 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xc6c2b6, roughness: 0.92 });
  if (wallGeos.length) {
    const merged = wallGeos.length === 1 ? wallGeos[0] : mergeGeometries(wallGeos)!;
    const mesh = new THREE.Mesh(merged, stone);
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
  if (curbGeos.length) {
    const merged = curbGeos.length === 1 ? curbGeos[0] : mergeGeometries(curbGeos)!;
    const mesh = new THREE.Mesh(merged, curbMat);
    mesh.position.y = 0.56;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
  if (waterGeos.length) {
    const merged = waterGeos.length === 1 ? waterGeos[0] : mergeGeometries(waterGeos)!;
    const mesh = new THREE.Mesh(merged, waterMaterial);
    mesh.name = "water";
    mesh.position.y = 0.05;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

export function bboxCenter(pts: [number, number][]): [number, number] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** 校区边界白线（返回线条对象，由调用方挂载并控制显隐） */
export function buildBoundaryLine(boundary: { pts: [number, number][] }): THREE.LineLoop {
  const pts = boundary.pts.map(([x, y]) => new THREE.Vector3(x, 0.12, -y));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
  }));
  line.renderOrder = 4;
  return line;
}

/** 楼栋：立面纹理 + 女儿墙 + 屋顶设备块。landmark 楼由调用方过滤后另行构建。 */
export function buildBuildings(scene: THREE.Scene, buildings: Building[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "buildings";
  const parapetGeos: THREE.BufferGeometry[] = [];
  const unitGeos: THREE.BufferGeometry[] = [];

  for (const b of buildings) {
    const shape = shapeFromRings(b.polygon, b.holes);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(b.height, 2),
      bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    const floors = Math.max(1, Math.round(b.height / 3.3));
    rewriteFacadeUV(geo, b.polygon, floors);

    const style = (b.style ?? "office") as FacadeStyle;
    const variant = styleVariant(style, b.id);
    const tex = facadeTexture(style, variant).clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, floors); // v 已按楼层归一，纵向重复 = 层数
    const wallMat = new THREE.MeshLambertMaterial({ map: tex });
    wallMat.color.setScalar(0.93 + hash01(b.id) * 0.09);

    // ExtrudeGeometry 分组：material 0 = 顶底面，1 = 侧面
    const mesh = new THREE.Mesh(geo, [roofMaterial, wallMat]);
    const [cx, cy] = bboxCenter(b.polygon);
    mesh.userData = {
      id: b.id,
      name: b.name,
      type: b.type,
      style,
      height: b.height,
      heightSource: b.heightSource,
      area: b.area,
      cx,
      cy: -cy,
    };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    if (b.area >= 80) {
      const pg = parapetGeometry(b.polygon, b.height);
      if (pg) parapetGeos.push(pg);
    }
    if (b.area >= 1200) {
      const n = Math.max(1, Math.min(6, Math.floor(b.area / 900)));
      addRoofUnits(unitGeos, b, n);
    }
  }
  scene.add(group);

  if (parapetGeos.length) {
    const merged = mergeGeometries(parapetGeos)!;
    const m = new THREE.Mesh(merged, parapetMaterial);
    scene.add(m);
  }
  if (unitGeos.length) {
    const merged = mergeGeometries(unitGeos)!;
    const m = new THREE.Mesh(merged, roofUnitMaterial);
    m.castShadow = true;
    scene.add(m);
  }
  return group;
}

function parapetGeometry(poly: [number, number][], height: number): THREE.BufferGeometry | null {
  const ccw = ensureCCW(poly);
  const inner = offsetPolygon(ccw, -0.55);
  const shape = new THREE.Shape(ccw.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, height, 0);
  return geo;
}

function addRoofUnits(geos: THREE.BufferGeometry[], b: Building, n: number): void {
  const [cx, cy] = bboxCenter(b.polygon);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of b.polygon) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const span = Math.min(x1 - x0, y1 - y0);
  for (let i = 0; i < n; i++) {
    const h1 = idHash01(`${b.id}u${i}`);
    const h2 = idHash01(`${b.id}w${i}`);
    const px = cx + (h1 - 0.5) * span * 0.6;
    const py = cy + (h2 - 0.5) * span * 0.6;
    if (!pointInPoly(px, py, b.polygon)) continue;
    const sx = 1.8 + idHash01(`${b.id}s${i}`) * 2.2;
    const sy = 1.2 + idHash01(`${b.id}t${i}`) * 1.4;
    const g = new THREE.BoxGeometry(sx, sy, sx);
    g.translate(px, b.height + sy / 2, -py);
    geos.push(g);
  }
}

/** 折线 → 带斜接(Miter)接头的扁平条带 */
function ribbonGeometry(pts: [number, number][], width: number): THREE.BufferGeometry {
  const half = width / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    normals.push([dy / len, -dx / len]);
  }
  const pushVertex = (x: number, y: number) => positions.push(x, 0, -y);
  for (let i = 0; i < pts.length; i++) {
    let nx: number, ny: number;
    if (i === 0) {
      [nx, ny] = normals[0];
    } else if (i === normals.length) {
      [nx, ny] = normals[normals.length - 1];
    } else {
      const [a1x, a1y] = normals[i - 1];
      const [a2x, a2y] = normals[i];
      let mx = a1x + a2x;
      let my = a1y + a2y;
      const mlen = Math.hypot(mx, my) || 1;
      mx /= mlen;
      my /= mlen;
      const cosHalf = Math.max(0.4, mx * a2x + my * a2y);
      const scale = Math.min(1 / cosHalf, 2.5);
      nx = mx * scale;
      ny = my * scale;
    }
    pushVertex(pts[i][0] + nx * half, pts[i][1] + ny * half);
    pushVertex(pts[i][0] - nx * half, pts[i][1] - ny * half);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // 法线朝上（+Y）
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 沿折线的中央虚线（短四边形合批） */
function dashGeometry(pts: [number, number][], dashLen: number, gapLen: number, width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let arc = 0;
  let nextAt = dashLen; // 先留一段空
  const cycle = dashLen + gapLen;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    if (!segLen) continue;
    const dx = (x2 - x1) / segLen;
    const dy = (y2 - y1) / segLen;
    let t = 0;
    while (t < segLen) {
      if (arc + (segLen - t) < nextAt + dashLen && arc + t < nextAt + dashLen && arc + t >= nextAt) {
        const d0 = Math.min(dashLen, segLen - t);
        const ax = x1 + dx * t;
        const ay = y1 + dy * t;
        const bx = x1 + dx * (t + d0);
        const by = y1 + dy * (t + d0);
        const nx = -dy * width * 0.5;
        const ny = dx * width * 0.5;
        const base = positions.length / 3;
        positions.push(ax + nx, 0, -(ay + ny), ax - nx, 0, -(ay - ny), bx + nx, 0, -(by + ny), bx - nx, 0, -(by - ny));
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        t += d0;
        nextAt += cycle;
      } else {
        const jump = Math.min(segLen - t, Math.max(0.01, nextAt - arc - t));
        t += jump;
        if (arc + t >= nextAt + dashLen) nextAt += cycle;
      }
    }
    arc += segLen;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 道路分级渲染：沥青主路面 + 人行道衬带 + 主要道路中央虚线，全部合批 */
export function buildRoads(parent: THREE.Object3D, roads: Road[]): void {
  const sidewalkGeos: THREE.BufferGeometry[] = [];
  const asphaltGeos: THREE.BufferGeometry[] = [];
  const pathGeos: THREE.BufferGeometry[] = [];
  const dashGeos: THREE.BufferGeometry[] = [];

  roads.forEach((r, idx) => {
    if (r.pts.length < 2) return;
    const cls = ROAD_CLASS[r.kind] ?? "path";
    if (cls === "path") {
      const g = ribbonGeometry(r.pts, r.width);
      g.translate(0, 0.03 + (idx % 5) * 0.003, 0);
      pathGeos.push(g);
      return;
    }
    const sw = ribbonGeometry(r.pts, r.width + 3);
    sw.translate(0, 0.02, 0);
    sidewalkGeos.push(sw);
    const g = ribbonGeometry(r.pts, r.width);
    g.translate(0, 0.06 + (idx % 5) * 0.004, 0);
    asphaltGeos.push(g);
    if (cls === "major" || (cls === "campus" && r.width >= 5)) {
      const d = dashGeometry(r.pts, 3, 5, 0.35);
      d.translate(0, 0.14, 0); // 与沥青拉开 8cm，防拉高后深度冲突闪动
      const idx = d.getIndex();
      if (idx && idx.count > 0) dashGeos.push(d);
    }
  });

  const batch = (geos: THREE.BufferGeometry[], color: number, yOff: number): void => {
    if (!geos.length) return;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color }));
    mesh.position.y = yOff;
    mesh.receiveShadow = true;
    parent.add(mesh);
  };
  batch(sidewalkGeos, COLORS.sidewalk, 0);
  batch(asphaltGeos, COLORS.roadAsphalt, 0);
  batch(pathGeos, COLORS.roadPath, 0);
  if (dashGeos.length) {
    const merged = dashGeos.length === 1 ? dashGeos[0] : mergeGeometries(dashGeos)!;
    parent.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: COLORS.roadMark })));
  }
}

export type { SceneData };
