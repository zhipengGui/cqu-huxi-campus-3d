/** scene.json 类型定义（由 scripts/build_scene_data.py 生成） */

export interface SceneMeta {
  origin: [number, number];
  bbox: [number, number, number, number];
  source: string;
  snapshotTakenAt: string;
  generatedAt: string;
  note: string;
}

export interface Building {
  id: number | string;
  name: string;
  type: string;
  height: number;
  heightSource: "tag:height" | "tag:levels" | "default";
  area: number;
  polygon: [number, number][];
  holes: [number, number][][];
}

export interface Road {
  id: number;
  kind: string;
  name: string;
  width: number;
  pts: [number, number][];
}

export interface Area {
  id: number | string;
  name: string;
  kind?: string;
  outers: [number, number][][];
  inners: [number, number][][];
}

export interface SceneData {
  meta: SceneMeta;
  buildings: Building[];
  roads: Road[];
  water: Area[];
  green: Area[];
  trees: [number, number][];
}
