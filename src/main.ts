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
import { cancelFly, flyTo } from "./flyTo";import { LabelLayer } from "./labels";
import {
  BuildingPicker,
  type BuildingUserData,
} from "./interact";
import { initSearch, type SearchItem } from "./search";
import { DayNight, type PresetName } from "./dayNight";
import { buildActivity, buildGate, buildLibrary, gateLabel } from "./landmarks";
import { Navigator } from "./navigation";
import { collectPlaces, initPlacesPanel, type PlaceEntry, type PlacesPanel } from "./placesPanel";
import { PLACE_INFO } from "./placesInfo";
import { facadeTexture, roofMaterial } from "./facades";

const app = document.querySelector<HTMLDivElement>("#app")!;
const statsEl = document.querySelector<HTMLDivElement>("#hud-stats")!;
const navStatusEl = document.querySelector<HTMLDivElement>("#nav-status")!;

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 9000);
const HOME_VIEW = { pos: new THREE.Vector3(650, 620, 1050), target: new THREE.Vector3(0, 10, 0) };
camera.position.copy(HOME_VIEW.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_VIEW.target);
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
  const maxMove = e.pointerType === "touch" ? 10 : 6;
  if (Math.hypot(e.clientX - d[0], e.clientY - d[1]) > maxMove) return;
  raycaster.setFromCamera(
    new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1),
    camera,
  );
  const pt = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, pt)) navigator.clickGround(pt.x, pt.z);
});

// ---- 信息卡（已并入面板详情模式；此处仅保留导航面板状态）----
let dayNight: DayNight | null = null;
let picker: BuildingPicker | null = null;
let navigator: Navigator | null = null;
let navMode = false;
let panel: PlacesPanel | null = null;
let places: PlaceEntry[] = [];
let boundaryLine: THREE.LineLoop | null = null;

// ---- 图层分组 ----
const gGreen = new THREE.Group();
const gSports = new THREE.Group();
const gWater = new THREE.Group();
const gRoads = new THREE.Group();
const gTrees = new THREE.Group();
const gContext = new THREE.Group();
scene.add(gGreen, gSports, gWater, gRoads, gTrees, gContext);

// ---- GLB ----
const gltfLoader = new GLTFLoader();
const GLB_LANDMARKS = new Set(["library", "info", "gym", "gongke", "activity"]);
const GLB_GATES: Record<string, string> = { 北门: "gate_north", 东门: "gate_east", 西门: "gate_south" };

function bboxCenterOfBuilding(b: Building): [number, number] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of b.polygon) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

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
        g.rotation.y = (gate.angle * Math.PI) / 180 + Math.PI / 2;
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

// ---- 详情卡（面板内 gxu 式）----
function openDetail(it: PlaceEntry): void {
  flyTargetBuilding = it.mesh ?? null;
  const hud = document.querySelector("#hud")!;
  hud.classList.add("detail-mode");
  document.querySelector("#place-detail")!.classList.add("open");
  (document.querySelector("#pd-num") as HTMLElement)!.textContent = it.num;
  document.querySelector("#pd-name")!.textContent = it.name;
  const meta: string[] = [it.kind === "water" ? "湖泊" : it.kind === "gate" ? "校门" : "建筑"];
  if (it.mesh) {
    const d = it.mesh.userData as BuildingUserData;
    meta.push(`${d.height} m`, `${d.area.toLocaleString()} m²`);
  }
  document.querySelector("#pd-meta")!.textContent = meta.join(" · ");
  const info = PLACE_INFO[it.name];
  document.querySelector("#pd-desc")!.textContent =
    info?.desc ?? "介绍待补充，欢迎提供资料。";
  const photo = document.querySelector("#pd-photo") as HTMLElement;
  photo.style.backgroundImage = info?.photo ? `url(${info.photo})` : "none";
  panel?.setActive(it.name);
}

function closeDetail(): void {
  document.querySelector("#hud")!.classList.remove("detail-mode");
  document.querySelector("#place-detail")!.classList.remove("open");
}

function focusBuilding(mesh: THREE.Mesh | null): void {
  if (!mesh) return;
  const d = mesh.userData as BuildingUserData;
  flyTo(camera, controls, new THREE.Vector3(d.cx, d.height / 2, d.cy),
    Math.max(150, Math.sqrt(d.area) * 3.4));
}

function selectPlace(it: SearchItem): void {
  if (navMode && navigator) {
    navigator.setEndBuilding(it.target.x, it.target.z);
    flyTo(camera, controls, it.target, it.distance);
    return;
  }
  if (it.mesh) picker?.select(it.mesh);
  else picker?.clearSelection();
  flyTo(camera, controls, it.target, it.distance);
  openDetail(it as PlaceEntry);
}

