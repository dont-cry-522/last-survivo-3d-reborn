"""Package the manifest unchanged with a tiny Windows-inbox .NET local host."""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import http.client
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.parse
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TEXT = {'.js', '.mjs', '.py', '.cmd', '.txt', '.css', '.html', '.webmanifest', '.json', '.gltf', '.md'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify_host(executable, manifest, payload, port):
    process = subprocess.Popen([str(executable), '--verify-only', '--no-open', f'--port={port}', '--stop-after-ms=30000'],
                               creationflags=0x08000000)
    started = time.monotonic()
    try:
        for _ in range(120):
            try:
                with socket.create_connection(('127.0.0.1', port), .2):
                    break
            except OSError:
                assert process.poll() is None, 'Launcher exited before listening'
                time.sleep(.05)
        else:
            raise RuntimeError('Native host did not start')

        def request(path, method='GET', headers=None):
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            result = response.status, dict(response.getheaders()), response.read()
            connection.close()
            return result

        def resource(item):
            status, headers, body = request('/' + urllib.parse.quote(item['path']))
            assert status == 200 and len(body) == item['bytes'] and digest(body) == item['sha256'], item['path']
            if item['path'].endswith(('.js', '.mjs')):
                assert 'javascript' in headers['Content-Type'], item['path']
            if item['path'].endswith('.gz'):
                assert 'Content-Encoding' not in headers, item['path']
            return True

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            assert all(pool.map(resource, manifest['files']))
        # Real keep-alive matters: don't exhaust Windows sockets when many local assets load.
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        socket_ids = []
        for path in ('play.html', 'main.js', 'offline-package.json'):
            connection.request('GET', '/' + path)
            response = connection.getresponse()
            assert response.status == 200 and response.read() == payload['game/' + path]
            socket_ids.append(connection.sock.fileno())
        assert len(set(socket_ids)) == 1
        connection.close()
        data = payload['game/main.js']
        assert request('/main.js', 'HEAD')[2] == b''
        status, headers, body = request('/main.js', headers={'Range': 'bytes=10-29'})
        assert status == 206 and body == data[10:30] and headers['Content-Range'] == f'bytes 10-29/{len(data)}'
        assert request('/main.js', headers={'Range': 'bytes=-20'})[2] == data[-20:]
        assert request('/main.js', headers={'Range': 'bytes=999999999-'})[0] == 416
        assert request('/main.js', 'POST')[0] == 405
        for path in ('/../Launcher.cs', '/%2e%2e/asset-paths.txt', '/asset-paths.txt', '/missing.js'):
            assert request(path)[0] == 404, path
        assert request('/play.html', headers={'Host': 'example.com'})[0] == 400
        assert request('/play.html?v=229')[2] == payload['game/play.html']
        assert request('/offline-package.json')[2] == payload['game/offline-package.json']
        process.wait(timeout=max(1, 34 - (time.monotonic() - started)))
        assert process.returncode == 0, 'Host did not shut down cleanly'
        # The exact port can be reused after graceful shutdown.
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            probe.bind(('127.0.0.1', port))
        return {'resourcesServedAndHashVerified': len(manifest['files']), 'moduleMime': True,
                'compressedAssetsNotDoubleDecoded': True, 'httpKeepAlive': True, 'headAndRanges': True,
                'queryStrings': True, 'whitelistAndPathTraversal': True, 'loopbackHostValidation': True,
                'gracefulShutdownAndPortReuse': True, 'noNodeOrPythonRequiredToPlay': True}
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--test-port', type=int, default=18938)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest_data = (ROOT / 'offline-package.json').read_bytes()
    manifest = json.loads(manifest_data)
    assert manifest['version'] == '229', 'Update and verify launcher URL/version before a new release'
    payload = {}
    for item in manifest['files']:
        path = (ROOT / item['path']).resolve()
        assert path.is_relative_to(ROOT), item['path']
        content = path.read_bytes()
        if path.suffix in TEXT:
            content = content.replace(b'\r\n', b'\n')
        assert len(content) == item['bytes'] and digest(content) == item['sha256'], item['path']
        payload['game/' + item['path']] = content
    assert sum(len(content) for content in payload.values()) == manifest['bytes']
    payload['game/offline-package.json'] = manifest_data
    payload['asset-paths.txt'] = ('\n'.join([item['path'] for item in manifest['files']] + ['offline-package.json']) + '\n').encode('utf-8')
    payload['先看这里-启动说明.txt'] = '''异境回响 REBORN v229 · Windows 电脑离线版

1. 在电脑上将整个 ZIP “全部解压”到自己选择的目录。
2. 双击根目录的“启动异境回响.exe”。游戏以独立全屏窗口打开，无地址栏。
3. F11 切换全屏/窗口；Alt+Tab 切换应用；Esc 暂停；Alt+F4 退出游戏。
   关闭游戏窗口会同时停止本机服务；也可在启动器点击“结束游戏并关闭服务”。

无需另外安装 Python 或 Node.js，无需网络；适用于 Windows 10/11。
需要已安装 Microsoft Edge 或 Google Chrome，及支持 WebGL2 的显卡/驱动。
这是电脑便携包，解压即用；不是安卓应用，也不是带安装向导的 Setup。
请不要在 ZIP 压缩包内直接运行，不要直接双击 game 目录中的 HTML。
如果端口占用，请先关闭旧版游戏的启动窗口后重试。

电脑存档仍在浏览器的 http://127.0.0.1:8897 来源。
更新时继续使用相同浏览器和地址；不要清除浏览器网站数据。
默认优先使用系统默认的 Edge/Chrome；启动器可以选择并记住浏览器。
使用该浏览器正常用户资料，不是隐私/访客模式，也不创建另一套浏览器资料。
如果以前在另一浏览器或另一用户资料中玩，请切回原浏览器及原资料。
系统默认浏览器不支持应用窗口时，需要在启动器中选择 Edge/Chrome。
与安卓、GitHub 网页的存档不自动互通。未改变游戏核心机制或资源画质。
系统可能提示此启动器没有商业签名；本包附有文件校验值供核对。
封装消除了在线下载，仍不能保证所有设备永不卡顿。

全部地图、角色、音频、引擎与运行资源都在 game 目录。
资源来源和许可见 game/THIRD_PARTY_ASSETS.md。
'''.replace('\n', '\r\n').encode('utf-8-sig')
    compiler = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    assert compiler.is_file(), 'Windows .NET Framework compiler is required to build (not to install separately)'
    with tempfile.TemporaryDirectory(prefix='reborn-windows-') as temporary:
        stage = Path(temporary)
        exe = stage / '启动异境回响.exe'
        command = [str(compiler), '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/debug-',
                   '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/out:' + str(exe), str(HERE / 'Launcher.cs')]
        compile_log = subprocess.check_output(command, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
        payload[exe.name] = exe.read_bytes()
        for name, data in payload.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        checks = verify_host(exe, manifest, payload, args.test_port)
        target = output / '异境回响-REBORN-v229-电脑离线包.zip'
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, data in payload.items():
                archive.writestr(name, data)
        with zipfile.ZipFile(target) as archive:
            assert archive.testzip() is None
            assert len(archive.namelist()) == len(set(archive.namelist())) == len(payload)
            for name, data in payload.items():
                assert archive.read(name) == data, name
        report = {'version': manifest['version'], 'offlineBuild': manifest['build'], 'path': str(target),
                  'bytes': target.stat().st_size, 'sha256': digest(target.read_bytes()),
                  'launcherBytes': len(payload[exe.name]), 'launcherSHA256': digest(payload[exe.name]), 'manifestFiles': len(manifest['files']),
                  'allGameFilesByteIdenticalToVerifiedManifest': True, 'zipCrcAndEveryEntry': True,
                  'nativeHost': checks, 'buildLog': compile_log,
                  'browserGameScreenshotTested': False, 'realPhonePerformanceTested': False,
                  'desktopWindow': 'Normal-profile Edge/Chrome app window with checked initial fullscreen; F11/Alt+Tab/Alt+F4',
                  'limitations': ['Portable ZIP, not a Setup installer.', 'Windows 10/11 and installed Edge/Chrome with WebGL2 required.', 'Launcher has no commercial Authenticode signature.', 'Packaging verification is not an FPS measurement.']}
        (output / 'pc-package-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
