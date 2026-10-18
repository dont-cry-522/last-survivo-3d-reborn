"""Author the three masked heroes' cloth and head meshes in Blender.

Run Blender --background --python scripts/prepare-mist-heroes.py -- [hero ...].
Inputs are the actual game's unscaled, unposed rest surfaces exported to
outputs/character-v215/rest. The GLBs replace geometry only: the existing rig,
UV based mask insets, dynamic long hair, collision and weapons stay in charge.
No third party source .blend or embedded script is opened.
"""
from pathlib import Path
import json
import math
import runpy
import sys
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parents[1] / "outputs" / "character-v215"
DEST = ROOT / "assets" / "characters" / "rebuilt-v215"
HELPERS = runpy.run_path(str(ROOT / "scripts" / "hero-blender-tools.py"))
create_mesh, refine, export_glb = (HELPERS[k] for k in ("create_mesh", "refine", "export_glb"))
TAU = math.tau


def smooth(value, low, high):
    t = min(1, max(0, (value-low)/(high-low)))
    return t*t*(3-2*t)


def bell(value, center, width):
    return math.exp(-((value-center)/width)**2)


def linear(hex_color):
    def channel(c):
        c /= 255
        return c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4
    return tuple(channel((hex_color >> shift) & 255) for shift in (16, 8, 0))


def blend(a, b, fraction):
    return tuple(x+(y-x)*fraction for x, y in zip(a,b))


def mesh_record(name, points, indices, uvs, colors, material):
    return {"name": name, "position": points, "index": indices, "uv": uvs,
            "color": colors, "material": material}


def native_weld(obj, distance=.000001):
    # Weld the original UV splits before relaxing. UVs stay on loops, so a seam
    # cannot crack open when the adjacent cloth vertices move together.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=distance)
    bm.normal_update();bm.to_mesh(obj.data);bm.free()
    obj.data.update()


def edge_thickness(obj, thickness):
    # Existing cloth and masks already render from both sides. Only the rim is
    # visible around their openings: keep that physical edge, without exporting
    # another complete hidden torso/head behind the first one.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True);bpy.context.view_layer.objects.active=obj
    modifier=obj.modifiers.new("HeroTurnedClothEdges","SOLIDIFY")
    modifier.thickness=thickness;modifier.offset=-1;modifier.use_rim_only=True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.update()


def curve_profile(profile, y):
    i=0
    while i<len(profile)-2 and y>profile[i+1][0]:i+=1
    a=profile[max(0,i-1)];b=profile[i];c=profile[i+1];d=profile[min(len(profile)-1,i+2)]
    span=c[0]-b[0];t=min(1,max(0,(y-b[0])/span));t2=t*t;t3=t2*t
    return [(2*t3-3*t2+1)*b[k]+(t3-2*t2+t)*span*(c[k]-a[k])/(c[0]-a[0])
            +(-2*t3+3*t2)*c[k]+(t3-t2)*span*(d[k]-b[k])/(d[0]-b[0])
            for k in range(1,len(b))]


