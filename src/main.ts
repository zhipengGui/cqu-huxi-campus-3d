import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { boundsOf, frameBox, framePoints, placeRoot } from "./landmarkViews";
import { clipRoads, campusAreas } from "./campusClip";
import { buildContext } from "./context";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneData, Building, Gate } from "./types";
import {
  bboxCenter,
  buildBoundaryLine,
  buildBuildings,
  buildGreen,
  buildGround,
  buildPaving,
  buildRoads,
  buildWater,
  waterMaterial,
} from "./sceneBuilder";
import { buildTrees } from "./trees";
import { cancelFly, flyTo } from "./flyTo";import { LabelLayer } from "./labels";
import {
  BuildingPicker,
  type BuildingUserData,
} from "./interact";
import { initSearch, type SearchItem } from "./search";
import { DayNight, applyBuildingEmissive, type PresetName } from "./dayNight";
import { buildActivity, buildGate, buildGym, buildLikelou, buildLibrary, buildZonghe, gateLabel } from "./landmarks";
import { buildSportsMarks, sportsSiteAreas } from "./sports";
import { Navigator } from "./navigation";
import { collectPlaces, initPlacesPanel, type PlaceEntry, type PlacesPanel } from "./placesPanel";
import { PLACE_INFO } from "./placesInfo";
import { TOUR_STOPS } from "./tourStops";
import { facadeTexture, roofMaterial } from "./facades";
import {formatSharedView,parseSharedView,sharedDistanceScale} from './shareView';
import {advanceFrame} from './frameTiming';
import {initNavigationPanel} from './navigationPanel';
import {WalkWorld} from './walkCollision';
import {Walking} from './walking';
import walkSpawns from '../data/walk_spawns.json';

const app = document.querySelector<HTMLDivElement>("#app")!;
const statsEl = document.querySelector<HTMLDivElement>("#hud-stats")!;
const navStatusEl = document.querySelector<HTMLDivElement>("#nav-status")!;
const mobileLayout=window.matchMedia('(max-width:640px)');
const hud=document.querySelector<HTMLElement>('#hud')!;
let walking:Walking|null=null;
let walkWorld:WalkWorld|null=null;
let sceneData:SceneData|null=null;
let walkViewport:[number,number]=[0,0];
hud.classList.toggle('collapsed',mobileLayout.matches);
document.querySelector('#hud-fold')!.setAttribute('aria-expanded',String(!mobileLayout.matches));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=false;
let shadowDirty=true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;
app.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.addEventListener("pointerdown", () => renderer.domElement.focus());

const scene = new THREE.Scene();
const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment, .04).texture;
scene.environmentIntensity = .30;
environment.dispose();
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 18000);
const HOME_VIEW = { pos: new THREE.Vector3(650, 620, 1050), target: new THREE.Vector3(0, 10, 0) };
camera.position.copy(HOME_VIEW.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_VIEW.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 12;
controls.maxDistance = 8500;

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
sun.shadow.bias = -0.00008;
sun.shadow.normalBias = .07;
scene.add(sun);
scene.add(sun.target);

const labels = new LabelLayer(app);
scene.add(labels.root);

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  if(walking?.active)camera.clearViewOffset();else camera.setViewOffset(window.innerWidth, window.innerHeight,
    window.innerWidth > 640 ? -150 : 0, window.innerWidth <= 640 ? window.innerHeight * .20 : 0,
    window.innerWidth, window.innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labels.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", () => {
  resize();
  if(walking?.active)return;
  if(navMode&&routeNavigator?.result)focusRoute();
  else if (document.querySelector("#hud")!.classList.contains("detail-mode")) {
    if (flyTargetBuilding) focusBuilding(flyTargetBuilding, lastBuildingView);
    else if (selectedPlace) focusPlace(selectedPlace);
  } else homeView();
});
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
  if (!d || !navMode || !routeNavigator) return;
  const maxMove = e.pointerType === "touch" ? 10 : 6;
  if (Math.hypot(e.clientX - d[0], e.clientY - d[1]) > maxMove) return;
  // The building picker owns building taps; do not also set the ground behind it.
  if (picker?.hitAt(e.clientX, e.clientY)) return;
  raycaster.setFromCamera(
    new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1),
    camera,
  );
  const pt = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, pt)) routeNavigator.clickGround(pt.x, pt.z);
});