// ---- 场景加载 ----
let buildingsRef: THREE.Group | null = null;
async function loadScene(): Promise<void> {
  const res = await fetch("data/scene.json");
  if (!res.ok) throw new Error("scene.json 加载失败 (HTTP " + res.status + ")");
  const data: SceneData = await res.json();

  buildGround(scene);
  buildGreen(gGreen, gSports, data.green);
  buildPaving(gRoads, data.paving);
  buildWater(gWater, data.water);
  buildRoads(gRoads, data.roads);

  const inside = data.buildings.filter((b) => b.inside);
  const outside = data.buildings.filter((b) => !b.inside);
  buildContextBuildings(gContext, outside);
  if (data.boundary) {
    boundaryLine = buildBoundaryLine(data.boundary);
    scene.add(boundaryLine);
  }

  const generic = inside.filter((b) => !b.landmark);
  const buildings = buildBuildings(scene, generic);
  buildingsRef = buildings;
  const landmarkDefs = inside.filter((b) => b.landmark);
  const landmarkGroups = await Promise.all(landmarkDefs.map(async (b) => {
    const glb = await loadLandmarkGLB(b.landmark, b);
    if (glb) return glb;
    if (b.landmark === "library") return buildLibrary(b);
    if (b.landmark === "activity") return buildActivity(b);
    return fallbackLandmark(b);
  }));
  for (const g of landmarkGroups) buildings.add(g);
  const treeCount = buildTrees(gTrees, data.green, data.roads, data.water);

  dayNight = new DayNight(scene, hemi, sun, buildings);
  dayNight.apply("day");

  navigator = new Navigator(scene, data.graph);
  navigator.onStatus = (t) => {
    navStatusEl.textContent = t || (navMode ? "点击道路或地面设置起点" : "");
  };

  // 地点收集：有名字的楼（同名取第一个 mesh，递归含 GLB 组）+ 湖 + 校门
  const byName = new Map<string, THREE.Mesh>();
  buildings.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const d = mesh.userData as BuildingUserData;
    if (!d.name || d.name.includes("门")) return;
    if (!byName.has(d.name)) byName.set(d.name, mesh);
  });
  places = collectPlaces(data, byName);
  panel = initPlacesPanel(document.querySelector("#places")!, places, selectPlace);
  initSearch(
    document.querySelector<HTMLInputElement>("#search")!,
    document.querySelector<HTMLElement>("#suggestions")!,
    places,
    selectPlace,
  );

  picker = new BuildingPicker(renderer.domElement, camera, buildings, {
    onSelect: (mesh) => {
      if (navMode && navigator) {
        const d = mesh.userData as BuildingUserData;
        navigator.setEndBuilding(d.cx, d.cy);
        return;
      }
      const entry = places.find((p) => p.mesh === mesh || p.name === (mesh.userData as BuildingUserData).name);
      if (entry) {
        picker!.select(mesh);
        openDetail(entry);
      } else {
        picker!.clearSelection();
      }
    },
    onClear: () => {
      if (!navMode) closeDetail();
    },
  });

  // 标注：楼名（楼顶）+ 湖名
  for (const [name, mesh] of byName) {
    const d = mesh.userData as BuildingUserData;
    const pos = new THREE.Vector3(d.cx, d.height + 12, d.cy);
    labels.add(name, pos, 1250, { onClick: () => { picker!.select(mesh); focusBuilding(mesh); } });
  }
  for (const w of data.water) {
    if (!w.name || w.inside === false) continue;
    const [cx, cy] = bboxCenter(w.outers[0]);
    labels.add(w.name, new THREE.Vector3(cx, 2, -cy), 2000, {
      cls: "water",
      onClick: () => { flyTo(camera, controls, new THREE.Vector3(cx, 0, -cy), 400); },
    });
  }

  for (const g of data.gates) {
    const asset = GLB_GATES[g.name];
    const glb = asset ? await loadGateGLB(asset, g) : null;
    scene.add(glb ?? buildGate(g));
    const lb = gateLabel(g);
    labels.add(lb.text, lb.pos, 3000, { cls: "gate", onClick: () => {
      flyTo(camera, controls, new THREE.Vector3(g.x, 0, -g.y), 320);
    } });
  }

  statsEl.textContent =
    `楼栋 ${data.buildings.length} · 树木 ${treeCount}（示意） · ` +
    `数据 © OpenStreetMap 贡献者`;
  document.querySelector("#hud-count")!.textContent = `地点 ${places.length} 处`;
  document.querySelector("#tour-count")!.textContent = `${places.length} 个地点`;
}

