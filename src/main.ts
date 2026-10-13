import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneData } from "./types";
import {
  bboxCenter,
  buildBuildings,
  buildGreen,
  buildGround,
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

const app = document.querySelector<HTMLDivElement>("#app")!;
const statsEl = document.querySelector<HTMLDivElement>("#hud-stats")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 9000);
camera.position.set(650, 620, 1050); // 校区东南侧上空，朝北俯瞰

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
document.querySelector("#ic-close")!.addEventListener("click", () => {
  picker?.clearSelection();
});
let flyTargetBuilding: THREE.Mesh | null = null;
document.querySelector("#ic-fly")!.addEventListener("click", () => {
  if (flyTargetBuilding) focusBuilding(flyTargetBuilding);
});

let dayNight: DayNight | null = null;
let picker: BuildingPicker | null = null;

function focusBuilding(mesh: THREE.Mesh): void {
  const d = mesh.userData as BuildingUserData;
  flyTo(camera, controls, new THREE.Vector3(d.cx, d.height / 2, d.cy), Math.max(150, Math.sqrt(d.area) * 3.4));
}

// 用户手动拖拽时中断飞行
renderer.domElement.addEventListener("pointerdown", cancelFly);

async function loadScene(): Promise<void> {
  const res = await fetch("data/scene.json");
  if (!res.ok) throw new Error("scene.json 加载失败 (HTTP " + res.status + ")");
  const data: SceneData = await res.json();

  buildGround(scene);
  buildGreen(scene, data.green);
  buildWater(scene, data.water);
  buildRoads(scene, data.roads);
  const buildings = buildBuildings(scene, data.buildings);
  const treeCount = buildTrees(scene, data.green, data.roads, data.water);

  dayNight = new DayNight(scene, hemi, sun, buildings);
  dayNight.apply("day");

  picker = new BuildingPicker(renderer.domElement, camera, buildings, {
    onSelect: (mesh) => {
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
    if (!d.name) continue;
    if (!byName.has(d.name)) byName.set(d.name, mesh); // 同名楼（如兰园#2）只留第一个
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
  initSearch(
    document.querySelector<HTMLInputElement>("#search")!,
    document.querySelector<HTMLElement>("#suggestions")!,
    items,
    (it) => {
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
        const [cx2, cy2] = bboxCenter(w.outers[0]);
        flyTo(camera, controls, new THREE.Vector3(cx2, 0, -cy2), 400);
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

// 工具栏
document.querySelector<HTMLButtonElement>("#tb-labels")!.addEventListener("click", (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  labels.enabled = !labels.enabled;
  btn.classList.toggle("on", labels.enabled);
});
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

// 调试入口（控制台用）
Object.assign(window, { __huxi: { renderer, scene, camera, controls } });
