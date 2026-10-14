import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneData, Building, Gate } from "./types";
import {
  bboxCenter,
  buildBoundaryLine,
  buildBuildings,
  buildContextBuildings,
  buildGreen,
  buildGround,
  buildPaving,
  buildRoads,
  buildWater,
} from "./sceneBuilder";
import { buildTrees } from "./trees";
import { cancelFly, flyTo } from "./flyTo";
import { LabelLayer } from "./labels";
import {
  BuildingPicker,
  fillInfoCard,
  hideInfoCard,
  type InfoCardEls,
  type BuildingUserData,
} from "./interact";
import { initSearch, type SearchItem } from "./search";
import { collectPlaces, initPlacesPanel, type PlacesPanel } from "./placesPanel";
import { DayNight, type PresetName } from "./dayNight";
import { buildActivity, buildGate, buildLibrary, gateLabel } from "./landmarks";
import { Navigator } from "./navigation";
import { facadeTexture, roofMaterial } from "./facades";

const gltfLoader = new GLTFLoader();
const GLB_LANDMARKS = new Set(["library", "info", "gym", "gongke", "activity"]);
const GLB_GATES: Record<string, string> = { 北门: "gate_north", 东门: "gate_east", 南门: "gate_south" };

function bboxCenterOfBuilding(b: Building): [number, number] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of b.polygon) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** GLB 地标加载；失败返回 null 由调用方回落 */
function loadLandmarkGLB(asset: string, b: Building): Promise<THREE.Group | null> {
  return new Promise((resolve) => {
    if (!GLB_LANDMARKS.has(asset)) return resolve(null);
    gltfLoader.load(
      "models/" + asset + ".glb",
      (gltf) => {
        const g = gltf.scene;
        const [cx, cy] = bboxCenterOfBuilding(b);
        g.position.set(cx, 0, -cy);
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const d = mesh.userData;
            d.id = b.id; d.name = b.name; d.type = b.type;
            d.style = "library"; d.height = b.height; d.heightSource = b.heightSource;
            d.area = b.area; d.cx = cx; d.cy = -cy;
          }
        });
        resolve(g);
      },
      undefined,
      () => resolve(null),
    );
  });
}

