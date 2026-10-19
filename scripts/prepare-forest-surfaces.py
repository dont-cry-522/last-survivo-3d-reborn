"""Fetch two CC0 Poly Haven PBR sets; retain source checksums outside the game.

Run with a Python installation containing Pillow. This script only decodes images;
it does not execute downloaded Blender projects or third-party scripts.
"""
from pathlib import Path
from datetime import date
import hashlib
import json
import urllib.request
from PIL import Image, ImageFile

# Full-chroma normal maps need a larger JPEG optimisation buffer than Pillow's
# default block; this is a build-time allocation, not a browser texture cost.
ImageFile.MAXBLOCK = 4 * 1024 * 1024

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parents[1] / 'outputs' / 'reborn-forest-v218' / 'texture-sources'
DEST = ROOT / 'assets' / 'environment' / 'forest-reborn'
SETS = [('aerial_rocks_02', 'mossRock'), ('bark_brown_01', 'bark')]
CHANNELS = [('Diffuse', 'color'), ('nor_gl', 'normal'), ('Rough', 'roughness')]
LICENSE = 'https://polyhaven.com/license'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return destination.read_bytes()
    request = urllib.request.Request(url, headers={'User-Agent': 'ForestEchoes-Reborn/218 (local CC0 asset preparation)'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    if len(data) > 8_000_000:
        raise ValueError('Unexpectedly large image or metadata response')
    destination.write_bytes(data)
    return data


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    evidence = fetch(LICENSE, WORK / 'polyhaven-license.html')
    if b'CC0' not in evidence:
        raise ValueError('Official licence page does not mention CC0')
    records = []
    for source_id, kind in SETS:
        files = json.loads(fetch('https://api.polyhaven.com/files/' + source_id, WORK / (source_id + '-files.json')))
        info = json.loads(fetch('https://api.polyhaven.com/info/' + source_id, WORK / (source_id + '-info.json')))
        for channel, slot in CHANNELS:
            source = files[channel]['1k']['jpg']
            downloaded = WORK / (source_id + '-' + slot + '.jpg')
            data = fetch(source['url'], downloaded)
            if hashlib.md5(data).hexdigest() != source['md5'] or len(data) != source['size']:
                raise ValueError('Official source integrity mismatch: ' + downloaded.name)
            image = Image.open(downloaded)
            if image.size != (1024, 1024):
                raise ValueError('Unexpected texture dimensions: ' + str(image.size))
            # No hue/brightness adjustment. Preserve normals at full chroma resolution.
            image = image.convert('L' if slot == 'roughness' else 'RGB')
            filename = kind + '-' + slot + '-1k.jpg'
            image.save(DEST / filename, quality=92 if slot == 'normal' else 88,
                       subsampling=0 if slot == 'normal' else 2, optimize=True)
            runtime = (DEST / filename).read_bytes()
            records.append(dict(kind=kind, slot=slot, file=filename, bytes=len(runtime),
                sha256=sha(runtime), width=1024, height=1024, sourceId=source_id,
                sourcePage='https://polyhaven.com/a/' + source_id,
                authors=info['authors'], sourceURL=source['url'], sourceBytes=len(data),
                sourceMD5=source['md5'], sourceSHA256=sha(data),
                conversion='JPEG recompression, no colour adjustment; normal full-chroma quality 92; albedo/roughness quality 88'))
    manifest = dict(license='CC0-1.0', licenseURL=LICENSE,
        legalcode='https://creativecommons.org/publicdomain/zero/1.0/',
        verifiedOn=str(date.today()), licenseEvidenceSHA256=sha(evidence), files=records)
    (DEST / 'sources.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    (DEST / 'LICENSE.txt').write_text(
        'Two PBR texture sets from Poly Haven, distributed under CC0 1.0.\n'
        'Aerial Rocks 02 and Bark Brown 01 by Rob Tuytel.\n'
        'https://polyhaven.com/a/aerial_rocks_02\n'
        'https://polyhaven.com/a/bark_brown_01\n'
        'Licence: https://polyhaven.com/license\n'
        'Legal code: https://creativecommons.org/publicdomain/zero/1.0/\n'
        'Runtime derivatives are 1024x1024 JPEGs recompressed without colour adjustment.\n'
        'Original download URLs, official MD5 checksums, source and runtime SHA256 hashes,\n'
        'dimensions and byte sizes are recorded in sources.json.\n', encoding='utf-8')
    print(json.dumps({'files': len(records), 'bytes': sum(f['bytes'] for f in records),
                      'sourceBytes': sum(f['sourceBytes'] for f in records)}, indent=2))


if __name__ == '__main__':
    main()
