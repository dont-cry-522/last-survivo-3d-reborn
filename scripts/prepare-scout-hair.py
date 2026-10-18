"""Build the ranger's cropped hair and close beard from selected Quaternius CC0 meshes.
Run with Blender -b --python scripts/prepare-scout-hair.py -- --workspace /path/to/workspace
"""
import argparse,json,pathlib,runpy,sys,math
parser=argparse.ArgumentParser();parser.add_argument('--workspace',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[3]);args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
workspace=args.workspace;repo=pathlib.Path(__file__).resolve().parents[1]
api=runpy.run_path(str(repo/'scripts/hero-blender-tools.py'))
rest=json.loads((workspace/'outputs/character-v215/rest/scout.json').read_text())
old=next(m for m in rest['meshes'] if m['name']=='SM_Hero_Hair_scout')
root=workspace/'outputs/character-v215/sources/universal-base-characters'
combined={'name':old['name'],'position':[],'normal':[],'color':[],'uv':[],'index':[],'material':{'name':'M_Ranger_CroppedHair_CC0','baseColorFactor':[1,1,1,1],'roughness':.86,'metalness':0,'doubleSided':True}}
counts=[]
for role in ['Hair_Buzzed','Hair_Beard']:
 record=json.loads((root/(role+'-rest.json')).read_text())['meshes'][0];a=record['attributes'];positions=a['position']['array'];normals=a['normal']['array'];base=len(combined['position'])//3
 for i in range(0,len(positions),3):
  x,y,z=positions[i:i+3]
  if role=='Hair_Beard':
   y=1.682+(y-1.682)*.80
   x*=.965;z=z*.98+.0015
   value=.82+.12*math.sin(x*107+y*39)+.07*math.cos(z*103+x*31)
   color=[.105*value,.060*value,.034*value,1]
  else:
   # Keep the artist's short cap, with a subtle forward crest instead of a high quiff.
   crest=max(0,(y-1.735)/.08)
   y+=.006*crest*max(0,1-abs(x)/.08)
   z+=.003*crest
   value=.92+.12*math.sin(x*92+z*38)+.09*max(0,(y-1.7)/.12)
   color=[.115*value,.066*value,.037*value,1]
  combined['position'].extend([x,y,z]);combined['color'].extend(color)
 combined['normal'].extend(normals);combined['uv'].extend(a['uv']['array']);combined['index'].extend(base+i for i in record['index'])
 counts.append({'source':role,'triangles':len(record['index'])//3})
obj=api['create_mesh'](combined,source=old,metadata={'kind':'scout','targetName':old['name'],'materialMode':'replace','externalSource':'Quaternius Universal Base Characters CC0: Hair_Buzzed + Hair_Beard','sourceFiles':['Hair_Buzzed.gltf','Hair_Beard.gltf']})
api['refine'](obj,smooth=.07,iterations=1,decimate=.8)
report=api['export_glb']([obj],repo/'assets/characters/rebuilt-v215/scout-head.glb',kind='scout')
report.update({'sourceMeshes':counts,'oldTriangles':len(old['index'])//3,'license':'CC0-1.0','description':'Short close-cut scalp with a small natural crest and fitted close beard, replacing the high quiff; existing head skeleton and facial meshes preserved.'})
(workspace/'outputs/character-v215/scout-head-build.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