// ---- 信息卡（已并入面板详情模式；此处仅保留导航面板状态）----
let dayNight: DayNight | null = null;
let picker: BuildingPicker | null = null;
let routeNavigator: Navigator | null = null;
let navMode = false;
let panel: PlacesPanel | null = null;
let places: PlaceEntry[] = [];
let boundaryLine: THREE.LineLoop | null = null;
let lastBuildingView = "overview";
let selectedPlace:SearchItem|null=null;

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
const GLB_LANDMARKS = new Set(["library", "info", "gym", "gongke", "activity", "zonghe", "teaching1", "likelou"]);
const PRIORITY_ASSETS = new Set(["zonghe", "teaching1", "info", "library", "likelou", "gym", "activity", "gongke"]);
const draco = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + "draco/");
gltfLoader.setDRACOLoader(draco);
const detailAssets: { root: THREE.Group; far: THREE.Group; asset: string; building: Building; near?: THREE.Group; requested: boolean }[] = [];
const GLB_GATES: Record<string, string> = { 北门: "gate_north", 东门: "gate_east", 西门: "gate_west" };

function bboxCenterOfBuilding(b: Building): [number, number] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of b.polygon) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

function tagAsset(g: THREE.Group, b: Building, root: THREE.Group): void {
  const [cx, cy] = bboxCenterOfBuilding(b);
  g.traverse((o) => {
    if (typeof o.userData.courtX === "number") {
      root.userData.court = new THREE.Vector3(o.userData.courtX, 2, -o.userData.courtNorth);
      root.userData.courtRadius = o.userData.courtRadius;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true; mesh.receiveShadow = true;
    Object.assign(mesh.userData, { id: b.id, name: b.name, type: b.type, style: b.style,
      height: b.height, heightSource: b.heightSource, area: b.area, cx, cy: -cy, pickRoot: root });
  });
  applyBuildingEmissive(g);
}

async function loadLandmarkGLB(asset: string, b: Building): Promise<THREE.Group | null> {
  if (!GLB_LANDMARKS.has(asset)) return null;
  const priority = PRIORITY_ASSETS.has(asset);
  try {
    const gltf = await gltfLoader.loadAsync("models/" + asset + (priority ? ".far" : "") + ".glb?v=8");
    const root = new THREE.Group();
    const [cx, cy] = bboxCenterOfBuilding(b);
    root.position.set(cx, 0, -cy); root.name = b.name;
    root.add(gltf.scene); tagAsset(gltf.scene, b, root);
    if (priority) detailAssets.push({root, far: gltf.scene, asset, building: b, requested: false});
    return root;
  } catch (error) {
    console.warn("地标模型加载失败，使用回退建筑", asset, error);
    notifyModelFallback();
    return null;
  }
}

function updateDetailAssets(): void {
  for(const mesh of gSports.children)if(['sports-net','sports-orange','sports-glass'].includes(mesh.name))
    mesh.visible=resolveHighQuality()&&camera.position.distanceTo(controls.target)<800;
  for (const entry of detailAssets) {
    const close = resolveHighQuality() && camera.position.distanceTo(entry.root.position) < 650;
    if (entry.near) { if(entry.near.visible!==close)shadowDirty=true;entry.near.visible = close; entry.far.visible = !close; }
    else if (close && !entry.requested) {
      entry.requested = true;
      void gltfLoader.loadAsync("models/" + entry.asset + ".glb?v=8").then((gltf) => {
        entry.near = gltf.scene; tagAsset(gltf.scene, entry.building, entry.root);
        entry.root.add(gltf.scene);
        shadowDirty=true;
      }).catch(() => { notifyModelFallback(); });
    }
  }
}

function loadGateGLB(asset: string, gate: Gate): Promise<THREE.Group | null> {
  return new Promise((resolve) => {
    gltfLoader.load(
      "models/" + asset + ".glb?v=8",
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
      () => {notifyModelFallback();resolve(null);},
    );
  });
}
function notifyModelFallback():void {
  const status=document.querySelector<HTMLElement>('#asset-status')!;
  status.hidden=false;status.textContent='部分模型暂未加载，已保留简化外观；刷新页面可重试。';
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
  selectedPlace=it;
  flyTargetBuilding = it.mesh ?? null;
  const hud = document.querySelector("#hud")!;
  hud.classList.remove('collapsed');
  document.querySelector('#hud-fold')!.setAttribute('aria-expanded','true');
  hud.classList.add("detail-mode");
  document.querySelector("#place-detail")!.classList.add("open");
  (document.querySelector("#pd-num") as HTMLElement)!.textContent = it.num;
  document.querySelector("#pd-name")!.textContent = it.name;
  const meta: string[] = [it.kind === "water" ? "湖泊" : it.kind === "gate" ? "校门" : it.kind==='sports'?'运动场地':"建筑"];
  (document.querySelector('.building-views') as HTMLElement).style.display=it.mesh?'flex':'none';
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
  photo.hidden = !info?.photo;
  labels.active = it.name;
  if (it.mesh) meta.push((it.mesh.userData.heightSource === "override" ? "已校准楼高" : "楼高为推算值"));
  document.querySelector("#pd-meta")!.textContent = meta.join(" · ");
  panel?.setActive(it.name);
}

function closeDetail(): void {
  selectedPlace=null;
  labels.active = "";
  flyTargetBuilding = null;
  document.querySelector("#hud")!.classList.remove("detail-mode");
  document.querySelector("#place-detail")!.classList.remove("open");
}

function focusBuilding(mesh: THREE.Mesh | null, view = "overview"): void {
  if (!mesh) return;
  lastBuildingView = view;
  const box = boundsOf(mesh);
  const rect=mapRect();
  const usableWidth=rect.right-rect.left,usableHeight=rect.bottom-rect.top;
  const fit = frameBox(box, camera.fov, {width: window.innerWidth, height: window.innerHeight, usableWidth, usableHeight});
  const center = fit.target;
  let distance = fit.distance;
  let dir = new THREE.Vector3(.70,.80,1.0);
  if (view === "facade") { dir.set(.2,.35,1); distance *= .82; }
  if (view === "court") {
    dir.set(.35,1.2,.85); distance = Math.max(75,distance*.36);
    const root = placeRoot(mesh);
    if (root.userData.court) center.copy(root.localToWorld((root.userData.court as THREE.Vector3).clone()));
    if (root.userData.courtRadius) {
      distance=THREE.MathUtils.clamp(root.userData.courtRadius*2.3,45,90);
      center.y=(mesh.userData as BuildingUserData).height*.35;
    }
  }
  // Compose into the actual free area, not behind the side/bottom panel.
  composeRect(rect);
  flyTo(camera, controls, center, distance, 1100, dir);
}

function mapRect() {
  const width=window.innerWidth,height=window.innerHeight,panel=hud.getBoundingClientRect();
  const brand=document.querySelector('#brand')!.getBoundingClientRect();
  const bottom=navMode?document.querySelector('#nav-panel')!.getBoundingClientRect().top-16:height-24;
  return width>640?{left:hud.classList.contains('collapsed')?24:panel.right+20,right:width-72,top:brand.bottom+18,bottom:Math.min(height-24,bottom)}
    :{left:12,right:width-12,top:Math.max(brand.bottom+16,72),bottom:navMode?bottom:Math.min(height-24,panel.top-16)};
}
function composeRect(rect:ReturnType<typeof mapRect>):void {
  camera.setViewOffset(innerWidth,innerHeight,innerWidth/2-(rect.left+rect.right)/2,innerHeight/2-(rect.top+rect.bottom)/2,innerWidth,innerHeight);
}
function focusPlace(it:SearchItem):void {
  if(it.mesh){focusBuilding(it.mesh);return;}
  const rect=mapRect();composeRect(rect);
  let distance=it.distance;
  if(it.extent) {
    const {width,length}=it.extent;
    const box=new THREE.Box3(it.target.clone().add(new THREE.Vector3(-width/2,0,-length/2)),it.target.clone().add(new THREE.Vector3(width/2,5,length/2)));
    distance=frameBox(box,camera.fov,{width:innerWidth,height:innerHeight,usableWidth:rect.right-rect.left,usableHeight:rect.bottom-rect.top}).distance;
  }
  flyTo(camera,controls,it.target,distance,1100,new THREE.Vector3(.35,1.3,1));
}
function homeView(): void {
  if (!campusPoints.length) return;
  const width=window.innerWidth,height=window.innerHeight,rect=mapRect();
  const direction=new THREE.Vector3(.28,1.45,1);
  const fit=framePoints(campusPoints,camera.fov,{width,height},rect,direction);
  camera.setViewOffset(width,height,fit.offset.x,fit.offset.y,width,height);
  flyTo(camera,controls,fit.target,fit.distance,1100,direction);
}

function selectPlace(it: SearchItem): void {
  walking?.exit();
  if (navMode && routeNavigator) {
    routeNavigator.setPlace(routeNavigator.pickEndpoint??'end',it.name,it.target.x,it.target.z);
    return;
  }
  if (it.mesh) picker?.select(it.mesh);
  else picker?.clearSelection();
  openDetail(it as PlaceEntry);
  focusPlace(it);
}

// ---- 场景加载 ----
const campusPoints: THREE.Vector3[] = [];
let buildingsRef: THREE.Group | null = null;
async function loadScene(): Promise<void> {
  const res = await fetch("data/scene.json");
  if (!res.ok) throw new Error("scene.json 加载失败 (HTTP " + res.status + ")");
  const data: SceneData = await res.json();
  sceneData=data;

  buildGround(scene);
  if (data.boundary) {
    const shape = new THREE.Shape(data.boundary.pts.map(([x,y]) => new THREE.Vector2(x,y)));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI/2);
    const campusGround = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color: 0xa7b690}));
    campusGround.position.y = -.15; campusGround.receiveShadow = true; scene.add(campusGround);
  }
  const campusGreen = campusAreas(data.green, data.boundary?.pts);
  const campusWater = campusAreas(data.water, data.boundary?.pts);
  buildGreen(gGreen, gSports, campusGreen);
  buildSportsMarks(gSports, campusGreen);
  buildPaving(gRoads, campusAreas(data.paving, data.boundary?.pts));
  buildWater(gWater, campusWater);
  buildRoads(gRoads, data.boundary ? clipRoads(data.roads, data.boundary.pts) : data.roads);

  if (data.boundary) {
    for (const [x,y] of data.boundary.pts) campusPoints.push(new THREE.Vector3(x,0,-y));
    for (const building of data.buildings.filter(b=>b.inside)) {
      for (const [x,y] of building.polygon) campusPoints.push(new THREE.Vector3(x,building.height,-y));
    }
  }
  const inside = data.buildings.filter((b) => b.inside);
  gContext.add(buildContext(data));
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
    if (b.landmark === "gym") return buildGym(b);
    if (b.landmark === "library") return buildLibrary(b);
    if (b.landmark === "activity") return buildActivity(b);
    if (b.landmark === "zonghe") return buildZonghe(b);
    if (b.landmark === "likelou") return buildLikelou(b);
    return fallbackLandmark(b);
  }));
  for (const g of landmarkGroups) buildings.add(g);
  const treeCount = buildTrees(gTrees, [...campusGreen,...sportsSiteAreas(campusGreen)], data.roads, campusWater, inside, data.boundary?.pts);

  dayNight = new DayNight(scene, hemi, sun, buildings);
  dayNight.apply("day");

  routeNavigator = new Navigator(scene, data.graph);
  walkWorld=new WalkWorld(data);
  walking=new Walking(camera,controls,renderer.domElement,walkWorld,(active,message)=>{
    document.body.classList.toggle('walk-mode',active);picker?.setEnabled(!active);shadowDirty=true;
    document.querySelector<HTMLElement>('#walk-setup')!.hidden=true;
    if(message)showToast(message);
    if(!active&&(walkViewport[0]!==innerWidth||walkViewport[1]!==innerHeight)){resize();if(selectedPlace)focusPlace(selectedPlace);else homeView();}
  });
  routeNavigator.onStatus = (t) => {
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
  places = collectPlaces({...data, water: campusWater,green:campusGreen}, byName);
  initNavigationPanel(routeNavigator,places,focusRoute);
  tourStops = TOUR_STOPS.map((s) => places.find((p) => p.name === s.name)).filter(
    (p): p is PlaceEntry => !!p,
  );
  panel = initPlacesPanel(document.querySelector("#places")!, places, selectPlace);
  initSearch(
    document.querySelector<HTMLInputElement>("#search")!,
    document.querySelector<HTMLElement>("#suggestions")!,
    places,
    selectPlace,
  );

  picker = new BuildingPicker(renderer.domElement, camera, buildings, {
    onSelect: (mesh) => {
      if (navMode && routeNavigator) {
        const d = mesh.userData as BuildingUserData;
        routeNavigator.setPlace(routeNavigator.pickEndpoint??'end',d.name,d.cx,d.cy);
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
  for(const place of places.filter(p=>p.kind==='sports'))labels.add(place.name,place.target.clone().setY(3),6000,
    {cls:'sports',priority:3,onClick:()=>selectPlace(place)});
  for (const [name, mesh] of byName) {
    const box = boundsOf(mesh);
    const pos = box.getCenter(new THREE.Vector3()); pos.y = box.max.y + 5;
    labels.add(name, pos, 6000, { priority: mesh.userData.pickRoot ? 5 : 1, onClick: () => {
      const item=places.find(p=>p.name===name);if(item)selectPlace(item);
    } });
  }
  for (const w of campusWater) {
    if (!w.name || w.inside === false) continue;
    const [cx, cy] = bboxCenter(w.outers[0]);
    labels.add(w.name, new THREE.Vector3(cx, 2, -cy), 6000, {
      cls: "water", priority: 3,
      onClick: () => { flyTo(camera, controls, new THREE.Vector3(cx, 0, -cy), 400); },
    });
  }

  for (const g of data.gates) {
    const asset = GLB_GATES[g.name];
    const glb = asset ? await loadGateGLB(asset, g) : null;
    scene.add(glb ?? buildGate(g));
    const lb = gateLabel(g);
    labels.add(lb.text, lb.pos, 6000, { cls: "gate", onClick: () => {
      flyTo(camera, controls, new THREE.Vector3(g.x, 0, -g.y), 320);
    } });
  }

  statsEl.textContent =
    `楼栋 ${data.buildings.length} · 树木 ${treeCount}（示意） · ` +
    `数据 © OpenStreetMap 贡献者`;
  document.querySelector("#hud-count")!.textContent = `地点 ${places.length} 处`;
  document.querySelector("#tour-count")!.textContent = `游览 ${tourStops.length} 站`;
}

loadScene().then(() => {
  renderLayers();
  renderLighting();
  const view=parseSharedView(location.hash);
  if(view) {
    applyLighting(view.preset as PresetName);
    const place=places.find(p=>p.name===view.place);
    if(place){if(place.mesh)picker?.select(place.mesh);openDetail(place);}
    hud.classList.toggle('collapsed',view.collapsed);
    document.querySelector('#hud-fold')!.setAttribute('aria-expanded',String(!view.collapsed));
    camera.position.fromArray(view.position);controls.target.fromArray(view.target);
    if(view.offset.length===2&&view.viewport[0]===innerWidth&&view.viewport[1]===innerHeight)
      camera.setViewOffset(innerWidth,innerHeight,view.offset[0]*innerWidth,view.offset[1]*innerHeight,innerWidth,innerHeight);
    else {
      const rect=mapRect(),offset=camera.position.clone().sub(controls.target);
      let subject=campusPoints;
      if(place?.mesh||place?.extent) {
        const box=place.mesh?boundsOf(place.mesh):new THREE.Box3(
          place.target.clone().add(new THREE.Vector3(-place.extent!.width/2,0,-place.extent!.length/2)),
          place.target.clone().add(new THREE.Vector3(place.extent!.width/2,5,place.extent!.length/2)));
        subject=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])subject.push(new THREE.Vector3(x,y,z));
      }
      const dir=offset.clone().normalize(),depths=subject.map(p=>p.clone().sub(controls.target).dot(dir));
      const scale=sharedDistanceScale(view,{width:innerWidth,height:innerHeight},{width:rect.right-rect.left,height:rect.bottom-rect.top},[Math.min(...depths),Math.max(...depths)]);
      offset.setLength(THREE.MathUtils.clamp(offset.length()*scale,12,8500));camera.position.copy(controls.target).add(offset);
      composeRect(rect);
    }
    controls.update();
  } else homeView();
  shadowDirty=true;
  document.querySelector<HTMLElement>('#boot')!.hidden=true;
}).catch((e: unknown) => {
  statsEl.textContent = "加载出错：" + (e instanceof Error ? e.message : String(e));
  statsEl.classList.add("err");
  document.querySelector<HTMLElement>('#boot')!.hidden=false;
  document.querySelector('#boot-title')!.textContent='校园数据加载失败';
  document.querySelector('#boot-note')!.textContent='请检查网络，然后重新加载。';
  document.querySelector<HTMLElement>('.boot-spinner')!.hidden=true;
  document.querySelector<HTMLButtonElement>('#boot-retry')!.hidden=false;
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
  { name: "运动场地", desc: "田径跑道与室外球场", get: () => gSports.visible, set: (v) => { gSports.visible = v; } },
  { name: "周边环境", desc: "校界约200米内的简化建筑、道路与地表", get: () => gContext.visible, set: (v) => { gContext.visible = v; } },
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
      shadowDirty=true;
    });
    list.appendChild(row);
  }
}

