# 新方向开发副本

2026-10-18 按用户要求，从本地 `work/last-survivo-3d-next` 复制至 `work/last-survivo-3d-reborn`。

- 新仓库：<https://github.com/dont-cry-522/last-survivo-3d-reborn>
- 来源仓库：<https://github.com/dont-cry-522/last-survivo-3d-next>
- 来源已有提交：`76f3e4f95d534d67542fe3f33edc4088b63a8be7`，保留完整历史。
- **实际复制的是该提交加上当前全部未提交内容**，不是回退到该提交。复制前逐文件校验 750 个项目文件，合计 87,671,589 bytes（不含 `.git`）。
- 当前页面版本保留 v216；同时包含正在制作中的 v217 铃芽衣装、材质和阴影改动。它们作为当前工作快照保存，不代表 v217 美术升级已经全部完成。
- 七位英雄、武器、地图、游戏机制和离线资源完整保留。12 个原来被忽略的 v215 制作 GLB 也纳入版本控制，以保留测试及再制作依据。
- 新副本仅调整仓库入口、存档/设置/角色缓存命名空间及离线清单。不会自动导入或修改 NEXT 的玩家数据。
- 建模脚本一并保存；部分 Blender 脚本还使用原本地工作区 `outputs/character-v215`、`v216`、`v217/rest` 的制作快照。这些工作区输出未作为游戏资源上传，运行游戏和自动测试不依赖它们。

## 本地启动

在仓库根目录运行 `python -m http.server 8938`，打开 <http://127.0.0.1:8938/play.html>。
不要直接双击 HTML。也可以使用已有离线启动器。

## 资源与回归检查

```sh
npm run offline:build
npm run offline:check
npm test
```

本次复制不继续制作新模型、不调整玩法数值，接下来的开发方向由用户另行指定。
