import * as THREE from "three";
import { offsetPolygon } from "./facades";
import { bboxCenter } from "./sceneBuilder";
import type { Building, Gate } from "./types";

/** 地标精模（参数化专用模块，思路对齐 gxu 的"地标专用生成脚本"）：
 *  - 图书馆：参考实拍（红棕横楼 + 玻璃底座 + 竖向百叶板塔 + 塔顶校名）
 *  - 学生活动中心：弧形楼体玻璃底座 + 白色冠带
 *  - 校门：白横梁 + 红色校名 + 徽标 + 门柱 + 翼墙（参考重大校门设计语言）
 *  统一返回 THREE.Group（组内局部坐标，组带世界位姿），由调用方挂进场景；
 *  楼栋类地标的网格 userData 由 attachBuildingData 补齐供拾取。 */

const PODIUM_RED = 0xa8523f;
const PODIUM_RED_DARK = 0x8a4036;
const GLASS = 0x42525e;
const STONE = 0xb5b1a8;
const BEAM_WHITE = 0xeceae4;
const CROWN_WHITE = 0xf0efe9;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function textTexture(text: string, fg: string, bg: string): THREE.CanvasTexture {
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = fg;
    g.font = "bold 88px 'Microsoft YaHei', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 256, 70);
  });
}

function emblemTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = "#f4f3ee";
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#b8322c";
    g.lineWidth = 7;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#2a4d7f";
    g.beginPath();
    g.arc(64, 64, 30, 0, Math.PI * 2);
    g.fill();
  });
}

/** 竖向百叶纹理（图书馆板塔立面） */
function finTexture(base: string, fin: string): THREE.CanvasTexture {
  return canvasTexture(128, 64, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = fin;
    for (let x = 0; x < 128; x += 16) {
      g.fillRect(x, 0, 7, 64);
    }
    g.fillStyle = "rgba(255,255,255,0.18)";
    for (let x = 7; x < 128; x += 16) {
      g.fillRect(x, 0, 2, 64);
    }
  });
}

/** 综合楼：毛石砌墙面（参考实拍 work/refs/虎溪综合楼.jpg，米灰石块+横条窗带） */
function stoneTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 128, (g) => {
    g.fillStyle = "#b3ab9c";
    g.fillRect(0, 0, 256, 128);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 260; i++) {
      const bw = 8 + rnd() * 24;
      const bh = 5 + rnd() * 9;
      const shade = 0.8 + rnd() * 0.32;
      g.fillStyle = `rgb(${Math.round(179 * shade)},${Math.round(171 * shade)},${Math.round(156 * shade)})`;
      g.fillRect(rnd() * 256, rnd() * 128, bw, bh);
    }
    g.fillStyle = "#4d565f";
    for (let y = 12; y < 128; y += 40) {
      g.fillRect(0, y, 256, 11);
    }
  });
}

/** 理科楼：横向百叶窗带（参考实拍 photos/likelou.jpg，浅灰白错落体块） */
function louverTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 64, (g) => {
    g.fillStyle = "#d9dbd8";
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#9aa2a8";
    for (let y = 0; y < 64; y += 10) {
      g.fillRect(0, y, 128, 5);
    }
  });
}

export function attachBuildingData(root: THREE.Object3D, b: Building, height: number): void {
  const [cx, cy] = bboxCenter(b.polygon);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.userData = {
        id: b.id,
        name: b.name,
        type: b.type,
        style: "library",
        height,
        heightSource: b.heightSource,
        area: b.area,
        cx,
        cy: -cy,
      };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

function ccw(polygon: [number, number][]): [number, number][] {
  let a = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    a += x1 * y2 - x2 * y1;
  }
  return a >= 0 ? polygon : [...polygon].reverse();
}

/** 轮廓拉伸（局部坐标系：原点=轮廓 bbox 中心） */
function extrudeOutline(
  polygon: [number, number][],
  holes: [number, number][][],
  depth: number,
  yOffset: number,
  cx: number,
  cy: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(polygon.map(([x, y]) => new THREE.Vector2(x - cx, y - cy)));
  for (const hole of holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x - cx, y - cy))));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, yOffset, 0);
  return geo;
}