// ---- 画质（自动/高/低）----
type Quality = "auto" | "high" | "low";
let quality: Quality = "auto";

function resolveHighQuality(): boolean {
  if (quality === "low") return false;
  if (quality === "high") return true;
  // 自动：移动端（粗指针）或内存 <=4GB 视为低配
  const nav = window.navigator as (typeof window.navigator) & { deviceMemory?: number };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const lowMem = nav.deviceMemory !== undefined && nav.deviceMemory <= 4;
  return !(coarse || lowMem);
}

function applyQuality(): void {
  const high = resolveHighQuality();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1));
  renderer.shadowMap.enabled = high;
  shadowDirty=true;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#quality-seg .tb")) {
    b.classList.toggle("on", b.dataset.q === quality);
  }
}

document.querySelector("#quality-seg")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".tb");
  if (!btn || !btn.dataset.q) return;
  quality = btn.dataset.q as Quality;
  applyQuality();
});
applyQuality();

// ---- 光影 ----
const LIGHTING_DEFS: { key: PresetName; name: string; sub: string }[] = [
  { key: "morning", name: "晨光", sub: "树影初长" },
  { key: "day", name: "日间", sub: "校园清朗" },
  { key: "dusk", name: "黄昏", sub: "余晖入窗" },
  { key: "night", name: "夜景", sub: "灯火渐明" },
];
let currentPreset: PresetName = "day";
let sunDirection: [number,number,number] = [600,900,350];
function applyLighting(key: PresetName): void {
  currentPreset = key;
  picker?.clearSelection();
  dayNight?.apply(key);
  shadowDirty=true;
  sunDirection = sun.position.toArray() as [number,number,number];
  for (const c of document.querySelectorAll<HTMLButtonElement>("#lighting-list .lt-card")) {
    c.classList.toggle("on", c.dataset.key === key);
  }
}
function renderLighting(): void {
  const list = document.querySelector("#lighting-list")!;
  list.innerHTML = "";
  for (const def of LIGHTING_DEFS) {
    const card = document.createElement("button");
    card.type = "button";
    card.dataset.key = def.key;
    card.className = "lt-card" + (def.key === currentPreset ? " on" : "");
    card.innerHTML = `<strong>${def.name}</strong><small>${def.sub}</small>`;
    card.addEventListener("click", () => applyLighting(def.key));
    list.appendChild(card);
  }
}

