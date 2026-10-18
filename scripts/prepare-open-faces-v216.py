"""Native Blender head/hairstyle refinement on the actual v215 rest surfaces.

Keeps the existing 65-bone rig and all sockets; no armature retargeting. Lingya's
eye socket and Blink vertices are frozen while the mouth/cheek planes are sculpted.
"""
import argparse, copy, json, math, pathlib, runpy, struct, sys
import bpy, bmesh

parser=argparse.ArgumentParser()
parser.add_argument('--workspace',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[3])
parser.add_argument('--kind',choices=['lingya','scout','silver','tide'],default='lingya')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
repo=pathlib.Path(__file__).resolve().parents[1];workspace=args.workspace
api=runpy.run_path(str(repo/'scripts/hero-blender-tools.py'))
kind=args.kind
rest=json.loads((workspace/f'outputs/character-v216/rest/{kind}.json').read_text())
records={m['name']:m for m in rest['meshes'] if m['visible']}
outputs=[];measurements=[]

def gauss(value,width): return math.exp(-(value/width)**2)
def smooth(a,b,value):
 t=max(0,min(1,(value-a)/(b-a)));return t*t*(3-2*t)
def record(name):
 r=api['_record'](copy.deepcopy(records[name]));r.pop('attributes',None);return r
def native_smooth(obj,weights,strength,iterations):
 group=obj.vertex_groups.new(name='ContinuousFaceSculpt')
 for i,w in enumerate(weights):
  if w>1e-7:group.add([i],w,'REPLACE')
 bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 modifier=obj.modifiers.new('LocalFacialPlaneRelax','SMOOTH');modifier.factor=strength
 modifier.iterations=iterations;modifier.vertex_group=group.name
 bpy.ops.object.modifier_apply(modifier=modifier.name)
 obj.select_set(False)
def weld_seams(obj):
 bm=bmesh.new();bm.from_mesh(obj.data)
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000003)
 bm.to_mesh(obj.data);bm.free();obj.data.update()

