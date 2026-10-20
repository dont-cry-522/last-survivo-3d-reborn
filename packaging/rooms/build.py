"""Build an offline-complete Windows host with an opt-in public HTTPS tunnel."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TEXT = {'.js', '.mjs', '.py', '.cmd', '.txt', '.css', '.html', '.webmanifest', '.json', '.gltf', '.md'}
CLOUDFLARED_VERSION = '2026.10.1'
CLOUDFLARED_SHA256 = '4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6'
CLOUDFLARED_LICENSE_SHA256 = '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(path):
    data = path.read_bytes()
    return data.replace(b'\r\n', b'\n') if path.suffix in TEXT else data


def merge_offline_package(payload, manifest, archive_path):
    """Merge a separately verified native host without replacing any shared bytes."""
    report = json.loads((archive_path.parent / 'pc-package-verification.json').read_text('utf-8'))
    archive_data = archive_path.read_bytes()
    checks = report.get('nativeHost', {})
    if (report.get('version') != manifest['version'] or report.get('offlineBuild') != manifest['build']
            or report.get('sha256') != digest(archive_data) or report.get('bytes') != len(archive_data)
            or report.get('allGameFilesByteIdenticalToVerifiedManifest') is not True
            or report.get('zipCrcAndEveryEntry') is not True
            or checks.get('resourcesServedAndHashVerified') != len(manifest['files'])
            or any(checks.get(key) is not True for key in (
                'moduleMime', 'compressedAssetsNotDoubleDecoded', 'httpKeepAlive', 'headAndRanges',
                'queryStrings', 'whitelistAndPathTraversal', 'loopbackHostValidation',
                'gracefulShutdownAndPortReuse', 'noNodeOrPythonRequiredToPlay'))):
        raise RuntimeError('Offline ZIP must have a matching successful native-host verification report.')
    expected = {'game/' + item['path'] for item in manifest['files']} | {
        'game/offline-package.json', 'asset-paths.txt', '启动异境回响.exe', '先看这里-启动说明.txt'}
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != expected or archive.testzip() is not None:
            raise RuntimeError('Offline ZIP contains unexpected, duplicate or corrupt entries.')
        additions = {name: archive.read(name) for name in names}
    if additions['game/offline-package.json'] != payload['game/offline-package.json']:
        raise RuntimeError('Offline and room manifests are not byte-identical.')
    expected_paths = ('\n'.join([item['path'] for item in manifest['files']] + ['offline-package.json']) + '\n').encode('utf-8')
    if additions['asset-paths.txt'] != expected_paths:
        raise RuntimeError('Offline native-host asset whitelist differs from the manifest.')
    executable = additions['启动异境回响.exe']
    if (not executable.startswith(b'MZ') or len(executable) != report.get('launcherBytes')
            or digest(executable) != report.get('launcherSHA256')):
        raise RuntimeError('Offline executable differs from the verified native host.')
    for item in manifest['files']:
        data = additions['game/' + item['path']]
        if len(data) != item['bytes'] or digest(data) != item['sha256']:
            raise RuntimeError('Offline resource differs from the manifest: ' + item['path'])
    shared = set(additions) & set(payload)
    for name in shared:
        if additions[name] != payload[name]:
            raise RuntimeError('Package merge conflict; refusing to replace shared bytes: ' + name)
    # Validate every collision before mutating: a failed merge leaves payload intact.
    payload.update({name: data for name, data in additions.items() if name not in payload})
    return {'path': str(archive_path), 'bytes': len(archive_data), 'sha256': digest(archive_data),
            'sharedFilesByteIdentical': len(shared), 'allSharedFilesByteIdentical': True,
            'oneSharedGameDirectory': True, 'launcherSHA256': digest(executable),
            'origin': 'http://127.0.0.1:8897', 'browserProfileChanged': False}


def verify_combined_native_host(stage, manifest, payload, port):
    spec = importlib.util.spec_from_file_location('reborn_windows_packaging', ROOT / 'packaging/windows/build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.verify_host(stage / '启动异境回响.exe', manifest, payload, port)


def collect_cloudflared(binary):
    source = json.loads((binary.parent / 'cloudflared-source.json').read_text('utf-8-sig'))
    official_url = f'https://github.com/cloudflare/cloudflared/releases/download/{CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe'
    data = binary.read_bytes()
    license_data = (binary.parent / 'LICENSE-cloudflared.txt').read_bytes()
    if (source.get('Version') != CLOUDFLARED_VERSION or source.get('URL') != official_url
            or source.get('SHA256') != CLOUDFLARED_SHA256 or source.get('Bytes') != len(data)
            or source.get('VerifiedAgainstReleaseDigest') is not True
            or digest(data) != CLOUDFLARED_SHA256 or digest(license_data) != CLOUDFLARED_LICENSE_SHA256):
        raise RuntimeError('cloudflared binary, license or provenance differs from the verified official release.')
    version = subprocess.check_output([str(binary), '--version'], text=True, encoding='utf-8', timeout=15, creationflags=0x08000000).strip()
    if not version.startswith('cloudflared version ' + CLOUDFLARED_VERSION + ' '):
        raise RuntimeError('cloudflared version does not match the verified release.')
    source.update({'License': 'Apache-2.0', 'LicenseSHA256': CLOUDFLARED_LICENSE_SHA256,
                   'LicenseURL': f'https://github.com/cloudflare/cloudflared/blob/{CLOUDFLARED_VERSION}/LICENSE'})
    return {'runtime/cloudflared.exe': data, 'runtime/LICENSE-Cloudflared.txt': license_data,
            'runtime/cloudflared-source.json': (json.dumps(source, ensure_ascii=False, indent=2) + '\n').encode('utf-8')}, source


def collect_payload(node, cloudflared):
    manifest_data = (ROOT / 'offline-package.json').read_bytes()
    manifest = json.loads(manifest_data)
    paths = {entry['path'] for entry in manifest['files']}
    required = {'multiplayer-client.js', 'multiplayer-lobby.js', 'multiplayer-protocol.js',
                'multiplayer-state.js', 'multiplayer-replica.js', 'multiplayer-world.js', 'multiplayer.css'}
    if not required <= paths:
        raise RuntimeError('Room runtime assets missing from offline manifest; finish integration and offline:build first.')
    payload = {}
    for entry in manifest['files']:
        path = (ROOT / entry['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise RuntimeError('Invalid manifest path: ' + entry['path'])
        data = normalized(path)
        if len(data) != entry['bytes'] or digest(data) != entry['sha256']:
            raise RuntimeError('Stale offline manifest: ' + entry['path'])
        payload['game/' + entry['path']] = data
    if sum(len(data) for data in payload.values()) != manifest['bytes']:
        raise RuntimeError('Offline total byte count does not match.')
    payload['game/offline-package.json'] = manifest_data
    payload['game/scripts/room-server.mjs'] = normalized(ROOT / 'scripts/room-server.mjs')
    payload['game/packaging/rooms/start-room.mjs'] = normalized(HERE / 'start-room.mjs')
    payload['game/packaging/rooms/start-public-room.mjs'] = normalized(HERE / 'start-public-room.mjs')
    payload['game/package.json'] = b'{"private":true,"type":"module"}\n'
    payload['game/docs/PRIVATE_ROOMS.md'] = normalized(ROOT / 'docs/PRIVATE_ROOMS.md')
    ws = ROOT / 'node_modules/ws'
    package = json.loads((ws / 'package.json').read_text('utf-8'))
    if package.get('license') != 'MIT' or package.get('version') != json.loads((ROOT / 'package.json').read_text('utf-8'))['dependencies']['ws']:
        raise RuntimeError('ws installation does not match the pinned project dependency.')
    for path in [ws / name for name in ['package.json', 'LICENSE', 'index.js', 'wrapper.mjs', 'browser.js']] + sorted((ws / 'lib').glob('*.js')):
        payload['game/node_modules/ws/' + path.relative_to(ws).as_posix()] = path.read_bytes()
    sources = json.loads((HERE / 'licenses/sources.json').read_text('utf-8'))
    actual = json.loads(subprocess.check_output([str(node), '-p', 'JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})'], text=True, encoding='utf-8'))
    if actual != {'version': sources['nodeVersion'], 'arch': sources['arch'], 'platform': sources['platform']}:
        raise RuntimeError('Node runtime version / architecture does not match the bundled license provenance.')
    runtime = node.read_bytes()
    license_data = (HERE / 'licenses' / ('node-' + sources['nodeVersion'] + '-LICENSE.txt')).read_bytes()
    if digest(runtime) != sources['runtimeSha256'] or digest(license_data) != sources['licenseSha256']:
        raise RuntimeError('Node runtime or license differs from verified official source.')
    payload['runtime/node.exe'] = runtime
    payload['runtime/LICENSE-Node.txt'] = license_data
    payload['runtime/sources.json'] = (HERE / 'licenses/sources.json').read_bytes()
    tunnel_payload, tunnel_source = collect_cloudflared(cloudflared)
    payload.update(tunnel_payload)
    for launcher in ['START_ONLINE_ROOM.cmd', 'START_PRIVATE_ROOM.cmd', 'START_TAILSCALE_ROOM.cmd']:
        payload[launcher] = normalized(HERE / launcher).replace(b'\n', b'\r\n')
    payload['README.md'] = normalized(HERE / 'README.md')
    payload['先读我-免VPN联机.txt'] = (f'''异境回响 REBORN v{manifest['version']} · 好友免 VPN 异地联机主机包

1. 在 Windows 10/11（64 位）电脑将整个 ZIP 全部解压到自己选择的文件夹。
2. 房主双击 START_ONLINE_ROOM.cmd，等待临时 HTTPS 游戏页面与 WSS 对战连接检查成功。
3. 房主将窗口显示的本机专用网址（127.0.0.1）复制到电脑 Edge / Chrome，进入“好友房间”并创建房间。
4. 点房间内的“复制邀请”，把生成的 HTTPS 公网链接给朋友，不要分享房主专用的 127.0.0.1 网址。不同 Wi-Fi 或使用手机流量的朋友只需浏览器，不需安装 VPN / Tailscale，也不需要注册组网账号。
5. 朋友打开链接，选择人物并加入房间；大家各自准备后由房主开始。最多 4 人、至少 2 人，玩家互为对手，场上也有怪物。

本包已包含游戏完整本地资源、Node 运行时、ws 与 Cloudflare 官方 cloudflared；电脑无需另装 Python / Node，也不需要 npm 下载。
房主无需 Cloudflare 账号、域名或付费云服务器。朋友无需安装辅助软件；本包不含账户、密码或预设邀请密钥。
首次手机 / 另一台电脑打开时要从房主电脑载入游戏资源，不能保证零等待或任何设备永不卡顿。
请使用现代浏览器和支持 WebGL2 的设备。手机不能作为此 Windows 主机包的服务器。
房主服务与游戏页面必须保持打开；房主离开前台可能暂停全体对局，关闭服务会使所有人断开。
请不要在 ZIP 内直接运行，不要双击 game 中的 HTML，也不要从公开网页连接私人服务。
启动器不自动打开浏览器、不修改防火墙、不开放路由器入站端口。游戏仅监听本机回环地址，通过临时 HTTPS 网址转发。
若网络或系统阻止转发工具，启动器会报错并清理本次进程，不会用局域网链接假装完成异地连接。

同一 Wi-Fi 的备用入口：START_PRIVATE_ROOM.cmd，可选择局域网地址；“仅这台电脑测试”不能让朋友加入。
不同 Wi-Fi / 异地请用 START_ONLINE_ROOM.cmd，不能把 192.168.x 的局域网链接直接发给远处朋友。
临时入口使用 Cloudflare Quick Tunnel 免费测试服务，没有正常运行时间保证；最多 200 个同时在途请求，重启后网址会变化。
官方说明：https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
普通网络、设备电量与带宽仍需自行具备。不同地区和网络的连通与延迟要实际验证。

邀请链接含本次启动随机生成的密钥，只发给朋友。重启服务后旧邀请失效。
异地联机需要网络。“返回离线单机”保留原来的独立玩法。本次手机 APK 仍是离线版，手机参加联机请在浏览器打开朋友的完整邀请，不是在 APK 内加入。
不同网址的浏览器存档不会自动互通，不要清除网站数据。
授权来源：game/THIRD_PARTY_ASSETS.md、game/node_modules/ws/LICENSE、runtime/LICENSE-Node.txt、runtime/LICENSE-Cloudflared.txt。
转发程序来源、版本与 SHA256：runtime/cloudflared-source.json。
本包的传输自检不能代替多人游戏实际手感、异地网络或手机真机性能测试。
''').replace('\n', '\r\n').encode('utf-8-sig')
    return manifest, payload, actual, tunnel_source


VERIFY = r'''
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRoomServer} from './game/scripts/room-server.mjs';
import {startPublicRoom} from './game/packaging/rooms/start-public-room.mjs';
import {RoomClient} from './game/multiplayer-client.js';
import WebSocket from './game/node_modules/ws/wrapper.mjs';
const server=await createRoomServer({port:0});
class Socket extends WebSocket{constructor(url){super(url,{origin:server.url});}}
const host=new RoomClient({WebSocketClass:Socket}),guest=new RoomClient({WebSocketClass:Socket});
const next=(client,type,predicate=()=>true)=>new Promise((resolve,reject)=>{const off=client.on(type,value=>{if(predicate(value)){off();clearTimeout(timer);resolve(value);}});const timer=setTimeout(()=>{off();reject(Error('Timed out waiting for '+type));},5000);});
try{
 assert.equal(typeof startPublicRoom,'function');
 const manifest=JSON.parse(await readFile('./game/offline-package.json','utf8'));
 for(let i=0;i<manifest.files.length;i+=6)await Promise.all(manifest.files.slice(i,i+6).map(async entry=>{
  const response=await fetch(server.url+'/'+entry.path);assert.equal(response.status,200,entry.path);
  const data=Buffer.from(await response.arrayBuffer());assert.equal(data.length,entry.bytes,entry.path);assert.equal(createHash('sha256').update(data).digest('hex'),entry.sha256,entry.path);
 }));
 for(const path of ['/scripts/room-server.mjs','/packaging/rooms/start-public-room.mjs','/node_modules/ws/LICENSE','/package.json','/%2e%2e/runtime/node.exe','/runtime/cloudflared.exe'])assert.equal((await fetch(server.url+path)).status,404,path);
 await Promise.all([host.connect({url:server.url,token:server.token}),guest.connect({url:server.url,token:server.token})]);
 let waiting=next(host,'room');host.create({name:'Host',heroId:'scout',weaponIndex:0,mapId:'forest'});await waiting;
 let joined=next(host,'room',r=>r.players.length===2),guestJoined=next(guest,'room');guest.join({code:host.room.code,name:'Guest',heroId:'silver',weaponIndex:0});await Promise.all([joined,guestJoined]);
 waiting=next(host,'room',r=>r.players.every(p=>p.ready));host.setReady(true);guest.setReady(true);await waiting;
 let a=next(host,'room',r=>r.phase==='loading'),b=next(guest,'room',r=>r.phase==='loading');host.start();await Promise.all([a,b]);
 a=next(host,'room',r=>r.phase==='playing');b=next(guest,'room',r=>r.phase==='playing');host.loaded();guest.loaded();await Promise.all([a,b]);
 waiting=next(host,'input');guest.sendInput({moveX:1,attack:true});assert.equal((await waiting).input.attack,true);
 waiting=next(guest,'snapshot');host.sendSnapshot({time:1,players:[]});assert.equal((await waiting).data.time,1);
 waiting=next(guest,'closed');host.leave();await waiting;
 console.log(JSON.stringify({verifiedHttpResources:manifest.files.length,twoClientRoomFlow:true,hostShutdownDisconnect:true,serverSourceNotPublic:true,publicLauncherImports:true,gameplayTested:false}));
}finally{host.destroy();guest.destroy();await server.close();}
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node', type=Path, default=shutil.which('node'))
    parser.add_argument('--cloudflared', type=Path, required=True)
    parser.add_argument('--offline-package', type=Path, help='Verified native fullscreen offline ZIP to combine with the room host.')
    parser.add_argument('--test-port', type=int, default=18939, help='Temporary native-host verification port; normal launch stays on 8897.')
    args = parser.parse_args()
    if not args.node or not args.node.is_file():
        raise RuntimeError('A verified Windows x64 Node.js runtime is required to build the standalone package.')
    if not args.cloudflared.is_file():
        raise RuntimeError('Pass the verified cloudflared.exe path with its adjacent source record and Apache-2.0 license.')
    output = args.output.resolve()
    if output.is_relative_to(ROOT):
        raise RuntimeError('Choose an output directory outside the game repository.')
    manifest, payload, runtime, tunnel_source = collect_payload(args.node.resolve(), args.cloudflared.resolve())
    offline_source = None
    native_checks = None
    if args.offline_package:
        offline_source = merge_offline_package(payload, manifest, args.offline_package.resolve())
        payload['先读我-两个启动入口.txt'] = (f'''异境回响 REBORN v{manifest['version']} · Windows 单机与好友联机合包

先将整个 ZIP 全部解压到电脑的任意目录，不要直接在压缩包中运行。

自己离线玩：双击“启动异境回响.exe”，以原浏览器用户资料全屏运行。
F11 切换全屏；Esc 暂停；Alt+F4 退出。沿用 http://127.0.0.1:8897 存档来源。

邀请朋友对战：双击“START_ONLINE_ROOM.cmd”，按窗口显示的本机网址在浏览器开房，再将房间内“复制邀请”的 HTTPS 链接发给朋友。
朋友用手机或电脑浏览器打开邀请即可，不要求同一 Wi-Fi 或 VPN。房主服务和游戏页须保持打开。
联机使用独立的 8898 服务，与单机 8897 地址分开；两个入口不会自动互相同步存档。

两种入口共用 game 目录的一套完整游戏资源，请保留 game、runtime 及所有许可文件。
本次手机 APK 是离线版；手机参加好友房间使用浏览器邀请，不是在 APK 内加入。
详细说明见“先看这里-启动说明.txt”和“先读我-免VPN联机.txt”。
''').replace('\n', '\r\n').encode('utf-8-sig')
    with tempfile.TemporaryDirectory(prefix='reborn-room-package-') as temporary:
        stage = Path(temporary)
        for name, data in payload.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        checked = subprocess.run([str(stage / 'runtime/node.exe'), '--input-type=module', '-e', VERIFY], cwd=stage, capture_output=True, text=True, encoding='utf-8', timeout=90, creationflags=0x08000000)
        if checked.returncode:
            raise RuntimeError('Packaged host validation failed: ' + checked.stderr)
        validation = json.loads(checked.stdout)
        if offline_source:
            native_checks = verify_combined_native_host(stage, manifest, payload, args.test_port)
    output.mkdir(parents=True, exist_ok=True)
    suffix = 'Windows' if offline_source else 'Public-Room-Windows'
    target = output / f'Realm-Echoes-REBORN-v{manifest["version"]}-{suffix}.zip'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in payload.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(set(archive.namelist())) == len(payload)
        for name, data in payload.items():
            assert archive.read(name) == data, name
    report = {'version': manifest['version'], 'offlineBuild': manifest['build'], 'path': str(target),
              'bytes': target.stat().st_size, 'sha256': digest(target.read_bytes()), 'runtime': runtime,
              'runtimeBytes': len(payload['runtime/node.exe']), 'gameResourceBytes': manifest['bytes'],
              'allGameFilesMatchManifest': True, 'zipCrcAndBytesVerified': True, 'packagedHostChecks': validation,
              'primaryLauncher': 'START_ONLINE_ROOM.cmd', 'lanLauncher': 'START_PRIVATE_ROOM.cmd',
              'cloudflared': tunnel_source, 'cloudflaredBytes': len(payload['runtime/cloudflared.exe']),
              'publicTunnelStartedByBuilder': False,
              'tailscaleInstallerBundled': False, 'realPhoneOrRemoteNetworkTested': False, 'browserGameOpenedByBuilder': False,
              'combinedOfflineAndOnline': bool(offline_source), 'offlineSource': offline_source,
              'offlineLauncher': '启动异境回响.exe' if offline_source else None, 'combinedNativeHostChecks': native_checks,
              'packagedFiles': [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(payload.items())]}
    (output / 'public-room-package-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'packagedFiles'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