loadScene().then(() => {
  renderLayers();
  renderLighting();
}).catch((e: unknown) => {
  statsEl.textContent = "加载出错：" + (e instanceof Error ? e.message : String(e));
  statsEl.classList.add("err");
});

// ---- 标签页 ----
const tabPages: Record<string, string> = {
  places: "tab-places", layers: "tab-layers", lighting: "tab-lighting",
};
for (const btn of document.querySelectorAll<HTMLButtonElement>(".hud-tab")) {
  btn.addEventListener("click", () => {
    closeDetail();
    for (const b of document.querySelectorAll(".hud-tab")) b.classList.toggle("on", b === btn);
    const key = btn.dataset.tab!;
    for (const [k, id] of Object.entries(tabPages)) {
      document.querySelector("#" + id)!.classList.toggle("on", k === key);
    }
  });
}

// ---- 图层 ----
interface LayerDef { name: string; desc: string; get: () => boolean; set: (v: boolean) => void }
const LAYER_DEFS: LayerDef[] = [
  { name: "地点名称", desc: "在地图上显示地点名称", get: () => labels.enabled, set: (v) => { labels.enabled = v; } },
  { name: "校园边界", desc: "白色细线标示大致范围", get: () => boundaryLine?.visible ?? false, set: (v) => { if (boundaryLine) boundaryLine.visible = v; } },
  { name: "校园建筑", desc: "边界内的主要建筑", get: () => buildingsRef?.visible ?? true, set: (v) => { if (buildingsRef) buildingsRef.visible = v; } },
  { name: "树木", desc: "示意绿荫分布", get: () => gTrees.visible, set: (v) => { gTrees.visible = v; } },
  { name: "道路与桥梁", desc: "车行道与步行道", get: () => gRoads.visible, set: (v) => { gRoads.visible = v; } },
  { name: "湖塘水面", desc: "缙湖、云湖等水面", get: () => gWater.visible, set: (v) => { gWater.visible = v; } },
  { name: "运动场地", desc: "田径场与球场", get: () => gSports.visible, set: (v) => { gSports.visible = v; } },
  { name: "周边建筑", desc: "仅保留贴近校界的周边背景", get: () => gContext.visible, set: (v) => { gContext.visible = v; } },
];

function renderLayers(): void {
  const list = document.querySelector("#layers-list")!;
  list.innerHTML = "";
  for (const def of LAYER_DEFS) {
    const row = document.createElement("div");
    row.className = "layer-row";
    const id = "layer-" + def.name;
    row.innerHTML =
      `<span class="lt"><strong id="layer-title-${id}">${def.name}</strong>` +
      `<small id="layer-desc-${id}">${def.desc}</small></span>` +
      `<span class="sw"><input type="checkbox" id="${id}" ${def.get() ? "checked" : ""} /><i></i></span>`;
    (row.querySelector("input") as HTMLInputElement).addEventListener("change", (e) => {
      def.set((e.target as HTMLInputElement).checked);
    });
    list.appendChild(row);
  }
}

// ---- 光影 ----
const LIGHTING_DEFS: { key: PresetName; name: string; sub: string }[] = [
  { key: "morning", name: "晨光", sub: "树影初长" },
  { key: "day", name: "日间", sub: "校园清朗" },
  { key: "dusk", name: "黄昏", sub: "余晖入窗" },
  { key: "night", name: "夜景", sub: "灯火渐明" },
];
let currentPreset: PresetName = "day";
function renderLighting(): void {
  const list = document.querySelector("#lighting-list")!;
  list.innerHTML = "";
  for (const def of LIGHTING_DEFS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "lt-card" + (def.key === currentPreset ? " on" : "");
    card.innerHTML = `<strong>${def.name}</strong><small>${def.sub}</small>`;
    card.addEventListener("click", () => {
      currentPreset = def.key;
      picker?.clearSelection();
      dayNight?.apply(def.key);
      for (const c of list.children) c.classList.toggle("on", c === card);
    });
    list.appendChild(card);
  }
}

// ---- 巡游 ----
const TOUR_DWELL = 4200;
const tour = { on: false, paused: false, index: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> };

function tourBarText(): void {
  const it = places[tour.index];
  document.querySelector("#tour-state")!.textContent = tour.paused ? "游览已暂停" : "正在游览";
  document.querySelector("#tour-pos")!.textContent =
    `${String(tour.index + 1).padStart(2, "0")} / ${places.length}`;
  document.querySelector("#tour-name")!.textContent = it ? it.name : "";
  document.querySelector("#tour-pause")!.textContent = tour.paused ? "继续" : "暂停";
}

