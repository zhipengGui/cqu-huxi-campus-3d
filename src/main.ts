import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneData } from "./types";
import {
  bboxCenter,
  buildBuildings,
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
import { buildingSearchItem, initSearch, type SearchItem } from "./search";
import { DayNight, type PresetName } from "./dayNight";
import { buildActivity, buildGate, buildLibrary, gateLabel } from "./landmarks";
import { Navigator } from "./navigation";

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

  const generic = data.buildings.filter((b) => !b.landmark);
  const buildings = buildBuildings(scene, generic);
  // 地标精模组挂进同一拾取组（递归射线）
  for (const b of data.buildings) {
    if (b.landmark === "library") {
      buildings.add(buildLibrary(b));
    } else if (b.landmark === "activity") {
      buildings.add(buildActivity(b));
    }
  }
  const treeCount = buildTrees(scene, data.green, data.roads, data.water);

  for (const g of data.gates) {
    scene.add(buildGate(g));
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

  // 搜索条目：有名字的楼 + 湖
  const items: SearchItem[] = [];
  const byName = new Map<string, THREE.Mesh>();
  for (const mesh of buildings.children as THREE.Mesh[]) {
    const d = mesh.userData as BuildingUserData;
    if (!d.name || d.name.includes("门")) continue;
    if (!byName.has(d.name)) byName.set(d.name, mesh);
    items.push(buildingSearchItem(mesh));
  }
  for (const w of data.water) {
    if (!w.name) continue;
    const [cx, cy] = bboxCenter(w.outers[0]);
    let r = 0;
    for (const [x, y] of w.outers[0]) r = Math.max(r, Math.hypot(x - cx, y - cy));
    items.push({
      name: w.name,
      kind: "water",
      target: new THREE.Vector3(cx, 0, -cy),
      distance: Math.max(260, r * 2.6),
    });
  }
  for (const g of data.gates) {
    items.push({
      name: g.name,
      kind: "gate",
      target: new THREE.Vector3(g.x, 0, -g.y),
      distance: 320,
    });
  }
  initSearch(
    document.querySelector<HTMLInputElement>("#search")!,
    document.querySelector<HTMLElement>("#suggestions")!,
    items,
    (it) => {
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
    },
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

  const named = byName.size;
  statsEl.textContent =
    `楼栋 ${data.buildings.length}（有名字 ${named}）· 树木 ${treeCount}（示意） · ` +
    `数据 © OpenStreetMap 贡献者`;
}

loadScene().catch((e: unknown) => {
  statsEl.textContent = "加载出错：" + (e instanceof Error ? e.message : String(e));
  statsEl.classList.add("err");
});

// ---- 工具栏 ----
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

renderer.setAnimationLoop(() => {
  controls.update();
  labels.update(camera);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

Object.assign(window, { __huxi: { renderer, scene, camera, controls } });
