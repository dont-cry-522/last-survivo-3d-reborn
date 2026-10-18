"""Small Blender mesh-only preparation helpers. Coordinates remain Three.js local space.

Load with runpy.run_path; create_mesh preserves UV/colour loops. export_glb exports
geometry only and transfers skin weights from the nearest original rest vertex.
The runtime binds these attributes to the existing skeleton, never a second rig.
"""
import json
import math
import pathlib
import struct
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

_SOURCES = {}
_METADATA = {}
_MATERIALS = {}

def _rows(values, width):
    if values is None:
        return []
    if values and isinstance(values[0], (list, tuple)):
        return [tuple(row) for row in values]
    return [tuple(values[i:i + width]) for i in range(0, len(values), width)]


def _attribute(attribute):
    values = attribute['array']
    if not attribute.get('normalized'):
        return values
    divisor = {'Uint8Array': 255, 'Uint8ClampedArray': 255, 'Uint16Array': 65535,
               'Uint32Array': 4294967295, 'Int8Array': 127, 'Int16Array': 32767,
               'Int32Array': 2147483647}.get(attribute.get('type'))
    if divisor is None:
        return values
    return [max(-1.0, value / divisor) for value in values]


def _record(record):
    if 'attributes' not in record:
        return record
    # Three.js integer BufferAttributes expose normalized floats to the GPU.
    # Blender FLOAT_COLOR/custom skin attributes must receive that same range.
    return {**record, **{name: _attribute(attribute) for name, attribute in record['attributes'].items()}}


def create_mesh(record, name=None, source=None, metadata=None):
    """Create a Blender mesh from flat arrays; source supplies unchanged rest weights."""
    record = _record(record)
    source = _record(source) if source is not None else record
    name = name or record.get('name', 'SM_Hero_Mesh')
    vertices = _rows(record['position'], 3)
    indices = record.get('index')
    if indices is None:
        indices = list(range(len(vertices)))
    faces = _rows(indices, 3)
    mesh = bpy.data.meshes.new(name + '_Geometry')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for face in mesh.polygons:
        face.use_smooth = True
    if record.get('uv') is not None:
        rows = _rows(record['uv'], 2)
        layer = mesh.uv_layers.new(name='UVMap')
        for loop in mesh.loops:
            layer.data[loop.index].uv = rows[loop.vertex_index]
    if record.get('color') is not None:
        values = record['color']
        width = len(values) // len(vertices) if not isinstance(values[0], (list, tuple)) else len(values[0])
        rows = _rows(values, width)
        if any(not 0.0 <= component <= 1.0 for row in rows for component in row):
            raise ValueError('Vertex colours must be normalized to 0..1: ' + name)
        layer = mesh.color_attributes.new(name='HeroColor', type='FLOAT_COLOR', domain='CORNER')
        for loop in mesh.loops:
            row = rows[loop.vertex_index]
            layer.data[loop.index].color = (*row[:3], row[3] if len(row) > 3 else 1.0)
    _SOURCES[obj.name] = source or record
    _METADATA[obj.name] = {'targetName': record.get('name', name), 'materialMode': 'preserve', **(metadata or {})}
    _MATERIALS[obj.name] = record.get('material', {})
    return obj


