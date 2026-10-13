import * as THREE from "three";
import type { BuildingUserData } from "./interact";

/** 搜索：楼名/湖名子串匹配，回车选第一条。 */

export interface SearchItem {
  name: string;
  kind: "building" | "water";
  target: THREE.Vector3;
  distance: number; // 建议的落点距离
  mesh?: THREE.Mesh;
}

export function initSearch(
  input: HTMLInputElement,
  listEl: HTMLElement,
  items: SearchItem[],
  onSelect: (item: SearchItem) => void,
): void {
  let current: SearchItem[] = [];

  const hide = (): void => {
    listEl.classList.remove("open");
    current = [];
  };

  const render = (): void => {
    listEl.innerHTML = "";
    for (const [i, it] of current.entries()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestion";
      btn.innerHTML = `<span class="tag">${it.kind === "water" ? "湖" : "楼"}</span>${it.name}`;
      btn.addEventListener("pointerdown", (e) => e.preventDefault()); // 防止输入框失焦抢点击
      btn.addEventListener("click", () => {
        hide();
        input.blur();
        onSelect(it);
      });
      if (i === 0) btn.classList.add("first");
      listEl.appendChild(btn);
    }
    listEl.classList.toggle("open", current.length > 0);
  };

  const query = (): void => {
    const q = input.value.trim();
    if (!q) {
      hide();
      return;
    }
    const matched = items.filter((it) => it.name.includes(q));
    matched.sort((a, b) => {
      const sa = a.name.startsWith(q) ? 0 : 1;
      const sb = b.name.startsWith(q) ? 0 : 1;
      return sa - sb || a.name.length - b.name.length;
    });
    current = matched.slice(0, 8);
    render();
  };

  input.addEventListener("input", query);
  input.addEventListener("focus", query);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && current.length) {
      const it = current[0];
      hide();
      input.blur();
      onSelect(it);
    } else if (e.key === "Escape") {
      hide();
      input.blur();
    }
  });
  input.addEventListener("blur", () => setTimeout(hide, 120));
}

/** 从楼栋网格构造搜索条目 */
export function buildingSearchItem(mesh: THREE.Mesh): SearchItem {
  const d = mesh.userData as BuildingUserData;
  const radius = Math.sqrt(d.area / Math.PI);
  return {
    name: d.name,
    kind: "building",
    target: new THREE.Vector3(d.cx, d.height / 2, d.cy),
    distance: Math.max(150, radius * 3.4),
    mesh,
  };
}
