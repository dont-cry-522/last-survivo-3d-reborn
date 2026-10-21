import * as T from './vendor/three.module.js';
import {skinFrom} from './ranger-rebuild.js?v=230';
import {smoothSeams} from './hero-finish.js?v=230';
import {restSurface} from './hero-rest-surface.js?v=230';

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
 for(const amount of[.44,-.28,.42,-.27,.38,-.25,.34,-.23]){
  const next=nodes.map(n=>{const avg=new T.Vector3();for(const j of n.neighbors)avg.add(nodes[j].p);const w=T.MathUtils.smoothstep(n.p.y,1.49,1.57);return n.neighbors.size?n.p.clone().lerp(avg.multiplyScalar(1/n.neighbors.size),amount*w):n.p.clone();});nodes.forEach((n,i)=>n.p.copy(next[i]));
 }
 const gaussian=(v,c,s)=>Math.exp(-(((v-c)/s)**2));
 for(const n of nodes){
  let{x,y,z}=n.p;const front=T.MathUtils.smoothstep(z,.005,.055),ax=Math.abs(x),jaw=gaussian(y,1.567,.035);
  const cheek=gaussian(y,1.628,.031)*gaussian(ax,.052,.028)*front;
  // Resculpt the broad superhero jaw, concave lower cheek and heavy brow.
  // This changes the existing skin surface, not an added face-shaped shell.
  x*=1-.085*jaw;y+=.0035*gaussian(y,1.548,.021);
  z+=.0052*cheek+.0038*gaussian(y,1.595,.020)*gaussian(ax,.034,.020)*front;
  z-=.0057*gaussian(y,1.672,.013)*gaussian(ax,.037,.025)*front;
  y+=.0035*gaussian(y,1.657,.006)*gaussian(ax,.035,.022)*front;
  // Smaller rounded nose wings and a less projecting bridge retain a proper
  // profile. Lips keep their topology, but lose the carved smile and lip shelf.
  const nose=gaussian(y,1.621,.026)*gaussian(ax,0,.026)*front;
  x*=1-.13*nose;z-=.0032*nose;
  const lip=gaussian(y,1.592,.014)*gaussian(ax,0,.039)*front;
  x*=1-.10*lip;z=T.MathUtils.lerp(z,.085,.48*lip);
  z+=.0024*gaussian(y,1.591,.010)*gaussian(ax,.033,.015)*front;
  y=1.592+(y-1.592)*(1-.20*lip);
  for(const i of n.ids)p.setXYZ(i,x,y,z);
 }
 mesh.geometry=finish(g);mesh.userData.minstrelFaceRefined=true;
}
function faceSurface(mesh){
 const surface=ownMaterial(mesh);
 // The source texture includes painted eye-socket shadows. Keep its small
 // pigment variation, not that baked lighting: the real scene lights the face.
 surface.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec3 vMinstrelFace;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvMinstrelFace=position;');
  shader.fragmentShader='varying vec3 vMinstrelFace;\n'+shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   float skinValue=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
   float pigment=clamp((skinValue-.25)*.12,-.025,.035);
   float front=smoothstep(.018,.055,vMinstrelFace.z);
   float lipY=(vMinstrelFace.y-1.592)/.007,lipX=vMinstrelFace.x/.031;
   float lipX2=lipX*lipX;
   float lip=exp(-lipY*lipY-lipX2*lipX2)*front;
   vec2 cheekDistance=vec2((vMinstrelFace.y-1.625)/.022,(abs(vMinstrelFace.x)-.052)/.024);
   float cheek=exp(-dot(cheekDistance,cheekDistance))*front;
   vec3 skin=vec3(.62,.405,.29)*(1.0+pigment);
   skin=mix(skin,vec3(.48,.245,.188),lip*.49);
   diffuseColor.rgb=mix(skin,skin*vec3(1.025,.963,.955),cheek*.38);`);
 };
 surface.customProgramCacheKey=()=> 'minstrel-unbaked-soft-face-v229';
 surface.normalMap=null;surface.aoMap=null;surface.roughnessMap=null;
 surface.roughness=.76;surface.metalness=0;surface.color.set(0xffffff);
}
function refineBrows(mesh,face){
 const sample=restSurface(face.geometry);
 // Fit a single soft brow to the actual forehead, replacing the split, folded
 // original eyebrow strips. Sampling happens once, while building the template.
 const brows=[];
 for(const side of[-1,1])brows.push(grid(24,4,(u,v)=>{
  const x=side*(.017+u*.043),y=1.674+.0038*Math.sin(u*Math.PI)-.0025*u;
  const taper=Math.sin(Math.PI*u)**.65,py=y+(v-.5)*.0044*taper,z=sample(x,py)?.point.z??.05;
  return[x,py,z+.00065+Math.sin(v*Math.PI)*.0003*taper];
 }));
 const positions=[],uv=[],index=[];let offset=0;
 for(const g of brows){positions.push(...g.attributes.position.array);uv.push(...g.attributes.uv.array);index.push(...Array.from(g.index.array,i=>i+offset));offset+=g.attributes.position.count;g.dispose();}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(index);finish(g);skinFrom(g,face);
 mesh.geometry=g;mesh.skeleton=face.skeleton;mesh.bindMatrix.copy(face.bindMatrix);mesh.bindMatrixInverse.copy(face.bindMatrixInverse);
 mesh.material=material('SoftBrows',0x594334).clone();mesh.userData.minstrelBrowsRefined=true;
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
   faceSurface(m);
  }
  if(m.name==='Eyes'){ownMaterial(m);m.material.color.set(0xe9e4d8);m.material.roughness=.32;m.material.normalMap=null;}
 }
 refineBrows(meshes.find(o=>o.name==='Eyebrows'),meshes.find(o=>o.name==='Superhero_Female'));
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
  const p=path.getPoint(v),t=path.getTangent(v).normalize(),across=new T.Vector3().crossVectors(up,t).normalize(),normal=new T.Vector3().crossVectors(t,across).normalize(),a=u*Math.PI*2,[w,d]=sections(widths.map((w,i)=>[w,depths[i]]),v);
  p.addScaledVector(across,Math.sin(a)*Math.max(.0004,w)).addScaledVector(normal,Math.cos(a)*Math.max(.0003,d));return p.toArray();
 });return geo;
}
function hairColor(geo,base){
 const p=geo.attributes.position,uv=geo.attributes.uv,color=new T.Color(base),c=new T.Color(),out=[];
 for(let i=0;i<p.count;i++){const u=uv.getX(i),v=uv.getY(i);c.copy(color).multiplyScalar(.95+.045*Math.sin(u*10*Math.PI)+.065*Math.sin(v*Math.PI));out.push(c.r,c.g,c.b);}
 geo.setAttribute('color',new T.Float32BufferAttribute(out,3));return geo;
}
function prepareHairMotion(mesh,flex,anchor){
 const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,weight=new Float32Array(p.count),slope=new Float32Array(p.count);
 for(let i=0;i<p.count;i++){const u=T.MathUtils.clamp((anchor-p.getY(i))/.30,0,1);weight[i]=u*u*flex;slope[i]=u>0&&u<1?-2*u/.30*flex:0;}
 mesh.userData.minstrelHair={rest:p.array.slice(),normal:n.array.slice(),weight,slope,flex,anchor};
 if(flex){p.setUsage(T.DynamicDrawUsage);n.setUsage(T.DynamicDrawUsage);}
}
export function createMinstrelHair(face){
 const g=new T.Group();g.name='SM_Hero_Minstrel_Hair';
 const scalp=face?restSurface(face.geometry):null;
 const hair=material('SoftHair',0xffffff).clone();hair.vertexColors=true;hair.roughness=.65;
 // Fine longitudinal pigment bands follow the authored root-to-tip UV flow.
 // Derivative filtering fades subpixel strands rather than shimmering on phones.
 hair.onBeforeCompile=shader=>{
  shader.uniforms.minstrelParting={value:0};
  shader.vertexShader='varying vec2 vMinstrelHairUV;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvMinstrelHairUV=uv;');
  shader.fragmentShader='varying vec2 vMinstrelHairUV;\nuniform float minstrelParting;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float strand=vMinstrelHairUV.x*145.0+.7*sin(vMinstrelHairUV.y*3.0+vMinstrelHairUV.x*12.56637);
   float detail=1.0-smoothstep(.18,.7,fwidth(strand));
   diffuseColor.rgb*=1.0+detail*(.030*sin(strand*6.2831853)+.014*sin(strand*13.0));
   float partAngle=vMinstrelHairUV.x*6.2831853+.15;
   float partDistance=atan(sin(partAngle),cos(partAngle));
   float part=exp(-partDistance*partDistance/.001225)*smoothstep(.10,.40,vMinstrelHairUV.y)*minstrelParting;
   diffuseColor.rgb*=1.0-part*.24;`);
 };hair.customProgramCacheKey=()=> 'minstrel-flowing-strands-v229';
 const add=(name,geometry,flex=1,anchor=1.68)=>{
  const mat=hair.clone();mat.onBeforeCompile=shader=>{hair.onBeforeCompile(shader);shader.uniforms.minstrelParting.value=name==='Crown'?1:0;};mat.customProgramCacheKey=hair.customProgramCacheKey;
  const m=addMesh(g,'SM_Hero_Minstrel_'+name,hairColor(geometry,MINSTREL_PALETTE.hair),mat);prepareHairMotion(m,flex,anchor);return m;
 };
 // One uninterrupted scalp-to-hairline surface. The side part and swept fringe
 // belong to this surface, avoiding the old separate slabs and triangular gaps.
 const cap=grid(80,20,(u,v)=>{
  const a=u*Math.PI*2,c=Math.cos(a);
  const hairline=1.20+1.07*(1-c)*.5+.16*Math.sin(a)**2+.75*Math.sin(a)*Math.max(c,0);
  const feather=(.004*Math.sin(a*23+.4)+.003*Math.sin(a*31+1.1))*T.MathUtils.smoothstep(v,.88,1);
  const b=v*hairline+feather;
  const flow=a+.18*Math.sin(b)*Math.sin(a),split=Math.atan2(Math.sin(a+.15),Math.cos(a+.15));
  const strand=(.0003*Math.cos(a*29+b*.4)+.0012*Math.cos(a*8+b*1.6))*Math.sin(b);
  const part=-.0045*Math.exp(-((split/.085)**2))*Math.sin(b)**2;
  const sweep=(.008*Math.exp(-(((split-.50-.35*b)/.28)**2))+.004*Math.exp(-(((split-1.40-.16*b)/.20)**2))+.004*Math.exp(-(((split+.55+.12*b)/.30)**2)))*Math.sin(b)**2;
  const edge=T.MathUtils.smoothstep(v,.92,1),ridge=strand+part+sweep;
  const rx=.107+.004*Math.exp(-(((b-.8)/.7)**2))-.002*edge,rz=c>0?.119:.106;
  const x=-.019*(1-v)**2+Math.sin(flow)*Math.sin(b)*(rx+ridge),y=1.679+Math.cos(b)*(.117+ridge);
  let z=-.022+Math.cos(flow)*Math.sin(b)*(rz+ridge);
  if(scalp&&v>.82&&c>.15){const hit=scalp(x,y);if(hit)z=Math.max(z,hit.point.z+.0012);}
  return[x,y,z];
 });add('Crown',cap,0);
 // Temple hair is part of the crown surface above, brushed behind the ears.
 // Separate cheek ribbons made the earlier hairstyle look assembled.
 add('SweptPonytail',hairLock([[.010,1.687,-.099],[.015,1.662,-.121],[.025,1.610,-.151],[.038,1.544,-.180],[.064,1.447,-.191],[.067,1.370,-.172],[.041,1.331,-.149]],[.0006,.014,.019,.035,.044,.023,.0006],[.0005,.009,.014,.024,.025,.012,.0005],38),1,1.63);
 add('PonytailFold',hairLock([[.014,1.650,-.133],[.007,1.608,-.162],[.005,1.541,-.185],[.024,1.454,-.204],[.042,1.385,-.187],[.029,1.351,-.163]],[.0006,.012,.023,.026,.018,.0006],[.0004,.005,.007,.007,.004,.0005],30),1,1.63);
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
  const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,hair=!!mesh.userData.minstrelHair;
  const turnShift=T.MathUtils.clamp(turn,-2,2)*.008,runShift=T.MathUtils.clamp(run,0,2.5)*.021;
  for(let i=0;i<p.count;i++){const k=i*3,y=data.rest[k+1],w=hair?data.weight[i]:T.MathUtils.clamp((1.50-y)/.27,0,1)**2;
   const phase=time*(hair?2.3:1.8)+y*5,flow=time*2.1+y*8,x=Math.sin(phase)*.006-turnShift,z=-runShift-Math.sin(flow)*.004;
   p.setXYZ(i,data.rest[k]+w*x,y,data.rest[k+2]+w*z);
   if(hair){
    // Inverse transpose of the actual y-dependent shear keeps highlights with
    // the moving lock. No allocations or triangle/normal rebuild per frame.
    const dx=data.slope[i]*x+w*Math.cos(phase)*.030,dz=data.slope[i]*z-w*Math.cos(flow)*.032;
    const nx=data.normal[k],ny=data.normal[k+1]-dx*data.normal[k]-dz*data.normal[k+2],nz=data.normal[k+2],len=Math.hypot(nx,ny,nz)||1;
    n.setXYZ(i,nx/len,ny/len,nz/len);
   }
  }
  p.needsUpdate=true;if(hair)n.needsUpdate=true;
 }
}
