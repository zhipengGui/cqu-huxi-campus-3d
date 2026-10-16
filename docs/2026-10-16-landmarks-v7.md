# 虎溪地标与整体优化实施清单

已批准方案：8 栋建筑和北、东、西三门；地标用 Blender GLB，普通建筑保留 TypeScript 生成。综合楼、一教、信息楼优先。基线 b447e0b，开发分支 feat/huxi-landmarks-v7，发布须用户最终验收。

- [ ] M1 资料与体量：稳定 ID、照片来源、估算边界、院落、楼高与原点约定。
- [ ] M2 综合楼：石材墙、实体深窗、柱廊、下沉庭院和水池，远近两档 GLB、可编辑 blend。
- [ ] M3 一教和信息楼：五层楼翼与连廊；白框架、退后玻璃、穿孔屏、内庭院；接入检验。
- [ ] M4 整体优化：模型锚点、全景与地标取景、材质光影、标签避让和详情资料。
- [ ] M5 其余地标：图书馆、理科楼、体育馆、活动中心、工科楼和三门校准；缺照片处明确示意。
- [ ] M6 浏览器与性能：桌面/手机截图、搜索/拾取/巡游/图层/导航、模型预算、构建与独立复核。

## 约束与接口

模型坐标使用局部东/北/上米制，原点严格为 OSM 外轮廓包围盒中心，不旋转原有方位。GLB 导出转换为 Y-up；前端只平移到 (cx,0,-cy)。庭院屋面必须真正留洞，接地面高于地图地面。官方尺寸、照片估算与未知项分别记录。first teaching=13986652；info=14566184；zonghe=14628790。

模型配置 data/landmark_details.json；生成器 scripts/blender/build_priority.py；几何约束 scripts/landmark_geometry.py；实际导出校验 scripts/check_landmarks.py。每个 GLB 的高度、洞区、三角形数和文件大小均检测，不能仅凭 Blender 截图判定浏览器效果。

## 验证与检查重点

1. 先运行 scripts/test_landmark_geometry.py，观察新约束失败；实现几何后通过。
2. 每个模型导出后检查院落屋面无覆盖、世界坐标正确、无退化面、近远档位置一致。
3. 前端改变后运行 tsc --noEmit 与 vite build；在浏览器实看最终 GLB。
4. 加载失败保留回退建筑；低画质不请求近景；移动侧栏不遮主体。
5. 原有 v6 的跑道标线、植被、水面、搜索及步行路网保持可用。

## 来源

- https://www.cqu.edu.cn/zjzd/gyzd/jz_db.htm （综合楼与信息楼官方实拍）
- https://huxi.cqu.edu.cn/info/1043/1271.htm （教学资源；部分请求受 412 防护限制）
- https://jjc.cqu.edu.cn/info/1157/3571.htm （一教五层；总高度未知）
- https://youth.cqu.edu.cn/info/1007/1929.htm （一教相互贯通的楼栋）
- https://m.thepaper.cn/baijiahao_20117818 （重庆大学账号；信息楼穿孔铝板）
- https://news.cqu.edu.cn/archives/news2/content/2021/10/12/39a7c73e31b7464db56e4f69b66bc1ada2aba991.html （连廊跨度36m，桁架高9.4m；不是整栋高度）

## 执行记录

Ruling: 使用当前项目的新开发分支与工作区内暂存副本施工，不另建 worktree；主项目同步与构建使用经授权的目录写权限。保留 main 及其 12 个现有提交。
Ruling: 用户已明确批准方案并要求连续按里程碑汇报，实施清单落实已批准方案，不增加重复审批。
Ruling: 一教、综合楼、信息楼高度在得到确实数据前保留现有推算值，细模反映的是有参考支持的空间特征，不宣称测绘精度。
