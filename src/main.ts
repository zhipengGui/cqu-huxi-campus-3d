import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneData } from "./types";
import {
  buildBuildings,
  buildGreen,
  buildGround,
  buildRoads,
  buildWater,
} from "./sceneBuilder";

const app = document.querySelector<HTMLDivElement>("#app")!;
const statusEl = document.querySelector<HTMLDivElement>("#hud-status")!;

function setStatus(html: string, isError = false): void {
  statusEl.innerHTML = html;
  statusEl.classList.toggle("err", isError);
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfeaf2);
scene.fog = new THREE.Fog(0xdfeaf2, 2200, 5200);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 9000);
camera.position.set(650, 620, 1050); // 校区东南侧上空，朝北俯瞰

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 60;
controls.maxDistance = 3200;

scene.add(new THREE.HemisphereLight(0xcfe5ff, 0xb8b09a, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
sun.position.set(600, 900, 350);
scene.add(sun);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function loadScene(): Promise<void> {
  const res = await fetch("data/scene.json");
  if (!res.ok) throw new Error("scene.json 加载失败 (HTTP " + res.status + ")");
  const data: SceneData = await res.json();

  buildGround(scene);
  buildGreen(scene, data.green);
  buildWater(scene, data.water);
  buildRoads(scene, data.roads);
  buildBuildings(scene, data.buildings);

  const named = data.buildings.filter((b) => b.name).length;
  setStatus(
    `楼栋 ${data.buildings.length}（有名字 ${named}）· 道路 ${data.roads.length} · ` +
      `水面 ${data.water.length} · 绿地 ${data.green.length} · 数据 © OpenStreetMap 贡献者`,
  );
}

loadScene().catch((e: unknown) => {
  setStatus("加载出错：" + (e instanceof Error ? e.message : String(e)), true);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
