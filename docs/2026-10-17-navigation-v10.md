# 虎溪导航与步行升级实施计划 / 账本

计划依据：用户已批准桌面《虎溪校园3D导航系统升级指导报告.md》，推荐第一批 M15–M17；基线 e8384ba，分支 feat/huxi-navigation-v10。使用 executing-plans 在本会话逐项实现，末尾一次独立整分支复核。

## 全局约束

- 现有 Three.js 0.170 / TS / Vite，不引入 React、动画或物理引擎依赖；模型与现有原始路网不改。
- M15 路径计算与入口接入；M16 导航操作；M17 桌面第一人称与基础碰撞。GPS、自动跟随、室内、手机自由步行属于后续批次。
- 入口未获现场证据，一律“附近道路”，不能把楼中心或模型门洞标成已核实入口。
- 操作原有搜索、地标、图层、昼夜、巡游、分享、导出及手机兼容；只本地候选分支验收，不自动推送新功能。

## 任务及接口

### M15 纯路径计算与接入

文件：新增 src/routing.ts（RoadRouter、RoadSnap、RoadRoute），data/entrances.json、src/accessPoints.ts；修改 src/navigation.ts；新增 scripts/test_navigation.mts。

接口：RoadRouter(graph).snap(x,north,maxDist) 返回 {edge,t,offsetMeters}|null；point(snap) 返回 [east,north]；route(start,end) 返回 {points,nodes,edges,distanceMeters}|null。Navigator 继续保留 clickGround/setEndBuilding 供旧界面调用。

- [ ] 对当前回溯结果写转角及终点代价失败测试，实际运行 RED。
- [ ] 新纯计算器使用临时起终点、同边直连、完整回溯；A* 启发式按边长下界缩放，Dijkstra 对照。
- [ ] 改为沿原折线绘制，距离取完整图路径；清理释放路线材质/几何。
- [ ] 配置八地标三校门的未核实接近点，验证落在路网、55 组可达、原图不变。
- [ ] test_navigation + 既有六组 TS + tsc 通过，提交并汇报。

### M16 导航界面

文件：src/navigation.ts、src/navigationPanel.ts（按需要拆分）、src/main.ts、index.html；scripts/qa_navigation.mjs。

接口：Navigator setStart/setEnd、clearRoute、swap、route/result 与端点标签；UI 支持地点选择与地图选点，详情“导航到这里”，已有点击导航保留。

- [ ] 浏览器验证新起终点/交换/详情入口在基线失败。
- [ ] 接入起终点选择、交换、开始、清除、退出、完整路线提示；手机可操作。
- [ ] 不可达/太近/缺端点有明确提示，切换模式不抢相机。
- [ ] 浏览器专项 + 算法回归 + build 通过，提交并汇报。

### M17 桌面步行

文件：src/walking.ts、src/walkCollision.ts、src/main.ts、index.html；scripts/test_walking.mts 和浏览器专项。

接口：纯平面碰撞 step(position,delta,radius)；步行控制 enter/exit/update，PointerLockControls 使用已有 camera；main 按 orbit/walk 只更新一个控制器。

- [ ] 建筑/水面/边界、斜向移动、院落洞、长步长等纯几何测试 RED→GREEN。
- [ ] 保存恢复相机位置/四元数/目标/投影和 view offset；进入取消飞行/巡游/导航，固定已确认道路出生点。
- [ ] 眼高1.65m、步速1.4m/s、半径0.3m为体验初值；限制后台恢复步长，按实际移动方向碰撞。
- [ ] Esc/失焦/锁定失败/resize/搜索及返回全景可恢复；手机保留地图，明确桌面入口。
- [ ] 全部单测、完整旧浏览器回归、生产子路径检查、独立分支复核，修复重要项后提交与汇报。

## 复核关注

1. 同边反向、零长边、边权取整、断图；不能切角或返回错误最短路。
2. 未核实入口、湖泊与远处地图点；不能伪装真实入口或无条件穿越障碍。
3. Pointer Lock 失败、失焦与连续切换；相机和按键必须可恢复。
4. 已有侧栏 view offset、resize、巡游与分享；不能与步行抢相机或留下近裁面。
5. 穿模、院落洞、门洞未知与水边；碰撞必须匹配已声明的简化范围，不承诺室内/真实坡道。

## Rulings 与证据

Ruling: 已批准报告同时明确了目标、文件职责、顺序和验收条件，本账本细化执行，不再重复同一方案审批；代价是发现范围变化时仍需重新说明。
Ruling: 创建 C 盘独立 git worktree 并复用 node_modules，保留 D 盘 main 和服务器；这是可逆开发隔离，用户已有执行授权，不重复询问工作区许可。
Ruling: 使用 Python/Node 和原生 PowerShell 维护 Windows 账本，不增加 shell 工作流依赖。每项提交前实际运行验证，代价是脚本化记账由本会话承担。
Ruling: 入口资料不足时按报告保留附近道路，先完成可验证计算，不猜测门口或连接穿楼通道；代价是导航到接近点而非楼门。

Pre-flight: M15→M16 的纯路线与端点坐标统一为 east/north，渲染映射 z=-north；M16→M17 的地图点击、动画、选择与相机模式必须互斥。数据来源和原图保持只读。

M15 complete: 真实 Navigator 转角反例先失败（208m）后通过（260m）；终点代价反例选择约111m而非161m。1,000 次独立 Floyd-Warshall 对照、反向/同边/断图/无效输入/原图不可变、11个未核实接近点及55组地标/校门路线通过。七组 TS 回归、类型检查及生产构建通过。线路沿原折线合并为一次绘制，无曲线切角。新增入口配置先失败后通过，所有接近点都明确标注“附近道路”。
Ruling: 报告建议 Dijkstra 对照，本轮使用独立 Floyd-Warshall 小图全对作为等价最短路 oracle，避免与实现共用最小堆/启发式；代价是仅在小图随机样本及真实地点组合上验证，不等于穷尽所有输入。
Ruling: 首批不改变源 OSM 导航数据、路权或台阶规则；尚无通行实据时只承诺图上接近点，不宣称真实入口/无障碍路线。后续路权和室内属于单独数据任务。
