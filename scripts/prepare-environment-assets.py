"""Download three CC0 Poly Haven meshes, make small PBR GLBs and three real LODs.

python scripts/prepare-environment-assets.py --blender /path/to/blender
Original files and licence evidence stay outside the shipping repository.
No source .blend files or embedded scripts are executed.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parents[1] / "outputs" / "art-upgrade-v213"
SOURCES = WORK / "sources" / "environment"
DEST = ROOT / "assets" / "environment" / "models"
DATE = "2026-10-18"
ASSETS = (
    ("rock_07", "weathered-rock-a", "SM_Rock_Weathered_A"),
    ("rock_09", "weathered-rock-b", "SM_Rock_Weathered_B"),
    ("tree_stump_02", "old-stump", "SM_Stump_Old_A"),
)
LICENSE_URL = "https://polyhaven.com/license"
CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(url, path, md5=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        # A descriptive User-Agent is required by Poly Haven's public API.
        request = urllib.request.Request(url, headers={"User-Agent": "ForestEchoes-AssetPreparation/213 (offline CC0 conversion)"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(request, timeout=45) as response:
            data = response.read()
        if len(data) > 25_000_000:
            raise ValueError("Unexpectedly large individual source")
        path.write_bytes(data)
    data = path.read_bytes()
    if md5 and hashlib.md5(data).hexdigest() != md5:
        raise ValueError(f"Official source checksum mismatch: {path}")
    return {"file": str(path.relative_to(SOURCES)).replace("\\", "/"),
            "url": url, "bytes": len(data), "sha256": sha(path)}


def fetch_sources():
    records = []
    evidence = []
    for url, filename in ((LICENSE_URL, "polyhaven-license.html"), (CC0_URL, "CC0-1.0.txt")):
        evidence.append(download(url, SOURCES / filename))
    for source_id, output, name in ASSETS:
        folder = SOURCES / source_id
        info = download(f"https://api.polyhaven.com/info/{source_id}", folder / "info.json")
        files = download(f"https://api.polyhaven.com/files/{source_id}", folder / "files.json")
        official = json.loads((folder / "files.json").read_text())
        gltf = official["gltf"]["1k"]["gltf"]
        selected = [(f"{source_id}_1k.gltf", gltf), *gltf["include"].items()]
        downloads = [download(item["url"], folder / local, item["md5"]) for local, item in selected]
        details = json.loads((folder / "info.json").read_text())
        records.append({"id": output, "node": name, "sourceAsset": source_id,
                        "source": f"https://polyhaven.com/a/{source_id}",
                        "authors": details.get("authors", {}), "license": "CC0-1.0",
                        "licenseURL": LICENSE_URL, "retrieved": DATE,
                        "sourceFiles": downloads, "officialMetadata": [info, files]})
        print(f"Downloaded {source_id}: {sum(x['bytes'] for x in downloads):,} bytes", flush=True)
    document = {"retrieved": DATE, "licenseEvidence": evidence, "assets": records}
    (SOURCES / "download-manifest.json").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def convert():
    import bpy
    import numpy as np
    from mathutils import Vector
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((SOURCES / "download-manifest.json").read_text())
    preview_objects = []
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for source_id, output, name in ASSETS:
        bpy.ops.object.select_all(action="DESELECT")
        before = set(bpy.data.objects)
        source_file = SOURCES / source_id / f"{source_id}_1k.gltf"
        description = json.loads(source_file.read_text())
        # The author's ARM image includes AO, but the source glTF omits its slot.
        for mat in description["materials"]:
            arm = mat["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"]
            mat["occlusionTexture"] = {"index": arm, "strength": .65}
            mat["normalTexture"]["scale"] = .75
        runtime_source = source_file.with_name("runtime-source.gltf")
        runtime_source.write_text(json.dumps(description), encoding="utf-8")
        bpy.ops.import_scene.gltf(filepath=str(runtime_source))
        imported = list(set(bpy.data.objects) - before)
        meshes = [o for o in imported if o.type == "MESH"]
        if len(meshes) != 1:
            raise ValueError(f"Expected one authored source mesh, found {len(meshes)} for {source_id}")
        source = meshes[0]
        # Rock 07 carries an unconnected source vertex-colour layer. Blender's
        # shader ignores it but GLTFLoader enables vertexColors automatically;
        # do not multiply the intended scanned base colour a second time.
        for attribute in list(source.data.color_attributes):
            source.data.color_attributes.remove(attribute)
        source.select_set(True)
        bpy.context.view_layer.objects.active = source
        # Bake source glTF orientation/scale before centring; Blender exports Y-up.
        source.data.transform(source.matrix_world)
        source.matrix_world.identity()
        bounds = [v.co for v in source.data.vertices]
        low = Vector(tuple(min(v[k] for v in bounds) for k in range(3)))
        high = Vector(tuple(max(v[k] for v in bounds) for k in range(3)))
        center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
        radius = max(math.hypot(v.x - center.x, v.y - center.y) for v in bounds)
        for vertex in source.data.vertices:
            vertex.co = (vertex.co - center) / radius
        source.data.update()
        if len(source.data.materials) != 1:
            raise ValueError(f"Expected one material for {source_id}")
        material = source.data.materials[0]
        material.name = f"M_{name[3:]}_PBR"
        material.diffuse_color = (1, 1, 1, 1)
        prepared_images = set()
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                image = node.image
                if image in prepared_images:
                    continue
                prepared_images.add(image)
                if image.packed_file:
                    image.unpack(method="REMOVE")
                image.scale(512, 512)
                pixels = np.array(image.pixels[:], dtype=np.float32).reshape((-1, 4))
                if "rough" in image.name or "arm" in image.name:
                    # Dry stone/bark should not read as glossy wet paint inland.
                    pixels[:, 1] = .62 + .38 * pixels[:, 1]
                    pixels[:, 2] = 0
                elif "diff" in image.name and source_id.startswith("rock"):
                    luminance = pixels[:, :3] @ np.array([.2126, .7152, .0722])
                    pixels[:, :3] = pixels[:, :3] * .6 + luminance[:, None] * .4
                image.pixels.foreach_set(pixels.ravel())
                image.update()
                image.file_format = "JPEG"
                image.filepath_raw = str(SOURCES / source_id / ("runtime-" + image.name.split(".")[0] + ".jpg"))
                image.save()
                # Reload saved JPEG so GLB uses the actual 512px bytes.
                image.reload()
        source.data.calc_loop_triangles()
        source_triangles = len(source.data.loop_triangles)
        lods = []
        statistics = []
        for lod, target in enumerate((1800, 700, 180)):
            model = source.copy()
            model.data = source.data.copy()
            bpy.context.collection.objects.link(model)
            model.name = f"{name}_LOD{lod}"
            model.data.name = model.name
            bpy.context.view_layer.objects.active = model
            modifier = model.modifiers.new("Offline mesh simplification", "DECIMATE")
            modifier.ratio = min(1.0, target / source_triangles)
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            model.data.calc_loop_triangles()
            for polygon in model.data.polygons:
                polygon.use_smooth = True
            model["lod"] = lod
            model["sourceAsset"] = source_id
            model["sourceLicense"] = "CC0-1.0"
            lods.append(model)
            vertices = model.data.vertices
            statistics.append({"node": model.name, "triangles": len(model.data.loop_triangles),
                               "vertices": len(vertices),
                               "horizontalRadius": max(math.hypot(v.co.x, v.co.y) for v in vertices),
                               "boundsYUp": {"min": [min(v.co.x for v in vertices), min(v.co.z for v in vertices), -max(v.co.y for v in vertices)],
                                              "max": [max(v.co.x for v in vertices), max(v.co.z for v in vertices), -min(v.co.y for v in vertices)]}})
        bpy.ops.object.select_all(action="DESELECT")
        for model in lods:
            model.select_set(True)
        path = DEST / f"{output}.glb"
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                                  export_yup=True, export_animations=False, export_extras=True,
                                  export_materials="EXPORT", export_image_format="AUTO")
        record = next(a for a in manifest["assets"] if a["id"] == output)
        record.update({"file": path.name, "bytes": path.stat().st_size, "sha256": sha(path),
                       "sourceTriangles": source_triangles, "lods": statistics,
                       "materials": 1, "textureSize": 512, "normalization": "Y-up; x/z centred; base y approximately 0; horizontal radius approximately 1 (all LODs <=1.02 after decimation)",
                       "transform": "Authored source geometry preserved, normalized, smooth shaded and decimated to three discrete meshes; original UVs retained; unused vertex colours removed; base/normal/ARM maps resized to 512 JPEG; rock base saturation reduced 40%; roughness remapped to 0.62+0.38*source; AO from ARM red enabled at 0.65 strength; normal strength 0.75; single shared PBR material."})
        print(f"Exported {output}: {record['bytes']:,} bytes; triangles {[s['triangles'] for s in statistics]}", flush=True)
        # Keep one LOD for a proof image, remove other meshes and imported source.
        preview = lods[0]
        preview.location = ((len(preview_objects) - 1) * 2.7, 0, 0)
        preview_objects.append(preview)
        for model in lods[1:] + imported:
            bpy.data.objects.remove(model, do_unlink=True)
    manifest.update({"generatedBy": "scripts/prepare-environment-assets.py", "blender": bpy.app.version_string,
                     "runtimeNotes": "Each GLB contains three overlapping LOD meshes. Select exactly one LOD; do not show all three. Existing collider dimensions remain the authority. Textures are embedded once per GLB; no Draco/KTX/meshopt extension or CDN required."})
    (DEST / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (DEST / "CC0-1.0.txt").write_bytes((SOURCES / "CC0-1.0.txt").read_bytes())
    (DEST / "LICENSE.txt").write_text("Poly Haven environment meshes, CC0 1.0 Universal.\n\nRock 07 and Rock 09 by Jenelle van Heerden.\nTree Stump 02 by Rob Tuytel.\nOfficial policy: https://polyhaven.com/license\nVerified: " + DATE + "\n\nSpecific source links, original file checksums and adaptation steps are recorded in sources.json.\nThis project's normalized 512px / LOD derivatives remain CC0.\n", encoding="utf-8")
    # Small offline render is evidence of geometry/material conversion, not game FPS.
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.name = "PreviewFloor"
    matte = bpy.data.materials.new("Preview matte")
    matte.diffuse_color = (.16, .18, .15, 1)
    floor.data.materials.append(matte)
    floor.location.z = -.02
    bpy.ops.object.camera_add(location=(4, -9, 5.5))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, .5)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 9.7
    bpy.context.scene.camera = camera
    for location, energy, size in (((-3, -4, 7), 1100, 5), ((4, 2, 5), 800, 4)):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy, light.data.shape, light.data.size = energy, "DISK", size
        light.rotation_euler = (Vector((0, 0, .5)) - light.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1200, 620, 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(WORK / "environment-models-preview.png")
    scene.world.color = (.2, .23, .27)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    if "--convert" in sys.argv:
        convert()
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--blender", required=True)
        args = parser.parse_args()
        fetch_sources()
        subprocess.run([args.blender, "--background", "--factory-startup", "--python", str(Path(__file__).resolve()), "--", "--convert"], check=True)
