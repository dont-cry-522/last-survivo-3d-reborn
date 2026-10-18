# 异境回响 · REBORN 开发副本

本仓库从 `dont-cry-522/last-survivo-3d-next` 当前本地工作区完整复制，含尚未提交的改动和本地模型；来源见 `docs/COPY_SOURCE.md`。

- 当前开发目标为本仓库；origin 必须是 `https://github.com/dont-cry-522/last-survivo-3d-reborn.git`。
- 保留 NEXT 与更早的原版仓库，不向它们提交或推送本仓库修改。
- 启动和玩法见 README.md。没有明确新需求时，不擅自改变游戏机制或数值。
- REBORN 使用独立的存档、设置及角色资源缓存键；离线缓存与 PWA 作用域按站点目录隔离。不要清理其他版本的浏览器数据。
- 保留手机横竖屏、触控、第一/第三人称、离线能力以及已有玩法。
- 资源变更后运行 `npm run offline:build`、受影响测试和 `npm run offline:check`；完整回归使用 `npm test`。
- 保留制作源 GLB 与运行时哈希 GLB。不要把工作区的 `outputs/`、`undefined/`、凭据或临时日志加入本仓库。
