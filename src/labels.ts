import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/** 楼名/湖名标注层：CSS2D 渲染，按相机距离做 LOD 显隐。 */

interface Entry {
  obj: CSS2DObject;
  pos: THREE.Vector3;
  limit: number;
}

export class LabelLayer {
  readonly renderer: CSS2DRenderer;
  /** 标注对象的场景挂载点（需加入 scene） */
  readonly root = new THREE.Group();
  private entries: Entry[] = [];
  enabled = true;

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
    opts?: { cls?: string; onClick?: () => void },
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
    this.entries.push({ obj, pos, limit });
  }

  update(camera: THREE.Camera): void {
    for (const e of this.entries) {
      e.obj.visible = this.enabled && camera.position.distanceTo(e.pos) < e.limit;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }
}
