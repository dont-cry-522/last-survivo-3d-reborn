"""Make two bounded forest templates from Quaternius' CC0 Standard MegaKit.

Run with Blender 4.5: blender --background --factory-startup --python scripts/prepare-forest-trees.py
The official archive is kept outside the game in outputs/reborn-forest-v222/sources.
No paid assets, source Blender scripts, runtime decoders or external URLs are used.
"""
from pathlib import Path
import hashlib
import json
import math
import zipfile
import bpy
import bmesh
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT.parents[1] / 'outputs/reborn-forest-v222/sources'
SOURCE = SOURCES / 'megakit/glTF'
DEST = ROOT / 'assets/environment/forest-trees-v222'
DEST.mkdir(parents=True, exist_ok=True)
ARCHIVE = SOURCES / 'stylized-nature-megakit-standard.zip'
ASSETS = [('CommonTree_1', 'woodland-canopy', 9.6, 980), ('TwistedTree_5', 'leaning-canopy', 9.4, 1100)]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
records = []

def compact_image(image, alpha=False):
    # Resize source images once; export embeds these local 512px derivatives.
    image.scale(512, 512)
    if image.colorspace_settings.name not in ('Non-Color', 'Raw'):
        # The source free kit's leaf albedos are flat lime/red, with detailed
        # alpha shapes. Match the existing scanned forest's grey-olive palette
        # without discarding those leaf outlines or the bark's luminance grain.
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape((-1, 4))
        if alpha:
            pixels[:, :3] = [.40, .47, .32]
        elif 'Bark' in image.name:
            luma = pixels[:, :3] @ np.array([.2126, .7152, .0722])
            pixels[:, :3] = np.clip(luma[:, None] / max(.01, luma.mean()) * np.array([.44, .415, .35]), 0, 1)
        image.pixels.foreach_set(pixels.ravel())
    image.file_format = 'PNG' if alpha else 'JPEG'
    path = SOURCES / ('prepared-' + image.name.split('.')[0] + ('.png' if alpha else '.jpg'))
    image.filepath_raw = str(path)
    image.save()
    result = bpy.data.images.load(str(path), check_existing=False)
    result.colorspace_settings.name = image.colorspace_settings.name
    return result