function loadGateGLB(asset: string, gate: Gate): Promise<THREE.Group | null> {
  return new Promise((resolve) => {
    gltfLoader.load(
      "models/" + asset + ".glb",
      (gltf) => {
        const g = gltf.scene;
        g.position.set(gate.x, 0, -gate.y);
        const a = (gate.angle * Math.PI) / 180;
        g.rotation.y = a + Math.PI / 2;
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.castShadow = true;
        });
        resolve(g);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** 无 GLB 时的地标兜底：素色拉伸体 */
function fallbackLandmark(b: Building): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape(b.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of b.holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(b.height, 6), bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const tex = facadeTexture("teaching", 0).clone();
  tex.needsUpdate = true;
  tex.repeat.set(1, Math.max(1, Math.round(b.height / 3.3)));
  const mesh = new THREE.Mesh(geo, [roofMaterial, new THREE.MeshLambertMaterial({ map: tex })]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const [cx, cy] = bboxCenterOfBuilding(b);
  mesh.userData = { id: b.id, name: b.name, type: b.type, style: b.style,
    height: b.height, heightSource: b.heightSource, area: b.area, cx, cy: -cy };
  g.add(mesh);
  return g;
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const statsEl = document.querySelector<HTMLDivElement>("#hud-stats")!;
const navStatusEl = document.querySelector<HTMLDivElement>("#nav-status")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 9000);
camera.position.set(650, 620, 1050);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 40;
controls.maxDistance = 3200;

const hemi = new THREE.HemisphereLight(0xcfe5ff, 0xb8b09a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
sun.position.set(600, 900, 350);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1700;
sun.shadow.camera.right = 1700;
sun.shadow.camera.top = 1700;
sun.shadow.camera.bottom = -1700;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 4500;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 1.5;
scene.add(sun);
scene.add(sun.target);

const labels = new LabelLayer(app);
scene.add(labels.root);

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labels.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

const els: InfoCardEls = {
  root: document.querySelector("#info-card")!,
  title: document.querySelector("#ic-title")!,
  type: document.querySelector("#ic-type")!,
  height: document.querySelector("#ic-height")!,
  area: document.querySelector("#ic-area")!,
  src: document.querySelector("#ic-src")!,
};
let flyTargetBuilding: THREE.Mesh | null = null;
function focusBuilding(mesh: THREE.Mesh | null): void {
  if (!mesh) return;
  const d = mesh.userData as BuildingUserData;
  flyTo(camera, controls, new THREE.Vector3(d.cx, d.height / 2, d.cy), Math.max(150, Math.sqrt(d.area) * 3.4));
}
document.querySelector("#ic-close")!.addEventListener("click", () => picker?.clearSelection());
document.querySelector("#ic-fly")!.addEventListener("click", () => focusBuilding(flyTargetBuilding));

let dayNight: DayNight | null = null;
let picker: BuildingPicker | null = null;
let navigator: Navigator | null = null;
let navMode = false;

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let downAt: [number, number] | null = null;

renderer.domElement.addEventListener("pointerdown", (e) => {
  downAt = [e.clientX, e.clientY];
  cancelFly();
});
renderer.domElement.addEventListener("pointerup", (e) => {
  const d = downAt;
  downAt = null;
  if (!d || !navMode || !navigator) return;
  if (e.pointerType === "touch" && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 10) return;
  if (e.pointerType !== "touch" && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return;
  raycaster.setFromCamera(
    new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1),
    camera,
  );
  const pt = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, pt)) {
    navigator.clickGround(pt.x, pt.z);
  }
});

async function loadScene(): Promise<void> {
  const res = await fetch("data/scene.json");
  if (!res.ok) throw new Error("scene.json 加载失败 (HTTP " + res.status + ")");
  const data: SceneData = await res.json();

  buildGround(scene);
  buildGreen(scene, data.green);
  buildPaving(scene, data.paving);
  buildWater(scene, data.water);
  buildRoads(scene, data.roads);

  const inside = data.buildings.filter((b) => b.inside);
  const outside = data.buildings.filter((b) => !b.inside);
  buildContextBuildings(scene, outside);
  if (data.boundary) buildBoundaryLine(scene, data.boundary);

  const generic = inside.filter((b) => !b.landmark);
  const buildings = buildBuildings(scene, generic);
  // 地标：优先 Blender GLB（失败回落参数化/素色体）
  const landmarkDefs = inside.filter((b) => b.landmark);
  const landmarkGroups = await Promise.all(landmarkDefs.map(async (b) => {
    const glb = await loadLandmarkGLB(b.landmark, b);
    if (glb) return glb;
    if (b.landmark === "library") return buildLibrary(b);
    if (b.landmark === "activity") return buildActivity(b);
    return fallbackLandmark(b);
  }));
  for (const g of landmarkGroups) buildings.add(g);
  const treeCount = buildTrees(scene, data.green, data.roads, data.water);

  for (const g of data.gates) {
    const asset = GLB_GATES[g.name];
    const glb = asset ? await loadGateGLB(asset, g) : null;
    scene.add(glb ?? buildGate(g));
    const lb = gateLabel(g);
    labels.add(lb.text, lb.pos, 3000, { cls: "gate" });
  }

  dayNight = new DayNight(scene, hemi, sun, buildings);
  dayNight.apply("day");

  navigator = new Navigator(scene, data.graph);
  navigator.onStatus = (t) => {
    navStatusEl.textContent = t || (navMode ? "点击道路或地面设置起点" : "");
  };

  picker = new BuildingPicker(renderer.domElement, camera, buildings, {
    onSelect: (mesh) => {
      if (navMode && navigator) {
        const d = mesh.userData as BuildingUserData;
        navigator.setEndBuilding(d.cx, d.cy);
        return;
      }
      flyTargetBuilding = mesh;
      fillInfoCard(mesh, els);
    },
    onClear: () => {
      flyTargetBuilding = null;
      hideInfoCard(els);
    },
  });

  // 地点收集：有名字的楼（同名取第一个 mesh）+ 湖 + 校门，搜索与列表共用
  const byName = new Map<string, THREE.Mesh>();
  for (const mesh of buildings.children as THREE.Mesh[]) {
    const d = mesh.userData as BuildingUserData;
    if (!d.name || d.name.includes("门")) continue;
    if (!byName.has(d.name)) byName.set(d.name, mesh);
  }
  const places = collectPlaces(data, byName);
  let panel: PlacesPanel | null = null;
  const selectPlace = (it: SearchItem): void => {
    if (navMode && navigator) {
      navigator.setEndBuilding(it.target.x, it.target.z);
      flyTo(camera, controls, it.target, it.distance);
      return;
    }
    if (it.mesh) {
      picker!.select(it.mesh);
      focusBuilding(it.mesh);
    } else {
      picker!.clearSelection();
      flyTo(camera, controls, it.target, it.distance);
    }
    panel?.setActive(it.name);
  };
  panel = initPlacesPanel(document.querySelector("#places")!, places, selectPlace);
  initSearch(
    document.querySelector<HTMLInputElement>("#search")!,
    document.querySelector<HTMLElement>("#suggestions")!,
    places,
    selectPlace,
  );

  // 标注：楼名（楼顶）+ 湖名
  for (const [name, mesh] of byName) {
    const d = mesh.userData as BuildingUserData;
    const pos = new THREE.Vector3(d.cx, d.height + 12, d.cy);
    labels.add(name, pos, 1250, { onClick: () => { picker!.select(mesh); focusBuilding(mesh); } });
  }
  for (const w of data.water) {
    if (!w.name) continue;
    const [cx, cy] = bboxCenter(w.outers[0]);
    labels.add(w.name, new THREE.Vector3(cx, 2, -cy), 2000, {
      cls: "water",
      onClick: () => {
        flyTo(camera, controls, new THREE.Vector3(cx, 0, -cy), 400);
      },
    });
  }

  statsEl.textContent =
    `楼栋 ${data.buildings.length} · 树木 ${treeCount}（示意） · ` +
    `数据 © OpenStreetMap 贡献者`;
  document.querySelector("#hud-count")!.textContent = `地点 ${places.length} 处`;
}

loadScene().catch((e: unknown) => {
  statsEl.textContent = "加载出错：" + (e instanceof Error ? e.message : String(e));
  statsEl.classList.add("err");
});

// ---- 工具栏 ----
document.querySelector<HTMLButtonElement>("#hud-fold")!.addEventListener("click", () => {
  document.querySelector("#hud")!.classList.toggle("collapsed");
});

document.querySelector<HTMLButtonElement>("#tb-labels")!.addEventListener("click", (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  labels.enabled = !labels.enabled;
  btn.classList.toggle("on", labels.enabled);
});

const navBtn = document.querySelector<HTMLButtonElement>("#tb-nav")!;
function setNavMode(v: boolean): void {
  navMode = v;
  navBtn.classList.toggle("on", v);
  document.querySelector("#nav-panel")!.classList.toggle("open", v);
  navigator?.setActive(v);
  if (v) picker?.clearSelection();
  navBtn.blur();
}
navBtn.addEventListener("click", () => setNavMode(!navMode));
document.querySelector("#nav-clear")!.addEventListener("click", () => navigator?.clearRoute());
document.querySelector("#nav-exit")!.addEventListener("click", () => setNavMode(false));

for (const name of ["day", "dusk", "night"] as PresetName[]) {
  document.querySelector<HTMLButtonElement>(`#preset-${name}`)!.addEventListener("click", (e) => {
    picker?.clearSelection();
    dayNight?.apply(name);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#toolbar .seg .tb")) {
      b.classList.toggle("on", b.id === `preset-${name}`);
    }
    (e.currentTarget as HTMLButtonElement).blur();
  });
}

let lastFrame = 0;
renderer.setAnimationLoop((t) => {
  if (t - lastFrame < 15) return; // 帧率上限 ~60fps，240fps 空转浪费 GPU
  lastFrame = t;
  controls.update();
  labels.update(camera);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

Object.assign(window, { __huxi: { renderer, scene, camera, controls } });
