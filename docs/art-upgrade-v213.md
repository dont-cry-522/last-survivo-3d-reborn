# v213 免费美术工具与环境资源记录

本记录区分工具安装验证、资源加工结果和游戏运行验证。模型下载或 Blender 导出成功本身不代表游戏中的画面、帧率和手感已经验收。

## 已验证工具链

- 复用工作区已有 **Blender 4.5.9 LTS**，没有重复下载或安装 Blender。`blender.exe` 的 Windows Authenticode 签名验证有效，签署方为 Blender Foundation。官方校验文件下载返回 HTTP 403，未重新验证原有 ZIP 的 SHA256。
- 复用 **Python 3.12.10、uv 0.12.10、uvx 0.12.10**。
- 按[社区项目官方安装说明](https://github.com/ahujasid/mcp-for-blender)，安装并固定 **mcp-for-blender 2.1.9**。从 PyPI 下载的 wheel SHA256 与官方分发元数据一致：`a5cbc6cf316fa7433566eb505a0c26ca22e28c10083bd1b09a23d9e357821ccc`。这是社区 MIT 工具，不是 Blender Foundation 官方插件。
- Blender 插件已启用，遥测同意项设为关闭，MCP 进程也设置了 `BLENDER_MCP_DISABLE_TELEMETRY=1`。未调用付费生成、积分服务、外部模型生成 API，也未上传项目或本地资产。
- 修改 Codex 配置前保存备份；解析比对确认原配置条目和值均保留，仅增加 `blender` 服务。配置使用现有 `uvx.exe` 和 Python 的绝对路径，避免 GUI 环境找不到命令。

实际运行结果：

| 检查 | 已取得结果 |
| --- | --- |
| Blender 后台创建模型、导出 GLB | 成功，测试 GLB 为 14,628 字节 |
| 后台 Cycles 渲染 | 400 × 400 图像成功生成并目视检查 |
| MCP 初始化和工具列表 | 本地标准输入输出客户端成功连接，列出 9 个工具 |
| MCP 读取场景 | 成功读取测试对象名称、类型、位置和尺寸 |
| MCP 执行建模代码、导出 GLB | 成功旋转测试模型并导出 14,684 字节 GLB |
| GLB 文件结构 | 两份测试文件均为有效 glTF 2.0 二进制，缓冲区内嵌 |

官方插件明确不支持通过 `blender -b` 启动其 socket 服务，因此 MCP 测试使用隐藏窗口启动的 Blender 和仅连接本机的协议客户端。测试客户端及 Blender 测试进程已关闭；没有新增 Windows 开机自启服务。当前 Codex 对话未热加载 Blender 工具，之后需要完整重启 Codex 并打开已启用插件的 Blender，才能直接使用新工具。**本轮资源制作使用已验证的 Blender 后台 CLI，不需要等待重启。**

工具链测试资产只用于验证，不进入正式游戏。完整本地证据位于工作区 `outputs/art-upgrade-v213/toolchain/`，包括 `toolchain-report.json`、协议结果、测试 GLB 和渲染图；配置备份留在该目录，不包含在游戏分发中。

## 真正的环境模型资源

来源与许可在 2026-10-18 核验，正式运行资源均放在 `assets/environment/models/`。完整原始 URL、作者、哈希和加工参数见同目录 `sources.json`，人类可读登记见 [THIRD_PARTY_ASSETS.md](../THIRD_PARTY_ASSETS.md)。

| 运行模型 | 来源、作者 | 原始三角形 | 三个 LOD 三角形 | GLB 字节 |
| --- | --- | --- | --- | --- |
| `weathered-rock-a.glb` | [Rock 07](https://polyhaven.com/a/rock_07)，Jenelle van Heerden | 14,844 | 1,800 / 700 / 179 | 252,188 |
| `weathered-rock-b.glb` | [Rock 09](https://polyhaven.com/a/rock_09)，Jenelle van Heerden | 12,416 | 1,800 / 699 / 180 | 250,108 |
| `old-stump.glb` | [Tree Stump 02](https://polyhaven.com/a/tree_stump_02)，Rob Tuytel | 62,345 | 1,800 / 700 / 180 | 384,536 |

三项均采用 [Poly Haven CC0](https://polyhaven.com/license)。保留 `LICENSE.txt` 和原始 `CC0-1.0.txt`，无需账号、购买或运行时联网。原始下载是 glTF/bin/1K JPG，没有执行下载的 Blender 工程或脚本。

加工保持原模型的结构与 UV，统一地面原点、Y 向上和约为 1 的水平半径，平滑法线并生成三个独立简化网格。简化后顶点位置会有轻微变化，当前最大水平半径约 1.01779，并非精确的单位碰撞体。每个 GLB 仅一个 PBR 材质，包含 512 像素的颜色、OpenGL 法线和 ARM 贴图。岩石颜色降低饱和度以融入现有风格；粗糙度重映射为 `0.62 + 0.38 × 原值`，AO 强度 0.65，法线强度 0.75。总 GLB 体积 **886,832 字节，约 0.85 MiB**。这些是加工后的交付模型，不是原始模型全分辨率直装。

每份 GLB 的三个 LOD 位于同一原点，运行时必须只显示其中一级。地形和碰撞的真实范围仍由已有世界数据决定；不能按下载模型重新扩张碰撞或修改战斗数值。

## 可复现与离线交付

在仓库运行：

```text
python scripts/prepare-environment-assets.py --blender "/path/to/blender"
```

实际可用 Blender 位于工作区 `tools/character-work/blender-4.5.9-windows-x64/blender.exe`。原始资源、官方 API 元数据、许可页面和下载清单保存在工作区 `outputs/art-upgrade-v213/sources/environment/`，不进入运行目录。

离线构建明确收录以下六个文件，既用于服务工作线程缓存，也用于完整下载包：

- `assets/environment/models/weathered-rock-a.glb`
- `assets/environment/models/weathered-rock-b.glb`
- `assets/environment/models/old-stump.glb`
- `assets/environment/models/sources.json`
- `assets/environment/models/LICENSE.txt`
- `assets/environment/models/CC0-1.0.txt`

新增 `tests/environment-offline.test.js` 在独立临时目录执行真实构建：验证六项文件及其内容哈希进入缓存和下载清单；源码 ZIP、Blender 工程及未选用 GLB 不会混入；模型内容变化会使旧离线清单失效。该检查已通过，不会改写开发中的仓库构建结果。

## 游戏接入与最终验收记录

本轮已实际接入现有游戏，版本为 **本地 v213**，没有提交、推送或发布到 GitHub。原版目录未修改。

### 实际视觉变化

- 森林：替换已有景观簇中的岩石，并在部分簇加入低矮腐木根盘，保留树木、植物及通行空间。腐木不是高树桩。
- 雪地：岩石保留纹理和法线，上朝表面增加积雪覆盖，避免将整块岩石简单染白。
- 灰烬：不规则暗色岩石代替原石块，保留焦木、火山地表和危险标记。
- 沙漠：使用暖色风化岩石，保留原有沙地、枯木和地标轮廓。
- 海港：用冷灰礁石替换原海岸石块，调整底部贴地，保留原顶部、宽度和碰撞数据，木设施及船只不变。
- 五境大远征中的五个对应区域同步替换；大厅和对局使用相同接入流程。每个模型加载失败时保留相应的原景观，不影响进入游戏。
- 獾兽伙伴：用连续身体轮廓、短口鼻、贴头耳部、有关节的腿及单条弯曲尾部替换主要拼接结构；增加身体表面毛流。仍使用原跟随、攻击、游泳、受伤和复活状态，不修改数值。

七位英雄已使用现有的本地骨骼 GLB，本轮保留骨架、手持挂点和动画。没有宣称完成所有英雄、17 种武器、45 类敌人和 15 位首领的全量重建。Blender 工具链验证的两个小模型仅为独立测试资产，未混入游戏资源。

### 性能措施和实际对照

新增环境资源仅加载一次，几何体与贴图跨场景复用。同模型和生物群系按 `InstancedMesh` 合批，三档 LOD 每实例只显示一级。桌面切换距离为 10 / 30 米，手机为 7.5 / 22.5 米；更远处继续保留低面轮廓。移动超过 0.5 米才检查 LOD，只有档位变化时上传矩阵。场景退出时释放自己的实例缓冲和材质，共享资源保留供下次使用。测试确认相同机位重复渲染不持续增加几何体或贴图。

獾兽模型：**41 → 20 个网格、29,752 → 11,408 个三角形、16 → 5 个材质**。新增三份环境 GLB 共 0.85 MiB，使用九张内嵌 512 像素贴图。环境升级增加了部分近景三角形及常驻纹理；合批减少了部分场景的绘制调用，并非所有视角的渲染成本都下降。

以下来自同一台电脑、同一浏览器、固定种子 522、1180 × 720 第一人称机位；绘制像素数相同，读取稳定帧的渲染器统计。它们是场景复杂度对照，**不是 FPS 基准**。

| 机位 | Draw calls 原 → 新 | 三角形 原 → 新 |
| --- | --- | --- |
| 森林 | 176 → 183 | 594,511 → 609,943 |
| 雪地 | 140 → 140 | 290,821 → 305,822 |
| 灰烬 | 204 → 206 | 297,089 → 312,069 |
| 沙漠 | 159 → 161 | 310,556 → 320,960 |
| 海港 | 109 → 99 | 308,971 → 322,677 |
| 五境·森林 | 782 → 766 | 783,742 → 786,792 |
| 五境·雪地 | 926 → 883 | 908,700 → 902,693 |
| 五境·灰烬 | 907 → 870 | 932,909 → 929,360 |
| 五境·沙漠 | 160 → 162 | 265,410 → 272,096 |
| 五境·海港 | 98 → 100 | 214,170 → 222,507 |

### 执行过的验证

- `npm test`：**1,232 / 1,232 通过**。在最后的岩石色调与海岸贴地修正后，重新运行受影响的环境模型和獾兽测试，**10 / 10 通过**。
- 实际浏览器完整回归：**39 项通过**，包括六张地图各三次大厅/战斗切换、七名英雄、动态水面、暂停、重开、资源释放、2560 / 3840 大屏像素预算，以及手机横竖屏模拟；错误日志为空。
- 五张独立地图与五境五区 × 第一/第三人称：桌面 **20 / 20**，手机横屏尺寸模拟 **20 / 20**。最终新资产接入检查 **10 / 10**。
- 保存五张地图相同机位、相同游戏时间的新旧画面对照，检查岩石底部、雪覆盖和各地配色。修正发现的重复深色染色及海港礁石底部悬浮问题。
- 獾兽实际 Three.js 预览检查站立、移动、扑咬、游泳、倒地和复活；保留原状态驱动，并以 Blender 渲染保存实际几何体前后对照。
- 实际林地桌面、海港手机竖屏场景分别生成五种普通敌人和首领，各推进 540 帧正常 AI；怪物移动、首领移动和姿态矩阵检查通过。测试玩家无敌且不自动攻击，此项不能作为难度或伤害平衡验证。
- `npm run offline:build` 和 `npm run offline:check`：通过，build **213-ed2f030bd27a**。缓存 298 资源，下载清单 299 项。
- 完整离线 ZIP：**300 文件、25,297,952 字节（24.13 MiB）**，包含清单本身；CRC、文件大小及 SHA256 逐项验证通过。ZIP SHA256：`51b6e52a2118c2ad3dfd2943be57e656f68ae9326b204e9c1948188782c5cb79`。
- `git diff --check`：通过。大量其他 JS 的差异只来自离线构建统一更新 `?v=213`，不是重做战斗系统。

证据保存于工作区 `outputs/art-upgrade-v213/`：`tests-final.txt`、`tests-material-correction.txt`、`browser-full-final.json`、`after-desktop-final.json`、`after-mobile.json`、`asset-check-final.json`、`battle-mobile-final.txt`、`offline-package-validation.json` 和五组 `*-before.png` / `*-after.png`。獾兽 Blender 对照位于 `outputs/art-v213/badger-before-after.png`。

### 主要文件与体验方式

- `environment-assets.js`：本地 GLB 加载、失败回退、生物群系材质、实例化 LOD、资源生命周期。
- `environment-clusters.js`、`main.js`：已有景观标签、场景建立/销毁及镜头距离更新。
- `beast-model.js`、`badger-surface.js`、`creature-anatomy.js`、`creature-surface.js`：獾兽形体、关节和表面。
- `assets/environment/models/`、`scripts/prepare-environment-assets.py`：实际模型、许可和转换流程。
- `scripts/build-offline.mjs`、`offline-package.json`、`sw.js`：离线收录；新增环境/獾兽测试及浏览器验收页面。

从 NEXT 目录启动 `python -m http.server 8897`，打开 `http://localhost:8897/play.html?v=213`。若端口被占用，改用其他空闲端口。分别选择五张地图或五境大远征查看环境；选择铃芽查看獾兽伙伴。完整 ZIP 位于工作区 `outputs/异境回响-v213-离线完整包.zip`，解压后使用包内启动说明，不要直接以 `file://` 打开模块页面。

### 仍然存在的边界

本轮改善的是选定环境模型与伙伴，整体仍是风格化游戏，不等于所有生物或场景已经达到写实品质。没有测得可信的真实手机 FPS、跨浏览器 FPS、显存占用或冷启动耗时对照；不承诺桌面稳定 60 FPS 或手机稳定 30 FPS。尺寸模拟不是真机测试；离线资源完整性检查也不等于所有手机上的断网冷启动已验证。

试玩本地游戏不需要重启 Codex，也不需要打开 Blender。只有后续想在 Codex 直接调用新 Blender MCP 工具时，才需要完整重启 Codex、打开 Blender 并启动插件连接。本轮 CLI 制作和本地 MCP 协议连接已经实际验证。
