"""Tailor Lingya's shirt as joined cloth panels in Blender, in existing rest space.

The former ring torso and inflated sleeve tubes are replaced by one continuous
shoulder/armhole surface. Existing bare wrists, hands, head and skeleton are not
changed. Output is a geometry-only replacement bound to the original 65 bones.
"""
import copy
import json
import math
import pathlib
import runpy
import bpy
import bmesh
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from mathutils.bvhtree import BVHTree

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT.parents[1] / 'outputs' / 'character-v217'
api = runpy.run_path(str(ROOT / 'scripts' / 'hero-blender-tools.py'))
records = {m['name']: api['_record'](m) for m in json.loads((WORK / 'rest/lingya.json').read_text())['meshes']}


def smooth(a, b, x):
    t = max(0., min(1., (x-a)/(b-a)))
    return t*t*(3-2*t)


def bell(x, c, width):
    return math.exp(-((x-c)/width)**2)


def srgb(hex_value):
    def linear(v):
        return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4
    return tuple(linear(((hex_value >> n) & 255)/255) for n in (16, 8, 0))


CREAM, TRIM, RED, RED_EDGE = (srgb(c) for c in (0xE9DDC5, 0xD4BD94, 0xA75C3E, 0x7F402F))


class Surface:
    def __init__(self):
        self.positions, self.faces, self.colors, self.uvs = [], [], [], []

    def vertex(self, p, color=CREAM, uv=None):
        self.positions.append(tuple(p)); self.colors.append((*color, 1.))
        self.uvs.append(tuple(uv or (p[0]*4, p[1]*4)))
        return len(self.positions)-1

    def quad(self, a, b, c, d):
        self.faces.extend(((a,b,c), (a,c,d)))

    def grid(self, rows, columns, fn):
        ids = [[self.vertex(*fn(i/columns,j/rows)) for i in range(columns+1)] for j in range(rows+1)]
        for j in range(rows):
            for i in range(columns):
                self.quad(ids[j][i],ids[j][i+1],ids[j+1][i+1],ids[j+1][i])

    def record(self, name, material):
        return {'name':name, 'position':[x for p in self.positions for x in p],
                'index':[i for face in self.faces for i in face],
                'color':[x for c in self.colors for x in c],
                'uv':[x for uv in self.uvs for x in uv], 'material':material}


# A sewing-pattern outline. The shoulder is sloped, not a sphere. Open edges
# are hem, both sleeve ends and neck; all other front/back boundaries are sewn.
OUTLINE = [(-.141,1.095),(.141,1.095),(.137,1.16),(.151,1.275),(.160,1.345),
           (.183,1.354),(.235,1.355),(.288,1.358),(.340,1.365),
           (.340,1.466),(.287,1.472),(.230,1.480),(.181,1.489),(.113,1.497),
           (.065,1.497),(.045,1.476),(0.,1.469),(-.045,1.476),(-.065,1.497),
           (-.113,1.497),(-.181,1.489),(-.230,1.480),(-.287,1.472),(-.340,1.466),
           (-.340,1.365),(-.288,1.358),(-.235,1.355),(-.183,1.354),(-.160,1.345),
           (-.151,1.275),(-.137,1.16)]
OPEN = {0, 8, 14, 15, 16, 17, 23}
SEAMS = [(Vector(OUTLINE[i]), Vector(OUTLINE[(i+1)%len(OUTLINE)]))
         for i in range(len(OUTLINE)) if i not in OPEN]


def segment_distance(p, a, b):
    edge=b-a; t=max(0.,min(1.,(p-a).dot(edge)/edge.length_squared))
    return (p-(a+t*edge)).length


def depth(x, y):
    """Rounded cross-section measured from actual sewn boundaries, not tubes."""
    point=Vector((x,y)); distance=min(segment_distance(point,a,b) for a,b in SEAMS)
    if distance < .00001: distance=0.
    arm=smooth(.135,.235,abs(x))*smooth(1.30,1.36,y)
    maximum=(.100-.012*bell(y,1.145,.09)+.005*bell(y,1.34,.08))*(1-arm)+.052*arm
    rounding=.130*(1-arm)+.052*arm
    curve=math.sqrt(max(0.,min(1.,2*distance/rounding-(distance/rounding)**2))) if distance < rounding else 1.
    return maximum*curve, -.028*(1-arm)-.049*arm