// ---- 巡游 ----
const TOUR_DWELL = 4200;
const tour = { on: false, paused: false, index: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> };
let tourStops: PlaceEntry[] = [];

function tourBarText(): void {
  const it = tourStops[tour.index];
  const stop = it ? TOUR_STOPS.find((s) => s.name === it.name) : undefined;
  document.querySelector("#tour-state")!.textContent = tour.paused ? "游览已暂停" : "正在游览";
  document.querySelector("#tour-pos")!.textContent =
    `${String(tour.index + 1).padStart(2, "0")} / ${tourStops.length}`;
  document.querySelector("#tour-name")!.textContent = it ? it.name : "";
  document.querySelector("#tour-desc")!.textContent = stop?.note ?? "";
  document.querySelector("#tour-pause")!.textContent = tour.paused ? "继续" : "暂停";
}

function tourGoto(index: number): void {
  if (!tourStops.length) return;
  tour.index = ((index % tourStops.length) + tourStops.length) % tourStops.length;
  const it = tourStops[tour.index];
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
  else if (selectedPlace) focusPlace(selectedPlace);
});
document.querySelector('#pd-nav')!.addEventListener('click',()=>{
  const place=selectedPlace;if(!place)return;setNavMode(true);routeNavigator?.setPlace('end',place.name,place.target.x,place.target.z);
});

