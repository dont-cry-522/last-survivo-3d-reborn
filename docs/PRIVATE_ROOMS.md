# 私人房间：玩法、使用与同步协议

此文件按当前 REBORN 实现说明房间玩法及传输协议。自动化传输测试不等于所有武器手感、手机真机性能或异地网络已经验证；实际验证结果以本轮交付报告为准。

## 从哪里开始

1. **朋友只用浏览器加入的主入口是 `START_ONLINE_ROOM.cmd`**。不要求同一 Wi-Fi，不要求朋友安装 VPN/Tailscale，也不要求注册账号。房主完整解压包后启动，等待 HTTPS 页面与 WSS 对战邀请检查都成功。操作见包根目录 README，或源码的 [开房说明](../packaging/rooms/README.md)。
2. 启动器先监听电脑的 `127.0.0.1` 游戏服务，再启动包内 cloudflared，为该服务建立临时 HTTPS 入口。只接受这次公开入口的精确 Origin，或房主本机服务地址与 Host 的精确配对；本次程序只管理自己创建的子进程，不修改路由器、防火墙、Cloudflare 账号或用户已有配置。服务窗口保持打开，失败不改用局域网。同 Wi-Fi 可另选 `START_PRIVATE_ROOM.cmd`；已有私人组网可自愿选 `START_TAILSCALE_ROOM.cmd`。
3. 房主把启动窗口显示的**房主本机专用网址**复制到电脑浏览器。这条 `127.0.0.1` 地址让资源和对战同步直接连接本机，不绕行公网，也不要发给朋友。载入游戏后点“好友房间”，选择名字、人物、武器和地图，再点“创建私人房间”。
4. 房主点“复制邀请”，自动生成本次 **HTTPS 公网完整链接**，再把它发给朋友。朋友用手机或电脑浏览器打开，点“好友房间”，选择人物和武器后加入。链接会携带本次服务密钥和房间码，不要只发送房间码。
5. 至少两人、最多四人，各自点“准备”；全部准备后由房主点“开始对战”。所有设备载入完成后一起开始，开局后不能中途加入。

朋友使用房主服务提供的同一套游戏资源。不要在公开 GitHub 页面直接连接私人 HTTP 服务，也不要双击包内的 HTML 文件。首次载入仍需要从房主电脑传输资源，并由各自设备准备画面。

## 当前房间玩法

- **玩家互相对战，场上也有怪物和首领（PvPvE）**。怪物是共同世界中的敌人，本轮没有招募怪物为兵种的玩法。
- v228 可选 **8 位英雄、19 种武器**：林地游侠、霜影、影裔、潮行者、铃芽、雾苓、雾苓·蜃影、岚歌；新增雾钟山谷、星辉晶窟。武器仍跟随各自英雄，移动、攻击、闪避、第一/第三人称和手机操作沿用原有方式。旧 v227 包仍是此前七人十七武器；升级房主整包、关闭旧服务后重新启动，再分享新邀请，朋友才会载入新版内容。
- 倒地后等待 **8 秒对局时间**，在出生区域满血复活，保留本局等级、武器路线和已选成长；复活后有 **2 秒伤害保护**。暂停时复活倒计时也暂停。
- 普通地图击败本局 **3 位首领**后结算；五境合流地图平定 **5 个区域首领**后结算。战况分别记录玩家击败数、倒地数和怪物击败数。房主可返回同一房间再开一局，新局重新生成地图与本局成长。
- 有人选择升级或奖励时，**整个房间暂停**；待当前所有选择完成后继续。每个人只能提交自己的选项，由房主验证并应用。
- 打开个人菜单**不暂停战斗，也不提供无敌**。房主切到后台时全房暂停；回到前台后恢复。服务窗口和房主游戏页都必须持续打开。
- 客人离开会移除该玩家；房主退出、断线或主机服务关闭会结束整个房间，**没有房主迁移或本局断线重连**。

离线单机与好友房间是独立入口。原来的离线单机玩法不需要好友房间服务，也不会因为本次联机开发自动变成在线游戏。**旧离线 APK 不会自动获得联机功能**；本次朋友加入方式是从完整邀请链接打开浏览器。不同网址的浏览器存档不会自动互通，不要清除原有站点数据。

## 免费临时 HTTPS 入口

源码运行与包内主入口相同的启动器，可明确指定已经下载的官方 cloudflared 可执行文件：

```text
node packaging/rooms/start-public-room.mjs --cloudflared "C:/path/to/cloudflared.exe" --port 8898
```

`startPublicRoom({cloudflaredPath,port,timeoutMs,onDiagnostic})` 也可供验证脚本调用。它先成功绑定游戏服务，避免把已占用端口的其他程序暴露出去；拿到临时 URL 后调用服务的 `setPublicOrigin` 一次，再请求真实 `play.html` 并用 WSS 完成 `hello → welcome`。全部通过才打印房主本机专用入口，游戏里的“复制邀请”使用服务端确认的公网地址。超时、进程错误、隧道退出、Ctrl+C 或关闭控制台会清理自己创建的服务与子进程；不会终止用户的其他隧道。

