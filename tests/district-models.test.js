import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {buildDistricts} from '../map-districts.js';
import {seeded} from '../rules.js';
import {polishEnvironmentModels} from '../environment-props.js';

function build(id,seed){
 const world={group:new T.Group(),obstacles:[],sites:[],ponds:[],spawn:{x:-30,z:-30},half:100};
 const cache=new Map(),materials=new Map();
 const mesh=(type,args,color,x=0,y=0,z=0,parent)=>{const key=type+args.join(',');if(!cache.has(key))cache.set(key,new T[type](...args));if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,emissiveIntensity:0}));const o=new T.Mesh(cache.get(key),materials.get(color));o.position.set(x,y,z);parent.add(o);return o;};
 const random=seeded(seed),layouts=id==='sand'?[{x:0,z:0,kind:'gate',angle:.31},{x:20,z:20,kind:'court',angle:-.41}]:['warehouse','wreck','beacon','dock'].map((kind,i)=>({x:i%2*25,z:Math.floor(i/2)*25,kind,angle:.31}));
 buildDistricts(world,id,layouts,mesh,random);polishEnvironmentModels(world);
 const layout=world.obstacles.map(o=>[o.x,o.z,o.r,o.mesh.rotation.y,o.mesh.userData.district,o.mesh.userData.fragile||false]);
 world.layoutHash=createHash('sha256').update(JSON.stringify([layout,random()])).digest('hex');
 world.dispose=()=>{world.group.traverse(o=>{if(o.userData.ownedGeometry)o.geometry.dispose();if(o.isInstancedMesh)o.dispose();});for(const g of cache.values())g.dispose();for(const m of materials.values())m.dispose();};return world;
}
const baseline={sand:['0a8882c4485b150ce7f8ab43949f6d33ba30d13fd17145dbbac7922055708e94','afddf69024bb882d351dcc47981a18d278f7c494b909a1ff33cfb9d79c0aa0b2','e91c41ba3143896a90244f886642121ef7c3eef4bf3952616392a4c18d65a520'],coast:['3c09e3ab4cea813b185cae7c53fed64905ccd738c7244566260fec29ce0648c1','87ed6fb799b2dbd300c3f221493962869787eed3dac690abbaceecf45aa581c9','7fe6421d4bdae837543f63bbb72416d9d94c8763cb27b1a5fd38ea0b6bd8e417']};

test('district art preserves v213 collision positions, rotations, breakable roots and the seeded stream',()=>{
 for(const id of['sand','coast'])for(const [i,seed]of[1,42,522].entries()){
  const world=build(id,seed);assert.equal(world.layoutHash,baseline[id][i]);assert.equal(world.obstacles.length,id==='sand'?34:27);
  if(id==='sand')assert.equal(world.obstacles.filter(o=>o.mesh.userData.fragile).length,16);
  world.dispose();
 }
});

test('district details stay batched and finite without another texture or per-frame system',()=>{
 for(const id of['sand','coast']){
  const world=build(id,522);let count=0,triangles=0;
  world.group.traverse(o=>{if(!o.isMesh)return;count++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);assert([...o.geometry.attributes.position.array,...o.geometry.attributes.normal.array].every(Number.isFinite));if(o.name.startsWith('SM_District_')){assert(o.userData.ownedGeometry&&o.userData.environmentFinish);assert.equal(o.material.vertexColors,true);if(o.name.endsWith('_wood'))assert.equal(o.geometry.attributes.surfaceCoord.count,o.geometry.attributes.position.count);}});
  assert(count<=(id==='sand'?41:44));assert(triangles<=(id==='sand'?18000:22000));
  const a=world.obstacles.find(o=>o.mesh.children.some(m=>m.name.startsWith('SM_District_'))).mesh.children.find(m=>m.name.startsWith('SM_District_'));
  const other=build(id,42);assert(other.obstacles.some(o=>o.mesh.children.some(m=>m.material===a.material)),'static finishes were reallocated on restart');world.dispose();other.dispose();
 }
});

test('warehouse retains a closed precise roof while the wreck gains a curved hull inside its occupied envelope',()=>{
 const world=build('coast',42),roofs=[];
 for(const obstacle of world.obstacles){
  obstacle.mesh.traverse(m=>{if(m.name==='SM_Harbor_CedarRoof_A'){roofs.push(m);const p=m.geometry.attributes.position;assert(p.count>400);for(let i=0;i<p.count;i++)assert(Math.abs(p.getX(i))<=.5001&&Math.abs(p.getY(i))<=.5001&&Math.abs(p.getZ(i))<=.5001);}
   if(obstacle.mesh.userData.district==='wreck'&&m.name.startsWith('SM_District_')){const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){assert(Math.hypot(p.getX(i),p.getZ(i))<=obstacle.r+.011,'new hull escaped its old collision circle');assert(p.getY(i)<1,'low wreck became a tall obstacle');}}
  });
 }
 assert.equal(roofs.length,2);world.dispose();
});

test('warehouse slopes rise toward one sealed ridge and leave the two-metre passage open',()=>{
 const world=build('coast',42),district=world.districts.find(d=>d.kind==='warehouse'),roofs=[];
 for(const obstacle of world.obstacles)if(obstacle.mesh.userData.district==='warehouse')obstacle.mesh.traverse(m=>{if(m.isMesh&&(m.name==='SM_Harbor_CedarRoof_A'||m.name==='SM_Harbor_RoofFrame_A'))roofs.push(m);});
 world.group.updateMatrixWorld(true);const c=Math.cos(district.angle),s=Math.sin(district.angle),at=(x,y,z)=>new T.Vector3(district.x+c*x+s*z,y,district.z-s*x+c*z),ray=new T.Raycaster(),heights=new Map();
 for(const z of[-1.8,-.8,.8,1.8])for(const x of[-2.3,-1.3,-.15,0,.15,1.3,2.3]){
  ray.set(at(x,4.6,z),new T.Vector3(0,-1,0));ray.far=2;const hit=ray.intersectObjects(roofs,false)[0];assert(hit,'gap through pitched roof at '+[x,z]);heights.set(x+':'+z,hit.point.y);
  ray.set(at(x,2,z),new T.Vector3(0,1,0));assert(ray.intersectObjects(roofs,false)[0]?.point.y>3,'roof blocks the walking head plane');
 }
 for(const z of[-1.8,-.8,.8,1.8]){assert(heights.get('0:'+z)>heights.get('-2.3:'+z)+.45);assert(heights.get('0:'+z)>heights.get('2.3:'+z)+.45);}
 ray.set(at(-2,1.8,0),at(2,1.8,0).sub(at(-2,1.8,0)).normalize());ray.far=4;assert.equal(ray.intersectObjects(roofs,false).length,0,'triangular bracing entered the walking route');
 world.dispose();
});
