# REBORN Android 离线安装包

本目录只包装当前游戏，不更换引擎，也不修改战斗代码。APK 内置离线清单的全部本地资源；独立包名 `io.github.dontcry522.realmechoes.reborn`，安装版 227.1 对应游戏 v227。

- Android 10+、支持 WebGL2 的系统 WebView；使用系统的硬件加速渲染。
- 默认横屏，允许左右翻转。保留触屏操作、第一/第三人称和游戏画质设置。
- 返回键在战斗中暂停，其他情况下确认退出；切后台暂停战斗和音频，回前台后手动继续。
- 安装版替换浏览器的“下载/离线”面板，因为资源已经在 APK 内，不再重复下载或创建缓存副本。
- 设置、图鉴等由原有代码保存到本应用的固定本地域名；与网页存档独立，不自动导入。没有新增中途存档功能。升级时保留包名、签名和地址，直接覆盖安装；卸载/清数据会丢失本应用数据。
- 不加载外部 CDN。所有网络请求仅从白名单内的 APK 资源响应，其他地址明确返回 404。清单中的 `.gz` 保持原始压缩字节，由现有角色加载器解压。

使用 Android 官方的 [WebView 本地 HTTPS 内容拦截模式](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)，通过系统 API 实现固定资源路由，不引入新运行库或 JavaScript 原生桥。

## 重新构建

需要已有 JDK 17、Android build-tools 35 和 platform android-35。当前工作区的 `work/android-toolchain` 已有这些工具：

```powershell
python packaging/android/build.py --toolchain ../android-toolchain --output ../../outputs/reborn-install-v227
```

脚本先逐一验证 `offline-package.json` 的字节数和 SHA256，再编译 Java、转换 dex、对齐和签名。构建结果包含 APK、证书/manifest 检查报告、包体 SHA256。打包只将 APK 内的两个 HTML 入口改用 `app-shell.js`，其余原有游戏模块与资源保持逐字节一致。

签名身份保存在用户目录 `.codex/signing/realm-echoes-reborn/`，不进入 Git 或分发包。后续版本必须继续使用它，不要删除或公开；否则无法覆盖升级。版本升级时同时调整 manifest 的 versionCode/versionName、Activity 入口与构建器版本检查。

## 已知边界

这是使用系统 WebView 的本地离线应用，不是将 Three.js 转成原生 3D 引擎。安装消除了在线资源下载，但 GPU 负荷、初次加载和设备发热仍会影响帧率，不能保证所有手机永不卡顿。

APK 签名与资源校验、桌面浏览器模拟均不等于 Android 真机安装及性能测试。交付时需分别注明。打包脚本只使用现有签名，并核对与 v225 相同的证书；签名缺失会停止构建，不自动生成替代身份。
