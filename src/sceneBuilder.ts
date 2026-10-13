import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Area, Building, Road } from "./types";

/** 场景坐标系约定：scene.json 的 X(东)/Y(北) 映射到 three.js 世界
 *  x = 东, z = -北（即 -z 朝北）, y 向上。 */

export const COLORS = {
  ground: 0xe9e6de,
  building: 0xf5f2ec,
  water: 0x8fc3dd,
  park: 0xb5d19c,
  grass: 0xc2dba6,
  forest: 0x9cc287,
  pitch: 0xa7cd8f,
  roadMajor: 0xbfbfbf,
  roadMinor: 0xd2ccb9,
};

const GREEN_COLORS: Record<string, number> = {
  park: COLORS.park,
  grass: COLORS.grass,
  forest: COLORS.forest,
  pitch: COLORS.pitch,
};

const MAJOR_ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

/** 稳定伪随机（同一楼栋每次加载颜色一致）；id 可能是 "123-2" 这类字符串 */
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

function shapeFromRings(outer: [number, number][], holes: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  return shape;
}

export function buildGround(scene: THREE.Scene): void {
  const geo = new THREE.PlaneGeometry(4000, 4000);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      color: COLORS.ground,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  );
  mesh.position.y = -0.2;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildAreas(scene: THREE.Scene, areas: Area[], colorOf: (a: Area) => number, y: number): void {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  for (const a of areas) {
    for (const outer of a.outers) {
      const shape = shapeFromRings(outer, a.inners);
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat.clone());
      (mesh.material as THREE.MeshLambertMaterial).color.setHex(colorOf(a));
      mesh.position.y = y;
      scene.add(mesh);
    }
  }
}

export function buildWater(scene: THREE.Scene, water: Area[]): void {
  buildAreas(scene, water, () => COLORS.water, 0.05);
}

export function buildGreen(scene: THREE.Scene, green: Area[]): void {
  buildAreas(scene, green, (a) => GREEN_COLORS[a.kind ?? "park"] ?? COLORS.park, 0.02);
}

/** bbox 中心（局部坐标）——用作楼栋锚点 */
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

export function buildBuildings(scene: THREE.Scene, buildings: Building[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "buildings";
  for (const b of buildings) {
    const shape = shapeFromRings(b.polygon, b.holes);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(b.height, 2),
      bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.building });
    // 同色系微差异，避免整片死白
    mat.color.offsetHSL(0, (hash01(b.id) - 0.5) * 0.02, (hash01(String(b.id) + "7") - 0.5) * 0.045);
    const mesh = new THREE.Mesh(geo, mat);
    const [cx, cy] = bboxCenter(b.polygon);
    mesh.userData = {
      id: b.id,
      name: b.name,
      type: b.type,
      height: b.height,
      heightSource: b.heightSource,
      area: b.area,
      cx,
      cy: -cy,
    };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);
  return group;
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
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // 法线朝上（+Y），否则被背面剔除
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 全部道路按主/次合并成 2 个网格，把几百个 draw call 压到 2 个 */
export function buildRoads(scene: THREE.Scene, roads: Road[]): void {
  const majorGeos: THREE.BufferGeometry[] = [];
  const minorGeos: THREE.BufferGeometry[] = [];
  roads.forEach((r, idx) => {
    if (r.pts.length < 2) return;
    const geo = ribbonGeometry(r.pts, r.width);
    geo.translate(0, 0.03 + (idx % 7) * 0.004, 0);
    (MAJOR_ROADS.has(r.kind) ? majorGeos : minorGeos).push(geo);
  });
  const majorMat = new THREE.MeshLambertMaterial({ color: COLORS.roadMajor });
  const minorMat = new THREE.MeshLambertMaterial({ color: COLORS.roadMinor });
  if (majorGeos.length) scene.add(new THREE.Mesh(mergeGeometries(majorGeos)!, majorMat));
  if (minorGeos.length) scene.add(new THREE.Mesh(mergeGeometries(minorGeos)!, minorMat));
}
