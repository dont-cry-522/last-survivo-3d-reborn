"""Refine the three masked heroes in Blender, leaving the v215 exports intact.

The v215 author script supplies already fitted rest-space shells. This pass
rebuilds their quad flow, relaxes the broad forms and folds the real perimeter;
the runtime still owns the original skeleton, materials, mask insets and hair.
Run: blender --background --python scripts/prepare-mist-heroes-v216.py
"""
from pathlib import Path
import json
import math
import runpy
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[1]
BASE=runpy.run_path(str(ROOT/'scripts'/'prepare-mist-heroes.py'))
HELP=BASE['HELPERS']
DEST=ROOT/'assets'/'characters'/'rebuilt-v216'
OUT=ROOT.parents[1]/'outputs'/'character-v216'
SOURCE=ROOT.parents[1]/'outputs'/'character-v215'/'rest'
bell,smooth=BASE['bell'],BASE['smooth']


def quad_surface(obj,ratio=.47):
    """DCC retopology and subdivision keep broad surfaces smooth at a fixed budget."""
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.join_triangles(bm,faces=list(bm.faces),angle_face_threshold=.60,
                             angle_shape_threshold=.80,cmp_uvs=True,cmp_vcols=False)
    bm.normal_update();bm.to_mesh(obj.data);bm.free()
    HELP['refine'](obj,subdivide=1,decimate=ratio)
    HELP['_METADATA'][obj.name]['weightTransfer']='surface'
    HELP['_METADATA'][obj.name]['revision']=216
    HELP['_METADATA'][obj.name]['construction']='Blender-quad-retopology-subdivision-sculpt'


def tailored_coat(source,kind):
    obj=BASE['garment'](source,kind)
    # A supported shoulder and hanging cloth have different fold directions.
    # These are folds in the same surface, without another armour panel mesh.
    for vertex in obj.data.vertices:
        x,y,z=vertex.co;a=math.atan2(x,z+.03);front=max(0,math.cos(a))
        waist=bell(y,1.18,.13);hem=1-smooth(y,.93,1.15)
        if kind=='wraith':
            # Broad, round mantle shoulders over restrained vertical fluting.
            relief=.006*bell(y,1.43,.07)*abs(math.sin(a))**2
            relief+=.004*math.sin(a*4+.3)*hem
            z+=.0045*bell(abs(a),.52,.12)*bell(y,1.36,.09)*front
        elif kind=='wuling':
            # Cloth gathers toward the diagonal fastening, then releases.
            relief=.0058*math.sin(a*5+y*6)*waist
            relief+=.006*math.cos(a*6+.5)*hem
            z+=.0065*bell(a,.44,.11)*bell(y,1.28,.15)*front
        else:
            # Long narrow folds descend from the fitted waist to a petal hem.
            relief=.0045*math.sin(a*6-.3)*hem
            relief+=.0032*math.cos(a*8+y*10)*waist
            z+=.0048*bell(abs(a),.36,.09)*bell(y,1.27,.15)*front
        vertex.co.x=x+math.sin(a)*relief
        vertex.co.z=z+math.cos(a)*relief
    quad_surface(obj,.42)
    return obj


def draped_hood(source,kind):
    obj=BASE['cloth_hood'](source,kind)
    for vertex in obj.data.vertices:
        x,y,z=vertex.co
        if kind=='wraith':
            # Roll the opening back into its lining and let gravity pull the
            # lower folds, instead of forming an inflated pointed helmet.
            front=smooth(z,-.025,.075);low=1-smooth(y,1.59,1.72)
            x*=1-.025*front*bell(y,1.70,.09)
            z-=.004*front*bell(abs(x),.12,.045)
            y-=.009*low*(.55+.45*math.cos(x*28))
        else:
            # Soft gathering-hood crown and turned opening remain distinct
            # from the traveller's open drape and mirage's uncovered hair.
            side=smooth(abs(x),.07,.14)
            z-=.004*side*bell(y,1.64,.10)
            y-=.006*side*(1-smooth(y,1.57,1.70))
        vertex.co=(x,y,z)
    quad_surface(obj,.48)
    return obj


