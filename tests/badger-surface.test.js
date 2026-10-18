import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {makeBadger,animateBadger} from '../beast-model.js';

const meshes=g=>{const out=[];g.traverse(o=>{if(o.isMesh)out.push(o)});return out;};

test('badger continuous coat replaces separate belly, shin and tail spheres while sharing bounded resources',()=>{
 const a=makeBadger(),b=makeBadger(),parts=meshes(a),copy=meshes(b),materials=new Set(parts.map(m=>m.material));
 assert.equal(parts.length,20);assert.equal(materials.size,5);
 const tris=parts.reduce((sum,m)=>sum+(m.geometry.index?.count||m.geometry.attributes.position.count)/3,0);
 assert(tris<12000,'rebuild exceeded less-than-half of the 29,752 triangle baseline');
 parts.forEach((m,i)=>{assert.equal(m.geometry,copy[i].geometry);assert.equal(m.material,copy[i].material);assert(m.castShadow&&m.receiveShadow);assert(!m.isSkinnedMesh);});
 assert(a.userData.body.geometry.name.includes('Badger_Body'));
 for(const l of a.userData.legs){assert(l.softLimb);assert.equal(l.knee.children.filter(o=>o.isMesh).length,0);assert.equal(l.paw.children.filter(o=>o.isMesh).length,1);assert.equal(l.softLimb.morphTargetInfluences.length,2);}
 assert.equal(a.userData.tail.children.filter(o=>o.isMesh).length,1);
});

test('continuous badger leg skin stays joined to the original IK shin and paw during land, bite and water poses',()=>{
 const pet=makeBadger(),d=pet.userData,p=new T.Vector3(),q=new T.Vector3(),target=new T.Vector3();
 for(let frame=0;frame<300;frame++){
  const t=frame/60,speed=t<1.4?1.15:t<3?6:0;pet.position.z+=speed/60;pet.rotation.y=Math.sin(t)*.25;d.waterDepth=t>3&&t<4?.9:0;
  animateBadger(pet,t,speed,t>1.5&&t<2?'pounce':'follow',Math.max(0,(t-1.5)*2));pet.updateMatrixWorld(true);
  for(const l of d.legs){
   const m=l.softLimb,g=m.geometry,pos=g.attributes.position,{limbRows:rows,limbSides:sides}=g.userData;
   for(let row=Math.ceil(rows*.85);row<rows;row++){
    p.set(0,0,0);for(let i=0;i<sides;i++)p.add(m.getVertexPosition(row*sides+i,q));p.multiplyScalar(1/sides).applyMatrix4(m.matrixWorld);
    const along=-pos.getY(row*sides);target.set(0,-along+l.upperLength,0).applyMatrix4(l.knee.matrixWorld);
    assert(p.distanceTo(target)<2e-6,'continuous coat detached from the existing shin');
   }
   assert.equal(pos.version,0,'walking uploaded per-actor skin vertices');
  }
 }
});

test('badger surface rebuild keeps finite smooth normals and per-instance flex, with no corrupted shared rest mesh',()=>{
 const a=makeBadger(),b=makeBadger(),parts=meshes(a),rest=parts.map(m=>m.geometry.attributes.position.array.slice());
 const body=a.userData.body.geometry,normal=body.attributes.normal,position=body.attributes.position,normalAt=new Map();
 for(let i=0;i<position.count;i++){
  if(Math.abs(position.getX(i))<1e-6)continue; // Collapsed closing poles have separate fan normals.
  const key=[position.getX(i),position.getY(i),position.getZ(i)].join(','),n=[normal.getX(i),normal.getY(i),normal.getZ(i)];
  if(normalAt.has(key))assert(n.every((v,j)=>Math.abs(v-normalAt.get(key)[j])<1e-6),'body batching introduced flat triangle seams');normalAt.set(key,n);
 }
 for(const [state,speed]of [['look',0],['wind',0],['pounce',6],['recover',2],['down',0],['look',0]])for(let i=0;i<45;i++)animateBadger(a,i/60+speed,speed,state,i/45);
 parts.forEach((m,i)=>{assert.deepEqual(m.geometry.attributes.position.array,rest[i]);for(const name of['position','normal'])assert(m.geometry.attributes[name].array.every(Number.isFinite));});
 for(const l of b.userData.legs)assert.deepEqual(l.softLimb.morphTargetInfluences,[0,0]);
 assert.notEqual(a.userData.legs[0].softLimb.morphTargetInfluences,b.userData.legs[0].softLimb.morphTargetInfluences);
});