def garment(source, kind):
    # A single quad-like cloth surface owns its collar, shoulder roll, front
    # overlap and hem. It is not a stack of chest plates or separate ornaments.
    profiles={
        "wraith":[[.89,.211,.143,-.034],[.98,.205,.140,-.034],[1.08,.184,.127,-.033],
                  [1.17,.149,.112,-.031],[1.27,.174,.137,-.033],[1.37,.199,.142,-.034],
                  [1.445,.216,.122,-.034],[1.495,.178,.094,-.029],[1.53,.087,.073,-.023],[1.567,.067,.067,-.022]],
        "wuling":[[.82,.223,.152,-.028],[.91,.215,.150,-.028],[1.02,.193,.138,-.028],
                  [1.11,.164,.120,-.028],[1.18,.142,.111,-.028],[1.27,.160,.140,-.028],
                  [1.35,.184,.145,-.028],[1.41,.203,.122,-.027],[1.462,.137,.082,-.026],[1.491,.075,.064,-.026]],
        "mirage":[[.925,.204,.127,-.028],[1.015,.182,.120,-.028],[1.11,.143,.104,-.028],
                  [1.19,.128,.110,-.028],[1.27,.152,.136,-.028],[1.35,.181,.144,-.028],
                  [1.405,.200,.122,-.028],[1.452,.176,.090,-.028],[1.48,.082,.062,-.028],[1.516,.064,.060,-.028]]}
    palette={"wraith":(0x292b32,0x16191f,0xb6b9b8),"wuling":(0x3d2841,0x271b2e,0x947a53),
             "mirage":(0x242b3c,0x151b29,0x9daec1)}
    cloth,shade,trim=map(linear,palette[kind]);profile=profiles[kind]
    points=[];indices=[];uvs=[];colors=[];rows=42;cols=48
    low,high=profile[0][0],profile[-1][0]
    for row in range(rows+1):
        v=row/rows;y=low+(high-low)*v;rx,rz,cz=curve_profile(profile,y)
        for col in range(cols+1):
            a=col/cols*TAU;angle=math.atan2(math.sin(a),math.cos(a));front=max(0,math.cos(a))
            lower=1-smooth(y,low,1.17);shoulder=bell(y,1.445,.057)
            if kind=="wraith":
                # Soft charcoal mantle cut: folded V-neck, a wrapped side seam
                # and a broad quiet hem rather than the old ranger armour bars.
                fold=.0062*math.sin(a*6+.5)*lower+.0035*math.sin(a*10+y*22)*bell(y,1.19,.16)
                chestline=abs(angle)-(.37+.35*smooth(y,1.25,1.49))
                lapel=.0105*bell(chestline,0,.075)*smooth(y,1.21,1.33)*(1-smooth(y,1.49,1.55))
                radius=fold+lapel+.006*shoulder*abs(math.sin(a))
                yy=y-.029*lower*(.5+.5*math.cos(a*2+.45))-.028*smooth(y,1.50,high)*front**2
                seam=bell(chestline,0,.022)*smooth(y,1.25,1.34)*(1-smooth(y,1.47,1.52))
                c=blend(cloth,shade,.25*(1-front)+.15*lower)
                c=blend(c,trim,seam*.32)
            elif kind=="wuling":
                # The gathering coat wraps diagonally toward her lamp hand.
                # Its overlapping fold tapers into the tied waist, then opens
                # into longer rear quarters and two restrained field pleats.
                center=.29+.24*smooth(y,1.12,1.43)
                seam=bell(angle,center,.04)*smooth(y,.88,1.10)*(1-smooth(y,1.43,1.49))
                overlap=.010*bell(angle,center,.09)*smooth(y,.90,1.12)*(1-smooth(y,1.44,1.49))
                fold=.0074*math.sin(a*7+.3)*lower+.003*math.sin(a*11+y*24)*bell(y,1.16,.12)
                radius=fold+overlap+.0055*shoulder*abs(math.sin(a))
                yy=y-.035*lower*(1-front)*(.8+.2*math.sin(a))+.014*smooth(y,1.465,high)*(1-front)
                c=blend(cloth,shade,.22*(1-front)+.10*lower)
                c=blend(c,trim,seam*.50)
            else:
                # A fitted nocturnal coat with narrow descending petal folds.
                # The shoulders remain soft; the lower front is pointed and
                # the back is longer, visibly distinct from the field coat.
                seam_angle=.29+.15*math.sin(smooth(y,1.04,1.42)*math.pi)
                seam=bell(abs(angle),seam_angle,.022)*smooth(y,.97,1.08)*(1-smooth(y,1.43,1.49))
                radius=.004*math.sin(a*6)*lower+.007*bell(abs(angle),seam_angle,.07)*bell(y,1.22,.19)
                yy=y-.047*lower*(.62+.38*math.cos(a*2))-.007*smooth(y,1.48,high)*front
                c=blend(cloth,shade,.32*(1-front)+.09*lower)
                c=blend(c,trim,seam*.52)
            point=(math.sin(a)*(rx+radius),yy,cz+math.cos(a)*(rz+radius))
            points.extend(point);uvs.extend((col/cols,v))
            hem_trim=(row==0 or row==rows)
            colors.extend(blend(c,trim,.36 if hem_trim else 0))
            if row<rows and col<cols:
                n=row*(cols+1)+col;indices.extend((n,n+1,n+cols+1,n+1,n+cols+2,n+cols+1))
    record=mesh_record(source['name'],points,indices,uvs,colors,source['material'])
    obj=create_mesh(record,name=f"SM_Hero_{kind}_TailoredCoat_A",source=source,
                    metadata={"kind":kind,"targetName":source['name'],"materialMode":"preserve","madeInBlender":True,
                              "construction":"continuous-tailored-cloth","hideTargets":(["SM_Hero_Wraith_TunicSeams","SM_Hero_Wraith_SplitTunicHem"] if kind=="wraith" else [])})
    native_weld(obj)
    refine(obj,smooth=.10,iterations=2)
    edge_thickness(obj,.0026)
    return obj


