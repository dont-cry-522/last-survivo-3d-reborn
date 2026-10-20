import * as T from './vendor/three.module.js';
import {skinFrom} from './ranger-rebuild.js?v=228';
import {smoothSeams} from './hero-finish.js?v=228';

// Authored rest-space clothing on the existing licensed female rig. The head,
// feet and hand topology retain their proven binding; the silhouette is new.
export const MINSTREL_PALETTE={cloth:0x527b80,ivory:0xe5ddc7,leather:0x604333,metal:0xb79961,hair:0x68452f,skin:0xe1c5b1};
const cache=new Map();
function ownMaterial(mesh){const source=mesh.material;mesh.material=source.clone();mesh.material.onBeforeCompile=source.onBeforeCompile;mesh.material.customProgramCacheKey=source.customProgramCacheKey;return mesh.material;}
function material(name,color,metal=0){
 if(!cache.has(name))cache.set(name,new T.MeshStandardMaterial({name:'MAT_Minstrel_'+name,color,roughness:metal?.36:.85,metalness:metal,side:T.DoubleSide}));
 return cache.get(name);
}
function grid(cols,rows,point){
 const p=[],uv=[],ix=[];
 for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){p.push(...point(i/cols,j/rows));uv.push(i/cols,j/rows);if(i<cols&&j<rows){const a=j*(cols+1)+i;ix.push(a,a+1,a+cols+1,a+1,a+cols+2,a+cols+1);}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();smoothSeams(g);g.computeBoundingBox();g.computeBoundingSphere();return g;
}
function garment(root,source,name,geometry,color){
 skinFrom(geometry,source);
 if(geometry.userData.outerVertexCount){
  const count=geometry.userData.outerVertexCount,si=geometry.attributes.skinIndex,sw=geometry.attributes.skinWeight;
  for(let i=0;i<count;i++)for(let k=0;k<4;k++){si.array[(i+count)*4+k]=si.array[i*4+k];sw.array[(i+count)*4+k]=sw.array[i*4+k];}
 }
 const mesh=new T.SkinnedMesh(geometry,material(name,color).clone());
 mesh.name='SM_Hero_Minstrel_'+name;mesh.geometry.name=mesh.name;mesh.bindMode=source.bindMode;mesh.bind(source.skeleton,source.bindMatrix);
 mesh.position.copy(source.position);mesh.quaternion.copy(source.quaternion);mesh.scale.copy(source.scale);mesh.castShadow=mesh.receiveShadow=true;mesh.userData.minstrelPart=name;
 // Reuse the existing cloth micro-normal, not an extra downloaded texture set.
 mesh.material.normalMap=source.material.normalMap;mesh.material.roughnessMap=source.material.roughnessMap;mesh.material.normalScale.set(.11,.11);root.add(mesh);return mesh;
}
function sections(profile,v){
 const k=Math.min(profile.length-2,Math.floor(v*(profile.length-1))),t=v*(profile.length-1)-k;
 return profile[k].map((b,i)=>{const a=profile[Math.max(0,k-1)][i],c=profile[k+1][i],d=profile[Math.min(profile.length-1,k+2)][i];return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);});
}
function finish(g){g.computeVertexNormals();smoothSeams(g);g.computeBoundingBox();g.computeBoundingSphere();return g;}
// Close a tailored panel's actual edge. The inner surface uses the same skinning
// sample as the outer, so moving the arm cannot expose a paper-thin open cut.
function thickness(g,depth=.003){
 const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,count=p.count,positions=Array.from(p.array),tex=Array.from(uv.array),ix=Array.from(g.index.array),edges=new Map();
 for(let i=0;i<count;i++){positions.push(p.getX(i)-n.getX(i)*depth,p.getY(i)-n.getY(i)*depth,p.getZ(i)-n.getZ(i)*depth);tex.push(uv.getX(i),uv.getY(i));}
 for(let i=0;i<g.index.count;i+=3){const a=ix[i],b=ix[i+1],c=ix[i+2];ix.push(c+count,b+count,a+count);for(const[x,y]of[[a,b],[b,c],[c,a]]){const key=x<y?x+':'+y:y+':'+x;if(edges.has(key))edges.delete(key);else edges.set(key,[x,y]);}}
 for(const[a,b]of edges.values())ix.push(a,b,a+count,b,b+count,a+count);
 const result=new T.BufferGeometry();result.setAttribute('position',new T.Float32BufferAttribute(positions,3));result.setAttribute('uv',new T.Float32BufferAttribute(tex,2));result.setIndex(ix);result.userData.outerVertexCount=count;g.dispose();return finish(result);
}
// Merge only rest-space skin samples, remapping bone indices explicitly. A coat
// crossing the waist can then share continuous torso/hip influences.
function clothSource(body,...parts){
 const p=[],si=[],sw=[],boneIndex=new Map(body.skeleton.bones.map((b,i)=>[b.name,i]));
 for(const mesh of[body,...parts].filter(Boolean)){
  const a=mesh.geometry.attributes,used=new Set(mesh.geometry.index?.array||Array.from({length:a.position.count},(_,i)=>i));
  for(const i of used){p.push(a.position.getX(i),a.position.getY(i),a.position.getZ(i));for(let k=0;k<4;k++){si.push(boneIndex.get(mesh.skeleton.bones[a.skinIndex.array[i*4+k]].name));sw.push(a.skinWeight.array[i*4+k]);}}
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(p,3));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(si,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(sw,4));return{...body,geometry};
}
function softenFace(mesh){
 const g=mesh.geometry.clone(),p=g.attributes.position,ids=new Set(g.index.array),groups=new Map(),nodes=[],at=[];
 for(const i of ids){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*100000)).join(',');if(!groups.has(key)){groups.set(key,nodes.length);nodes.push({p:new T.Vector3().fromBufferAttribute(p,i),ids:[],neighbors:new Set()});}const j=groups.get(key);nodes[j].ids.push(i);at[i]=j;}
 for(let i=0;i<g.index.count;i+=3)for(let k=0;k<3;k++){const a=at[g.index.array[i+k]],b=at[g.index.array[i+(k+1)%3]];if(a!==b){nodes[a].neighbors.add(b);nodes[b].neighbors.add(a);}}
 // Taubin relaxation rounds the low-poly jaw and brow without shrinking the
 // whole head or moving the already bound eye sockets.
 for(const amount of[.34,-.28,.28,-.23]){
  const next=nodes.map(n=>{const avg=new T.Vector3();for(const j of n.neighbors)avg.add(nodes[j].p);const w=T.MathUtils.smoothstep(n.p.y,1.49,1.57);return n.neighbors.size?n.p.clone().lerp(avg.multiplyScalar(1/n.neighbors.size),amount*w):n.p.clone();});nodes.forEach((n,i)=>n.p.copy(next[i]));
 }
 const gaussian=(v,c,s)=>Math.exp(-(((v-c)/s)**2));
 for(const n of nodes){
  let{x,y,z}=n.p;const front=T.MathUtils.smoothstep(z,.005,.055),jaw=gaussian(y,1.574,.035),cheek=gaussian(y,1.623,.027)*gaussian(Math.abs(x),.052,.028)*front,mouth=gaussian(y,1.592,.011)*gaussian(Math.abs(x),.026,.014)*front;
  x*=1-.045*jaw;x+=Math.sign(x)*.0022*cheek;z+=.0038*cheek;y+=.0027*mouth;
  // Reduce the angular bridge, retaining the nose profile and original lips.
  z-=.0018*gaussian(y,1.643,.026)*gaussian(x,0,.018)*front;
  for(const i of n.ids)p.setXYZ(i,x,y,z);
 }
 mesh.geometry=finish(g);mesh.userData.minstrelFaceRefined=true;
}
export function rebuildMinstrel(root){
 const oldIdentity=root.getObjectByName('SM_Hero_Identity_silver');oldIdentity?.removeFromParent();
 const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
 const body=meshes.find(o=>o.name==='SM_Hero_Body_silver'),sleeves=meshes.find(o=>o.name==='SM_Hero_Sleeves_silver'),legs=meshes.find(o=>o.name==='SM_Hero_Legs_Silver');
 if(!body||!sleeves)throw Error('Minstrel requires the fitted female body and sleeves');
 for(const m of meshes){
  if(m.userData.hairstyle||/Body_silver|Harness|Lapel|Belt|Buckle|ShoulderYoke|BootPanel|Identity|Bracers|Sleeves/.test(m.name))m.visible=false;
  if(m.name==='SM_Hero_Legs_Silver'){
   m.geometry=m.geometry.clone();const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i),w=T.MathUtils.smoothstep(y,.78,1.025);p.setXYZ(i,p.getX(i)*(1-.07*w),y,-.027+(p.getZ(i)+.027)*(1-.07*w));}finish(m.geometry);
   m.material=material('TravelLeggings',0x344446).clone();m.name='SM_Hero_Minstrel_TravelLeggings';
  }
  if(m.name==='Female_Ranger_Feet'){m.material=material('TravelBoots',0x604333).clone();}
  if(m.name==='SM_Hero_Hands_silver'){m.material=material('ArcheryGloves',MINSTREL_PALETTE.leather).clone();}
  if(m.name==='Superhero_Female'){
   softenFace(m);
   const surface=ownMaterial(m),before=surface.onBeforeCompile,key=surface.customProgramCacheKey();
   surface.onBeforeCompile=shader=>{before(shader);if(shader.uniforms.heroSkinTint)shader.uniforms.heroSkinTint={value:new T.Vector3(.72,.52,.41)};shader.fragmentShader=shader.fragmentShader.replace('(.72+skinShade*.42)','(.83+skinShade*.25)');};surface.customProgramCacheKey=()=>key+'-minstrel-soft-traveller';
   surface.normalMap=null;surface.roughness=.72;surface.aoMapIntensity=.50;
  }
  if(m.name==='Eyes'){ownMaterial(m);m.material.color.set(0xe4e4d5);m.material.roughness=.24;}
  if(m.name==='Eyebrows'){
   m.geometry=m.geometry.clone();const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){const x=Math.abs(p.getX(i));p.setY(i,1.669+(p.getY(i)-1.669)*.65+.0045*(1-T.MathUtils.smoothstep(x,.013,.055)));}finish(m.geometry);
   ownMaterial(m);m.material.color.set(0x795840);m.material.roughness=.9;
  }
 }
 // The long waistcoat is ONE continuous torso-to-hem panel. It replaces the
 // former separate skirt/belt seam that opened into spikes during a stride.
 const blended=clothSource(body,legs,sleeves);
 const coat=[[.72,.242,.174,.181],[.83,.239,.168,.176],[.97,.219,.149,.162],[1.045,.188,.135,.144],[1.13,.153,.119,.127],[1.25,.163,.136,.131],[1.36,.184,.155,.138],[1.435,.195,.141,.140],[1.485,.169,.114,.121],[1.52,.075,.073,.077]];
 const shell=garment(root,blended,'TailoredCoat',thickness(grid(48,42,(u,v)=>{
  const[y,x,front,back]=sections(coat,v),hem=1-T.MathUtils.smoothstep(y,.72,1.06),opening=.45*hem,a=opening+u*(Math.PI*2-opening*2),s=Math.sin(a),c=Math.cos(a),fold=.005*Math.sin(a*7+.2)*hem+.002*Math.sin(y*48+a*4)*Math.exp(-(((y-1.12)/.11)**2)),roundEdge=Math.exp(-((Math.min(u,1-u)/.055)**2))*.028*hem;
  return[s*(x+fold),y+roundEdge,-.027+c*((c>0?front:back)+fold)];
 }),.0036),MINSTREL_PALETTE.cloth);shell.userData.continuousWaistcoat=true;
 // The cream front is a stitched panel of this same topology. It cannot poke
 // through the blue side panels at the shoulder or below the waist.
 shell.material.color.set(0xffffff);
 shell.material.onBeforeCompile=shader=>{
  shader.uniforms.minstrelBlue={value:new T.Color(MINSTREL_PALETTE.cloth)};shader.uniforms.minstrelIvory={value:new T.Color(MINSTREL_PALETTE.ivory)};
  shader.vertexShader='varying vec3 vMinstrelCloth;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvMinstrelCloth=position;');
  shader.fragmentShader='varying vec3 vMinstrelCloth;\nuniform vec3 minstrelBlue;\nuniform vec3 minstrelIvory;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float panelWidth=.047+.055*exp(-pow((vMinstrelCloth.y-1.36)/.15,2.0));
   float seamAA=max(fwidth(vMinstrelCloth.x)*1.15,.0007);
   float frontPanel=(1.0-smoothstep(panelWidth-seamAA,panelWidth+seamAA,abs(vMinstrelCloth.x)))*smoothstep(1.102,1.12,vMinstrelCloth.y)*smoothstep(.015,.05,vMinstrelCloth.z);
   diffuseColor.rgb*=mix(minstrelBlue,minstrelIvory,frontPanel);`);
 };shell.material.customProgramCacheKey=()=> 'minstrel-continuous-front-panel-v2';
 // A soft, narrow belt follows the coat's waist instead of leaving a gap
 // between independently skinned shirt and skirt objects.
 garment(root,blended,'WovenWaistSash',thickness(grid(40,4,(u,v)=>{const a=u*Math.PI*2,y=1.074+v*.033,bulge=Math.sin(v*Math.PI)*.002;return[Math.sin(a)*(.181+bulge),y,-.027+Math.cos(a)*(.143+bulge)];}),.002),MINSTREL_PALETTE.leather);
 // Keep the source's shaped shoulder and elbow topology, but make actual
 // cloth volume and soft elbow folds; no cylindrical tubes at the shoulders.
 const sleeve=sleeves.geometry.clone(),sp=sleeve.attributes.position,indices=[];
 for(let i=0;i<sleeve.index.count;i+=3){const ids=[sleeve.index.array[i],sleeve.index.array[i+1],sleeve.index.array[i+2]];if(ids.every(j=>Math.abs(sp.getX(j))<.637))indices.push(...ids);}
 sleeve.setIndex(indices);
 for(let i=0;i<sp.count;i++){const x=sp.getX(i),a=Math.abs(x),elbow=Math.exp(-(((a-.44)/.075)**2)),fold=(Math.sin(a*92)*.0015+Math.sin(a*48+sp.getZ(i)*16)*.0014)*elbow;
  sp.setXYZ(i,x,1.413+(sp.getY(i)-1.413)*1.025+fold,-.047+(sp.getZ(i)+.047)*1.03+fold);
 }
 garment(root,sleeves,'TailoredSleeves',finish(sleeve),MINSTREL_PALETTE.ivory);
 for(const side of[-1,1])garment(root,blended,'Cuff_'+(side<0?'R':'L'),thickness(grid(24,8,(u,v)=>{const a=u*Math.PI*2,x=.612+v*.079,r=.044-.012*T.MathUtils.smoothstep(v,0,1)+.001*Math.sin(v*Math.PI);return[side*x,1.414+Math.cos(a)*r,-.047+Math.sin(a)*r*.90];}),.0025),0xd8cfb9);
 blended.geometry.dispose();
 root.userData.minstrelRebuilt=true;root.userData.rebuildStyle='continuous-tailored-coat-soft-traveller';
}
function addMesh(parent,name,geometry,mat){
 const m=new T.Mesh(geometry,mat);m.name=name;m.castShadow=m.receiveShadow=true;parent.add(m);return m;
}
function hairLock(points,widths,depths,segments=20){
 const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),up=new T.Vector3(0,0,1);
 const geo=grid(10,segments,(u,v)=>{
  const p=path.getPoint(v),t=path.getTangent(v).normalize(),across=new T.Vector3().crossVectors(up,t).normalize(),normal=new T.Vector3().crossVectors(t,across).normalize(),a=u*Math.PI*2,k=Math.min(widths.length-2,Math.floor(v*(widths.length-1))),s=v*(widths.length-1)-k,w=T.MathUtils.lerp(widths[k],widths[k+1],s),d=T.MathUtils.lerp(depths[k],depths[k+1],s);
  // Broad lens sections read as swept hair sheets, not hanging cylinders.
  p.addScaledVector(across,Math.sin(a)*w).addScaledVector(normal,Math.cos(a)*d*(.95+.05*Math.cos(u*6*Math.PI)));return p.toArray();
 });return geo;
}
function hairColor(geo,base){
 const p=geo.attributes.position,uv=geo.attributes.uv,color=new T.Color(base),c=new T.Color(),out=[];
 for(let i=0;i<p.count;i++){const u=uv.getX(i),v=uv.getY(i);c.copy(color).multiplyScalar(.90+.08*Math.sin(u*22*Math.PI+v*.7)+.09*Math.sin(v*Math.PI));out.push(c.r,c.g,c.b);}
 geo.setAttribute('color',new T.Float32BufferAttribute(out,3));return geo;
}
export function createMinstrelHair(){
 const g=new T.Group();g.name='SM_Hero_Minstrel_Hair';
 const hair=material('SoftHair',0xffffff).clone();hair.vertexColors=true;hair.roughness=.58;
 const add=(name,geometry,flex=1,anchor=1.68)=>{const m=addMesh(g,'SM_Hero_Minstrel_'+name,hairColor(geometry,MINSTREL_PALETTE.hair),hair.clone());m.userData.minstrelHair={rest:geometry.attributes.position.array.slice(),flex,anchor};geometry.attributes.position.setUsage(T.DynamicDrawUsage);return m;};
 // A continuous shaped cap extends down the back and over the temples. The
 // part and brushed ridges are in its surface, rather than eight isolated tubes.
 const cap=grid(48,24,(u,v)=>{
  const a=u*Math.PI*2,c=Math.cos(a),b=.001+v*(1.23+.95*(1-c)*.5),ridge=.0009*Math.sin(a*21+b*2)*Math.sin(b),part=-.0035*Math.exp(-(((a-.38)/.10)**2))*Math.sin(b)**2;
  return[Math.sin(a)*Math.sin(b)*(.110+ridge+part),1.681+Math.cos(b)*.118,-.025+c*Math.sin(b)*(.109+ridge)];
 });add('Crown',cap,0);
 // The fringe is brushed diagonally away from the eyes, with overlapping roots.
 add('SweptFringe',hairLock([[-.031,1.787,.014],[.009,1.773,.064],[.058,1.726,.083],[.080,1.681,.060]],[.031,.039,.030,.001],[.006,.009,.010,.001],24),.20,1.70);
 add('PartedFringe',hairLock([[-.035,1.786,.010],[-.070,1.754,.059],[-.092,1.705,.057],[-.097,1.666,.039]],[.021,.028,.024,.001],[.006,.009,.008,.001],20),.18,1.70);
 add('HairLock_L',hairLock([[-.098,1.705,.021],[-.107,1.654,.021],[-.104,1.591,.022],[-.080,1.553,.010]],[.022,.026,.018,.001],[.009,.011,.009,.001],24),.45,1.67);
 add('HairLock_R',hairLock([[.099,1.699,.011],[.106,1.640,-.003],[.099,1.583,-.026],[.076,1.555,-.039]],[.021,.024,.016,.001],[.008,.010,.008,.001],22),.45,1.66);
 // Soft broad ponytail, curving back toward the body, with two attached folds.
 add('SweptPonytail',hairLock([[.025,1.641,-.133],[.040,1.561,-.172],[.075,1.442,-.184],[.099,1.342,-.151],[.074,1.302,-.135]],[.028,.052,.050,.029,.001],[.022,.029,.024,.016,.001],32),1,1.63);
 add('PonytailFold',hairLock([[.018,1.632,-.149],[.020,1.544,-.194],[.045,1.433,-.202],[.072,1.346,-.169]],[.019,.025,.023,.001],[.008,.010,.008,.001],26),1,1.63);
 hair.dispose();
 return g;
}
export function createMinstrelMantle(){
 // A small back collar stays behind the shoulder articulation. The old rigid
 // front cape corners caught the raised upper arms and looked like armor.
 const geometry=thickness(grid(32,8,(u,v)=>{const a=.60+u*(Math.PI*2-1.2),c=Math.cos(a),r=.078+.024*v;return[Math.sin(a)*r,1.53-v*.058,-.027+c*r*.91];}),.003);
 const m=new T.Mesh(geometry,material('ShortMantle',0x3f646a).clone());m.name='SM_Hero_Minstrel_ShortMantle';m.castShadow=m.receiveShadow=true;
 m.userData.minstrelCloth={rest:geometry.attributes.position.array.slice()};geometry.attributes.position.setUsage(T.DynamicDrawUsage);return m;
}
export function animateMinstrelDetails(details,time,run=0,turn=0){
 for(const mesh of details){
  const data=mesh.userData.minstrelHair||mesh.userData.minstrelCloth;if(!data)continue;
  if(data.flex===0)continue;
  const p=mesh.geometry.attributes.position,hair=!!mesh.userData.minstrelHair;
  for(let i=0;i<p.count;i++){const k=i*3,y=data.rest[k+1],w=T.MathUtils.clamp((hair?(data.anchor||1.70)-y:1.50-y)/(hair?.30:.27),0,1)**2*(hair?(data.flex??1):1);
   p.setXYZ(i,data.rest[k]+w*(Math.sin(time*(hair?2.3:1.8)+y*5)*.006-T.MathUtils.clamp(turn,-2,2)*.008),y,data.rest[k+2]-w*(run*.021+Math.sin(time*2.1+y*8)*.004));}
  p.needsUpdate=true;
 }
}