for original, name, height, trunk_budget in ASSETS:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / (original + '.gltf')))
    source = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    source.data.transform(source.matrix_world)
    source.matrix_world.identity()
    bottom = min(v.co.z for v in source.data.vertices)
    top = max(v.co.z for v in source.data.vertices)
    scale = height / (top - bottom)
    for v in source.data.vertices:
        v.co.x *= scale
        v.co.y *= scale
        v.co.z = (v.co.z - bottom) * scale
    leaf_indices = set(v for p in source.data.polygons if p.material_index == 1 for v in p.vertices)
    leaf_min = min(source.data.vertices[i].co.z for i in leaf_indices)
    lift = max(0, 3.85 - leaf_min) / max(.1, math.sin(math.pi * leaf_min / height))
    for v in source.data.vertices:
        v.co.z += lift * math.sin(math.pi * min(1, v.co.z / height))
        t = max(0, min(1, (v.co.z - 2.5) / 2.3))
        broaden = 1 + .20 * t * t * (3 - 2 * t)
        v.co.x *= broaden; v.co.y *= broaden
        # Keep the inherited collider authoritative below head height. The
        # source's asymmetric boughs and crown remain intact above the passage.
        r = math.hypot(v.co.x, v.co.y)
        allowed = .46 + max(0, v.co.z - 2.5) * 1.5
        if r > allowed:
            v.co.x *= allowed / r
            v.co.y *= allowed / r
    for mat in source.data.materials:
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Metallic'].default_value = 0
        bsdf.inputs['Roughness'].default_value = .94
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                node.image = compact_image(node.image, 'Leaves' in mat.name)
        # The source is stylized diffuse art, not a separate high-frequency
        # normal requirement. Preserve its normal map at the bounded size.
    parts = []
    for kind in [0, 1]:
        obj = source.copy()
        obj.data = source.data.copy()
        bpy.context.collection.objects.link(obj)
        bm = bmesh.new(); bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != kind], context='FACES')
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
        bm.to_mesh(obj.data); bm.free()
        for color in list(obj.data.color_attributes): obj.data.color_attributes.remove(color)
        obj.data.materials.clear(); obj.data.materials.append(source.data.materials[kind])
        for p in obj.data.polygons:
            p.material_index = 0
            p.use_smooth = kind == 0
        if kind == 0:
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new('Bounded trunk detail', 'DECIMATE')
            obj.data.calc_loop_triangles()
            modifier.ratio = min(1, trunk_budget / len(obj.data.loop_triangles))
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.name = 'SM_Tree_' + name.replace('-', '_') + '_Bark'
            parts.append(obj)
        else:
            # Decimating disconnected cards destroys their outlines. Keep
            # complete authored leaf clusters and distribute retained groups
            # over the full crown at each LOD, including its extreme lobes.
            bm = bmesh.new(); bm.from_mesh(obj.data)
            components = []; unseen = set(bm.verts)
            while unseen:
                todo = [min(unseen, key=lambda v: v.index)]; group = set(todo)
                while todo:
                    v = todo.pop()
                    for e in v.link_edges:
                        n = e.other_vert(v)
                        if n not in group: group.add(n); todo.append(n)
                unseen.difference_update(group); components.append(group)
            ids = [set(v.index for v in group) for group in components]
            centers = [sum((v.co for v in group), __import__('mathutils').Vector()) / len(group) for group in components]
            extremes = {f(range(len(centers)), key=lambda i: centers[i][axis]) for axis in range(3) for f in [min, max]}
            bm.free()
            for level, stride in [(0, 1), (1, 2), (2, 3)]:
                lod = obj.copy(); lod.data = obj.data.copy(); bpy.context.collection.objects.link(lod)
                if level:
                    bm = bmesh.new(); bm.from_mesh(lod.data); bm.verts.ensure_lookup_table()
                    remove = set().union(*(group for i, group in enumerate(ids) if i % stride and i not in extremes))
                    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in sorted(remove)], context='VERTS')
                    bm.to_mesh(lod.data); bm.free()
                # Runtime canopy uses the same 3.6m pivot as existing trees.
                for v in lod.data.vertices: v.co.z -= 3.6
                lod.name = 'SM_Tree_' + name.replace('-', '_') + '_Leaves_LOD' + str(level)
                parts.append(lod)
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    stats=[]
    for obj in parts:
        obj.select_set(True); obj.data.calc_loop_triangles()
        stats.append({'node':obj.name,'triangles':len(obj.data.loop_triangles),'vertices':len(obj.data.vertices)})
    output=DEST/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,export_yup=True,
                              export_animations=False,export_extras=False,export_image_format='AUTO')
    files=[SOURCE/(original+'.gltf'),SOURCE/(original+'.bin')]
    record={'id':name,'sourceModel':original,'sourceFiles':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in files],
            'file':output.name,'bytes':output.stat().st_size,'sha256':sha(output),'nodes':stats,'height':height,
            'leafComponents':len(ids),'canopyOffsetY':3.6,'textureMaxSize':512}
    records.append(record);print(json.dumps(record),flush=True)

manifest={'retrieved':'2026-10-19','author':'Quaternius','license':'CC0-1.0',
 'source':'https://quaternius.com/packs/stylizednaturemegakit.html','downloadPage':'https://quaternius.itch.io/stylized-nature-megakit',
 'edition':'Standard FREE','archive':{'name':ARCHIVE.name,'bytes':ARCHIVE.stat().st_size,'sha256':sha(ARCHIVE)},
 'generator':'scripts/prepare-forest-trees.py','blender':bpy.app.version_string,
 'adaptation':'Two original branching/crown meshes normalized to local forest height. Upper boughs and leaves widened together 20%; lower trunk constrained to existing collider; low crown gently lifted for eye clearance. One smooth bounded trunk and three whole-card leaf LODs preserving extreme lobes. Source UVs, alpha and normal maps retained at 512px; flat lime/red leaf albedo recoloured to grey olive, bark recoloured to grey brown preserving luminance. Runtime uses shared material, game-time wind, original obstacle objects and local URLs.',
 'assets':records}
(DEST/'sources.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
with zipfile.ZipFile(ARCHIVE) as archive:(DEST/'LICENSE.txt').write_bytes(archive.read('License_Standard.txt'))
(DEST/'CC0-1.0.txt').write_bytes((ROOT/'assets/environment/models/CC0-1.0.txt').read_bytes())