def cloth_hood(source,kind):
    points=[];indices=[];uvs=[];colors=[];rows=24;cols=48
    main=linear(0x292b33 if kind=="wraith" else 0x36243e)
    trim=linear(0xb6b9b8 if kind=="wraith" else 0x947a53)
    for row in range(rows+1):
        v=row/rows
        for col in range(cols+1):
            u=col/cols
            if kind=="wraith":
                theta=.025+v*2.24;opening=.86*smooth(theta,.20,.73)
                a=opening+u*(TAU-opening*2);r=math.sin(theta)
                edge=abs(u-.5)*2;fall=smooth(v,.63,1)
                fold=(.0042*math.sin(a*5+v*.8)+.002*math.sin(a*9-v))*fall
                x=math.sin(a)*(.163*r+fold)
                y=1.656+.181*math.cos(theta)-.025*fall*(.6+.4*abs(math.sin(a)))
                z=-.025+math.cos(a)*(.186*r+fold)+.006*edge**8
            else:
                # Folded circular face opening, pulled back at the temples.
                a=u*TAU;theta=.91+v*(math.pi-.91);r=math.sin(theta)
                roll=.0055*math.sin(math.pi*min(1,v/.14));edge=1-smooth(v,0,.11)
                fall=.0035*math.cos(a*6+.3)*math.sin(v*math.pi)
                x=math.cos(a)*(.164*r+roll+fall)
                y=1.632+math.sin(a)*(.178*r+roll)-.009*smooth(v,.55,1)
                z=-.047+math.cos(theta)*.188+roll*.7
            points.extend((x,y,z));uvs.extend((u,v))
            seam=(edge**32*.48 if kind=="wraith" else edge*.38)
            colors.extend(blend(main,trim,seam))
            if row<rows and col<cols:
                n=row*(cols+1)+col;indices.extend((n,n+cols+1,n+1,n+1,n+cols+1,n+cols+2))
    record=mesh_record(source['name'],points,indices,uvs,colors,source['material'])
    obj=create_mesh(record,name=f"SM_Hero_{kind}_DrapedHood_A",source=source,
                    metadata={"kind":kind,"targetName":source['name'],"materialMode":"preserve","madeInBlender":True,
                              "construction":"single-cloth-shell","hideTargets":["SM_Hero_Wraith_SoftHoodLip"] if kind=="wraith" else []})
    native_weld(obj)
    refine(obj,smooth=.08,iterations=2)
    edge_thickness(obj,.0034)
    return obj