if kind=='lingya':
 r=record('Lingya-head');original=list(r['position']);source=copy.deepcopy(r)
 obj=api['create_mesh'](r,source=source,metadata={'kind':kind,'materialMode':'preserve','modelWork':'Soft lower-face planes and refined mouth; all Blink and socket anchors unchanged'})
 blink=r['morphAttributes']['position'][0]['array'];frozen=[];weights=[]
 for i,v in enumerate(obj.data.vertices):
  x,y,z=v.co;eye=any(abs(t)>1e-9 for t in blink[i*3:i*3+3]) or (1.598<y<1.659 and z>.002 and abs(x)<.075)
  anchor=eye or y<1.50 or y>1.715
  frozen.append(anchor)
  front=smooth(.005,.040,z);mouth=gauss(y-1.568,.020)*gauss(x,.037)*front
  cheek=gauss(y-1.590,.027)*gauss(abs(x)-.053,.030)*front
  jaw=gauss(y-1.538,.023)*smooth(.020,.059,abs(x))*front
  if not anchor:
   # A less protruding, narrower mouth and a continuous cheek/jaw transition.
   v.co.x=x*(1-.15*mouth-.055*jaw)
   v.co.z=z-.0048*mouth+.0026*cheek
   # Re-form the adult base's deep nose-to-lip folds as a quiet closed mouth.
   # This is a continuous frontal patch, not a separate lip/cheek primitive.
   muzzle=gauss(y-1.567,.021)*gauss(x,.040)*front
   plane=.062+.002*gauss(y-1.580,.030)-.023*(x/.075)**2
   nose=.015*gauss(y-1.591,.012)*gauss(x,.015)
   lip=(.0018*gauss(y-1.570,.0035)+.0015*gauss(y-1.562,.004)-.0009*gauss(y-1.566,.0015))*gauss(x,.026)
   v.co.z=v.co.z*(1-.83*muzzle)+(plane+nose+lip)*(.83*muzzle)
   v.co.y=y+.0012*jaw
  weights.append(0 if anchor else min(1,.18+.70*mouth+.32*cheek+.24*jaw))
 native_smooth(obj,weights,.46,9)
 max_anchor=0
 for i,anchor in enumerate(frozen):
  if anchor:
   error=max(abs(obj.data.vertices[i].co[d]-original[i*3+d]) for d in range(3));max_anchor=max(max_anchor,error)
 assert max_anchor<1e-7,('Lingya eye/neck anchor moved',max_anchor)
 # Topology is unchanged: use exact post-sculpt coordinates as transfer anchors,
 # retaining the original index-to-Blink/weight correspondence without nearest drift.
 source['position']=[c for v in obj.data.vertices for c in v.co]
 # Recompute the closed-lid normal difference against this actual sculpt. The
 # original position deltas stay exact, but old normal deltas are no longer the
 # correct difference after the surrounding cheek has been smoothed.
 obj.data.update();base_normals=[v.normal.copy() for v in obj.data.vertices]
 closed=obj.data.copy()
 for i,v in enumerate(closed.vertices):
  for axis in range(3):v.co[axis]+=blink[i*3+axis]
 closed.update()
 source['morphAttributes']['normal'][0]['array']=[v.normal[axis]-base_normals[i][axis] for i,v in enumerate(closed.vertices) for axis in range(3)]
 bpy.data.meshes.remove(closed)
 measurements.append({'mesh':r['name'],'frozenVertices':sum(frozen),'maximumAnchorError':max_anchor,'beforeTriangles':len(r['index'])//3,'morphTargets':len(r['morphAttributes']['position'])})
 outputs.append(obj)
 # Eyebrows are a static Head attachment, not part of the skinned rest export.
 # Bake their refinement here so runtime face finishing remains material-only.
 facepath=repo/'assets/characters/lingya-face.gltf'
 face=json.loads(facepath.read_text());binary=(facepath.parent/face['buffers'][0]['uri']).read_bytes()
 def read_attribute(index):
  a=face['accessors'][index];view=face['bufferViews'][a['bufferView']]
  width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];fmt={5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']]
  size=struct.calcsize(fmt)*width;start=view.get('byteOffset',0)+a.get('byteOffset',0)
  return [value for i in range(a['count']) for value in struct.unpack_from('<'+fmt*width,binary,start+i*view.get('byteStride',size))]
 primitive=next(m for m in face['meshes'] if m['name']=='Lingya-eyebrows')['primitives'][0]
 brow_record={'name':'Lingya-eyebrows','position':read_attribute(primitive['attributes']['POSITION']),'normal':read_attribute(primitive['attributes']['NORMAL']),'uv':read_attribute(primitive['attributes']['TEXCOORD_0']),'index':read_attribute(primitive['indices'])}
 brow=api['create_mesh'](brow_record,metadata={'kind':kind,'materialMode':'preserve','modelWork':'Offline low-volume eyebrow arc; immutable runtime head and Blink'})
 original=[v.co.copy() for v in brow.data.vertices]
 for i,v in enumerate(brow.data.vertices):
  x,y,z=original[i];near=[p.y for p in original if abs(abs(p.x)-abs(x))<.003];mid=(min(near)+max(near))*.5
  v.co.y=y+(mid-y)*.28-smooth(.033,.057,abs(x))*.0012
 brow.data.update();outputs.append(brow)
else:
 skinname='SuperHero_Male' if kind=='scout' else 'Superhero_Female'
 r=record(skinname);obj=api['create_mesh'](r,metadata={'kind':kind,'materialMode':'preserve','weightTransfer':'surface','modelWork':'Continuous subdivided face; softer cheek and lower facial planes'})
 # Weld geometric seams while retaining loop UVs, then subdivide only the face.
 # Hands/body below the neck are not refined or re-proportioned.
 bm=bmesh.new();bm.from_mesh(obj.data)
 threshold=1.555 if kind=='scout' else 1.514
 head=[v for v in bm.verts if v.co.y>threshold]
 bmesh.ops.remove_doubles(bm,verts=head,dist=0.000004)
 edges=[e for e in bm.edges if all(v.co.y>threshold+.006 for v in e.verts)]
 bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
 bm.to_mesh(obj.data);bm.free();obj.data.update()
 weights=[]
 for v in obj.data.vertices:
  x,y,z=v.co;front=smooth(.01,.065,z)
  if kind=='scout':
   cheek=gauss(y-1.667,.035)*gauss(abs(x)-.045,.026)*front
   jaw=gauss(y-1.603,.028)*front
   v.co.z+=.0015*cheek;v.co.x*=1-.022*jaw
   weight=.32*smooth(threshold,threshold+.04,y)*(1-smooth(1.675,1.69,y))*front
  else:
   cheek=gauss(y-1.624,.027)*gauss(abs(x)-.046,.029)*front
   muzzle=gauss(y-1.583,.024)*gauss(x,.036)*front
   jaw=gauss(y-1.555,.026)*smooth(.019,.058,abs(x))*front
   v.co.z+=.0028*cheek-.0038*muzzle;v.co.x*=1-.08*muzzle-.04*jaw
   weight=.45*(cheek+muzzle+.4*jaw)
  # Preserve eye socket registration and forehead silhouette.
  eye_y=1.699 if kind=='scout' else 1.656
  ocular=gauss(y-eye_y,.014)*gauss(abs(x)-.031,.026)*front
  weights.append(min(.8,max(0,weight*(1-.95*ocular))))
 native_smooth(obj,weights,.32,5)
 outputs.append(obj);measurements.append({'mesh':skinname,'beforeTriangles':len(r['index'])//3,'newFaceSubdivision':True})
 # Replace broad angular eyebrow blocks with a thinner soft arch, retaining
 # their position on the existing forehead instead of creating new eye cards.
 r=record('Eyebrows');source=copy.deepcopy(r)
 brow=api['create_mesh'](r,source=source,metadata={'kind':kind,'materialMode':'preserve','modelWork':'Refined low-volume natural eyebrow arc'})
 weld_seams(brow)
 original=[v.co.copy() for v in brow.data.vertices]
 for i,v in enumerate(brow.data.vertices):
  x,y,z=original[i];near=[p.y for p in original if abs(abs(p.x)-abs(x))<.0035]
  center=(min(near)+max(near))*.5;t=max(0,min(1,(abs(x)-.008)/.056))
  thickness=.60 if kind=='scout' else .43
  v.co.y=center+(y-center)*thickness+(.0035 if kind=='tide' else .0020)*(1-t)
  v.co.z-=.0015*(1-t)
 native_smooth(brow,[1]*len(original),.12,2)
 outputs.append(brow)
 # Refine each existing authored hairstyle as continuous surfaces. The heads
 # remain compatible with their original rig, mask and attachment positions.
 hairname={'scout':'SM_Hero_Hair_scout','silver':'SM_Hero_Hair_Silver','tide':'Hair_Buns'}[kind]
 r=record(hairname);source=copy.deepcopy(r)
 hair=api['create_mesh'](r,source=source,metadata={'kind':kind,'materialMode':'preserve','modelWork':'Authored hair-volume sculpt and relaxed lock surfaces'})
 weld_seams(hair)
 weights=[]
 for v in hair.data.vertices:
  x,y,z=v.co
  if kind=='scout':
   beard=(1-smooth(1.66,1.70,y))*smooth(.006,.044,z)
   v.co.y=y+(1.628-y)*.32*beard
   v.co.z=z-.0055*beard
   v.co.x=x*(1-.11*beard)
   crown=smooth(1.746,1.81,y)
   v.co.x+=.0025*crown*smooth(-.02,.06,z)
   weights.append(.85*beard+.25*crown)
  elif kind=='silver':
   tips=1-smooth(1.57,1.66,y)
   # Curved jaw-framing tips, slimmer back volume, asymmetrical sweep at the part.
   v.co.x=x*(1-.085*tips)
   v.co.z=z+.0065*tips*gauss(abs(x)-.085,.045)
   crown=smooth(1.70,1.77,y);v.co.x+=.0035*crown
   weights.append(.50*tips+.22*crown)
  else:
   front=smooth(.01,.063,z);fringe=(1-smooth(1.69,1.75,y))*front
   # Keep tied buns; reduce the straight pointed fringe and curve the side locks.
   v.co.x=x+.004*fringe
   v.co.y=y+.006*gauss(y-1.683,.020)*front
   v.co.z=z+.0035*fringe
   side=smooth(.075,.13,abs(x));v.co.y+=.003*side
   weights.append(.45*fringe+.34*side)
 native_smooth(hair,weights,.27,5)
 outputs.append(hair)

dest=repo/f'assets/characters/rebuilt-v216/{kind}-head.glb'
report=api['export_glb'](outputs,dest,kind=kind)
report['refinements']=measurements;report['sourceRest']='outputs/character-v216/rest/'+kind+'.json'
report['license']='Existing CC0 Quaternius source, locally remodeled in Blender; no new external head claimed'
out=workspace/'outputs/character-v216';out.mkdir(parents=True,exist_ok=True)
(out/f'{kind}-head-build.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
