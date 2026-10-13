# 重庆大学虎溪校区 3D 地图（huxi-3d-map）

对标 [gxu-campus-3d](https://github.com/wcqqq1214/gxu-campus-3d) 风格的虎溪校区可旋转三维地图。
纯本地项目，不公开部署。数据来自 OpenStreetMap（© OpenStreetMap 贡献者，ODbL）。

## 快速开始

```bash
npm install
npm run dev        # 打开终端提示的 http://localhost:5188/
```

操作：左键拖拽旋转 · 滚轮缩放 · 右键平移。

## 数据管线（已固化，无需重跑）

```bash
py scripts/fetch_osm.py         # 拉取 OSM 快照（多数据源兜底）→ data/snapshots/
py scripts/build_scene_data.py  # 快照 → public/data/scene.json（局部米制坐标）
```

快照已进 git，日常开发直接 `npm run dev`。

## 当前进度

- [x] **M1** 数据管线 + 可旋转白模（321 楼 / 531 路 / 14 水面 / 128 绿地）
- [ ] **M2** 点击楼栋信息卡、搜索定位、镜头飞行、楼名标注、高度人工校准（height_overrides）
- [ ] **M3** 材质光照打磨、树木补植、昼夜切换
- [ ] **M4** 手机适配、性能验证
- [ ] **M5+** 标志楼 Blender 精模、自动巡游

架构详情见 `docs/架构备忘.md`，数据来源记录见 `data/sources.json`。