启动器只执行绝对路径的 cloudflared，使用 `shell:false`、隐藏子窗口，并传入自己的临时空配置和禁用自动更新参数。不会改写 `~/.cloudflared`，不会安装后台系统服务，邀请密钥不写入文件。诊断回调只供本地测试记录；普通使用失败时显示简短诊断。

隧道默认显式传入 `--protocol http2`，不自动选择 QUIC。2026-10-20 真机验证记录中，QUIC 报 `timeout: no recent network activity` 后多个 GLB/HDR 请求和 WSS 中断；因此改用基于 TCP 的 HTTP/2 降低该网络路径上的 UDP 断流风险。启动验证仍为 90 秒，HTTPS/WSS 和邀请规则不变；此修改不意味着已保证所有网络下不断线。

[Cloudflare 官方 Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 不要求账号或域名，面向临时开发测试；没有 uptime SLA，每条隧道最多 200 个同时处理中的请求，超限返回 429，不支持 SSE。本项目用 WebSocket，不使用 SSE。网址每次启动变化，停止隧道后失效。它不是免费永久云服务器，真实网络延迟、首次资源传输速度与可达性需要实测。

**已完成 Windows 电脑与 Redmi K80 Pro 手机两台真机的跨网对战检查：手机关闭 Wi-Fi 和 VPN，使用蜂窝流量加入；四台真机异地对战尚未验证。** 房主电脑保留原有代理设置，关闭该代理后的公网连通性尚未验证。此记录不代表所有手机网络、四人实战帧率和延迟均已验证。原有宽带或手机套餐费用仍由各自承担。

## 局域网与 Tailscale 备用方式

底层主机命令 `npm run room:host` 默认仅监听本机 `127.0.0.1:8898`。同 Wi-Fi 或已经由管理员确认的私人网络可显式指定本机地址；这个底层命令不执行上述 Tailscale 就绪检查：

```text
npm run room:host -- --host 192.168.1.25 --port 8898
npm run room:host -- --host 100.100.20.30 --port 8898
node packaging/rooms/start-room.mjs --online --port 8898
```

最后一条对应 `START_TAILSCALE_ROOM.cmd`，会执行 `tailscale status --json` 验证 Running、Self.Online 与本机实际 IPv4；不以网卡前缀猜测登录状态。各人自愿安装 Tailscale，用自己的账号接受房主的私人网络邀请，再连接同一网络；不共享密码。**这不是 HTTPS 主入口的要求。**

私人方式的地址必须是电脑自身已分配的地址。服务不监听 `0.0.0.0`，不自动修改防火墙，也不安装路由器端口转发。房主和朋友从输出的完整地址进入相同游戏，再创建/加入房间。房间码不能代替完整网址；碎片中的密钥不会随页面 HTTP 请求发送，也不写入仓库或磁盘。

同一 Wi-Fi 下可直接用局域网。Tailscale Personal 截至 2026-10-20 为免费、最多 6 位用户，覆盖四人非商用游戏；[收费政策](https://tailscale.com/pricing) 以后可能改变。Tailscale 可能走直连或中继，应用 RTT 与帧率需要分别实测。

本次服务端依赖：`ws` **8.22.0**，MIT 许可。来源 https://github.com/websockets/ws 与 npm `ws@8.22.0`；锁定在 `package-lock.json`。依赖仅用于电脑主机服务，浏览器不访问 npm/CDN。分发独立主机包时应随包保留 `node_modules/ws/LICENSE`，若捆绑 Node.js，还须保留对应 Node.js 许可。

主机服务必须持续运行，作为房主的游戏页也必须保持打开。房主离开会关闭房间；关闭服务会断开所有房间，没有迁移到另一台设备或云端的机制。公开房间的朋友通过 HTTPS/WSS 访问，房主本机和私人局域网入口使用 HTTP/WS；所有方式都校验邀请密钥和流程权限。

## 同步边界

- 最多 4 人，至少 2 人准备后开始；开局后不允许中途加入。
- 电脑房主的游戏模拟拥有世界、伤害、怪物与奖励的决定权。客人只能提交操作和选卡结果，不能发布世界状态。
- 服务验证成员身份、英雄武器绑定、流程阶段、对局 ID、消息序号、数据大小和发送频率。战斗数值、命中判定和奖励 nonce 的验证属于房主游戏模拟。
- 同一台服务器最多 4 个独立房间，最多 24 条连接；每条消息不超过 192 KiB，普通控制消息不超过 4 KiB，关闭 WebSocket 压缩。
- 主机快照默认每秒最多 35 条，客人操作最多 65 条；允许短暂两倍突发。缓冲超过 384 KiB 会断开慢连接，中间旧快照可跳过，操作和事件保序。
- 连接 5 秒内必须完成邀请验证。主机模拟在未暂停时超过 8 秒没有快照（每秒检查）会关闭房间；加载超过 180 秒也会关闭。WebSocket 心跳与模拟存活分别检查。
- `suspend` 明确通知全房暂时停步，不把浏览器卡住伪装成正常运行。恢复时重置存活计时。角色选卡暂停和房主离开前台均需由游戏发送此消息。

## 浏览器协议 v1

连接同源 `/room-socket`：HTTPS 入口使用 `wss://`，房主本机和私人 HTTP 入口使用 `ws://`。邀请链接格式为 `/play.html#roomToken=…`。公共模式接受启动器确定的精确 HTTPS Origin，另允许房主本机服务 URL 与本机 Host 的精确配对；不允许用本机 Origin 搭配公网 Host，不能由 `Forwarded` 等客户端请求头修改。`setPublicOrigin` 只允许未配置、无连接/房间的 loopback 服务设置一次；HTTP 与 WS 的 Host 限定本机绑定地址或该公开地址。验证邀请后的 `welcome` 可带 `publicOrigin`，仅用于生成分享链接，客户端的对战连接始终保持页面同源。

每条消息为 JSON 对象，包含 `type`：

| 发送者 | type 与字段 | 含义 |
| --- | --- | --- |
| 首条消息 | `hello {protocol:1, token}` | 验证邀请 |
| 服务 | `welcome {protocol:1, playerId, publicOrigin?}` | 当前连接身份；可选公网分享入口不改变同源连接 |
| 任意未入房玩家 | `create {name,heroId,weaponIndex,mapId}` | 建房 |
| 任意未入房玩家 | `join {code,name,heroId,weaponIndex}` | 入房 |
| 玩家 | `select {heroId,weaponIndex}`、`ready {ready}` | 大厅选人、准备；改选会取消准备 |
| 房主 | `map {mapId}`、`start {}` | 选地图、开始；换地图重置全员准备 |
| 服务 | `room {room}` | 完整大厅/流程状态 |
| 玩家 | `loaded {runId}` | 当前对局资源加载结束 |
| 客人 | `input {runId,seq,input}` | 送往房主，服务器加 `playerId` |
| 客人 | `choice {runId,seq,choice:{id,nonce}}` | 选卡/延期请求，送往房主验证 |
| 房主 | `snapshot {runId,seq,data}` | 世界快照，广播给客人 |
| 房主 | `event {runId,seq,data,to?}` | 特效、选卡等；可定向给成员 |
| 房主 | `suspend {runId,paused,reason}` | `host-away` / `host-menu` / `choice`；广播 room 的 paused/pauseReason |
| 房主 | `finish {runId}` | 回到大厅，下一局使用新 ID/随机种子 |
| 玩家 | `leave {}` | 退房；房主退房使全房结束 |
| 玩家/服务 | `ping {at}` / `pong {at}` | 测量应用 RTT，不是 FPS |
| 服务 | `player-left {playerId}` | 客人离开，清除远端实体与输入 |
| 服务 | `closed {reason}` / `error {code,message}` | 房间终止 / 拒绝请求 |

`room`：`{code,hostId,phase,mapId,seed,runId,paused,pauseReason,players}`。`phase` 是 `lobby` / `loading` / `playing`；所有玩家 loaded 后才进入 playing。每名玩家为 `{id,name,heroId,weaponIndex,ready,loaded}`。

`input`：`{moveX,moveZ,aimYaw,aimPitch,attack,dodge,jump,crouch,autoAim,mobile,view,aspect,dodgeSeq,jumpSeq}`。移动向量归一化；视角为 first/third；宽高比限制 .5–3；跳跃/闪避序号递增，避免瞬时按键因发送合并而丢失。网络层不接受 HP、位置、伤害等客人自报数值。

输入、选择、快照、事件的 `seq` 分别独立递增，每个新 `runId` 从 0 开始即可。旧局消息和重复序号不会应用。房主发布数据有结构和体积限制，但本服务不宣称能防作弊房主。

## 验证入口

```text
node --test tests/multiplayer-server.test.js
node --test tests/multiplayer-host-addresses.test.js
node --test tests/multiplayer-public-launcher.test.js
```

传输测试真正建立 2–4 个 WebSocket 客户端，验证准备与加载屏障、房间容量、权限、输入与快照、选择转发、重开隔离、掉线、邀请、跨站请求、超大消息、静态资源路径与 Range，以及主机模拟停止后的全房关闭。公网启动器测试覆盖分片 URL、假域名、端口冲突不启动隧道、带空格路径的实际 fake CLI、超时、退出、readiness 失败、取消、资源回收，以及 HTTPS HTML 与 WSS 邀请握手；私人启动器另测 Tailscale 状态。真实公网隧道、手机和不同网络需要另外验证。