// ---- 导航 ----
const navBtn = document.querySelector<HTMLButtonElement>("#tb-nav")!;
document.querySelector('#tb-walk')!.addEventListener('click',()=>{
  if(mobileLayout.matches){showToast('步行漫游请使用电脑浏览器与鼠标。');return;}
  const setup=document.querySelector<HTMLElement>('#walk-setup')!,select=document.querySelector<HTMLSelectElement>('#walk-spawn')!;
  if(selectedPlace&&[...select.options].some(o=>o.value===selectedPlace!.name))select.value=selectedPlace.name;
  setup.hidden=false;
});
document.querySelector('#walk-cancel')!.addEventListener('click',()=>{document.querySelector<HTMLElement>('#walk-setup')!.hidden=true;});
document.querySelector('#walk-start')!.addEventListener('click',()=>{
  if(mobileLayout.matches){document.querySelector<HTMLElement>('#walk-setup')!.hidden=true;showToast('步行漫游请使用电脑浏览器与鼠标。');return;}
  if(!walking||!walkWorld||!routeNavigator||!sceneData)return;
  const name=document.querySelector<HTMLSelectElement>('#walk-spawn')!.value,place=places.find(p=>p.name===name);if(!place)return;
  const entry=walkSpawns.find(p=>p.name===name);
  const spawn=entry&&walkWorld.findSpawn(entry.point as [number,number],sceneData.graph.nodes);
  if(!spawn){showToast('附近没有安全步行点，请选择其他地点。');return;}
  cancelFly();if(tour.on)setTour(false);if(navMode)setNavMode(false);walkViewport=[innerWidth,innerHeight];
  walking.enter(spawn,entry.lookAt as [number,number]);
});
document.querySelector('#walk-exit')!.addEventListener('click',()=>walking?.exit());
function focusRoute():void {
  const route=routeNavigator?.result;if(!route)return;
  const points=route.points.map(([x,y])=>new THREE.Vector3(x,.3,-y)),rect=mapRect(),direction=new THREE.Vector3(.28,1.45,1);
  const fit=framePoints(points,camera.fov,{width:innerWidth,height:innerHeight},rect,direction);composeRect(rect);flyTo(camera,controls,fit.target,Math.max(120,fit.distance),900,direction);
}
function setNavMode(v: boolean): void {
  if(v)walking?.exit();
  navMode = v;
  document.body.classList.toggle('nav-mode',v);
  navBtn.classList.toggle("on", v);
  document.querySelector("#nav-panel")!.classList.toggle("open", v);
  routeNavigator?.setActive(v);
  if (v) {
    if (tour.on) setTour(false);
    closeDetail();
    picker?.clearSelection();
  }
  navBtn.blur();
}
navBtn.addEventListener("click", () => setNavMode(!navMode));
document.querySelector("#nav-clear")!.addEventListener("click", () => routeNavigator?.clearRoute());
document.querySelector("#nav-exit")!.addEventListener("click", () => setNavMode(false));

