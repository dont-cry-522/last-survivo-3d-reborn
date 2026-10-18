"""Rebuild three actual game costumes in Blender, retaining their existing rig.

Blender --background --python scripts/prepare-ranger-tide-attire.py -- scout silver tide
Run export-hero-rest.mjs once first. Only selected garment slots are exported;
weapons, bones, sockets, actor scale, animation clips and gameplay remain intact.
"""
from pathlib import Path
import json
import math
import runpy
import sys
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
REST = ROOT.parents[1] / 'outputs' / 'character-v215' / 'rest'
DEST = ROOT / 'assets' / 'characters' / 'rebuilt-v215'
TOOLS = runpy.run_path(str(ROOT / 'scripts' / 'hero-blender-tools.py'))
create_mesh, refine, export_glb = (TOOLS[n] for n in ('create_mesh', 'refine', 'export_glb'))
PI = math.pi


def smooth(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)


def gaussian(x, center, width):
    return math.exp(-((x-center)/width)**2)


def flatten(record):
    values={}
    for key,attribute in record['attributes'].items():
        array=attribute['array']
        if attribute.get('normalized'):
            divisor={'Uint8Array':255,'Uint16Array':65535}.get(attribute.get('type'))
            if divisor:array=[n/divisor for n in array]
        values[key]=array
    return {**record, **values}


def weld(obj):
    # UV islands duplicate positions in glTF. Weld their geometry before DCC
    # smoothing; corner UV/colour layers retain their seam values independently.
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=.000001)
    bpy.ops.object.mode_set(mode='OBJECT')


def sample(profile, value):
    i = 0
    while i < len(profile)-2 and value > profile[i+1][0]:
        i += 1
    a,b,c,d = profile[max(0,i-1)],profile[i],profile[i+1],profile[min(len(profile)-1,i+2)]
    t = max(0,min(1,(value-b[0])/(c[0]-b[0])))
    span = c[0]-b[0]
    return [(2*t**3-3*t*t+1)*b[k]+(t**3-2*t*t+t)*span*(c[k]-a[k])/(c[0]-a[0])
            +(-2*t**3+3*t*t)*c[k]+(t**3-t*t)*span*(d[k]-b[k])/(d[0]-b[0])
            for k in range(1,len(b))]