function tourGoto(index: number): void {
  if (!places.length) return;
  tour.index = ((index % places.length) + places.length) % places.length;
  const it = places[tour.index];
  selectPlace(it);
  tourBarText();
  startTourTimer();
}

function startTourTimer(): void {
  clearTimeout(tour.timer);
  if (tour.paused || !tour.on) return;
  const fill = document.querySelector("#tour-timer-fill") as HTMLElement;
  fill.style.transition = "none";
  fill.style.width = "0";
  void fill.offsetWidth;
  fill.style.transition = `width ${TOUR_DWELL}ms linear`;
  fill.style.width = "100%";
  tour.timer = setTimeout(() => tourGoto(tour.index + 1), TOUR_DWELL);
}

function setTour(on: boolean): void {
  tour.on = on;
  document.querySelector("#tour-bar")!.classList.toggle("on", on);
  if (on) {
    if (navMode) setNavMode(false);
    tour.paused = false;
    tourGoto(tour.index);
  } else {
    clearTimeout(tour.timer);
    closeDetail();
    panel?.setActive(null);
  }
}

document.querySelector("#tour-start")!.addEventListener("click", () => {
  setTour(true);
  tourGoto(tour.index);
});
document.querySelector("#tour-pause")!.addEventListener("click", () => {
  tour.paused = !tour.paused;
  tourBarText();
  if (!tour.paused) startTourTimer();
  else clearTimeout(tour.timer);
});
document.querySelector("#tour-prev")!.addEventListener("click", () => tourGoto(tour.index - 1));
document.querySelector("#tour-next")!.addEventListener("click", () => tourGoto(tour.index + 1));
document.querySelector("#tour-exit")!.addEventListener("click", () => setTour(false));

// ---- 详情返回 / 前往 ----
document.querySelector("#pd-back")!.addEventListener("click", () => {
  closeDetail();
  picker?.clearSelection();
});
let flyTargetBuilding: THREE.Mesh | null = null;
document.querySelector("#pd-fly")!.addEventListener("click", () => {
  if (flyTargetBuilding) focusBuilding(flyTargetBuilding);
  else if (places[tour.index]) flyTo(camera, controls, places[tour.index].target, places[tour.index].distance);
});

// ---- 导航 ----
const navBtn = document.querySelector<HTMLButtonElement>("#tb-nav")!;
function setNavMode(v: boolean): void {
  navMode = v;
  navBtn.classList.toggle("on", v);
  document.querySelector("#nav-panel")!.classList.toggle("open", v);
  navigator?.setActive(v);
  if (v) {
    if (tour.on) setTour(false);
    closeDetail();
    picker?.clearSelection();
  }
  navBtn.blur();
}
navBtn.addEventListener("click", () => setNavMode(!navMode));
document.querySelector("#nav-clear")!.addEventListener("click", () => navigator?.clearRoute());
document.querySelector("#nav-exit")!.addEventListener("click", () => setNavMode(false));

// ---- 折叠 ----
document.querySelector<HTMLButtonElement>("#hud-fold")!.addEventListener("click", () => {
  document.querySelector("#hud")!.classList.toggle("collapsed");
});

// ---- 右侧控件 ----
document.querySelector("#tl-zin")!.addEventListener("click", () => {
  const off = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(off.length() * 0.72, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(off.setLength(len));
});
document.querySelector("#tl-zout")!.addEventListener("click", () => {
  const off = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(off.length() * 1.38, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(off.setLength(len));
});
document.querySelector("#tl-compass")!.addEventListener("click", () => {
  const off = camera.position.clone().sub(controls.target);
  const horiz = Math.hypot(off.x, off.z);
  camera.position.set(controls.target.x, controls.target.y + off.y, controls.target.z + horiz);
});
document.querySelector("#tl-home")!.addEventListener("click", () => {
  setTour(false);
  flyTo(camera, controls, HOME_VIEW.target, 1600);
});
document.querySelector("#tl-fs")!.addEventListener("click", () => {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
});

// ---- 渲染循环（60fps 帽）----
let lastFrame = 0;
renderer.setAnimationLoop((t) => {
  if (t - lastFrame < 15) return;
  lastFrame = t;
  controls.update();
  labels.update(camera);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

// 调试入口（控制台用）
Object.assign(window, { __huxi: { renderer, scene, camera, controls } });
