import * as THREE from "three";
import { currentBaseEmissive } from "./dayNight";

/** 楼栋拾取：hover 高亮 + 点击信息卡。区分"点击"与"拖拽"（位移阈值）。 */

const TYPE_ZH: Record<string, string> = {
  apartments: "公寓 / 宿舍", dormitory: "宿舍", university: "校园建筑", school: "教学楼",
  office: "办公楼", government: "办公楼", hospital: "医疗", retail: "商业", commercial: "商业",
  hotel: "宾馆", service: "服务", warehouse: "仓储", garage: "车库", shed: "棚",
  greenhouse: "温室", house: "住宅", terrace: "住宅",
  sports: "体育设施", stadium: "体育设施", grandstand: "看台", pavilion: "亭 / 附属建筑",
  yes: "建筑",
};

const SRC_ZH: Record<string, string> = {
  "tag:height": "OSM 高度标注",
  "tag:levels": "按 OSM 层数推算",
  default: "按占地面积估算（可在 data/height_overrides.json 校准）",
  override: "人工校准",
};

export interface BuildingUserData {
  id: number | string;
  name: string;
  type: string;
  height: number;
  heightSource: string;
  area: number;
  cx: number;
  cy: number;
}

export interface PickerCallbacks {
  onSelect: (mesh: THREE.Mesh) => void;
  onClear: () => void;
}

const SELECT_EMISSIVE = 0x2a3550;
const HOVER_EMISSIVE = 0x1c2540;

export class BuildingPicker {
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private downPos: [number, number] | null = null;
  private hoverMesh: THREE.Mesh | null = null;
  private selectedMesh: THREE.Mesh | null = null;
  private hoverPending = false;

  constructor(
    private dom: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    private group: THREE.Group,
    private cb: PickerCallbacks,
  ) {
    dom.addEventListener("pointerdown", (e) => {
      this.downPos = [e.clientX, e.clientY];
    });
    dom.addEventListener("pointerup", (e) => {
      const d = this.downPos;
      this.downPos = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 6) this.pick(e.clientX, e.clientY);
    });
    dom.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      this.pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (!this.hoverPending) {
        this.hoverPending = true;
        requestAnimationFrame(() => {
          this.hoverPending = false;
          this.updateHover();
        });
      }
    });
  }

  private setEmissive(mesh: THREE.Mesh, hex: number): void {
    const mat = mesh.material as THREE.MeshLambertMaterial;
    if (mat && mat.emissive) mat.emissive.setHex(hex);
  }

  private restore(mesh: THREE.Mesh): void {
    this.setEmissive(mesh, mesh === this.selectedMesh ? SELECT_EMISSIVE : currentBaseEmissive());
  }

  private cast(ndcX: number, ndcY: number): THREE.Mesh | null {
    this.raycaster.setFromCamera(this.pointerNdc.set(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.group.children, true);
    const hit = hits.find((entry) => {
      let object: THREE.Object3D | null = entry.object;
      while (object) { if (!object.visible) return false; object = object.parent; }
      return true;
    });
    return (hit?.object as THREE.Mesh) ?? null;
  }

  private updateHover(): void {
    const target = this.cast(this.pointerNdc.x, this.pointerNdc.y);
    if (target !== this.hoverMesh) {
      if (this.hoverMesh && this.hoverMesh !== this.selectedMesh) this.restore(this.hoverMesh);
      this.hoverMesh = target;
      if (target && target !== this.selectedMesh) this.setEmissive(target, HOVER_EMISSIVE);
      this.dom.style.cursor = target ? "pointer" : "";
    }
  }

  private pick(clientX: number, clientY: number): void {
    const mesh = this.cast((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    if (mesh === this.selectedMesh) return;
    if (this.selectedMesh) this.restore(this.selectedMesh);
    this.selectedMesh = mesh;
    if (mesh) {
      this.setEmissive(mesh, SELECT_EMISSIVE);
      this.cb.onSelect(mesh);
    } else {
      this.cb.onClear();
    }
  }

  /** 搜索等外部入口直接选中某楼（只高亮，不触发回调——调用方自理界面） */
  select(mesh: THREE.Mesh): void {
    if (this.selectedMesh) this.restore(this.selectedMesh);
    this.selectedMesh = mesh;
    this.setEmissive(mesh, SELECT_EMISSIVE);
  }

  clearSelection(): void {
    if (this.selectedMesh) {
      this.restore(this.selectedMesh);
      this.selectedMesh = null;
    }
    this.cb.onClear();
  }
}

export interface InfoCardEls {
  root: HTMLElement;
  title: HTMLElement;
  type: HTMLElement;
  height: HTMLElement;
  area: HTMLElement;
  src: HTMLElement;
}

export function fillInfoCard(mesh: THREE.Mesh, els: InfoCardEls): void {
  const d = mesh.userData as BuildingUserData;
  els.root.classList.add("open");
  els.title.textContent = d.name || "未命名建筑";
  els.type.textContent = TYPE_ZH[d.type] ?? d.type;
  els.height.textContent = `${d.height} m`;
  els.area.textContent = `${d.area.toLocaleString()} m²`;
  els.src.textContent = SRC_ZH[d.heightSource] ?? d.heightSource;
  els.src.classList.toggle("calibrating", d.heightSource === "default");
}

export function hideInfoCard(els: InfoCardEls): void {
  els.root.classList.remove("open");
}
