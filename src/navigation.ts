import * as THREE from "three";
import type { RoadGraph } from "./types";

/** 步行导航：A* 寻路 + 路线绘制。
 *  图来自管线（节点=道路折线点 0.5m 网格去重，边=相邻点段），起点/终点
 *  通过"吸附到最近路段"接入图（虚拟起终点的多源 A*）。 */

interface Snap {
  a: number; // 边端点索引
  b: number;
  t: number; // 投影位置 0..1
}

class MinHeap {
  private a: [number, number][] = []; // [priority, node]
  push(p: number, v: number): void {
    this.a.push([p, v]);
    let i = this.a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.a[parent][0] <= this.a[i][0]) break;
      [this.a[parent], this.a[i]] = [this.a[i], this.a[parent]];
      i = parent;
    }
  }
  pop(): [number, number] | undefined {
    if (!this.a.length) return undefined;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l][0] < this.a[m][0]) m = l;
        if (r < this.a.length && this.a[r][0] < this.a[m][0]) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
  get size(): number {
    return this.a.length;
  }
}

function markerMesh(color: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(2.4, 2.4, 0.8, 20);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color }));
  m.visible = false;
  m.renderOrder = 5;
  return m;
}

export class Navigator {
  active = false;
  onStatus: (text: string) => void = () => {};
  private adj: Array<Array<{ to: number; len: number }>> = [];
  private nodes: [number, number][] = [];
  private start: Snap | null = null;
  private end: Snap | null = null;
  private hasRoute = false;
  private routeMesh: THREE.Mesh | null = null;
  private readonly markerA: THREE.Mesh;
  private readonly markerB: THREE.Mesh;

  constructor(private scene: THREE.Scene, graph: RoadGraph) {
    this.nodes = graph.nodes;
    this.adj = graph.nodes.map(() => []);
    for (const [a, b, len] of graph.edges) {
      this.adj[a].push({ to: b, len });
      this.adj[b].push({ to: a, len });
    }
    this.markerA = markerMesh(0x2e9e4f);
    this.markerB = markerMesh(0xd23f31);
    scene.add(this.markerA);
    scene.add(this.markerB);
  }

  setActive(v: boolean): void {
    this.active = v;
    if (!v) {
      this.clearRoute();
    }
    this.onStatus(v ? "点击道路或地面设置起点" : "");
  }

