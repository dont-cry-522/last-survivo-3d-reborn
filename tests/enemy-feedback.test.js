import test from 'node:test';import assert from 'node:assert/strict';import * as T from '../vendor/three.module.js';
import {recordEnemyHit,restoreEnemyHit,animateEnemyHit,EnemyDeaths} from '../enemy-feedback.js';
import {WEAPONS} from '../rules.js';
const target=()=>{const mesh=new T.Group(),rig=new T.Group();mesh.add(rig);mesh.userData.rig=rig;return mesh;};
test('contact tint is isolated, cached, pause-safe and restored on recovery/death',()=>{
 const base=new T.MeshStandardMaterial({color:0x476754}),color=base.color.clone(),a=target(),b=target();
 for(const m of[a,b])m.userData.rig.add(new T.Mesh(new T.SphereGeometry(.2,6,4),base));
 const am=a.userData.rig.children[0],bm=b.userData.rig.children[0];
 recordEnemyHit(a,{damage:10});const tint=am.material;
 assert.notEqual(tint,base);assert.equal(bm.material,base);assert(base.color.equals(color));
 animateEnemyHit(a,0);assert.equal(am.material,tint);
 recordEnemyHit(b,{damage:10});assert.equal(bm.material,tint,'one shared variant, no per-enemy allocation');
 restoreEnemyHit(a);animateEnemyHit(a,.11);assert.equal(am.material,base);
 assert.equal(bm.material,tint);const deaths=new EnemyDeaths(new T.Scene());deaths.add({mesh:b,role:'wolf'});assert.equal(bm.material,base);
 recordEnemyHit(a,{damage:0});assert.equal(am.material,base);
});
test('directional recoil separates light/heavy hits without moving collision roots or accumulating',()=>{
 for(const fps of [15,30,60,120])for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const mesh=target(),rig=mesh.userData.rig;recordEnemyHit(mesh,{kind:'hammer',angle,damage:40,maxHp:100});let peak=0;
  for(let i=0;i<fps;i++){restoreEnemyHit(mesh);animateEnemyHit(mesh,1/fps);peak=Math.max(peak,rig.position.length());assert.equal(mesh.position.length(),0);assert(rig.position.x*Math.sin(angle)+rig.position.z*Math.cos(angle)>=-1e-9);assert(rig.scale.equals(new T.Vector3(1,1,1)));}
  assert(peak>.1&&peak<=.24);assert(rig.position.length()<1e-9);assert(!mesh.userData.hitReaction);
 }
 const light=target(),heavy=target(),boss=target();for(const [m,kind,b]of [[light,'rifle',false],[heavy,'hammer',false],[boss,'hammer',true]])recordEnemyHit(m,{kind,damage:20,maxHp:100,boss:b});assert(heavy.userData.hitReaction.strength>light.userData.hitReaction.strength*2);assert(boss.userData.hitReaction.strength<heavy.userData.hitReaction.strength*.4);
 recordEnemyHit(light,{kind:'rifle',damage:20,maxHp:100});assert.equal(light.userData.hitReaction.age,0);recordEnemyHit(light,{damage:0});
});
test('death poses expire, obey their cap, and leave shared materials and scene objects alone',()=>{
 const scene=new T.Scene(),deaths=new EnemyDeaths(scene,4),roles=['mushroom','wolf','golem','shaman'],meshes=[];
 for(let i=0;i<20;i++){const mesh=target();scene.add(mesh);meshes.push(mesh);deaths.add({mesh,role:roles[i%4]});assert(deaths.items.length<=4);}assert.equal(scene.children.length,4);
 deaths.update(.2);const poses=deaths.items.map(p=>[p.rig.scale.y,p.rig.rotation.z,p.rig.rotation.x]);assert(new Set(poses.map(JSON.stringify)).size===4);for(const m of meshes)m.traverse(n=>assert(n.matrix.elements.every(Number.isFinite)));
 deaths.update(.3);assert.equal(deaths.items.length,0);assert.equal(scene.children.length,0);const mesh=target();scene.add(mesh);deaths.add({mesh,role:'wolf'});deaths.clear();assert.equal(scene.children.length,0);
});

