import * as T from './vendor/three.module.js';
import {herbalPose} from './weapon-performance.js?v=228';
import {nameWeapon} from './weapon-identity.js?v=228';

const materials=new Map(),geometry=new Map(),UP=new T.Vector3(0,1,0),FORWARD=new T.Vector3(0,0,1);
function mat(color,metal=0){const key=color+':'+metal;if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color,metalness:metal,roughness:metal?.39:.79,side:T.DoubleSide}));return materials.get(key);}
function mesh(parent,name,g,color,metal=0){const m=new T.Mesh(g,mat(color,metal));m.name=name;m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
function cached(key,make){if(!geometry.has(key))geometry.set(key,make());return geometry.get(key);}
function line(parent,name,points,r,color,metal=0){return mesh(parent,name,cached(name,()=>new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),Math.max(8,points.length*2),r,6,false)),color,metal);}
function sphere(parent,name,pos,scale,color,metal=0){const m=mesh(parent,name,cached('sphere',()=>new T.SphereGeometry(1,12,8)),color,metal);m.position.set(...pos);m.scale.set(...scale);return m;}
function tube(parent,name,pos,scale,color,metal=0){const m=mesh(parent,name,cached('shaft',()=>new T.CylinderGeometry(1,1,1,12)),color,metal);m.position.set(...pos);m.scale.set(...scale);return m;}

export const isHerbalWeapon=id=>id==='mycelialwhip'||id==='venomfan';
export function makeHerbalWeapon(id){
 const g=new T.Group();g.name=id==='mycelialwhip'?'SM_Weapon_MycelialWhip_A':'SM_Weapon_VenomFan_A';g.userData.herbalOwned={geometries:[],materials:[]};
 if(id==='mycelialwhip'){
  const h=mesh(g,'SM_MycelialWhip_ShapedGrip_A',cached('whip-handle',()=>new T.LatheGeometry([[.025,-.18],[.038,-.16],[.033,-.12],[.029,.10],[.040,.16],[.032,.20]].map(p=>new T.Vector2(...p)),16)),0x3b2940);h.userData.identityDetail=true;
  for(const y of[-.16,.14])tube(g,'SM_MycelialWhip_BronzeCollar_'+y,[0,y,0],[.039,.024,.039],0xa69a70,.60);
  const wrap=[];for(let i=0;i<=42;i++){const a=i/42*Math.PI*12;wrap.push([.033*Math.sin(a),-.13+i/42*.26,.033*Math.cos(a)]);}line(g,'SM_MycelialWhip_WovenGrip_A',wrap,.0038,0x867058);
  sphere(g,'SM_MycelialWhip_GillSocket_A',[0,.20,0],[.046,.069,.043],0x9a8e70);
  const rings=40,sides=7,p=new Float32Array((rings+1)*(sides+1)*3),uv=[],ix=[];
  for(let i=0;i<=rings;i++)for(let j=0;j<=sides;j++){uv.push(j/sides,i/rings);if(i<rings&&j<sides){const a=i*(sides+1)+j;ix.push(a,a+1,a+sides+1,a+1,a+sides+2,a+sides+1);}}
  const body=new T.BufferGeometry();body.setAttribute('position',new T.BufferAttribute(p,3).setUsage(T.DynamicDrawUsage));body.setAttribute('uv',new T.Float32BufferAttribute(uv,2));body.setIndex(ix);body.name='SM_MycelialWhip_FlexibleCord_A';
  const cord=mesh(g,body.name,body,0x776048);cord.frustumCulled=false;cord.userData.herbalDynamic=true;g.userData.herbalOwned.geometries.push(body);
  const tip=new T.Group();tip.name='SM_MycelialWhip_GillTip_A';g.add(tip);
  sphere(tip,'SM_MycelialWhip_TipHeart_A',[0,0,0],[.025,.055,.027],0xc3b979);
  for(const side of[-1,1]){const petal=sphere(tip,'SM_MycelialWhip_TipGill_'+side,[side*.025,-.022,0],[.035,.052,.010],0x9d8da4);petal.rotation.z=side*-.38;}
  g.userData.herbalCord={cord,tip,rings,sides,centers:Array.from({length:rings+1},()=>new T.Vector3()),axis:new T.Vector3(),normal:new T.Vector3(),binormal:new T.Vector3()};
 }else{
  // One pleated membrane with eleven light ribs: a real folding fan silhouette,
  // not a circle of rigid paddles. Its lower pivot stays in the wrapped palm.
  const segments=20,p=new Float32Array((segments+1)*3*3),uv=[],ix=[],colors=[],dark=new T.Color(0x33263f),light=new T.Color(0xb4a5bc),c=new T.Color();
  for(let i=0;i<=segments;i++)for(let r=0;r<3;r++){uv.push(i/segments,r/2);c.copy(dark).lerp(light,r===2?.60:r===1?.12:0);colors.push(c.r,c.g,c.b);if(i<segments&&r<2){const a=i*3+r;ix.push(a,a+3,a+1,a+3,a+4,a+1);}}
  const leaf=new T.BufferGeometry();leaf.setAttribute('position',new T.BufferAttribute(p,3).setUsage(T.DynamicDrawUsage));leaf.setAttribute('uv',new T.Float32BufferAttribute(uv,2));leaf.setAttribute('color',new T.Float32BufferAttribute(colors,3));leaf.setIndex(ix);leaf.name='SM_VenomFan_PleatedSilk_A';
  const silk=mesh(g,leaf.name,leaf,0xffffff);silk.material=silk.material.clone();silk.material.vertexColors=true;silk.material.roughness=.83;silk.userData.herbalDynamic=true;g.userData.herbalOwned.geometries.push(leaf);g.userData.herbalOwned.materials.push(silk.material);
  const ribs=[];for(let i=0;i<=10;i++){const rib=tube(g,'SM_VenomFan_BoneRib_'+i,[0,0,0],[.008,.57,.008],i===0||i===10?0xc7bc9d:0x887b77,.22);ribs.push(rib);}
  sphere(g,'SM_VenomFan_PivotRivet_A',[0,-.010,.013],[.037,.037,.013],0xbeb09b,.68);
  const tassel=line(g,'SM_VenomFan_SilkTassel_A',[[0,-.04,0],[.018,-.11,0],[.014,-.16,.012]],.008,0x786586);tassel.userData.identityDetail=true;
  g.userData.herbalFan={silk,ribs,segments};
 }
 poseHerbalWeapon(g,id,10,1,0,'',0);return nameWeapon(g,id==='mycelialwhip'?'wuling':'mirage',id);
}

