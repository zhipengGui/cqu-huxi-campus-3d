# 重庆大学虎溪校区 3D 地图（huxi-3d-map）

对标 [gxu-campus-3d](https://github.com/wcqqq1214/gxu-campus-3d) 风格的虎溪校区可旋转三维地图。
纯本地项目，不公开部署。数据来自 OpenStreetMap（© OpenStreetMap 贡献者，ODbL）。

## 快速开始

```bash
npm install
npm run dev        # 打开终端提示的 http://localhost:5188/
```

操作：左键拖拽旋转 · 滚轮缩放 · 右键平移 · 点击楼栋看信息 · 搜索框查楼/湖 ·
右上角切换 昼/昏/夜 · 「标注」开关楼名湖名。

## 数据管线（已固化，无需重跑）

```bash
py scripts/fetch_osm.py         # 拉取 OSM 快照（多数据源兜底）→ data/snapshots/
py scripts/build_scene_data.py  # 快照 → public/data/scene.json（局部米制坐标）
```

快照已进 git，日常开发直接 `npm run dev`。

### 楼高校准（height_overrides）

`data/height_overrides.json`：

```json
{ "byId": {}, "byName": { "图书馆": { "levels": 8 } } }
```

- `byId` 按 OSM 要素 id 匹配（信息卡可查），`byName` 按楼名匹配（同名楼一起生效）
- 值给 `{"height": 米}` 或 `{"levels": 层数}`（按 3.3m/层换算）
- 改完重跑 `py scripts/build_scene_data.py`，刷新页面生效
- 信息卡"来源"栏会显示该楼高度是 OSM 标注 / 层数推算 / 面积估算 / 人工校准

## 当前进度（M1–M4 完成）

- [x] **M1** 数据管线 + 可旋转白模（321 楼 / 531 路 / 14 水面 / 128 绿地）
- [x] **M2** 点击楼栋信息卡 + hover 高亮、搜索定位、镜头飞行、楼名/湖名标注（距离 LOD）、
      楼高校准机制（height_overrides，已闭环验证）
- [x] **M3** 软阴影、楼栋色微差异、程序化示意树 1120 株（避路避水、颜色错落）、昼/昏/夜三档光照
- [x] **M4** 性能优化（道路合并 + InstancedMesh：62 draw calls / 12 万三角形 / 桌面 240 FPS）、
      手机适配（紧凑面板 + 信息卡底部抽屉 + 触摸手势）
- [ ] **M5+**（可选）标志楼 Blender 精模、自动巡游、精模纹理

架构详情见 `docs/架构备忘.md`，数据来源记录见 `data/sources.json`。

## 已知限制

- 楼高仅 6 栋有 OSM 真实标注，其余为估算——可按上面的校准流程逐栋修正
- 树木为程序化示意分布（OSM 无树点数据），非真实绿化图
- `relation/13986651` 外环不闭合被跳过（个别异形建筑缺失，待排查）
