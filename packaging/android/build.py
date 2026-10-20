"""Build a signed, fully local APK from the verified offline manifest (no Gradle).

Usage: python packaging/android/build.py --toolchain PATH --output PATH
Requires JDK 17, Android build-tools 35 and platform android-35. Signing identity
is private per-user state outside Git; retain it for future in-place updates.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TEXT = {'.js', '.mjs', '.py', '.cmd', '.txt', '.css', '.html', '.webmanifest', '.json', '.gltf', '.md'}


def run(args, env=None):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    if result.returncode:
        raise RuntimeError(result.stdout + '\n' + result.stderr)
    return result.stdout + result.stderr


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--toolchain', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sdk = args.toolchain.resolve()
    jdk = next((sdk / 'jdk').glob('*/bin'))
    bt = sdk / 'build-tools/android-15'
    android = sdk / 'platform/android-35/android.jar'
    manifest = json.loads((ROOT / 'offline-package.json').read_text('utf-8'))
    if manifest['version'] != '229':
        raise RuntimeError('Update Android versionCode/versionName/entry and verify before packaging another game release.')
    entries = {}
    for item in manifest['files']:
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Unsafe manifest path')
        content = (ROOT / relative).read_bytes()
        if relative.suffix in TEXT:
            content = content.replace(b'\r\n', b'\n')
        assert len(content) == item['bytes'] and digest(content) == item['sha256'], relative
        entries[item['path']] = content
    original_hashes = {path: digest(content) for path, content in entries.items()}
    entries['offline-package.json'] = (ROOT / 'offline-package.json').read_bytes()
    # Change only the package's browser-shell entry. Gameplay/modules remain exact.
    for entry in ('index.html', 'play.html'):
        old = b'<script type="module" src="offline.js?v=229"></script>'
        assert entries[entry].count(old) == 1
        entries[entry] = entries[entry].replace(old, b'<script type="module" src="app-shell.js"></script>')
    entries['app-shell.js'] = (HERE / 'app-shell.js').read_bytes()

    signing = Path.home() / '.codex/signing/realm-echoes-reborn'
    key = signing / 'release.p12'
    password_file = signing / 'release-password.txt'
    if not key.is_file() or not password_file.is_file():
        raise RuntimeError('Existing REBORN signing identity is required. Recover it; never create a replacement for an update.')
    env = os.environ.copy()
    env['REBORN_SIGN_PASSWORD'] = password_file.read_text('utf-8').strip()

    # A unique build directory avoids deleting or mixing any prior build/output.
    with tempfile.TemporaryDirectory(prefix='reborn-apk-') as temporary:
        build = Path(temporary)
        res = build / 'res/drawable'
        res.mkdir(parents=True)
        shutil.copy2(ROOT / 'assets/icons/icon-192.png', res / 'icon.png')
        run([bt / 'aapt2.exe', 'compile', '--dir', build / 'res', '-o', build / 'res.zip'])
        run([bt / 'aapt2.exe', 'link', '-o', build / 'base.apk', '-I', android, '--manifest', HERE / 'AndroidManifest.xml', build / 'res.zip'])
        classes = build / 'classes'
        classes.mkdir()
        boot = os.pathsep.join(str(path) for path in (android, bt / 'core-lambda-stubs.jar'))
        compile_log = run([jdk / 'javac.exe', '-J-Duser.language=en', '-J-Dfile.encoding=UTF-8', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', boot, '-d', classes, HERE / 'GameActivity.java'])
        run([jdk / 'jar.exe', 'cf', build / 'classes.jar', '-C', classes, '.'])
        dex = build / 'dex'
        dex.mkdir()
        run([jdk / 'java.exe', '-cp', bt / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', android, '--min-api', '29', '--output', dex, build / 'classes.jar'])
        unsigned = build / 'unsigned.apk'
        shutil.copy2(build / 'base.apk', unsigned)
        with zipfile.ZipFile(unsigned, 'a') as archive:
            archive.write(dex / 'classes.dex', 'classes.dex', compress_type=zipfile.ZIP_DEFLATED)
            archive.writestr('assets/asset-paths.txt', '\n'.join(sorted(entries)) + '\n')
            for name, content in entries.items():
                # Don't spend device CPU re-inflating formats already compressed.
                compression = zipfile.ZIP_STORED if Path(name).suffix in {'.png', '.jpg', '.webp', '.ogg', '.mp3', '.gz'} else zipfile.ZIP_DEFLATED
                archive.writestr('assets/game/' + name, content, compress_type=compression, compresslevel=6)
        aligned = build / 'aligned.apk'
        run([bt / 'zipalign.exe', '-p', '-f', '4', unsigned, aligned])
        target = output / 'Realm-Echoes-REBORN-v229.1-Android.apk'
        signer = [jdk / 'java.exe', '-jar', bt / 'lib/apksigner.jar']
        run([*signer, 'sign', '--ks', key, '--ks-key-alias', 'reborn', '--ks-pass', 'env:REBORN_SIGN_PASSWORD', '--key-pass', 'env:REBORN_SIGN_PASSWORD', '--v4-signing-enabled', 'false', '--out', target, aligned], env)
        signature = run([*signer, 'verify', '--verbose', '--print-certs', target])
        alignment = run([bt / 'zipalign.exe', '-c', '-v', '4', target])
        badging = run([bt / 'aapt.exe', 'dump', 'badging', target])
        assert "package: name='io.github.dontcry522.realmechoes.reborn'" in badging
        assert "sdkVersion:'29'" in badging
        assert "targetSdkVersion:'35'" in badging
        assert "application-debuggable" not in badging
        assert "Verified using v3 scheme (APK Signature Scheme v3): true" in signature
        assert 'Signer #1 certificate SHA-256 digest: a299073dc093a9f8f1976d0ea5e4a0a5e58c7958d5f1cee8ff4fc7371a3cd693' in signature, 'Signing certificate changed'
        assert "versionCode='22901'" in badging and "versionName='229.1'" in badging
        with zipfile.ZipFile(target) as archive:
            assert archive.testzip() is None
            for name, content in entries.items():
                assert archive.read('assets/game/' + name) == content, name
            assert len(archive.namelist()) == len(set(archive.namelist()))
        changed = [name for name in original_hashes if original_hashes[name] != digest(entries[name])]
        assert changed == ['index.html', 'play.html'], changed
        (output / 'android-signature.txt').write_text(signature, encoding='utf-8')
        (output / 'android-manifest.txt').write_text(badging, encoding='utf-8')
        report = {
            'gameVersion': manifest['version'], 'offlineBuild': manifest['build'],
            'package': 'io.github.dontcry522.realmechoes.reborn', 'versionName': '229.1', 'versionCode': 22901,
            'path': str(target), 'bytes': target.stat().st_size, 'sha256': digest(target.read_bytes()),
            'sourceManifestFilesVerified': len(manifest['files']), 'packagedGameFiles': len(entries),
            'packageOnlyHtmlChanges': changed, 'gameplayModulesChanged': False,
            'checks': ['source manifest sizes/SHA256', 'Java compilation', 'D8 dex generation', 'APK v3 signature verification (Android 10+)', 'zipalign', 'manifest package/API/debuggable', 'ZIP CRC and every packaged asset byte'],
            'deviceInstallTested': False, 'realPhonePerformanceTested': False,
            'sameCertificateAsV225': True,
            'signingKeyLocation': str(key), 'compileNotes': compile_log.strip(),
        }
        (output / 'android-package-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({k: v for k, v in report.items() if k != 'signingKeyLocation'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
