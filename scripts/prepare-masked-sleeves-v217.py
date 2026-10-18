"""Fit the masked heroes' existing sleeves and boots in Blender rest space.

The v216 coat/hood/mask remains intact. This corrects the round pipe forearm,
oversized cuffs and featureless ankle profile, keeping all finger/wrist points
and shoulder attachment locations. Run only after the garment pilot is accepted.
"""
from pathlib import Path
import json, math, runpy
import bpy, bmesh

ROOT=Path(__file__).resolve().parents[1]
REST=ROOT.parents[1]/'outputs'/'character-v217'/'rest'
OUT=ROOT/'assets'/'characters'/'rebuilt-v217'
HELP=runpy.run_path(str(ROOT/'scripts'/'hero-blender-tools.py'))
bell=lambda x,c,w:math.exp(-((x-c)/w)**2)
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)

def prepare(record,kind,part):
 obj=HELP['create_mesh'](record,name='SM_Hero_'+kind+'_'+part+'_v217',metadata={'revision':217,'construction':'Blender-fitted-sleeve-and-ankle-surface','weightTransfer':'surface'})
 if part=='coat':return obj
 if kind=='wraith':
  # Source sleeves are an authored human arm: keep their silhouette and skin
  # registration, relax only the large elbow lumps below the shoulder seam.
  if part=='sleeves':
   for vertex in obj.data.vertices:
    x,y,z=vertex.co;w=bell(abs(x),.42,.065)
    vertex.co.y=1.414+(y-1.414)*(1-.07*w)
    vertex.co.z=-.049+(z+.049)*(1-.09*w)
 else:
  for vertex in obj.data.vertices:
   x,y,z=vertex.co;ax=abs(x)
   if part=='sleeves' and .16<ax<.62:
    fade=smooth(.16,.23,ax)*(1-smooth(.59,.62,ax))
    angle=math.atan2(z+.049,y-1.415)
    # Elbow cloth compresses on the inside and stretches across the outside;
    # a fitted forearm replaces the old even-radius pipe.
    taper=(.12 if kind=='wuling' else .18)*bell(ax,.44,.13)*fade
    crease=.003*math.sin((ax-.39)*65+angle*.5)*bell(ax,.41,.05)*fade
    vertex.co.y=1.415+(y-1.415)*(1-taper)+math.cos(angle)*crease
    vertex.co.z=-.049+(z+.049)*(1-taper*.85)+math.sin(angle)*crease*.7
   elif part=='cuffs':
    # Keep the existing open cuff and border colours, reshape its section.
    factor=.86 if kind=='wuling' else .82
    vertex.co.y=1.415+(y-1.415)*factor
    vertex.co.z=-.049+(z+.049)*factor
   elif part=='boots' and y>.075:
    center=(1 if x>=0 else -1)*(.10+.025*smooth(.30,.97,y))
    ankle=bell(y,.16,.09);calf=bell(y,.36,.12)
    vertex.co.x=center+(x-center)*(1-.14*ankle+.025*calf)
    vertex.co.z=-.032+(z+.032)*(1-.09*ankle)
    # Shallow tension at the ankle, rather than repeated rings up the shaft.
    vertex.co.z+=.003*math.sin(y*88)*bell(y,.21,.04)*(1-smooth(.02,.07,abs(x-center)))
 # Weld only exact UV duplicates. Corner attributes retain the original UV and
 # vertex palette; no topology inflation is required to repair seam normals.
 bm=bmesh.new();bm.from_mesh(obj.data)
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
 bm.normal_update();bm.to_mesh(obj.data);bm.free();obj.data.update()
 return obj

def build(kind):
 data=json.loads((REST/(kind+'.json')).read_text(encoding='utf-8'))
 prefix='Male_Ranger' if kind=='wraith' else 'Female_Ranger'
 slots=[(prefix+'_Body','coat'),(prefix+'_Arms_1','sleeves')]
 if kind!='wraith':slots += [(prefix+'_Arms_Bracer','cuffs'),(prefix+'_Feet','boots')]
 objects=[prepare(next(m for m in data['meshes'] if m['name']==name),kind,part) for name,part in slots]
 result=HELP['export_glb'](objects,OUT/(kind+'-attire.glb'),kind)
 for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
 return result

if __name__=='__main__':
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 OUT.mkdir(parents=True,exist_ok=True)
 records=[build(kind) for kind in ['wraith','wuling','mirage']]
 report=ROOT.parents[1]/'outputs'/'character-v217'/'masked-sleeves-build.json'
 report.write_text(json.dumps({'blender':bpy.app.version_string,'assets':records},indent=2),encoding='utf-8')
 print(json.dumps([{'path':r['path'],'bytes':r['bytes']} for r in records]))