/** 图书馆：真实轮廓裙楼（玻璃底座 + 红棕上段）+ 居中窄长百叶板塔 + 塔顶校名 */
export function buildLibrary(b: Building): THREE.Group {
  const [cx, cy] = bboxCenter(b.polygon);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of b.polygon) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const eastLong = x1 - x0 >= y1 - y0;
  const L = Math.max(x1 - x0, y1 - y0);
  const D = Math.min(x1 - x0, y1 - y0);
  const podiumH = 8;
  const towerH = Math.max(b.height, 30) - podiumH;
  const towerL = Math.min(L * 0.72, 95);
  const towerD = Math.max(14, Math.min(D * 0.38, 24));

  const g = new THREE.Group();
  g.position.set(cx, 0, -cy);
  g.rotation.y = eastLong ? 0 : Math.PI / 2;

  const red = new THREE.MeshLambertMaterial({ color: PODIUM_RED });
  const glass = new THREE.MeshLambertMaterial({ color: GLASS });

  // 裙楼上段（真实轮廓，局部坐标）
  const upper = new THREE.Mesh(
    extrudeOutline(b.polygon, b.holes, podiumH - 3.4, 3.4, cx, cy),
    red,
  );
  g.add(upper);
  // 底层玻璃（轮廓内收）
  const inner = offsetPolygon(ccw(b.polygon), -0.9).map(([x, y]) => [x, y] as [number, number]);
  const glassMesh = new THREE.Mesh(
    extrudeOutline(inner, [], 3.4, 0, cx, cy),
    glass,
  );
  g.add(glassMesh);

  // 板塔：竖向百叶
  const finLong = new THREE.MeshLambertMaterial({
    map: (() => {
      const t = finTexture("#a04a3c", "#7c382f");
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(towerL / 1.1, 1);
      return t;
    })(),
  });
  const finShort = new THREE.MeshLambertMaterial({
    map: (() => {
      const t = finTexture("#a04a3c", "#7c382f");
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(towerD / 1.1, 1);
      return t;
    })(),
  });
  const roofTop = new THREE.MeshLambertMaterial({ color: PODIUM_RED_DARK });
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(towerL, towerH, towerD),
    [finLong, finLong, roofTop, roofTop, finShort, finShort],
  );
  tower.position.y = podiumH + towerH / 2;
  g.add(tower);

  // 塔顶"重庆大学"红字（白色衬带，长面两侧）
  const signTex = textTexture("重 庆 大 学", "#b8322c", "#f4f3ee");
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(towerL * 0.8, towerL * 0.8 * 0.25),
      new THREE.MeshBasicMaterial({ map: signTex }),
    );
    p.position.set(0, podiumH + towerH - 1.8, (side * towerD) / 2 + side * 0.08);
    p.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(p);
  }
  // 裙楼"图书馆"字（短轴两端面）
  const nameTex = textTexture("图 书 馆", "#f4f0ea", "#7e3a30");
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 2.2),
      new THREE.MeshBasicMaterial({ map: nameTex }),
    );
    p.position.set(L * 0.24, podiumH - 1.7, (side * D) / 2 + side * 0.4);
    p.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(p);
  }

  attachBuildingData(g, b, podiumH + towerH);
  return g;
}

/** 学生活动中心：弧形楼体玻璃底座 + 白冠带（直接用真实轮廓，绝对坐标） */
export function buildActivity(b: Building): THREE.Group {
  const g = new THREE.Group();
  const bodyH = Math.max(b.height, 12);
  const shape = new THREE.Shape(b.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of b.holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  const mk = (depth: number, y: number, mat: THREE.Material): THREE.Mesh => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y, 0);
    return new THREE.Mesh(geo, mat);
  };
  g.add(mk(3.8, 0, new THREE.MeshLambertMaterial({ color: GLASS })));
  g.add(mk(bodyH - 3.8, 3.8, new THREE.MeshLambertMaterial({ color: 0xf1eee7 })));
  g.add(mk(1.4, bodyH, new THREE.MeshLambertMaterial({ color: CROWN_WHITE })));
  attachBuildingData(g, b, bodyH + 1.4);
  return g;
}

/** 综合楼：毛石砌墙 + 底层架空柱廊 + 顶带（参考实拍 work/refs/虎溪综合楼.jpg） */
export function buildZonghe(b: Building): THREE.Group {
  const g = new THREE.Group();
  const bodyH = Math.max(b.height, 15);
  const shape = new THREE.Shape(b.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of b.holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  const mk = (depth: number, y: number, mat: THREE.Material): THREE.Mesh => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y, 0);
    return new THREE.Mesh(geo, mat);
  };
  // 底层架空（深色柱廊空间）+ 毛石主体 + 米白顶带
  g.add(mk(3.4, 0, new THREE.MeshLambertMaterial({ color: 0x5d5b54 })));
  const tex = stoneTexture();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.08, 0.12); // Extrude 侧面 UV 为米制长度，约 12m×8m 重复一窗带
  g.add(mk(bodyH - 3.4 - 1.3, 3.4, new THREE.MeshLambertMaterial({ map: tex })));
  g.add(mk(1.3, bodyH - 1.3, new THREE.MeshLambertMaterial({ color: 0xd8d4c8 })));
  attachBuildingData(g, b, bodyH);
  return g;
}