// ---- 折叠 ----
document.querySelector<HTMLButtonElement>("#hud-fold")!.addEventListener("click", () => {
  document.querySelector("#hud")!.classList.toggle("collapsed");
  document.querySelector('#hud-fold')!.setAttribute('aria-expanded',String(!hud.classList.contains('collapsed')));
  if (!document.querySelector("#hud")!.classList.contains("detail-mode")) homeView();
});
mobileLayout.addEventListener('change',()=>{
  if(mobileLayout.matches){walking?.exit();document.querySelector<HTMLElement>('#walk-setup')!.hidden=true;}
  if(!hud.classList.contains('detail-mode')){hud.classList.toggle('collapsed',mobileLayout.matches);homeView();}
  document.querySelector('#hud-fold')!.setAttribute('aria-expanded',String(!hud.classList.contains('collapsed')));
});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-shortcut]'))button.addEventListener('click',()=>{
  const it=places.find(p=>p.name===button.dataset.shortcut);if(it)selectPlace(it);
});
document.querySelector('#tl-more')!.addEventListener('click',()=>{
  const open=document.querySelector('#tools')!.classList.toggle('open');
  document.querySelector('#tl-more')!.setAttribute('aria-expanded',String(open));
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
  walking?.exit();
  if(navMode)setNavMode(false);
  setTour(false);
  picker?.clearSelection();
  if(mobileLayout.matches){hud.classList.add('collapsed');document.querySelector('#hud-fold')!.setAttribute('aria-expanded','false');}
  homeView();
});
document.querySelector("#tl-fs")!.addEventListener("click", () => {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
});