def panel_points():
    """Tessellate a flat sewing pattern, then relax internal edge flow in Blender."""
    polygon=[Vector((x,y,0)) for x,y in OUTLINE]
    tris=tessellate_polygon([polygon]); lookup={tuple(v):i for i,v in enumerate(polygon)}
    mesh=bpy.data.meshes.new('Lingya_SewingPattern')
    mesh.from_pydata(polygon,[],[tuple(v if isinstance(v,int) else lookup[tuple(v)] for v in tri) for tri in tris])
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=8,use_grid_fill=True)
    for _ in range(14):
        updated={v:sum((e.other_vert(v).co for e in v.link_edges),Vector())/len(v.link_edges)
                 for v in bm.verts if not v.is_boundary and v.link_edges}
        for v,p in updated.items(): v.co=v.co.lerp(p,.34)
    bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.verts.ensure_lookup_table();bm.verts.index_update()
    vertices=[v.co.copy() for v in bm.verts]
    faces=[tuple(v.index for v in face.verts) for face in bm.faces]
    bm.free();bpy.data.meshes.remove(mesh)
    return vertices,faces


def blouse():
    out=Surface(); flat,faces=panel_points(); maps=[]
    for front in (1.,-1.):
        ids=[]
        for v in flat:
            x,y=v.x,v.y
            half,center=depth(x,y)
            # Small diagonal tension folds gather into the bib/waist, rather
            # than embossing the entire garment with evenly spaced sine rings.
            waist=bell(y,1.145,.066)*(1-smooth(.12,.16,abs(x)))
            fold=.0028*math.sin(x*72+abs(x)*y*31)*waist
            fold+=.0017*math.sin((y-1.34)*91+abs(x)*24)*bell(abs(x),.19,.062)*bell(y,1.37,.05)
            z=center+front*(half+fold*smooth(0.,.025,half))
            if front<0 and y>1.451 and abs(x)<.075:
                y+=.018*bell(x,0,.050)*smooth(1.451,1.476,y)
            cuff=smooth(.320,.337,abs(x)); hem=1-smooth(1.095,1.112,y)
            color=tuple(CREAM[i]*(1-.14*max(cuff,hem)) for i in range(3))
            ids.append(out.vertex((x,y,z),color))
        for face in faces:
            face=face if front>0 else tuple(reversed(face))
            out.faces.append(tuple(ids[i] for i in face))
        maps.append(ids)
    # Front and back share the exact sewn outline. Welding these vertices gives
    # the shoulder and the whole sleeve a single continuous topology.
    body=api['create_mesh'](out.record('Female_Ranger_Body',records['Female_Ranger_Body']['material']),
        source=records['Female_Ranger_Body'],metadata={'kind':'lingya','targetName':'Female_Ranger_Body',
        'materialMode':'preserve','hideTargets':['Female_Ranger_Arms_Bracer'],
        'attireRole':'tailored-continuous-blouse','weightTransfer':'surface'})
    bm=bmesh.new();bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000003)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(body.data);bm.free()
    # Tessellation happened on the flat pattern BEFORE forming the cloth.
    # Catmull-Clark on a triangular shoulder chart pulls every other seam
    # vertex inward and makes corrugated sides; retain the fitted sewing edge.
    # A single sheet also avoids a hidden solidify shell crossing the exterior.
    api['refine'](body,decimate=.90)
    bm=bmesh.new();bm.from_mesh(body.data)
    # Where a flat pattern corner sits exactly on the sewn shoulder, its two
    # projected copies can leave one tiny third face after weld/decimation.
    # Remove that planar sliver instead of hiding it with a normal/material fix.
    surplus={min(e.link_faces,key=lambda f:f.calc_area()) for e in bm.edges if len(e.link_faces)>2}
    if surplus:bmesh.ops.delete(bm,geom=list(surplus),context='FACES')
    unused=[v for v in bm.verts if not v.link_faces]
    if unused:bmesh.ops.delete(bm,geom=unused,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(body.data);bm.free()

    # Conforming bib, shoulder straps and one sewn pocket are made from cloth
    # patches. Their depth is only 2.5 mm; they do not replace the body silhouette.
    details=Surface()
    def surface(x,y,front=1,offset=.003):
        half,center=depth(x,y)
        return (x,y,center+front*(half+offset))
    def bib(u,v):
        y=1.105+.227*v; width=.077+.006*v-.005*smooth(.90,1.,v)
        x=(2*u-1)*width
        color=RED_EDGE if u<.055 or u>.945 or v>.96 else RED
        return surface(x,y,offset=.003),color,None
    details.grid(18,14,bib)
    for side in (-1.,1.):
        def strap(u,v):
            x=side*(.084+(u-.5)*.021)
            # S-shaped front/back route conforms to the round shoulder.
            angle=math.pi*v; y=1.284+.213*math.sin(angle)
            front=1. if v<.5 else -1.
            half,center=depth(x,y)
            z=center+front*(half+.0032)
            return (x,y,z),RED_EDGE if u<.12 or u>.88 else RED,None
        details.grid(46,4,strap)
    details.grid(7,8,lambda u,v:(surface((u*2-1)*(.036+.006*v),1.161+v*.065,offset=.0065),
                        RED_EDGE if v>.86 or u<.10 or u>.90 else RED,None))
    extra=api['create_mesh'](details.record('Lingya_SewnBib',records['Female_Ranger_Body']['material']),source=records['Female_Ranger_Body'])
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True);extra.select_set(True)
    bpy.context.view_layer.objects.active=body;bpy.ops.object.join()
    return body