/** 理科楼：浅灰白错落体块——主体 + 沿长轴 40% 的高塔段（31.5m），横百叶立面 */
export function buildLikelou(b: Building): THREE.Group {
  const [cx, cy] = bboxCenter(b.polygon);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of b.polygon) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const eastLong = x1 - x0 >= y1 - y0;
  const L = Math.max(x1 - x0, y1 - y0);
  const D = Math.min(x1 - x0, y1 - y0);
  const totalH = Math.max(b.height, 24);
  const bodyH = totalH * 0.62;
  const towerH = totalH - bodyH;
  const towerL = L * 0.4;

  const g = new THREE.Group();
  g.position.set(cx, 0, -cy);
  g.rotation.y = eastLong ? 0 : Math.PI / 2;

  const tex = louverTexture();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const louverMat = new THREE.MeshLambertMaterial({ map: tex });
  const plainMat = new THREE.MeshLambertMaterial({ color: 0xe3e2dd });
  const glassMat = new THREE.MeshLambertMaterial({ color: GLASS });

  // 主体：轮廓拉伸三段（玻璃底座 + 百叶主体 + 平顶）
  const shape = new THREE.Shape(b.polygon.map(([x, y]) => new THREE.Vector2(x - cx, y - cy)));
  for (const hole of b.holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x - cx, y - cy))));
  }
  const mk = (depth: number, y: number, mat: THREE.Material): THREE.Mesh => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y, 0);
    return new THREE.Mesh(geo, mat);
  };
  g.add(mk(3.8, 0, glassMat));
  g.add(mk(bodyH - 3.8, 3.8, louverMat));

  // 高塔段（局部坐标：长轴 -L/2 端起 40%，错落体块）
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(towerL, towerH, Math.max(D * 0.9, 18)),
    [plainMat, plainMat, louverMat, louverMat, louverMat, louverMat],
  );
  tower.position.set(-L / 2 + towerL / 2, bodyH + towerH / 2, 0);
  g.add(tower);

  // 塔顶白色设备带
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(towerL, 1.2, Math.max(D * 0.9, 18) + 0.4),
    plainMat,
  );
  cap.position.set(-L / 2 + towerL / 2, totalH + 0.6, 0);
  g.add(cap);

  attachBuildingData(g, b, totalH + 1.2);
  return g;
}

/** 校门：门柱 + 白横梁 + 红校名 + 徽标 + 翼墙 */
export function buildGate(gate: Gate): THREE.Group {
  const g = new THREE.Group();
  g.position.set(gate.x, 0, -gate.y);
  // 道路方向 → 世界系（z=-北）；横梁垂直道路
  const dir = new THREE.Vector3(
    Math.cos((gate.angle * Math.PI) / 180), 0, -Math.sin((gate.angle * Math.PI) / 180),
  );
  g.rotation.y = Math.atan2(-dir.z, dir.x) + Math.PI / 2;

  const stone = new THREE.MeshLambertMaterial({ color: STONE });
  const beamMat = new THREE.MeshLambertMaterial({ color: BEAM_WHITE });

  const pillarGeo = new THREE.BoxGeometry(1.6, 7, 1.6);
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(pillarGeo, stone);
    p.position.set(side * 6.2, 3.5, 0);
    g.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(14, 2.4, 1.8), beamMat);
  beam.position.y = 5.9;
  g.add(beam);

  const signTex = textTexture("重 庆 大 学", "#b8322c", "#edece6");
  for (const side of [1, -1]) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 1.9),
      new THREE.MeshBasicMaterial({ map: signTex }),
    );
    sign.position.set(0, 5.9, side * 0.92);
    sign.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(sign);
  }
  const embTex = emblemTexture();
  for (const side of [1, -1]) {
    const emb = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 28),
      new THREE.MeshBasicMaterial({ map: embTex, transparent: true }),
    );
    emb.position.set(5.35, 5.9, side * 0.92);
    emb.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(emb);
  }
  const wallGeo = new THREE.BoxGeometry(6, 1.6, 0.9);
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wallGeo, stone);
    w.position.set(side * 9.8, 0.8, 0);
    g.add(w);
  }
  return g;
}

/** 校门标签锚点 */
export function gateLabel(gate: Gate): { text: string; pos: THREE.Vector3 } {
  return { text: gate.name, pos: new THREE.Vector3(gate.x, 10, -gate.y) };
}