// ---- 分享视角 / 导出图片 ----
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string): void {
  const t = document.querySelector("#toast")!;
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

document.querySelector("#tl-share")!.addEventListener("click", () => {
  const rect=mapRect();
  const hash=formatSharedView({position:camera.position.toArray(),target:controls.target.toArray(),
    collapsed:hud.classList.contains('collapsed'),offset:[(camera.view?.offsetX??0)/innerWidth,(camera.view?.offsetY??0)/innerHeight],
    viewport:[innerWidth,innerHeight],frame:[rect.right-rect.left,rect.bottom-rect.top],preset:currentPreset,...(selectedPlace?{place:selectedPlace.name}:{})});
  const url = location.origin + location.pathname + hash;
  history.replaceState(null,'',url);
  (window.navigator.clipboard?.writeText(url)??Promise.reject()).then(
    () => showToast("链接已复制，可分享当前视角"),
    () => showToast("复制失败，请手动复制地址栏"),
  );
});

document.querySelector("#tl-export")!.addEventListener("click", () => {
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const w = src.width;
  const h = src.height;
  const bar = Math.max(26, Math.round(h * 0.045));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h + bar;
  const g = canvas.getContext("2d")!;
  g.drawImage(src, 0, 0);
  g.fillStyle = "rgba(15, 22, 32, 0.88)";
  g.fillRect(0, h, w, bar);
  g.fillStyle = "#fff";
  g.font = `${Math.round(bar * 0.52)}px system-ui, "Microsoft YaHei", sans-serif`;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText("© OpenStreetMap 贡献者", bar * 0.7, h + bar / 2);
  g.textAlign = "right";
  g.fillText("重庆大学虎溪校区 3D 地图", w - bar * 0.7, h + bar / 2);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "huxi-campus-3d.png";
  a.click();
  showToast("图片已导出");
});

// ---- 键盘快捷键 ----
function escapeAll(): void {
  if(walking?.active){walking.exit();return;}
  if(!document.querySelector<HTMLElement>('#walk-setup')!.hidden){document.querySelector<HTMLElement>('#walk-setup')!.hidden=true;return;}
  if(document.querySelector('#tools')!.classList.contains('open')){document.querySelector('#tl-more')!.dispatchEvent(new Event('click'));}
  else if (navMode) setNavMode(false);
  else if (tour.on) setTour(false);
  else closeDetail();
}
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA"||t.tagName==='SELECT') return;
  if(walking?.active){if(e.key==='Escape')walking.exit();return;}
  const k = e.key.toLowerCase();
  if (k === "h") document.querySelector<HTMLButtonElement>("#tl-home")!.click();
  else if (k === "n") document.querySelector<HTMLButtonElement>("#tl-compass")!.click();
  else if (k === "1") applyLighting("morning");
  else if (k === "2") applyLighting("day");
  else if (k === "3") applyLighting("dusk");
  else if (k === "4") applyLighting("night");
  else if (e.key === "Escape") escapeAll();
  else if (k === "?") showToast("快捷键：方向键旋转 · H全景 · N正北 · 1-4光影 · Esc退出");
});