def sampler(record, side=0):
    positions=api['_rows'](record['position'],3)
    triangles=api['_rows'](record['index'],3)
    if side:
        triangles=[t for t in triangles if all(positions[i][0]*side>0 for i in t)]
    tree=BVHTree.FromPolygons(positions,triangles,all_triangles=True)
    joints=api['_rows'](record['skinIndex'],4);weights=api['_rows'](record['skinWeight'],4)
    def at(position):
        p,normal,face,distance=tree.find_nearest(position)
        corners=triangles[face];a,b,c=(Vector(positions[i]) for i in corners)
        ab,ac,ap=b-a,c-a,p-a; aa,cc,cross=ab.dot(ab),ac.dot(ac),ab.dot(ac)
        denominator=aa*cc-cross*cross
        if abs(denominator)<1e-16: factors=(1.,0.,0.)
        else:
            v=(cc*ap.dot(ab)-cross*ap.dot(ac))/denominator
            w=(aa*ap.dot(ac)-cross*ap.dot(ab))/denominator
            factors=[max(0.,min(1.,q)) for q in (1-v-w,v,w)]
        result={}
        for corner,factor in zip(corners,factors):
            for joint,weight in zip(joints[corner],weights[corner]):
                result[int(joint)]=result.get(int(joint),0.)+weight*factor
        return result
    return at


def bind_shirt(obj):
    torso=sampler(records['Female_Ranger_Body'])
    arms={s:sampler(records['Female_Ranger_Arms_1'],s) for s in (-1,1)}
    obj.data.calc_loop_triangles()
    source={'position':[], 'index':[i for tri in obj.data.loop_triangles for i in tri.vertices],
            'skinIndex':[],'skinWeight':[],'boneNames':records['Female_Ranger_Body']['boneNames']}
    for vertex in obj.data.vertices:
        x,y,z=vertex.co; source['position'].extend(vertex.co)
        a=torso(vertex.co);b=arms[-1 if x<0 else 1](vertex.co)
        blend=smooth(.130,.230,abs(x))*smooth(1.29,1.35,y)
        merged={k:a.get(k,0.)*(1-blend)+b.get(k,0.)*blend for k in set(a)|set(b)}
        best=sorted(merged.items(),key=lambda item:item[1],reverse=True)[:4]
        while len(best)<4:best.append((0,0.))
        total=sum(w for _,w in best)
        source['skinIndex'].extend(j for j,_ in best);source['skinWeight'].extend(w/total for _,w in best)
    # The final mesh itself is the transfer reference: sampled seam weights are
    # continuous and cannot jump between the old disconnected shoulder pieces.
    api['_SOURCES'][obj.name]=source
    api['_METADATA'][obj.name]['weightTransfer']='nearest'


def bare_arms():
    source=copy.deepcopy(records['Female_Ranger_Arms_1']); source.pop('attributes',None)
    positions=api['_rows'](source['position'],3)
    # All old sleeve cap triangles lie within .329. Preserve the actual authored
    # forearms/palm back beyond the new cuff; not a newly approximated hand.
    faces=[t for t in api['_rows'](source['index'],3)
           if max(abs(positions[i][0]) for i in t)>.330 and min(abs(positions[i][0]) for i in t)>.303]
    source['index']=[i for t in faces for i in t]
    return api['create_mesh'](source,metadata={'kind':'lingya','targetName':source['name'],
        'materialMode':'preserve','attireRole':'unchanged-bare-forearms','weightTransfer':'surface'})