class Garment:
    def __init__(self, source):
        self.source = flatten(source)
        self.position=[];self.uv=[];self.color=[];self.index=[]
        p=self.source['position'];self.tree=KDTree(len(p)//3)
        for i in range(len(p)//3):self.tree.insert(p[i*3:i*3+3],i)
        self.tree.balance()

    def vertex(self, p, uv, tint=(1,1,1)):
        i=len(self.position)//3;self.position.extend(p);self.uv.extend(uv);self.color.extend(tint)
        return i

    def rings(self, rows, count, point, reverse=False, cap=False):
        start=len(self.position)//3
        for j,row in enumerate(rows):
            for i in range(count+1):
                p,tint=point(row,2*PI*i/count,j)
                self.vertex(p,(i/count,j/max(1,len(rows)-1)),tint)
        for j in range(len(rows)-1):
            for i in range(count):
                n=start+j*(count+1)+i
                tri=[n,n+1,n+count+1,n+1,n+count+2,n+count+1]
                self.index.extend(tri if not reverse else [tri[2],tri[1],tri[0],tri[5],tri[4],tri[3]])
        if cap:
            for j in (0,len(rows)-1):
                ids=[start+j*(count+1)+i for i in range(count)]
                center=[sum(self.position[i*3+k] for i in ids)/count for k in range(3)]
                m=self.vertex(center,(.5,j/(len(rows)-1)))
                for i in range(count):
                    a,b=ids[i],ids[(i+1)%count]
                    self.index.extend([m,b,a] if bool(j)==reverse else [m,a,b])

    def retained(self, predicate):
        s=self.source;p=s['position'];indices=s['index'];saved={}
        for n in range(0,len(indices),3):
            tri=indices[n:n+3]
            if not predicate([p[i*3:i*3+3] for i in tri]):continue
            for i in tri:
                if i not in saved:saved[i]=self.vertex(p[i*3:i*3+3],s.get('uv',[0]*(len(p)//3*2))[i*2:i*2+2])
                self.index.append(saved[i])

    def record(self):
        si=[];sw=[];source=self.source
        source_color=source.get('color')
        color_width=(len(source_color)//(len(source['position'])//3)) if source_color else 0
        for n in range(0,len(self.position),3):
            near=self.tree.find_n(self.position[n:n+3],4)
            influences={}
            tone=[0,0,0];tone_weight=0
            for _,i,distance in near:
                amount=1/max(1e-9,distance*distance)
                if source_color:
                    tone_weight+=amount
                    for channel in range(3):tone[channel]+=source_color[i*color_width+channel]*amount
                for k in range(4):
                    joint=source['skinIndex'][i*4+k]
                    influences[joint]=influences.get(joint,0)+source['skinWeight'][i*4+k]*amount
            top=sorted(influences.items(),key=lambda pair:pair[1],reverse=True)[:4]
            total=sum(v for _,v in top)
            si.extend([j for j,_ in top]+[0]*(4-len(top)))
            sw.extend([v/total for _,v in top]+[0]*(4-len(top)))
            if source_color:
                for channel in range(3):self.color[n+channel]*=tone[channel]/tone_weight
        return {'name':source['name'],'position':self.position,'index':self.index,'uv':self.uv,
                'color':self.color,'skinIndex':si,'skinWeight':sw,'boneNames':source['boneNames'],'material':source['material']}


def torso(source, kind):
    if kind=='tide':
        # The short mantle and wave clasp are fitted to the original shoulder
        # frame. Keep those weighted contact surfaces intact; tailor the front
        # and lower jacket without replacing that already-working attachment.
        record=flatten(source);record={**record,'position':record['position'][:]}
        p=record['position']
        for i in range(len(p)//3):
            x,y,z=p[i*3:i*3+3]
            front=smooth(-.005,.055,z)
            below=1-smooth(1.34,1.375,y)
            weight=front*below
            waist=gaussian(y,1.15,.085)
            hem=1-smooth(1.025,1.13,y)
            pleat=.006*math.sin(x*57+.35)*hem
            p[i*3]=x*(1+weight*(.040*gaussian(y,1.29,.12)-.035*waist))
            p[i*3+1]=y+weight*.020*gaussian(x,0,.032)*hem
            p[i*3+2]=z+weight*(.008*gaussian(y,1.28,.12)+pleat-.0025*waist)
        return record
    out=Garment(source)
    profiles={
      'scout':[[.872,.221,.141,.151],[.96,.210,.137,.145],[1.06,.191,.120,.135],[1.145,.169,.112,.125],
               [1.24,.179,.126,.133],[1.37,.207,.147,.145],[1.475,.217,.137,.139],[1.53,.177,.106,.110],
               [1.56,.089,.077,.078],[1.60,.083,.075,.077]],
      'silver':[[1.006,.175,.110,.124],[1.064,.159,.102,.108],[1.135,.132,.097,.104],[1.23,.146,.109,.114],
                [1.34,.173,.145,.122],[1.43,.184,.127,.119],[1.475,.153,.104,.098],[1.51,.074,.069,.065],[1.548,.072,.068,.067]],
      'tide':[[.944,.193,.145,.126],[1.014,.175,.141,.119],[1.10,.149,.121,.109],[1.20,.146,.126,.113],
              [1.32,.175,.155,.128],[1.41,.187,.146,.116],[1.465,.161,.105,.093],[1.50,.081,.071,.065],[1.518,.076,.067,.063]],
    }
    profile=profiles[kind]
    rows=[profile[0][0]+i/42*(profile[-1][0]-profile[0][0]) for i in range(43)]
    def point(y,a,j):
        rx,front,back=sample(profile,y);s,c=math.sin(a),math.cos(a)
        low=1-smooth(1.08,1.19,y);waist=gaussian(y,1.145 if kind=='scout' else 1.105,.1)
        # Wide cloth folds gather into the belt and spread into cut coat panels.
        pleat=.0045*math.cos(a*(8 if kind=='scout' else 6)+.6)*low
        pleat+=.0018*math.sin(y*65+a*3)*waist
        if kind=='scout':
            opening=.042*gaussian(math.atan2(s,c),0,.24)*low+.012*abs(s)*low
            y+=opening-.008*max(0,-c)*low
            # Stitched diagonal field-jacket seam is recessed in the mesh.
            seam=gaussian(math.atan2(s,c),.27*(1-smooth(1.13,1.5,y)),.025)*smooth(1.1,1.2,y)
        elif kind=='silver':
            y+=.027*max(0,c)*(1-gaussian(s,0,.24))*low
            seam=gaussian(abs(s),.61,.025)*smooth(1.08,1.25,y)*(1-smooth(1.43,1.51,y))
            pleat+=.006*gaussian(abs(s),.67,.13)*smooth(1.20,1.34,y)
        else:
            y+=.033*gaussian(s,0,.22)*low
            seam=gaussian(abs(s),.72,.035)*(1-smooth(1.42,1.50,y))
            pleat+=.004*math.sin(a*10)*low
        fold=pleat-.0016*seam
        tone=.98-.14*seam+.018*math.cos(a*4)*low
        return ([s*(rx+fold),y,-.030+c*((front if c>=0 else back)+fold)],(tone,tone,tone))
    out.rings(rows,48,point)
    return out.record()


def sleeves(source,kind):
    out=Garment(source);male=kind=='scout';center=1.451 if male else 1.411
    # Preserve original palms/glove transitions, generated anatomy ends inside
    # their existing sleeve boundary rather than manufacturing new hand weights.
    end=.708 if male else .640
    profile=[[.15,.055],[.20,.080 if male else .067],[.245,.086 if male else .072],
             [.30,.078 if male else .065],[.37,.065],[.42,.060],[.47,.057],
             [.54,.053],[.60,.048],[end,.042 if male else .036]]
    if kind=='tide':profile=[[.13,.048],[.19,.070],[.24,.081],[.29,.077],[.35,.065],[.405,.061],[.442,.059],[.47,.055],[.54,.047],[.60,.039],[end,.033]]
    rows=[profile[0][0]+i/32*(end-profile[0][0]) for i in range(33)]
    for side in (-1,1):
        def point(x,a,j):
            r=sample(profile,x)[0]
            bend=gaussian(x,.42,.07)
            fold=.0035*math.sin(x*88+a*2)*bend+.0015*math.sin(x*43-a*3)*smooth(.21,.30,x)
            # Sleeve seam on the inner arm; a rolled maritime cuff is modeled
            # separately by the existing Tide cuff attachment and remains aligned.
            seam=gaussian(math.atan2(math.sin(a),math.cos(a)),-PI/2,.09)
            r+=fold-.0014*seam
            loose=.003*gaussian(x,.27,.075) if kind=='tide' else 0
            tint=.98-.14*seam-.035*max(0,-math.cos(a))
            return ([side*x,center+math.cos(a)*(r+loose),-.049+math.sin(a)*r*.93],(tint,tint,tint))
        out.rings(rows,24,point,reverse=side<0)
    out.retained(lambda tri:min(abs(p[0]) for p in tri)>=end-.006)
    return out.record()


def fitted_panel(source, torso_obj, lift=.004, fold=.0015, keep_upper=False):
    record=flatten(source);record={**record,'position':record['position'][:], 'normal':None}
    tree=BVHTree.FromPolygons([v.co for v in torso_obj.data.vertices],[tuple(p.vertices) for p in torso_obj.data.polygons],all_triangles=False)
    p=record['position'];uv=record.get('uv')
    for i in range(len(p)//3):
        x,y,z=p[i*3:i*3+3]
        if keep_upper and y>=1.375:continue
        hit=tree.ray_cast(Vector((x,y,1)),Vector((0,0,-1)),2)
        if hit[0] is not None:
            wave=math.sin((uv[i*2] if uv else .5)*PI)*fold
            amount=1-smooth(1.34,1.375,y) if keep_upper else 1
            p[i*3+2]=z+(hit[0].z+lift+wave-z)*amount
    return record


def build(kind):
    data=json.loads((REST/(kind+'.json')).read_text())
    records={m['name']:m for m in data['meshes']}
    slots={'scout':('SM_Hero_Body_scout','SM_Hero_Sleeves_scout','SM_Hero_Boots_scout'),
           'silver':('SM_Hero_Body_silver','SM_Hero_Sleeves_silver','SM_Hero_Boots_silver'),
           'tide':('Female_Peasant_Body','Female_Peasant_Arms','Female_Peasant_Feet')}[kind]
    objects=[]
    for name,(make,role) in zip(slots,((torso,'jacket'),(sleeves,'sleeves'),(None,'boots'))):
        if make is None:
            # Retain the artist-authored buckles, layered toe, straps and turned
            # cuff. The first simple replacement lost those identity details.
            record=flatten(records[name]);record={**record,'position':record['position'][:]}
            p=record['position']
            for i in range(len(p)//3):
                x,y,z=p[i*3:i*3+3]
                if .03<y<.15:
                    # Ease the hard instep into the toe without changing sole
                    # elevation, upper cuff or any existing attachment vertex.
                    p[i*3+2]+= .0018*gaussian(y,.09,.035)*smooth(.04,.13,z)
        else:record=make(records[name],kind)
        obj=create_mesh(record,metadata={'kind':kind,'targetName':name,'materialMode':'preserve','attireRole':role})
        weld(obj)
        if make is None:refine(obj,decimate=.56 if kind=='scout' else .65)
        elif not(kind=='tide' and role=='jacket'):refine(obj,smooth=.04,iterations=1)
        objects.append(obj)
    # Re-seat existing lapels/harness on the new garment instead of allowing
    # old strips to float outside the remodeled chest.
    names=([f'SM_Hero_Lapel_{side}_{kind}' for side in ('L','R')]+[f'SM_Hero_Harness_{kind}',f'SM_Hero_ShoulderYoke_{kind}']) if kind in ('scout','silver') else ['SM_Hero_Tide_WovenLeatherVest','SM_Hero_Tide_FoldedOpenCollar','SM_Hero_Tide_WovenAbdomenGuard','SM_Hero_Tide_FittedHarness','SM_Hero_Tide_HarnessFastener','SM_Hero_Tide_SplitDeckCoat']
    for name in names:
        if name not in records:continue
        record=fitted_panel(records[name],objects[0],lift=.004 if 'Harness' not in name else .009,fold=.010 if 'Lapel' in name or 'Collar' in name else .002,keep_upper=kind=='tide')
        obj=create_mesh(record,metadata={'kind':kind,'targetName':name,'materialMode':'preserve'})
        weld(obj)
        if kind!='tide':refine(obj,smooth=.06,iterations=1)
        objects.append(obj)
    # Old dense bracer meshes become softened, efficient leather panels, while
    # UV/weights remain tied to the already working wrists.
    if kind in ('scout','silver'):
        name=f'SM_Hero_Bracers_{kind}'
        obj=create_mesh(records[name],metadata={'kind':kind,'targetName':name,'materialMode':'preserve'})
        weld(obj)
        refine(obj,smooth=.10,iterations=2,decimate=.32)
        objects.append(obj)
    DEST.mkdir(parents=True,exist_ok=True)
    result=export_glb(objects,DEST/(kind+'-attire.glb'),kind=kind)
    for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
    return result


if __name__=='__main__':
    requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['scout','silver','tide']
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for kind in requested:
        if kind not in ('scout','silver','tide'):raise ValueError('Unexpected hero: '+kind)
        print(json.dumps(build(kind)))