// ---- 渲染循环（60fps 帽）----
let lastFrame = 0;
let lastWalkTime=0;
const lastShadowTarget=new THREE.Vector3(Infinity,Infinity,Infinity);
let lastShadowSize=-1;
renderer.setAnimationLoop((t) => {
  const nextFrame=advanceFrame(lastFrame,t);if(nextFrame===null)return;
  lastFrame=nextFrame;
  // 水面波纹缓慢流动
  const ripple = waterMaterial.normalMap;
  if (ripple) {
    ripple.offset.x = (t * 0.000012) % 1;
    ripple.offset.y = (t * 0.000007) % 1;
  }
  const elapsed=lastWalkTime?(t-lastWalkTime)/1000:0;lastWalkTime=t;
  if(walking?.active)walking.update(elapsed);else controls.update();
  updateDetailAssets();
  if (scene.fog instanceof THREE.Fog) {
    const distance = camera.position.distanceTo(controls.target);
    scene.fog.near = Math.max(2100, distance * 1.3);
    scene.fog.far = Math.max(5200, distance * 2.2);
  }
  const shadowSize = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * .85, 160, 1700);
  if(shadowDirty||lastShadowTarget.distanceToSquared(controls.target)>.01||Math.abs(shadowSize-lastShadowSize)>.5) {
    sun.position.copy(controls.target).add(new THREE.Vector3(...sunDirection));
    sun.target.position.copy(controls.target);
    Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize });
    sun.shadow.camera.updateProjectionMatrix();renderer.shadowMap.needsUpdate=true;
    lastShadowTarget.copy(controls.target);lastShadowSize=shadowSize;shadowDirty=false;
  }
  labels.update(camera, controls.target);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

// 调试入口（控制台用）
Object.assign(window, { __huxi: { renderer, scene, camera, controls, detailAssets,get navigation(){return routeNavigator;},get walking(){return walking;} } });

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-building-view]")) {
  button.addEventListener("click", () => focusBuilding(flyTargetBuilding, button.dataset.buildingView));
}