def full_mask(source,kind,skin):
    obj=BASE['mask_surface'](source,kind)
    for vertex in obj.data.vertices:
        x,y,z=vertex.co;ax=abs(x)
        if kind=='wraith':
            # The shadow veil is taut over the bridge, free at the jaw. Avoid
            # sculpting a visible mouth or a second human face into the cloth.
            z+=.004*bell(y,1.61,.040)*(1-smooth(ax,.025,.075))
            z+=.0022*math.sin(x*48+.4)*bell(y,1.60,.042)
        else:
            eye_y=1.670-.009*min(1,max(0,(ax-.018)/.048)) if kind=='wuling' else 1.670+(ax-.044)*.16
            z-=.0022*bell(ax,.043,.026)*bell(y,eye_y,.011)
            z+=.0030*bell(ax,.054,.026)*bell(y,1.625,.023)
            # Broad lower face replaces inflated lip-like curvature.
            z+=.0028*bell(x,0,.036)*bell(y,1.585,.024)
            x*=1-.018*bell(y,1.56,.025)
        vertex.co=(x,y,z)
    quad_surface(obj,.52)
    # Subdivision can shrink a fitted shell into its original nose. Refit the
    # forward-facing surface to that actual skin, leaving the turned rim alone.
    position=skin['attributes']['position']['array'];indices=skin['index']
    surface=BVHTree.FromPolygons([tuple(position[i:i+3]) for i in range(0,len(position),3)],
                                [tuple(indices[i:i+3]) for i in range(0,len(indices),3)],all_triangles=True)
    for vertex in obj.data.vertices:
        if vertex.normal.z<.35:continue
        hit=surface.ray_cast(Vector((vertex.co.x,vertex.co.y,1)),Vector((0,0,-1)),2)[0]
        if hit is not None:vertex.co.z=max(vertex.co.z,hit.z+.0045)
    obj.data.update()
    return obj


def flowing_hair(source):
    obj=BASE['long_hair'](source)
    # Refine the extended rear strands only. Crown, fringe and the contact
    # roots retain their source silhouette and animation attachments.
    bm=bmesh.new();bm.from_mesh(obj.data)
    edges=[edge for edge in bm.edges if edge.calc_length()>.026
           and all(v.co.y<1.65 and v.co.z<-.065 for v in edge.verts)]
    if edges:bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
    loose=[v for v in bm.verts if v.co.y<1.59 and v.co.z<-.09]
    for _ in range(2):
        bmesh.ops.smooth_vert(bm,verts=loose,factor=.14,use_axis_x=True,use_axis_y=True,use_axis_z=True)
    for vertex in loose:
        x,y,z=vertex.co;fall=1-smooth(y,1.10,1.61)
        vertex.co.x+=.006*math.sin(fall*math.pi*1.6+x*9)*fall
        vertex.co.z+=.004*math.sin(x*46+fall*2)*math.sin(fall*math.pi)
    bm.normal_update();bm.to_mesh(obj.data);bm.free()
    HELP['_METADATA'][obj.name].update(revision=216,weightTransfer='surface',
        construction='Blender-longitudinal-strand-subdivision-relaxed-roots-fixed')
    return obj


def build(kind):
    data=json.loads((SOURCE/(kind+'.json')).read_text(encoding='utf-8'))
    accessories=json.loads((SOURCE/(kind+'-accessories.json')).read_text(encoding='utf-8'))['accessories']
    body=next(m for m in data['meshes'] if m['name'].endswith('_Body'))
    mask=next(m for m in accessories if m['name']=={'wraith':'wraith-shadow-veil','wuling':'wuling-full-mask','mirage':'mirage-full-mask'}[kind])
    skin=next(m for m in data['meshes'] if 'superhero' in m['name'].lower())
    attire=[tailored_coat(body,kind)];head=[full_mask(mask,kind,skin)]
    if kind=='mirage':head.insert(0,flowing_hair(next(m for m in data['meshes'] if m['name']=='Hair_Long')))
    else:head.insert(0,draped_hood(next(m for m in data['meshes'] if m['name'].endswith('_Head_Hood')),kind))
    results=[HELP['export_glb'](attire,DEST/(kind+'-attire.glb'),kind),HELP['export_glb'](head,DEST/(kind+'-head.glb'),kind)]
    for obj in attire+head:bpy.data.objects.remove(obj,do_unlink=True)
    return results


if __name__=='__main__':
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    results=[asset for kind in ['wraith','wuling','mirage'] for asset in build(kind)]
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'mist-heroes-build.json').write_text(json.dumps({'blender':bpy.app.version_string,'assets':results},indent=2),encoding='utf-8')
    print(json.dumps({'generated':[{k:r[k] for k in ('path','bytes')} for r in results]}))
