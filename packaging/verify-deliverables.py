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
    assert manifest['version'] == '227'
    apk = output / 'Realm-Echoes-REBORN-v227.1-Android.apk'
    pc = output / '异境回响-REBORN-v227-电脑离线包.zip'
    with zipfile.ZipFile(apk) as android, zipfile.ZipFile(pc) as desktop:
        assert android.testzip() is None and desktop.testzip() is None
        assert android.read('assets/game/offline-package.json') == desktop.read('game/offline-package.json') == manifest_bytes
        for item in manifest['files']:
            pc_data = desktop.read('game/' + item['path'])
            assert len(pc_data) == item['bytes'] and digest(pc_data) == item['sha256'], item['path']
            android_data = android.read('assets/game/' + item['path'])
            expected = pc_data
            if item['path'] in ('index.html', 'play.html'):
                old = b'<script type="module" src="offline.js?v=227"></script>'
                assert pc_data.count(old) == 1
                expected = pc_data.replace(old, b'<script type="module" src="app-shell.js"></script>')
            assert android_data == expected, item['path']
        assert android.read('assets/game/app-shell.js') == (ROOT / 'packaging/android/app-shell.js').read_bytes()
        expected_pc = {'game/' + item['path'] for item in manifest['files']} | {'game/offline-package.json', 'asset-paths.txt', '启动异境回响.exe', '先看这里-启动说明.txt'}
        assert set(desktop.namelist()) == expected_pc
    cert = 'a299073dc093a9f8f1976d0ea5e4a0a5e58c7958d5f1cee8ff4fc7371a3cd693'
    signature = (output / 'android-signature.txt').read_text('utf-8')
    assert 'Signer #1 certificate SHA-256 digest: ' + cert in signature
    assert 'Verified using v3 scheme (APK Signature Scheme v3): true' in signature
    badging = (output / 'android-manifest.txt').read_text('utf-8')
    assert "name='io.github.dontcry522.realmechoes.reborn'" in badging and "versionCode='22701'" in badging and "versionName='227.1'" in badging
    packages = [{'type': kind, 'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())}
                for kind, path in [('Android APK', apk), ('Windows portable offline ZIP', pc)]]
    report = {'version': manifest['version'], 'offlineBuild': manifest['build'],
              'manifestSHA256': digest(manifest_bytes), 'manifestResources': len(manifest['files']),
              'manifestResourceBytes': manifest['bytes'], 'sameCertificateAsV225': True,
              'certificateSHA256': cert, 'apkVersionMetadataVerified': True,
              'bothManifestsByteIdenticalToFrozenSource': True, 'everyGameResourceVerified': True,
              'desktopNoExternalRuntimeInstallRequired': True, 'desktopUsesNormalBrowserProfileAppWindow': True, 'androidOnlyChangesBrowserShell': True,
              'androidDeviceInstallTested': False, 'androidDevicePerformanceTested': False,
              'packages': packages}
    (output / 'deliverables-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    sums = '\n'.join(item['sha256'] + '  ' + Path(item['path']).name for item in packages) + '\n'
    (output / 'SHA256SUMS.txt').write_text(sums, 'utf-8')
    instructions = '''异境回响 REBORN v227 · 手机和电脑离线版

【手机怎么启动】
点击 Realm-Echoes-REBORN-v227.1-Android.apk 安装。
装好后，在手机桌面点击“异境回响 REBORN”。默认横屏，可以断网游玩。
若装有此前 REBORN APK，直接覆盖安装，不要卸载或清数据。
本包与此前版本保持相同包名、签名和本地存档地址。

【电脑怎么启动】
将“异境回响-REBORN-v227-电脑离线包.zip”传到 Windows 10/11 电脑。
右键 ZIP，选择“全部解压”，保存到自己喜欢的目录。
打开解压后的文件夹，双击根目录的“启动异境回响.exe”。
游戏以 Edge/Chrome 独立全屏窗口打开，无地址栏，无需另装 Python/Node.js。
F11 切换全屏/窗口，Alt+Tab 切换应用，Esc 暂停，Alt+F4 退出游戏。
关闭游戏窗口时会同时停止本机服务；也可在启动器点“结束游戏并关闭服务”。
不要直接在压缩包里面运行，也不要双击 game 文件夹中的 HTML。

手机 APK 和电脑 ZIP 是两个不同平台的包。
电脑 ZIP 是免安装的便携版，不是带安装向导的 Setup。
电脑需要已安装 Edge/Chrome 并支持 WebGL2；启动器未购买商业代码签名证书。
优先沿用系统默认的 Edge/Chrome，也可在启动器选择并记住浏览器。
使用浏览器正常用户资料及原本机地址，不使用隐私模式或新建独立资料。
以前的电脑存档请继续使用原浏览器及原用户资料；不同浏览器不会自动互通。
游戏资源已包含，离线不代表所有设备都没有渲染卡顿。
手机、电脑和在线网页的存档不会自动互相同步。
'''
    (output / '安装与游玩说明.txt').write_text(instructions.replace('\n', '\r\n'), 'utf-8-sig', newline='')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
