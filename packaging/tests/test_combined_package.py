"""Exercise real ZIP merge failure cases without building or launching the game."""
from pathlib import Path
import copy
import importlib.util
import json
import tempfile
import unittest
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('room_builder', ROOT / 'packaging/rooms/build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class CombinedPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='reborn-merge-test-')
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.archive = self.folder / 'offline.zip'
        game = {'play.html': b'<html>game</html>', 'main.js': b'export const version=228;'}
        self.manifest = {'version': '228', 'build': '228-fixture', 'files': [
            {'path': path, 'bytes': len(data), 'sha256': builder.digest(data)} for path, data in game.items()]}
        self.offline = {'game/' + path: data for path, data in game.items()}
        self.offline.update({
            'game/offline-package.json': json.dumps(self.manifest).encode(),
            'asset-paths.txt': b'play.html\nmain.js\noffline-package.json\n',
            '启动异境回响.exe': b'MZ-native-launcher-fixture',
            '先看这里-启动说明.txt': b'offline instructions'})
        self.payload = {'game/' + path: data for path, data in game.items()}
        self.payload.update({'game/offline-package.json': self.offline['game/offline-package.json'],
                             'runtime/node.exe': b'node-fixture', 'START_ONLINE_ROOM.cmd': b'room launcher'})
        self.report = {
            'version': '228', 'offlineBuild': '228-fixture', 'launcherBytes': len(self.offline['启动异境回响.exe']),
            'launcherSHA256': builder.digest(self.offline['启动异境回响.exe']),
            'allGameFilesByteIdenticalToVerifiedManifest': True, 'zipCrcAndEveryEntry': True,
            'nativeHost': {'resourcesServedAndHashVerified': len(game), **{key: True for key in (
                'moduleMime', 'compressedAssetsNotDoubleDecoded', 'httpKeepAlive', 'headAndRanges',
                'queryStrings', 'whitelistAndPathTraversal', 'loopbackHostValidation',
                'gracefulShutdownAndPortReuse', 'noNodeOrPythonRequiredToPlay')}}}
        self.write_archive()

    def write_archive(self, extra=None):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, data in self.offline.items():
                archive.writestr(name, data)
            if extra:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    archive.writestr(*extra)
        self.report.update(bytes=self.archive.stat().st_size, sha256=builder.digest(self.archive.read_bytes()))
        self.write_report()

    def write_report(self):
        (self.folder / 'pc-package-verification.json').write_text(json.dumps(self.report), 'utf-8')

    def rejected_without_mutation(self):
        original = copy.deepcopy(self.payload)
        with self.assertRaises(RuntimeError):
            builder.merge_offline_package(self.payload, self.manifest, self.archive)
        self.assertEqual(self.payload, original)

    def test_merge_preserves_shared_resources_and_both_launchers(self):
        original = copy.deepcopy(self.payload)
        report = builder.merge_offline_package(self.payload, self.manifest, self.archive)
        self.assertTrue(report['allSharedFilesByteIdentical'])
        self.assertEqual(report['sharedFilesByteIdentical'], 3)
        self.assertEqual(report['origin'], 'http://127.0.0.1:8897')
        self.assertFalse(report['browserProfileChanged'])
        self.assertEqual(len(self.payload), len(original) + 3)
        for name, data in original.items():
            self.assertEqual(self.payload[name], data)
        self.assertIn('启动异境回响.exe', self.payload)
        self.assertIn('START_ONLINE_ROOM.cmd', self.payload)

    def test_different_shared_bytes_are_rejected_atomically(self):
        self.payload['game/main.js'] = b'unrelated newer source'
        self.rejected_without_mutation()

    def test_different_manifest_bytes_are_rejected(self):
        self.payload['game/offline-package.json'] += b'\n'
        self.rejected_without_mutation()

    def test_same_version_but_stale_build_is_rejected(self):
        self.report['offlineBuild'] = '228-older'
        self.write_report()
        self.rejected_without_mutation()

    def test_report_cannot_mask_invalid_resource(self):
        self.offline['game/main.js'] = b'tampered source'
        self.write_archive()
        self.rejected_without_mutation()

    def test_launcher_replacement_is_rejected(self):
        self.offline['启动异境回响.exe'] = b'MZ-different-launcher'
        self.write_archive()
        self.rejected_without_mutation()

    def test_unverified_native_host_is_rejected(self):
        self.report['nativeHost']['gracefulShutdownAndPortReuse'] = False
        self.write_report()
        self.rejected_without_mutation()

    def test_zip_digest_mismatch_is_rejected(self):
        self.report['sha256'] = '0' * 64
        self.write_report()
        self.rejected_without_mutation()

    def test_duplicate_zip_entry_is_rejected(self):
        self.write_archive(('game/main.js', self.offline['game/main.js']))
        self.rejected_without_mutation()

    def test_path_traversal_extra_is_rejected(self):
        self.write_archive(('../outside.txt', b'bad path'))
        self.rejected_without_mutation()

    def test_unexpected_private_file_is_rejected(self):
        self.write_archive(('release.p12', b'not a real key'))
        self.rejected_without_mutation()

    def test_changed_native_whitelist_is_rejected(self):
        self.offline['asset-paths.txt'] += b'../outside.txt\n'
        self.write_archive()
        self.rejected_without_mutation()


if __name__ == '__main__':
    unittest.main()
