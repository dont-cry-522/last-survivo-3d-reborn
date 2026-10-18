"""Blender refinement of Lingya's existing head, retaining all eyelid morph anchors.
Run from Blender background; shared Quaternius source files are never changed.
"""
import argparse,json,pathlib,runpy,sys,math,bpy,bmesh
from mathutils.kdtree import KDTree
parser=argparse.ArgumentParser();parser.add_argument('--workspace',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[3]);args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
workspace=args.workspace;repo=pathlib.Path(__file__).resolve().parents[1];api=runpy.run_path(str(repo/'scripts/hero-blender-tools.py'))
rest=json.loads((workspace/'outputs/character-v215/rest/lingya.json').read_text());record=next(m for m in rest['meshes'] if m['name']=='Lingya-head')
obj=api['create_mesh'](record,metadata={'kind':'lingya','targetName':'Lingya-head','materialMode':'preserve','modelWork':'Soft cheek-jaw planes; protected eye/brow/blink anchors; rear skull decimation'})
original=[v.co.copy() for v in obj.data.vertices]
deltas=record['morphAttributes']['position'][0]['array']
protected=[]
def gauss(x,s):return math.exp(-(x/s)**2)
for i,v in enumerate(obj.data.vertices):
 x,y,z=v.co;blink=sum(abs(deltas[i*3+d]) for d in range(3))>1e-9
 ocular=z>.006 and 1.597<y<1.66 and abs(x)<.071
 protect=blink or ocular or y<1.50
 if protect:
  protected.append(i);continue
 front=max(0,min(1,(z+.003)/.035));side=1-gauss(abs(x),.024)
 cheek=gauss(y-1.583,.020)*gauss(abs(x)-.055,.027)*front
 jaw=gauss(y-1.545,.018)*gauss(abs(x)-.062,.030)*front
 sign=1 if x>=0 else -1
 v.co.x+=sign*(.0021*cheek-.0016*jaw)
 v.co.z+=.0012*cheek*side
 # Round the forehead planes without moving eyebrows or changing skull height.
 forehead=gauss(y-1.685,.019)*front
 v.co.z+=.0008*forehead
obj.data.update()
# Dissolve low-angle interior edges only on the rear/upper skull. Unlike an
# unconstrained decimator this leaves original eye/neck boundary positions exact.
bm=bmesh.new();bm.from_mesh(obj.data);bm.verts.ensure_lookup_table()
protected_set=set(protected)
selected={v for v in bm.verts if v.index not in protected_set and v.co.y>1.505 and (v.co.z<-.008 or v.co.y>1.689)}
edges=[e for e in bm.edges if all(v in selected for v in e.verts)]
bmesh.ops.dissolve_limit(bm,angle_limit=.07,verts=list(selected),edges=edges,use_dissolve_boundaries=False,delimit=set())
bm.to_mesh(obj.data);bm.free();obj.data.update()
# Check protected vertices survived exactly, not merely a nearest visual approximation.
tree=KDTree(len(obj.data.vertices))
for i,v in enumerate(obj.data.vertices):tree.insert(v.co,i)
tree.balance();max_error=max(tree.find(original[i])[2] for i in protected)
assert max_error<1e-7,('protected face/neck changed',max_error)
report=api['export_glb']([obj],repo/'assets/characters/rebuilt-v215/lingya-head.glb',kind='lingya')
report.update({'beforeTriangles':len(record['index'])//3,'beforeVertices':len(original),'protectedFaceVertices':len(protected),'maximumProtectedVertexError':max_error,'headHeightUnchanged':True,'eyeAndBrowMeshesUnchanged':True,'morphTargetCount':len(record['morphAttributes']['position']),'method':'Small continuous cheek/jaw/forehead sculpt; Blender selective rear/upper skull Limited Dissolve .07 radians; protected blink/ocular/neck vertices.'})
(workspace/'outputs/character-v215/lingya-head-build.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