def refine(obj, bevel=0, smooth=0, iterations=2, solidify=0, decimate=1, subdivide=0):
    """Apply requested native Blender modifiers; no mesh operation is implicit."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    modifiers = []
    if subdivide:
        m = obj.modifiers.new('HeroSurfaceSubdivision', 'SUBSURF')
        m.levels = int(subdivide)
        modifiers.append(m)
    if smooth:
        m = obj.modifiers.new('HeroSurfaceRelax', 'SMOOTH')
        m.factor = float(smooth)
        m.iterations = int(iterations)
        modifiers.append(m)
    if solidify:
        m = obj.modifiers.new('HeroClothThickness', 'SOLIDIFY')
        m.thickness = float(solidify)
        m.offset = -0.5
        modifiers.append(m)
    if bevel:
        m = obj.modifiers.new('HeroWornEdges', 'BEVEL')
        m.width = float(bevel)
        m.segments = 2
        m.limit_method = 'ANGLE'
        m.angle_limit = .55
        modifiers.append(m)
    if decimate < 1:
        m = obj.modifiers.new('HeroMeshBudget', 'DECIMATE')
        m.ratio = float(decimate)
        modifiers.append(m)
    for modifier in modifiers:
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.update()
    return obj


def _material(record, name):
    if not isinstance(record, dict):
        record = {}
    color = record.get('baseColorFactor', record.get('linearColor', record.get('color', [1, 1, 1, 1])))
    if isinstance(color, int):
        color = [(color >> shift & 255) / 255 for shift in (16, 8, 0)]
    if isinstance(color, dict):
        color = [color.get(c, 1) for c in ('r', 'g', 'b')]
    color = list(color)
    if len(color) == 3:
        color.append(record.get('opacity', 1))
    return {'name': record.get('name', 'M_' + name), 'pbrMetallicRoughness': {
        'baseColorFactor': color, 'metallicFactor': record.get('metalness', record.get('metallicFactor', 0)),
        'roughnessFactor': record.get('roughness', record.get('roughnessFactor', .8))},
        'doubleSided': bool(record.get('doubleSided', record.get('side') == 2))}


def export_glb(objects, path, kind=None):
    """Write compact indexed GLB, UV/colour and normalized original skin influences.

    Each object maps to one source mesh/material. New objects may use create_mesh's
    source argument and metadata add=True. No source image bytes are duplicated:
    the runtime reuses the target mesh material unless explicitly overridden.
    """
    document = {'asset': {'version': '2.0', 'generator': 'Blender ' + bpy.app.version_string + ' / hero-blender-tools'},
                'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
    binary = bytearray()
    metrics = []

    def accessor(rows, width, component=5126, target=34962, bounds=False):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        values = [value for row in rows for value in (row if isinstance(row, tuple) else (row,))]
        if any(not math.isfinite(float(value)) for value in values):
            raise ValueError('Nonfinite geometry attribute')
        fmt = 'f' if component == 5126 else 'I'
        binary.extend(struct.pack('<' + fmt * len(values), *values))
        view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary) - offset, 'target': target})
        result = {'bufferView': view, 'componentType': component, 'count': len(rows), 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[width]}
        if bounds:
            result['min'] = [min(row[i] for row in rows) for i in range(width)]
            result['max'] = [max(row[i] for row in rows) for i in range(width)]
        document['accessors'].append(result)
        return len(document['accessors']) - 1

    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        source = _SOURCES.get(obj.name)
        if source is None:
            raise ValueError('Object must be made by create_mesh: ' + obj.name)
        source_positions = _rows(source['position'], 3)
        source_indices = _rows(source.get('skinIndex'), 4)
        source_weights = _rows(source.get('skinWeight'), 4)
        skinned = bool(source_indices and source_weights)
        tree = KDTree(len(source_positions))
        for i, position in enumerate(source_positions):
            tree.insert(position, i)
        tree.balance()
        nearest = [tree.find(vertex.co)[1] for vertex in mesh.vertices]
        surface = None
        if skinned and _METADATA[obj.name].get('weightTransfer') == 'surface':
            source_triangles = _rows(source.get('index', list(range(len(source_positions)))), 3)
            surface = BVHTree.FromPolygons(source_positions, source_triangles, all_triangles=True)
        skin = []
        for vertex_index, source_index in enumerate(nearest):
            if not skinned:
                continue
            joints, weights = source_indices[source_index], source_weights[source_index]
            if surface:
                point, _, triangle, _ = surface.find_nearest(mesh.vertices[vertex_index].co)
                if point is not None:
                    corners = source_triangles[triangle]
                    a, b, c = (Vector(source_positions[i]) for i in corners)
                    ab, ac, ap = b-a, c-a, point-a
                    aa, cc, cross = ab.dot(ab), ac.dot(ac), ab.dot(ac)
                    denominator = aa*cc-cross*cross
                    if abs(denominator)>1e-16:
                        v=(cc*ap.dot(ab)-cross*ap.dot(ac))/denominator
                        w=(aa*ap.dot(ac)-cross*ap.dot(ab))/denominator
                        factors=[max(0,min(1,q)) for q in (1-v-w,v,w)]
                        influences={}
                        for corner, factor in zip(corners, factors):
                            for joint, amount in zip(source_indices[corner],source_weights[corner]):
                                influences[joint]=influences.get(joint,0)+factor*amount
                        best=sorted(influences.items(),key=lambda item:item[1],reverse=True)[:4]
                        while len(best)<4:best.append((0,0))
                        joints,weights=zip(*best)
            clean = [(int(j), max(0.0, float(w))) for j, w in zip(joints, weights)]
            total = sum(w for _, w in clean)
            if total <= 1e-8:
                raise ValueError('Source vertex has no skin weight: ' + obj.name)
            skin.append((tuple(float(j) for j, _ in clean), tuple(w / total for _, w in clean)))
        uv_layer = mesh.uv_layers.active
        color_layer = mesh.color_attributes.get('HeroColor')
        positions, normals, uvs, colors, joints_out, weights_out, indices = [], [], [], [], [], [], []
        source_out = []
        unique = {}
        normal_matrix = obj.matrix_world.to_3x3().inverted_safe().transposed()
        for triangle in mesh.loop_triangles:
            for loop_index in triangle.loops:
                vertex_index = mesh.loops[loop_index].vertex_index
                p = tuple(obj.matrix_world @ mesh.vertices[vertex_index].co)
                normal = tuple((normal_matrix @ mesh.corner_normals[loop_index].vector).normalized())
                uv = tuple(uv_layer.data[loop_index].uv) if uv_layer else None
                color = tuple(max(0.0, min(1.0, value)) for value in color_layer.data[loop_index].color) if color_layer else None
                joint, weight = skin[vertex_index] if skinned else (None, None)
                key = (p, normal, uv, color, joint, weight)
                if key not in unique:
                    unique[key] = len(positions)
                    positions.append(p); normals.append(normal); source_out.append(nearest[vertex_index])
                    if uv is not None: uvs.append(uv)
                    if color is not None: colors.append(color)
                    if skinned: joints_out.append(joint); weights_out.append(weight)
                indices.append(unique[key])
        if not positions:
            raise ValueError('Cannot export empty mesh: ' + obj.name)
        attrs = {'POSITION': accessor(positions, 3, bounds=True), 'NORMAL': accessor(normals, 3)}
        if uvs: attrs['TEXCOORD_0'] = accessor(uvs, 2)
        if colors: attrs['COLOR_0'] = accessor(colors, 4)
        if skinned:
            attrs['_SKININDEX'] = accessor(joints_out, 4)
            attrs['_SKINWEIGHT'] = accessor(weights_out, 4)
        mat_index = len(document['materials'])
        document['materials'].append(_material(_MATERIALS[obj.name], obj.name))
        metadata = dict(_METADATA[obj.name])
        if source.get('boneNames'):
            metadata.setdefault('boneNames', source['boneNames'])
        if kind is not None: metadata.setdefault('kind', kind)
        primitive = {'attributes': attrs, 'indices': accessor(indices, 1, 5125, 34963), 'material': mat_index}
        morph = source.get('morphAttributes', {})
        target_count = max((len(values) for values in morph.values()), default=0)
        targets = []
        for target_index in range(target_count):
            target = {}
            for channel, semantic in [('position', 'POSITION'), ('normal', 'NORMAL')]:
                layers = morph.get(channel, [])
                if target_index >= len(layers):
                    continue
                attribute = layers[target_index]
                rows = _rows(attribute.get('array', attribute) if isinstance(attribute, dict) else attribute, 3)
                if not source.get('morphTargetsRelative', True):
                    base = _rows(source[channel], 3)
                    rows = [tuple(a - b for a, b in zip(row, original)) for row, original in zip(rows, base)]
                target[semantic] = accessor([tuple(rows[i]) for i in source_out], 3, bounds=semantic == 'POSITION')
            targets.append(target)
        if targets:
            primitive['targets'] = targets
        mesh_index = len(document['meshes'])
        document['meshes'].append({'name': obj.name, 'primitives': [primitive], 'extras': metadata})
        document['nodes'].append({'name': obj.name, 'mesh': mesh_index, 'extras': metadata})
        document['scenes'][0]['nodes'].append(mesh_index)
        metrics.append({'name': obj.name, 'vertices': len(positions), 'triangles': len(indices) // 3, 'skinned': skinned, **metadata})
    document['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += bytes(-len(binary) % 4)
    target = pathlib.Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('wb') as stream:
        stream.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(encoded) + 8 + len(binary)))
        stream.write(struct.pack('<II', len(encoded), 0x4E4F534A)); stream.write(encoded)
        stream.write(struct.pack('<II', len(binary), 0x004E4942)); stream.write(binary)
    return {'path': str(target), 'bytes': target.stat().st_size, 'meshes': metrics}
