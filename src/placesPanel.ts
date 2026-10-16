import * as THREE from "three";
import type { SceneData } from "./types";
import type { SearchItem } from "./search";
import { bboxCenter } from "./sceneBuilder";
import {sportsSiteAreas,sportsFrame} from './sports';

/** 左侧"校园浏览"面板：分类地点列表，点击丝滑飞行。数据与搜索共用。 */

export type PlaceEntry = SearchItem & {
  group: string;
  num: string;
};

const GROUP_ORDER = ["教学", "文体", "运动", "餐饮", "宿舍", "楼宇", "湖泊", "校门"];
const FEATURED=['综合楼','第一教学楼','信息技术科研楼','图书馆','理科楼','工科大楼'];

function groupOfStyle(style: string): string {
  switch (style) {
    case "teaching":
    case "lab":
    case "library":
      return "教学";
    case "hall":
      return "文体";
    case "canteen":
      return "餐饮";
    case "dorm":
      return "宿舍";
    default:
      return "楼宇";
  }
}

export function collectPlaces(
  data: SceneData,
  meshByName: Map<string, THREE.Mesh>,
): PlaceEntry[] {
  const entries: PlaceEntry[] = [];
  // 有名字的楼（同名取第一个 mesh）
  for (const [name, mesh] of meshByName) {
    const d = mesh.userData as {
      style: string;
      height: number;
      area: number;
      cx: number;
      cy: number;
    };
    const radius = Math.sqrt(d.area / Math.PI);
    entries.push({
      name,
      kind: "building",
      group: groupOfStyle(d.style),
      num: "",
      target: new THREE.Vector3(d.cx, d.height / 2, d.cy),
      distance: Math.max(150, radius * 3.4),
      mesh,
    });
  }
  for (const w of data.water) {
    if (!w.name || w.inside === false) continue;
    const [cx, cy] = bboxCenter(w.outers[0]);
    let r = 0;
    for (const [x, y] of w.outers[0]) r = Math.max(r, Math.hypot(x - cx, y - cy));
    entries.push({
      name: w.name,
      kind: "water",
      group: "湖泊",
      num: "",
      target: new THREE.Vector3(cx, 0, -cy),
      distance: Math.max(260, r * 2.6),
    });
  }
  for (const g of data.gates) {
    entries.push({
      name: g.name,
      kind: "gate",
      group: "校门",
      num: "",
      target: new THREE.Vector3(g.x, 0, -g.y),
      distance: 320,
    });
  }

  for(const [name,area]of [['田径场',sportsSiteAreas(data.green)[0]],['室外球场区',data.green.find(a=>a.id===1057528491)]] as const) {
    const f=area&&sportsFrame(area.outers[0]);if(!f)continue;
    entries.push({name,kind:'sports',group:'运动',num:'',target:new THREE.Vector3(f.cx,0,-f.cy),
      distance:300,extent:{width:f.width,length:f.length}});
  }
  // 优先展示重点地标，再按中文序排列，编号仍连续。
  const out: PlaceEntry[] = [];
  let num = 1;
  for (const group of GROUP_ORDER) {
    const inGroup = entries
      .filter((e) => e.group === group)
      .sort((a, b) => ((FEATURED.indexOf(a.name)+1||99)-(FEATURED.indexOf(b.name)+1||99))||a.name.localeCompare(b.name, "zh-Hans-CN"));
    for (const e of inGroup) {
      e.num = String(num).padStart(2, "0");
      num += 1;
      out.push(e);
    }
  }
  return out;
}

export interface PlacesPanel {
  setActive: (name: string | null) => void;
}

export function initPlacesPanel(
  container: HTMLElement,
  entries: PlaceEntry[],
  onSelect: (entry: PlaceEntry) => void,
): PlacesPanel {
  container.innerHTML = "";
  const rowsByName = new Map<string, HTMLButtonElement[]>();

  for (const group of GROUP_ORDER) {
    const inGroup = entries.filter((e) => e.group === group);
    if (!inGroup.length) continue;
    const wrap = document.createElement("div");
    wrap.className = "place-group";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "pg-head";
    head.innerHTML = `${group}<span class="cnt">${inGroup.length}</span>`;
    head.addEventListener("click", () => {
      wrap.classList.toggle("folded");
    });
    wrap.appendChild(head);

    const body = document.createElement("div");
    body.className = "pg-body";
    for (const e of inGroup) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "place";
      row.innerHTML =
        `<span class="num">${e.num}</span>` +
        `<span class="nm">${e.name}</span>` +
        `<span class="badge">${e.kind === "water" ? "湖" : e.kind === "gate" ? "门" : ""}</span>` +
        `<span class="chev">›</span>`;
      row.addEventListener("click", () => {
        for (const r of rowsByName.values()) for (const x of r) x.classList.remove("active");
        const list = rowsByName.get(e.name) ?? [];
        for (const x of list) x.classList.add("active");
        onSelect(e);
      });
      if (!rowsByName.has(e.name)) rowsByName.set(e.name, []);
      rowsByName.get(e.name)!.push(row);
      body.appendChild(row);
    }
    wrap.appendChild(body);
    container.appendChild(wrap);
  }

  return {
    setActive(name: string | null): void {
      for (const r of rowsByName.values()) for (const x of r) x.classList.remove("active");
      if (!name) return;
      for (const x of rowsByName.get(name) ?? []) x.classList.add("active");
    },
  };
}