def shorts():
    source=copy.deepcopy(records['Superhero_Female']);source.pop('attributes',None)
    positions=api['_rows'](source['position'],3)
    colors=api['_rows'](source['color'],4);uvs=api['_rows'](source['uv'],2)
    indices=api['_rows'](source['skinIndex'],4);weights=api['_rows'](source['skinWeight'],4)
    shaped={k:[] for k in ('position','index','color','uv','skinIndex','skinWeight')}
    shaped.update(name=source['name'],material=source['material'],boneNames=source['boneNames'])
    modified=0;maximum=0.
    def original(i):
        return {'p':Vector(positions[i]),'c':colors[i],'uv':uvs[i],
                'w':{int(j):w for j,w in zip(indices[i],weights[i]) if w>0}}
    def interpolate(a,b,t):
        return {'p':a['p'].lerp(b['p'],t),'c':tuple(x+(y-x)*t for x,y in zip(a['c'],b['c'])),
                'uv':tuple(x+(y-x)*t for x,y in zip(a['uv'],b['uv'])),
                'w':{j:a['w'].get(j,0)*(1-t)+b['w'].get(j,0)*t for j in set(a['w'])|set(b['w'])}}
    def fit(p):
        x,y,z=p
        # Narrow the cloth thigh and remove the former balloon side volume.
        # Keep the midline crotch and high waist anchored to the original pelvis.
        side=1 if x>=0 else -1;center=side*.112
        influence=(1-smooth(1.055,1.125,y))*smooth(.022,.070,abs(x))
        hem=bell(y,.787,.048)
        nx=x-(x-center)*(.16+.055*hem)*influence
        nz=-.033+(z+.033)*(1-(.105+.025*hem)*influence)
        angle=math.atan2(x-center,z+.033)
        fold=.0032*math.cos(angle*4+y*19)*bell(y,.818,.045)*influence
        nx+=math.sin(angle)*fold;nz+=math.cos(angle)*fold
        return Vector((nx,y,nz))
    def add(v,cloth):
        nonlocal modified,maximum
        point=fit(v['p']) if cloth else v['p']
        if cloth:
            modified+=1;maximum=max(maximum,(point-v['p']).length)
        i=len(shaped['position'])//3;shaped['position'].extend(point)
        shaped['color'].extend((*RED_EDGE,1.) if cloth and point.y<.790 else v['c'])
        shaped['uv'].extend(v['uv'])
        best=sorted(v['w'].items(),key=lambda item:item[1],reverse=True)[:4]
        while len(best)<4:best.append((0,0.))
        total=sum(w for _,w in best);shaped['skinIndex'].extend(j for j,_ in best)
        shaped['skinWeight'].extend(w/total for _,w in best)
        return i
    for triangle in api['_rows'](source['index'],3):
        cloth=all(colors[i][0]<.60 and colors[i][1]<.30 and positions[i][1]>.70 for i in triangle)
        poly=[original(i) for i in triangle]
        if cloth:
            clipped=[]
            for j,a in enumerate(poly):
                b=poly[(j+1)%len(poly)];inside=a['p'].y>=.778;other=b['p'].y>=.778
                if inside:clipped.append(a)
                if inside!=other:clipped.append(interpolate(a,b,(.778-a['p'].y)/(b['p'].y-a['p'].y)))
            poly=clipped
        if len(poly)<3:continue
        ids=[add(v,cloth) for v in poly]
        for j in range(1,len(ids)-1):shaped['index'].extend((ids[0],ids[j],ids[j+1]))
    obj=api['create_mesh'](shaped,source=shaped,metadata={'kind':'lingya','targetName':'Superhero_Female',
        'materialMode':'preserve','attireRole':'tailored-short-overalls','weightTransfer':'surface'})
    # Source pelvis topology already has separate real leg openings. Reconnect
    # coincident cloth seams, but do not subdivide or move the exposed legs.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    return obj,{'movedClothVertices':modified,'largestClothDisplacement':maximum,'bareLegChange':0}


bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
shirt=blouse();bind_shirt(shirt);arms=bare_arms();pants,pants_metrics=shorts()
result=api['export_glb']([shirt,arms,pants],ROOT/'assets/characters/rebuilt-v217/lingya-attire.glb',kind='lingya')
result['construction']={'shirt':'continuous joined front/back sewing panels with open neck/cuffs/hem',
    'sleeveHalfHeightOld':.086,'sleeveHalfHeightNew':.0505,'shirtThickness':0,
    'boneCount':65,'headBlinkChanged':False,'handWristChanged':False,'pants':pants_metrics,
    'source':'Existing Quaternius CC0 templates and original Lingya v216 rest; no new external model'}
(WORK/'lingya-tailoring-build.json').write_text(json.dumps(result,indent=2),encoding='utf8')
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'lingya-tailoring.blend'))
print(json.dumps(result))
