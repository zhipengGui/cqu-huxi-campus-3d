import * as THREE from "three";
import type { Area, Building, SceneData } from "./types";

/** 场景坐标系约定：scene.json 的 X(东)/Y(北) 映射到 three.js 世界
 *  x = 东, z = -北（即 -z 朝北）, y 向上。 */

const COLORS = {
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

/** scene 二维坐标 (东, 北) → Shape 顶点。Shape 在 XY 平面，之后 rotateX(-PI/2)
 *  把形状面朝上并保持 x=东、世界 z=-北。 */
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
    new THREE.MeshLambertMaterial({ color: COLORS.ground, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
  );
  mesh.position.y = -0.2;
  scene.add(mesh);
}

export function buildAreas(scene: THREE.Scene, areas: Area[], colorOf: (a: Area) => number, y: number): void {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
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

export function buildBuildings(scene: THREE.Scene, buildings: Building[]): void {
  const mat = new THREE.MeshLambertMaterial({ color: COLORS.building });
  for (const b of buildings) {
    const shape = shapeFromRings(b.polygon, b.holes);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(b.height, 2),
      bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { id: b.id, name: b.name, height: b.height };
    scene.add(mesh);
  }
}

/** 折线 → 带斜接(Miter)接头的扁平条带，避免路口处出现缺口。 */
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
      // 限制斜接长度，避免锐角处出现长刺
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

export function buildRoads(scene: THREE.Scene, roads: SceneData["roads"]): void {
  const majorMat = new THREE.MeshLambertMaterial({ color: COLORS.roadMajor });
  const minorMat = new THREE.MeshLambertMaterial({ color: COLORS.roadMinor });
  roads.forEach((r, idx) => {
    if (r.pts.length < 2) return;
    const geo = ribbonGeometry(r.pts, r.width);
    const mesh = new THREE.Mesh(geo, MAJOR_ROADS.has(r.kind) ? majorMat : minorMat);
    mesh.position.y = 0.03 + (idx % 7) * 0.004; // 微小错位，防止共面闪烁
    scene.add(mesh);
  });
}