  /** 吸附最近路段；maxDist 米内无路返回 null。x/z 为世界坐标。 */
  snap(x: number, z: number, maxDist = 140): Snap | null {
    const wy = -z;
    let best: Snap | null = null;
    let bestD = Infinity;
    for (let i = 0; i < this.adj.length; i++) {
      // 只遍历有邻边的节点对应的边：改为直接遍历邻接表去重太繁，这里遍历节点+首个邻边由 edgeIter 完成
    }
    for (let a = 0; a < this.nodes.length; a++) {
      const [ax, ay] = this.nodes[a];
      for (const { to: b, len } of this.adj[a]) {
        void len;
        if (b < a) continue; // 每条边只处理一次
        const [bx, by] = this.nodes[b];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (!len2) continue;
        let t = ((x - ax) * dx + (wy - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const d = Math.hypot(x - px, wy - py);
        if (d < bestD) {
          bestD = d;
          best = { a, b, t };
        }
      }
    }
    if (!best || bestD > maxDist) return null;
    return best;
  }

  private place(marker: THREE.Mesh, s: Snap): void {
    const [ax, ay] = this.nodes[s.a];
    const [bx, by] = this.nodes[s.b];
    marker.position.set(ax + (bx - ax) * s.t, 0.4, -(ay + (by - ay) * s.t));
    marker.visible = true;
  }

  private snapPoint(s: Snap): THREE.Vector3 {
    const [ax, ay] = this.nodes[s.a];
    const [bx, by] = this.nodes[s.b];
    return new THREE.Vector3(ax + (bx - ax) * s.t, 0.09, -(ay + (by - ay) * s.t));
  }

  /** 地面点击（导航模式下）。x/z 为世界坐标。 */
  clickGround(x: number, z: number): void {
    const s = this.snap(x, z);
    if (!s) {
      this.onStatus("附近没有道路，请点更靠近道路的位置");
      return;
    }
    if (!this.start || this.hasRoute) {
      this.resetRoute();
      this.start = s;
      this.place(this.markerA, s);
      this.onStatus("起点已设：点击楼栋或地面设置终点");
    } else {
      this.end = s;
      this.place(this.markerB, s);
      this.computeRoute();
    }
  }

  /** 楼栋作为终点（世界坐标楼中心） */
  setEndBuilding(cx: number, cz: number): void {
    const s = this.snap(cx, cz, 320);
    if (!s) {
      this.onStatus("该楼附近没有可导航的道路");
      return;
    }
    this.end = s;
    this.place(this.markerB, s);
    this.computeRoute();
  }

  private resetRoute(): void {
    if (this.routeMesh) {
      this.scene.remove(this.routeMesh);
      this.routeMesh.geometry.dispose();
      this.routeMesh = null;
    }
    this.hasRoute = false;
  }

  clearRoute(): void {
    this.resetRoute();
    this.start = null;
    this.end = null;
    this.markerA.visible = false;
    this.markerB.visible = false;
    this.onStatus(this.active ? "点击道路或地面设置起点" : "");
  }

  private computeRoute(): void {
    this.resetRoute();
    if (!this.start || !this.end) return;
    const result = this.astar(this.start, this.end);
    if (!result) {
      this.onStatus("未找到可达路线");
      return;
    }
    const pts = [this.snapPoint(this.start)];
    for (const idx of result.nodes) {
      pts.push(new THREE.Vector3(this.nodes[idx][0], 0.09, -this.nodes[idx][1]));
    }
    pts.push(this.snapPoint(this.end));
    if (pts.length === 2 && pts[0].distanceTo(pts[1]) < 1) {
      this.onStatus("起点和终点太近了");
      return;
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.15);
    const geo = new THREE.TubeGeometry(curve, Math.min(600, Math.max(24, pts.length * 6)), 1.0, 6, false);
    this.routeMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    this.routeMesh.renderOrder = 6;
    this.scene.add(this.routeMesh);
    this.hasRoute = true;
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += pts[i].distanceTo(pts[i - 1]);
    const minutes = Math.max(1, Math.round(dist / 80));
    this.onStatus(`路线 ${Math.round(dist)} m · 步行约 ${minutes} 分钟`);
  }

  /** 多源 A*：起终点各自吸附在边 (a,b) 上，按 t 拆分初始代价 */
  private astar(s: Snap, e: Snap): { nodes: number[] } | null {
    const goals = new Set([e.a, e.b]);
    const [gx1, gy1] = this.nodes[e.a];
    const [gx2, gy2] = this.nodes[e.b];
    const h = (idx: number): number => {
      const [x, y] = this.nodes[idx];
      return Math.min(Math.hypot(x - gx1, y - gy1), Math.hypot(x - gx2, y - gy2));
    };
    const [sa, sb] = this.splitCost(s);
    const dist = new Map<number, number>([[s.a, sa], [s.b, sb]]);
    const prev = new Map<number, number>();
    const heap = new MinHeap();
    heap.push(sa + h(s.a), s.a);
    heap.push(sb + h(s.b), s.b);
    const settled = new Set<number>();
    let goal = -1;
    while (heap.size) {
      const [, u] = heap.pop()!;
      if (settled.has(u)) continue;
      settled.add(u);
      if (goals.has(u)) {
        goal = u;
        break;
      }
      const du = dist.get(u) ?? Infinity;
      for (const { to, len } of this.adj[u]) {
        if (settled.has(to)) continue;
        const nd = du + len;
        if (nd < (dist.get(to) ?? Infinity)) {
          dist.set(to, nd);
          prev.set(to, u);
          heap.push(nd + h(to), to);
        }
      }
    }
    if (goal < 0) return null;
    const chain: number[] = [];
    for (let cur = goal; ; cur = prev.get(cur)!) {
      if (cur === s.a || cur === s.b) break;
      chain.unshift(cur);
      if (!prev.has(cur)) return null;
    }
    return { nodes: chain };
  }

  private splitCost(n: Snap): [number, number] {
    const [ax, ay] = this.nodes[n.a];
    const [bx, by] = this.nodes[n.b];
    const L = Math.hypot(bx - ax, by - ay);
    return [L * n.t, L * (1 - n.t)];
  }
}
