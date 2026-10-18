"""Tide's own face and tailored upper sleeves, authored on immutable v216 rest.

No armature, animation, socket, texture, or gameplay replacement. Output location
is explicit so a candidate cannot silently become a running game asset.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import runpy
import sys

import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', type=Path, required=True)
parser.add_argument('--part', choices=['head', 'attire', 'all'], default='all')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
REPO = Path(__file__).resolve().parents[1]
WORKSPACE = REPO.parents[1]
REST_PATH = WORKSPACE / 'outputs/character-v217/rest/tide.json'
rest_bytes = REST_PATH.read_bytes()
REST = json.loads(rest_bytes)
RECORDS = {m['name']: m for m in REST['meshes']}
TOOLS = runpy.run_path(str(REPO / 'scripts/hero-blender-tools.py'))


def smooth(a, b, value):
    t = max(0.0, min(1.0, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bell(value, centre, width):
    return math.exp(-((value - centre) / width) ** 2)


def record(name):
    result = TOOLS['_record'](copy.deepcopy(RECORDS[name]))
    result.pop('attributes', None)
    return result


def make(name, sculpt=None, description='Existing v216 garment retained exactly'):
    data = record(name)
    source = copy.deepcopy(data)
    original = data['position'][:]
    anchors = []
    for i in range(len(original) // 3):
        p = tuple(original[i * 3:i * 3 + 3])
        edited, anchor = sculpt(*p) if sculpt else (p, True)
        data['position'][i * 3:i * 3 + 3] = edited
        anchors.append(anchor)
    # Topology/vertex correspondence stays exact. Moving the sampling anchors
    # with those vertices avoids borrowing cheek/shoulder weights from neighbours.
    source['position'] = data['position'][:]
    obj = TOOLS['create_mesh'](data, source=source, metadata={
        'kind': 'tide', 'materialMode': 'preserve', 'revision': 217,
        'modelWork': description,
    })
    obj.data.update()
    if sculpt is None and data.get('normal'):
        # Retained hair/garment targets must also retain their authored normals;
        # recalculating an unrelated UV seam would create a cosmetic regression.
        obj.data.normals_split_custom_set_from_vertices([
            tuple(data['normal'][i:i + 3]) for i in range(0, len(data['normal']), 3)
        ])
    displacements = [math.dist(original[i * 3:i * 3 + 3], data['position'][i * 3:i * 3 + 3])
                     for i in range(len(original) // 3)]
    anchor_error = max((d for d, frozen in zip(displacements, anchors) if frozen), default=0)
    assert anchor_error < 1e-8, (name, 'Protected anchors changed', anchor_error)
    return obj, {'target': name, 'vertices': len(original) // 3,
                 'triangles': len(data['index']) // 3,
                 'changedVertices': sum(d > 1e-6 for d in displacements),
                 'maximumDisplacementMm': max(displacements, default=0) * 1000,
                 'protectedVertices': sum(anchors), 'protectedError': anchor_error}


def face(x, y, z):
    # These are the true registration bounds of the existing eyes. The neck,
    # hairline, rear cranium and eye surroundings remain fixed, unlike a global
    # head squash/scale. Her expression has a broader, firmer lower-face profile.
    ocular = .012 < abs(x) < .061 and 1.633 < y < 1.681 and z > .020
    frozen = ocular or y < 1.515 or y > 1.718 or z < .005
    if frozen:
        return (x, y, z), True
    front = smooth(.005, .055, z)
    cheek = bell(y, 1.612, .027) * bell(abs(x), .056, .027) * front
    jaw = bell(y, 1.567, .024) * smooth(.024, .069, abs(x)) * front
    chin = bell(y, 1.542, .021) * bell(x, 0, .036) * front
    muzzle = bell(y, 1.582, .021) * bell(x, 0, .031) * front
    bridge = bell(y, 1.650, .022) * bell(x, 0, .009) * front
    tip = bell(y, 1.624, .012) * bell(x, 0, .018) * front
    sign = 1 if x > 0 else -1
    return (x + sign * (.0055 * cheek + .006 * jaw),
            y - .0035 * chin,
            z + .0048 * cheek + .0032 * jaw - .0025 * muzzle
            + .004 * bridge - .0035 * tip + .0022 * chin), False


def brows(x, y, z):
    # Keep the original eye attachment and make her brows straighter at the
    # inner third. This is a geometric arc, not another dark face primitive.
    amount = (1 - smooth(.016, .046, abs(x)))
    return (x, y - .0018 * amount, z), amount == 0


def sleeves(x, y, z):
    # Sleeve-cap and cuff contacts stay exact. Flatten the inflated bicep bulge
    # into a practical rolled working sleeve, including an elbow compression fold.
    ax = abs(x)
    amount = smooth(.18, .22, ax) * (1 - smooth(.36, .395, ax))
    if amount <= 0:
        return (x, y, z), True
    centre_y, centre_z = 1.411, -.049
    radius_y, radius_z = y - centre_y, z - centre_z
    upper = smooth(-.006, .055, radius_y)
    fold = .0018 * math.sin((ax - .21) * 67) * bell(ax, .345, .037)
    return (x,
            centre_y + radius_y * (1 - .13 * amount) - .004 * amount * upper + fold,
            centre_z + radius_z * (1 - .095 * amount)), False


HEAD = ['Superhero_Female', 'Eyebrows', 'Hair_Buns']
# Keep every already-delivered v215 outfit target in this complete part. Otherwise
# selecting the new attire file would unintentionally undo the old fitted panels.
ATTIRE = [
    'Female_Peasant_Body', 'Female_Peasant_Arms', 'Female_Peasant_Feet',
    'SM_Hero_Tide_WovenLeatherVest', 'SM_Hero_Tide_FoldedOpenCollar',
    'SM_Hero_Tide_WovenAbdomenGuard', 'SM_Hero_Tide_FittedHarness',
    'SM_Hero_Tide_HarnessFastener', 'SM_Hero_Tide_SplitDeckCoat',
]
results = []
for part in (['head', 'attire'] if args.part == 'all' else [args.part]):
    objects, changes = [], []
    for name in HEAD if part == 'head' else ATTIRE:
        sculpt, description = None, 'v216 surface retained with original rig and fit'
        if name == 'Superhero_Female':
            sculpt, description = face, 'Distinct Tide cheek, jaw, chin and nasal profile; eye/neck/hair anchors frozen'
        elif name == 'Eyebrows':
            sculpt, description = brows, 'Tide straight inner brow arc; original eye registration retained'
        elif name == 'Female_Peasant_Arms':
            sculpt, description = sleeves, 'Tailored upper working sleeves; mantle, cuff and hand contacts retained'
        obj, changed = make(name, sculpt, description)
        objects.append(obj)
        changes.append(changed)
    dest = args.output_dir / f'tide-{part}.glb'
    result = TOOLS['export_glb'](objects, dest, kind='tide')
    result.update({'part': part, 'changes': changes, 'sourceRest': str(REST_PATH),
                   'sourceSHA256': hashlib.sha256(rest_bytes).hexdigest(),
                   'script': 'scripts/prepare-tide-v217.py',
                   'license': 'Existing CC0 Quaternius meshes; local authored sculpt, no new external character'})
    results.append(result)
args.output_dir.mkdir(parents=True, exist_ok=True)
(args.output_dir / 'tide-v217-build.json').write_text(json.dumps(results, indent=2), encoding='utf8')
print(json.dumps(results))
