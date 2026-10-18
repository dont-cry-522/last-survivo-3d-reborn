"""Fit Lingya's actual blouse, overalls and boots in Blender rest space.

Rebuild the cloth surface with subdivision/welding and sculpt broad tension
folds. Keep the source palette, seams, rig, palms and finger geometry intact.
"""
from pathlib import Path
import json
import math
import runpy
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parents[1] / 'outputs' / 'character-v215'
helpers = runpy.run_path(str(ROOT / 'scripts' / 'hero-blender-tools.py'))
create_mesh, refine, export_glb = (helpers[k] for k in ('create_mesh', 'refine', 'export_glb'))


def bell(x, c, w):
    return math.exp(-((x-c)/w)**2)


def smooth(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)


def weld(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()


def sculpt(obj, part):
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        a = math.atan2(x, z+.028)
        if part == 'blouse':
            # The raised bib/pocket remains separate topology. Folds gather
            # underneath the two straps and tuck into the overall waistband.
            front = smooth(-.035, .055, z)
            waist = bell(y, 1.13, .10)
            side = smooth(.095, .15, abs(x))
            fold = .0042*math.sin(a*9+.6)*waist + .0034*math.sin(y*53+a*2)*side*bell(y,1.29,.16)
            vertex.co.x += math.sin(a)*fold
            vertex.co.z += math.cos(a)*fold
            # Lift the pocket rim and give the sewn bib a softly folded edge.
            vertex.co.z += .0035*bell(y,1.232,.011)*bell(x,0,.055)*front
        elif part == 'sleeves':
            if abs(x) >= .60:
                continue
            t = abs(x); angle = math.atan2(z+.049, y-1.415)
            cuff = bell(t,.305,.038)
            shoulder = bell(t,.225,.067)
            # Cotton gathered into the cuff: broad rounded shoulder and
            # asymmetric creases instead of a perfectly inflated sphere.
            displacement = -.0045*shoulder + .0035*math.cos(angle*7+t*12)*cuff
            displacement += .0025*math.sin(angle*3+.5)*shoulder
            vertex.co.y += math.cos(angle)*displacement
            vertex.co.z += math.sin(angle)*displacement
        elif part == 'shorts':
            if y < .755:
                continue
            cx = math.copysign(.112,x); angle = math.atan2(x-cx,z+.033)
            hem = bell(y,.79,.035)
            thigh = bell(y,.885,.070)
            displacement = .0037*math.sin(angle*7+y*24)*hem+.0033*math.cos(angle*3-y*30)*thigh
            vertex.co.x += math.sin(angle)*displacement
            vertex.co.z += math.cos(angle)*displacement
        elif part == 'boots':
            cx=math.copysign(.10,x); angle=math.atan2(x-cx,z+.033)
            ankle=bell(y,.145,.050)
            displacement=.0027*math.sin(y*103+angle*2)*ankle
            vertex.co.x += math.sin(angle)*displacement
            vertex.co.z += math.cos(angle)*displacement
            # Broaden the forefoot into an almond toe; retain floor contact.
            if z>.055 and y<.11:
                vertex.co.x = cx+(vertex.co.x-cx)*1.065
            if y<.020:
                vertex.co.y=max(.004,vertex.co.y)
    obj.data.update()


bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
data=json.loads((WORK/'rest/lingya.json').read_text())
records={m['name']:m for m in data['meshes']}
objects=[]
slots=[('Female_Ranger_Body','blouse'),('Female_Ranger_Arms_1','sleeves'),
       ('Superhero_Female','shorts'),('Female_Ranger_Feet','boots')]
for name,part in slots:
    source=records[name]
    obj=create_mesh(source,metadata={'kind':'lingya','targetName':name,'materialMode':'preserve','attireRole':part,'weightTransfer':'surface'})
    weld(obj)
    # Blouse and boots gain real continuous curvature. Do not subdivide the
    # wrist/palm boundary: it joins unchanged fingers in another mesh.
    if part in ('blouse','boots'):
        refine(obj,subdivide=1,smooth=.06,iterations=1)
    sculpt(obj,part)
    if part in ('blouse','boots'):
        refine(obj,decimate=.30 if part=='blouse' else .30)
    elif part=='shorts':
        refine(obj,smooth=.035,iterations=1)
    objects.append(obj)
result=export_glb(objects,ROOT/'assets/characters/rebuilt-v215/lingya-attire.glb',kind='lingya')
(WORK/'lingya-attire-build.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