// A curved centreline is evaluated from game-time phase. There is no physics
// timer or accumulating spring state, so pause/restart/low frame rates agree.
export function poseHerbalWeapon(g,id,age,period=1,combo=0,path='',time=0){
 const pose=herbalPose(id,age,period,combo,path),d=g.userData;
 if(d.herbalCord){
  const {cord,tip,rings,sides,centers,axis,normal,binormal}=d.herbalCord,p=cord.geometry.attributes.position,wide=path==='mycelialwhip_sweep'?1.30:1,long=path==='mycelialwhip_tip'?1.12:1;
  centers[0].set(0,.21,.10);
  for(let i=1;i<=rings;i++){
   // Integrate a unit tangent with fixed segment length: a slack cord unfolds,
   // rather than stretching like rubber from a short idle model into a long strike.
   const u=(i-.5)/rings,snap=pose.snap,loose=1-snap,lag=Math.max(0,Math.min(1,(pose.phase-u*.12)/.84)),load=Math.sin(Math.PI*lag)**2*pose.weight;
   axis.set(pose.side*(loose*.75*Math.cos(u*Math.PI*2)+snap*wide*.17*Math.sin(u*4.6-pose.phase*6)*load),loose*(-.94*Math.cos(u*Math.PI)+.025*Math.sin(time*1.7-u*2))-.045*snap,loose*.13*Math.cos(u*Math.PI)+snap).normalize();
   centers[i].copy(centers[i-1]).addScaledVector(axis,2.40*long/rings);
  }
  for(let i=0;i<=rings;i++){
   axis.copy(centers[Math.min(rings,i+1)]).sub(centers[Math.max(0,i-1)]).normalize();normal.crossVectors(axis,Math.abs(axis.y)>.9?FORWARD:UP).normalize();binormal.crossVectors(axis,normal).normalize();const radius=.021*(1-i/rings*.82);
   for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,idx=i*(sides+1)+j;p.setXYZ(idx,centers[i].x+radius*(normal.x*Math.cos(a)+binormal.x*Math.sin(a)),centers[i].y+radius*(normal.y*Math.cos(a)+binormal.y*Math.sin(a)),centers[i].z+radius*(normal.z*Math.cos(a)+binormal.z*Math.sin(a)));}
  }
  p.needsUpdate=true;cord.geometry.computeVertexNormals();cord.geometry.computeBoundingBox();cord.geometry.computeBoundingSphere();tip.position.copy(centers[rings]);axis.copy(centers[rings]).sub(centers[rings-1]).normalize();tip.quaternion.setFromUnitVectors(UP,axis);
 }
 if(d.herbalFan){
  const {silk,ribs,segments}=d.herbalFan,p=silk.geometry.attributes.position,spread=.16+pose.open*1.16;
  for(let i=0;i<=segments;i++){const angle=(i/segments-.5)*spread*2;for(let r=0;r<3;r++){const radius=[.13,.35,.55][r],pleat=(i%2?.013:-.013)*(r/2)*pose.open;p.setXYZ(i*3+r,Math.sin(angle)*radius,Math.cos(angle)*radius,pleat);}}
  p.needsUpdate=true;silk.geometry.computeVertexNormals();silk.geometry.computeBoundingBox();silk.geometry.computeBoundingSphere();
  for(let i=0;i<ribs.length;i++){const a=(i/(ribs.length-1)-.5)*spread*2,r=ribs[i];r.rotation.z=-a;r.position.set(Math.sin(a)*.275,Math.cos(a)*.275,.010);}
 }
 return pose;
}

export function disposeHerbalWeapon(g){const owned=g?.userData.herbalOwned;if(!owned)return;for(const resource of[...owned.geometries,...owned.materials])resource.dispose();owned.geometries.length=owned.materials.length=0;}