def mask_surface(source,kind):
    obj=create_mesh(source,name=f"SM_Hero_{kind}_FullMask_A",
                    metadata={"kind":kind,"targetName":source['name'],"materialMode":"preserve","madeInBlender":True,
                              "construction":"sculpted-full-cover-shell"})
    # Keep the eyes' exact shader coordinates and UVs. The sculpt builds real
    # recessed eye wells and softer cheek planes around those existing insets.
    for vertex in obj.data.vertices:
        x,y,z=vertex.co;ax=abs(x)
        if kind=="wraith":
            # Draped inner veil: bridge the mouth and reduce the embossed nose
            # while the central broken-white soul mark stays unchanged.
            z+=.003*bell(y,1.63,.048)*(1-smooth(ax,.037,.070))
            z+=.0025*math.cos(x*56)*bell(y,1.61,.035)
            x*=1+.025*bell(y,1.65,.045)
        elif kind=="wuling":
            eye_y=1.670-.009*min(1,max(0,(ax-.018)/.048))
            well=bell(ax,.042,.021)*bell(y,eye_y,.010)
            z-=.0032*well
            z+=.0038*bell(ax,.056,.025)*bell(y,1.625,.028)
            z+=.0022*bell(x,0,.014)*bell(y,1.653,.027)
            x*=1-.035*bell(y,1.555,.025)
        else:
            eye_y=1.670+(ax-.044)*.16
            well=bell(ax,.044,.024)*bell(y,eye_y,.011)
            z-=.0035*well
            z+=.0045*bell(ax,.056,.026)*bell(y,1.623,.024)
            z+=.0025*bell(x,0,.013)*bell(y,1.652,.025)
            x*=1-.045*bell(y,1.54,.025)
        vertex.co=(x,y,z)
    native_weld(obj)
    # Smooth along the physical shell, then add an actual narrow inward edge.
    # Existing mask shader is reused by the game, including engraved eye slots.
    refine(obj,smooth=.10,iterations=2)
    if kind!="mirage":edge_thickness(obj,.0018)
    return obj


def long_hair(source):
    obj=create_mesh(source,name="SM_Hero_mirage_FlowingLongHair_A",
                    metadata={"kind":"mirage","targetName":source['name'],"materialMode":"preserve","madeInBlender":True,
                              "construction":"sculpted-long-locks"})
    # A quiet S-curve redistributes the rear hair into larger flowing ribbons.
    # Root and fringe remain put. Runtime's damped motion still deforms every
    # lock because this replaces the same Hair_Long mesh and its userData.
    for vertex in obj.data.vertices:
        x,y,z=vertex.co
        weight=(1-smooth(y,1.45,1.66))*smooth(-z,.08,.19)
        fall=min(1,max(0,(1.65-y)/.56))
        vertex.co.x=x+(.009*math.sin(fall*math.pi*1.55)+math.copysign(.004,x))*weight
        vertex.co.z=z+.018*math.sin(fall*math.pi)*weight
    native_weld(obj)
    refine(obj,smooth=.055,iterations=1)
    return obj


def build(kind):
    data=json.loads((WORK/"rest"/(kind+".json")).read_text(encoding="utf-8"))
    accessory=json.loads((WORK/"rest"/(kind+"-accessories.json")).read_text(encoding="utf-8"))
    meshes=data["meshes"]
    body=next(m for m in meshes if m["name"].endswith("_Body"))
    masks=next(m for m in accessory["accessories"] if m["name"]=={"wraith":"wraith-shadow-veil","wuling":"wuling-full-mask","mirage":"mirage-full-mask"}[kind])
    attire=[garment(body,kind)];head=[mask_surface(masks,kind)]
    if kind!="mirage":head.insert(0,cloth_hood(next(m for m in meshes if m["name"].endswith("_Head_Hood")),kind))
    else:head.insert(0,long_hair(next(m for m in meshes if m["name"]=="Hair_Long")))
    results=[export_glb(attire,DEST/(kind+"-attire.glb"),kind),export_glb(head,DEST/(kind+"-head.glb"),kind)]
    for obj in attire+head:bpy.data.objects.remove(obj,do_unlink=True)
    return results


if __name__=="__main__":
    bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
    kinds=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else ["wraith","wuling","mirage"]
    results=[result for kind in kinds for result in build(kind)]
    WORK.mkdir(parents=True,exist_ok=True)
    (WORK/"mist-heroes-build.json").write_text(json.dumps({"blender":bpy.app.version_string,"assets":results},indent=2),encoding="utf-8")
    print(json.dumps({"generated":[{key:result[key] for key in ("path","bytes")} for result in results]}))
