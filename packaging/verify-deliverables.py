"""Cross-check both final packages against the same frozen REBORN manifest."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    manifest_bytes = (ROOT / 'offline-package.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    assert manifest['version'] == '229'
    apk = output / 'Realm-Echoes-REBORN-v229.1-Android.apk'
    pc = output / 'Realm-Echoes-REBORN-v229-Windows.zip'
    room_report = json.loads((output / 'public-room-package-verification.json').read_text('utf-8'))
    android_report = json.loads((output / 'android-package-verification.json').read_text('utf-8'))
    assert room_report['version'] == android_report['gameVersion'] == manifest['version']
    assert room_report['offlineBuild'] == android_report['offlineBuild'] == manifest['build']
    assert room_report['combinedOfflineAndOnline'] is True
    assert room_report['offlineSource']['allSharedFilesByteIdentical'] is True
    assert room_report['offlineSource']['oneSharedGameDirectory'] is True
    assert room_report['offlineSource']['origin'] == 'http://127.0.0.1:8897'
    assert room_report['offlineSource']['browserProfileChanged'] is False
    assert room_report['combinedNativeHostChecks']['resourcesServedAndHashVerified'] == len(manifest['files'])
    assert room_report['combinedNativeHostChecks']['gracefulShutdownAndPortReuse'] is True
    assert room_report['packagedHostChecks']['twoClientRoomFlow'] is True
    assert room_report['packagedHostChecks']['verifiedHttpResources'] == len(manifest['files'])
    for path, report in ((apk, android_report), (pc, room_report)):
        assert path.stat().st_size == report['bytes'] and digest(path.read_bytes()) == report['sha256'], path
    with zipfile.ZipFile(apk) as android, zipfile.ZipFile(pc) as desktop:
        assert android.testzip() is None and desktop.testzip() is None
        assert android.read('assets/game/offline-package.json') == desktop.read('game/offline-package.json') == manifest_bytes
        for item in manifest['files']:
            pc_data = desktop.read('game/' + item['path'])
            assert len(pc_data) == item['bytes'] and digest(pc_data) == item['sha256'], item['path']
            android_data = android.read('assets/game/' + item['path'])
            expected = pc_data
            if item['path'] in ('index.html', 'play.html'):
                old = b'<script type="module" src="offline.js?v=229"></script>'
                assert pc_data.count(old) == 1
                expected = pc_data.replace(old, b'<script type="module" src="app-shell.js"></script>')
            assert android_data == expected, item['path']
        assert android.read('assets/game/app-shell.js') == (ROOT / 'packaging/android/app-shell.js').read_bytes()
        entries = room_report['packagedFiles']
        expected_pc = {item['path'] for item in entries}
        assert len(desktop.namelist()) == len(expected_pc) == len(entries)
        assert set(desktop.namelist()) == expected_pc
        for item in entries:
            path = item['path']
            assert '\\' not in path and ':' not in path and not path.startswith('/') and '..' not in path.split('/')
            data = desktop.read(path)
            assert len(data) == item['bytes'] and digest(data) == item['sha256'], path
            assert not path.lower().endswith(('.p12', '.jks', '.pem', '.key')), path
        required = {'game/' + item['path'] for item in manifest['files']} | {
            'game/offline-package.json', 'asset-paths.txt', '启动异境回响.exe', '先看这里-启动说明.txt',
            'START_ONLINE_ROOM.cmd', 'START_PRIVATE_ROOM.cmd', 'START_TAILSCALE_ROOM.cmd',
            '先读我-两个启动入口.txt', '先读我-免VPN联机.txt', 'README.md',
            'runtime/node.exe', 'runtime/LICENSE-Node.txt', 'runtime/sources.json',
            'runtime/cloudflared.exe', 'runtime/LICENSE-Cloudflared.txt', 'runtime/cloudflared-source.json',
            'game/scripts/room-server.mjs', 'game/packaging/rooms/start-room.mjs',
            'game/packaging/rooms/start-public-room.mjs', 'game/docs/PRIVATE_ROOMS.md',
            'game/package.json', 'game/node_modules/ws/LICENSE', 'game/node_modules/ws/package.json'}
        assert required <= expected_pc
        assert digest(desktop.read('启动异境回响.exe')) == room_report['offlineSource']['launcherSHA256']
        asset_paths = ('\n'.join([item['path'] for item in manifest['files']] + ['offline-package.json']) + '\n').encode('utf-8')
        assert desktop.read('asset-paths.txt') == asset_paths
        for path in ('scripts/room-server.mjs', 'packaging/rooms/start-room.mjs', 'packaging/rooms/start-public-room.mjs', 'docs/PRIVATE_ROOMS.md'):
            assert desktop.read('game/' + path) == (ROOT / path).read_bytes().replace(b'\r\n', b'\n'), path
        for launcher in ('START_ONLINE_ROOM.cmd', 'START_PRIVATE_ROOM.cmd', 'START_TAILSCALE_ROOM.cmd'):
            assert desktop.read(launcher) == (ROOT / 'packaging/rooms' / launcher).read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        sources = json.loads(desktop.read('runtime/sources.json'))
        assert desktop.read('runtime/sources.json') == (ROOT / 'packaging/rooms/licenses/sources.json').read_bytes()
        assert digest(desktop.read('runtime/node.exe')) == sources['runtimeSha256']
        assert digest(desktop.read('runtime/LICENSE-Node.txt')) == sources['licenseSha256']
        assert digest(desktop.read('runtime/cloudflared.exe')) == '4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6'
        assert digest(desktop.read('runtime/LICENSE-Cloudflared.txt')) == '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd'
        ws = ROOT / 'node_modules/ws'
        expected_ws = [ws / name for name in ('package.json', 'LICENSE', 'index.js', 'wrapper.mjs', 'browser.js')] + sorted((ws / 'lib').glob('*.js'))
        for path in expected_ws:
            name = 'game/node_modules/ws/' + path.relative_to(ws).as_posix()
            assert desktop.read(name) == path.read_bytes(), name
            required.add(name)
        assert expected_pc == required, 'Unexpected files in the delivery ZIP'
    cert = 'a299073dc093a9f8f1976d0ea5e4a0a5e58c7958d5f1cee8ff4fc7371a3cd693'
    signature = (output / 'android-signature.txt').read_text('utf-8')
    assert 'Signer #1 certificate SHA-256 digest: ' + cert in signature
    assert 'Verified using v3 scheme (APK Signature Scheme v3): true' in signature
    badging = (output / 'android-manifest.txt').read_text('utf-8')
    assert "name='io.github.dontcry522.realmechoes.reborn'" in badging and "versionCode='22901'" in badging and "versionName='229.1'" in badging
    packages = [{'type': kind, 'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())}
                for kind, path in [('Android offline APK', apk), ('Windows offline + public-room ZIP', pc)]]
    report = {'version': manifest['version'], 'offlineBuild': manifest['build'],
              'manifestSHA256': digest(manifest_bytes), 'manifestResources': len(manifest['files']),
              'manifestResourceBytes': manifest['bytes'], 'sameCertificateAsV225': True,
              'certificateSHA256': cert, 'apkVersionMetadataVerified': True,
              'bothManifestsByteIdenticalToFrozenSource': True, 'everyGameResourceVerified': True,
              'desktopNoExternalRuntimeInstallRequired': True, 'desktopUsesNormalBrowserProfileAppWindow': True, 'androidOnlyChangesBrowserShell': True,
              'androidDeviceInstallTested': False, 'androidDevicePerformanceTested': False,
              'androidRoomPlay': 'Use browser invitation; APK is offline only',
              'desktopSingleGameDirectory': True, 'desktopRoomHostTransportTested': True,
              'publicTunnelOrRemoteNetworkTestedByPackaging': False,
              'packages': packages}
    (output / 'deliverables-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    sums = '\n'.join(item['sha256'] + '  ' + Path(item['path']).name for item in packages) + '\n'
    (output / 'SHA256SUMS.txt').write_text(sums, 'utf-8')
    instructions = '''异境回响 REBORN v229 · 手机离线版、电脑单机与联机合包

【本次更新】
岚歌的面部与头发精修，并调整持弓、战铃和闪避动作的衔接。本版继续使用已有角色、地图和玩法。

【手机怎么启动】
点击 Realm-Echoes-REBORN-v229.1-Android.apk 安装。
装好后，在手机桌面点击“异境回响 REBORN”。默认横屏，可以断网游玩。
若装有此前 REBORN APK，直接覆盖安装，不要卸载或清数据。
本包与此前版本保持相同包名、签名和本地存档地址。
手机 APK 是离线单机版。参加好友对战请在手机浏览器打开房主的完整邀请链接，不是在 APK 内加入。

【电脑离线单机怎么启动】
将“Realm-Echoes-REBORN-v229-Windows.zip”传到 Windows 10/11 电脑。
右键 ZIP，选择“全部解压”，保存到自己喜欢的目录。
打开解压后的文件夹，双击根目录的“启动异境回响.exe”。
游戏以 Edge/Chrome 独立全屏窗口打开，无地址栏，无需另装 Python/Node.js。
F11 切换全屏/窗口，Alt+Tab 切换应用，Esc 暂停，Alt+F4 退出游戏。
关闭游戏窗口时会同时停止本机服务；也可在启动器点“结束游戏并关闭服务”。
不要直接在压缩包里面运行，也不要双击 game 文件夹中的 HTML。

【电脑开房、朋友怎么加入】
同一解压目录内双击 START_ONLINE_ROOM.cmd，等待入口检查通过。
复制窗口显示的房主本机网址到电脑浏览器，点“好友房间”创建房间。
从房间内点“复制邀请”，把 HTTPS 完整链接发给朋友。手机和电脑都用浏览器打开邀请。
朋友不用同一 Wi-Fi，也不用 VPN；联机需要正常网络，房主的服务和游戏页必须保持打开。
不要把 127.0.0.1 的房主专用网址发给朋友。重启后邀请会变，需要重新复制。
临时公网入口依赖 Cloudflare Quick Tunnel 免费测试服务，不保证所有网络都能连接或固定延迟。
联机使用独立的 8898 服务；原单机沿用 127.0.0.1:8897 和原浏览器资料。

手机 APK 和电脑 ZIP 是两个不同平台的包。
电脑 ZIP 是免安装的便携版，不是带安装向导的 Setup。
电脑需要已安装 Edge/Chrome 并支持 WebGL2；启动器未购买商业代码签名证书。
优先沿用系统默认的 Edge/Chrome，也可在启动器选择并记住浏览器。
使用浏览器正常用户资料及原本机地址，不使用隐私模式或新建独立资料。
以前的电脑存档请继续使用原浏览器及原用户资料；不同浏览器不会自动互通。
游戏资源已包含，离线不代表所有设备都没有渲染卡顿。
手机、电脑和在线网页的存档不会自动互相同步。
两个电脑入口只保存一套 game 资源；请保留 runtime、说明与授权文件。
'''
    (output / '安装与游玩说明.txt').write_text(instructions.replace('\n', '\r\n'), 'utf-8-sig', newline='')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