test('all weapon reactions have readable distinct weight and recovery without altering collisions',()=>{
 const signatures=new Set();
 for(const kind of Object.keys(WEAPONS)){
  const mesh=target(),rig=mesh.userData.rig;recordEnemyHit(mesh,{kind,damage:20,maxHp:100,targetKind:'mushroom'});
  const h=mesh.userData.hitReaction;signatures.add([h.strength,h.duration,h.lean,h.turn].join(':'));
  for(let n=0;n<60;n++){restoreEnemyHit(mesh);animateEnemyHit(mesh,1/60);assert.equal(mesh.position.length(),0);assert(rig.position.length()<=.24);assert(rig.rotation.toArray().slice(0,3).every(Number.isFinite));}
  assert(rig.position.length()<1e-9);assert(rig.quaternion.angleTo(new T.Quaternion())<1e-8);
 }
 assert.equal(signatures.size,Object.keys(WEAPONS).length);
 const flesh=target(),shell=target(),rock=target();
 for(const[mesh,targetKind]of[[flesh,'mushroom'],[shell,'tidecrab'],[rock,'sandguard']])recordEnemyHit(mesh,{kind:'harpoon',targetKind,damage:20,maxHp:100});
 assert(flesh.userData.hitReaction.strength>shell.userData.hitReaction.strength);assert(shell.userData.hitReaction.strength>rock.userData.hitReaction.strength);
});

test('scythe cuts turn bodies in opposite directions and the harpoon hook draws its visual response back',()=>{
 const hits=[];for(const combo of [0,1,2]){const mesh=target();recordEnemyHit(mesh,{kind:'shadowblade',combo,damage:20,maxHp:100});animateEnemyHit(mesh,.03);hits.push(mesh.userData.rig.rotation.y);}
 assert(hits[0]>0&&hits[1]<0&&hits[2]===0);
 const thrust=target(),hook=target();recordEnemyHit(thrust,{kind:'harpoon',combo:0,damage:20});recordEnemyHit(hook,{kind:'harpoon',combo:2,damage:20});animateEnemyHit(thrust,.03);animateEnemyHit(hook,.03);
 assert(thrust.userData.rig.position.z>0&&hook.userData.rig.position.z<0);
});

test('recoil reuses one actor-owned snapshot and restores each animated base without stale poses',()=>{
 const actors=[target(),target()],snapshots=[];
 for(const [index,mesh]of actors.entries()){
  const d=mesh.userData,rig=d.rig;let previous;
  for(let frame=0;frame<90;frame++){
   restoreEnemyHit(mesh);
   if(previous){assert(rig.position.equals(previous.position));assert(rig.quaternion.equals(previous.rotation));assert(rig.scale.equals(previous.scale));}
   rig.position.set(index+frame*.001,.1,frame*.002);rig.rotation.set(frame*.003,index*.2,-frame*.001);rig.scale.set(1+frame*.001,.9,1.1);
   const current={position:rig.position.clone(),rotation:rig.quaternion.clone(),scale:rig.scale.clone()};
   // Calling restore twice must not reinstate an old frame over the new animation.
   restoreEnemyHit(mesh);assert(rig.position.equals(current.position));assert(rig.quaternion.equals(current.rotation));
   if(frame%20===0)recordEnemyHit(mesh,{kind:'hammer',angle:.7,damage:10,maxHp:100});
   animateEnemyHit(mesh,frame===1?0:1/60);
   if(d.hitBase){
    snapshots[index]??={base:d.hitBase,position:d.hitBase.position,rotation:d.hitBase.rotation,scale:d.hitBase.scale};
    for(const key of ['position','rotation','scale']){assert.equal(d.hitBase[key],snapshots[index][key]);assert(d.hitBase[key].equals(current[key]));}
    assert.equal(d.hitBase,snapshots[index].base);
   }
   previous=current;
  }
  restoreEnemyHit(mesh);assert.equal(d.hitBase,null);assert.equal(d.hitBaseCache,snapshots[index].base);
 }
 for(const key of ['base','position','rotation','scale'])assert.notEqual(snapshots[0][key],snapshots[1][key],'no snapshot state crosses actors');
});
