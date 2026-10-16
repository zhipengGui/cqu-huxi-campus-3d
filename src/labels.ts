import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/** 楼名/湖名标注层：CSS2D 渲染，按相机距离做 LOD 显隐。 */

interface Entry {
  obj: CSS2DObject;
  pos: THREE.Vector3;
  limit: number;
  text: string;
  priority: number;
}

export class LabelLayer {
  readonly renderer: CSS2DRenderer;
  /** 标注对象的场景挂载点（需加入 scene） */
  readonly root = new THREE.Group();
  private entries: Entry[] = [];
  enabled = true;
  active = "";
  private lastUpdate = 0;

  constructor(container: HTMLElement) {
    this.renderer = new CSS2DRenderer();
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    this.renderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.renderer.domElement);
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h);
  }

  add(
    text: string,
    pos: THREE.Vector3,
    limit: number,
    opts?: { cls?: string; onClick?: () => void; priority?: number },
  ): void {
    const div = document.createElement("div");
    div.className = "map-label " + (opts?.cls ?? "");
    div.textContent = text;
    if (opts?.onClick) {
      div.style.pointerEvents = "auto";
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onClick!();
      });
    }
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    this.root.add(obj);
    this.entries.push({ obj, pos, limit, text, priority: opts?.priority ?? (opts?.cls === "gate" ? 4 : 2) });
  }

  update(camera: THREE.Camera, target: THREE.Vector3): void {
    const now = performance.now();
    if (now - this.lastUpdate < 90) return;
    this.lastUpdate = now;
    const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
    const panel = document.querySelector("#hud")?.getBoundingClientRect();
    if (panel) occupied.push(panel);
    for(const id of ['#brand','#tools','#nav-panel']){const r=document.querySelector(id)?.getBoundingClientRect();if(r&&r.width)occupied.push(r);}
    const entries = [...this.entries].sort((a,b) =>
      ((b.text === this.active ? 100 : b.priority) - (a.text === this.active ? 100 : a.priority)) ||
      camera.position.distanceTo(a.pos)-camera.position.distanceTo(b.pos));
    let count = 0;
    const overview=camera.position.distanceTo(target)>1700;
    for (const e of entries) {
      e.obj.element.classList.toggle('active',e.text===this.active);
      e.obj.visible = false;
      if (!this.enabled || camera.position.distanceTo(e.pos) >= e.limit) continue;
      if (overview && e.priority<3 && e.text!==this.active) continue;
      const p = e.pos.clone().project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = (p.x+1)*window.innerWidth/2, y = (1-p.y)*window.innerHeight/2;
      const w = Math.max(e.obj.element.offsetWidth, e.text.length*12+18);
      const rect = {left:x-w/2-5, right:x+w/2+5, top:y-16, bottom:y+16};
      if (rect.left < 6 || rect.right > window.innerWidth-65 || rect.top < 6 || rect.bottom > window.innerHeight-20) continue;
      if (occupied.some(r => rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top)) continue;
      if (count >= (window.innerWidth < 640 ? (overview?5:7) : (overview?10:14))) continue;
      occupied.push(rect); count++; e.obj.visible = true;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }
}
