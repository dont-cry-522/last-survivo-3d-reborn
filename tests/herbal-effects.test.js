import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {SkillVFX} from '../skill-vfx.js';
import {weaponSample,weaponTakeCount} from '../weapon-audio.js';
import {GameAudio} from '../audio.js';
import {impactProfile,EnvironmentImpacts} from '../environment-impact.js';
import {recordEnemyHit,restoreEnemyHit,animateEnemyHit} from '../enemy-feedback.js';
import {weaponRouteEffect,WEAPON_ROUTE_LOOKS} from '../weapon-route-vfx.js';

const origin={x:0,y:1,z:0},direction={x:0,y:0,z:1};
test('herbal trails follow collision samples without spanning occluded gaps or leaving range rings',()=>{
 const v=new SkillVFX(new T.Scene(),{mobile:true});
 // More samples than the draw budget: a skipped occlusion sample still breaks the line.
 const points=Array.from({length:33},(_,i)=>i===17?null:{x:i*.1,y:1,z:.1*Math.sin(i/32*Math.PI)});
 v.herbalWhip(origin,{x:3.2,y:1,z:0},{points});assert(v.active.length>0&&v.active.length<=20);
 for(const p of v.active.filter(p=>p.shape==='ray')){const half=new T.Vector3(0,p.size[1]/2,0).applyQuaternion(p.mesh.quaternion),a=p.mesh.position.clone().sub(half),b=p.mesh.position.clone().add(half);assert(!(Math.min(a.x,b.x)<1.7&&Math.max(a.x,b.x)>1.7),'strand bridges a blocked sample');}
 v.clear();const front=[{x:-.4,y:1,z:2},null,{x:.4,y:1,z:2}];
 v.herbalGust(origin,direction,{distance:2,previousDistance:1.8,points:front});assert.equal(v.active.length,4);
 assert(v.active.every(p=>Math.abs(p.mesh.position.x)>.3&&p.mesh.position.z<=2));
 const before=v.active.map(p=>[p.life,...p.mesh.position.toArray()]);v.update(0);assert.deepEqual(v.active.map(p=>[p.life,...p.mesh.position.toArray()]),before);
 v.update(1);assert.equal(v.scene.children.length,0);assert.equal(v.active.length,0);
});

test('whip contact and fan breath stay distinct, on the supplied surface and cheap under sustained fire',()=>{
 const v=new SkillVFX(new T.Scene(),{mobile:true}),signatures=[];
 for(const id of ['mycelialwhip','venomfan']){
  const contact=Object.freeze({x:3,y:4,z:5,normal:{x:0,y:0,z:-1},direction:{x:0,y:0,z:1},compact:true});
  v.herbalHit(id,contact,{combo:1});assert(v.active.length<=5);signatures.push(v.active.map(p=>p.shape).join(','));
  for(const p of v.active){assert(p.mesh.position.distanceTo(new T.Vector3(3,4,5))<.2);assert.equal(p.mesh.material.blending,T.NormalBlending);}
  v.clear();
 }
 assert.notEqual(...signatures);
 for(let frame=0;frame<1800;frame++){
  if(frame%30===0)v.herbalWhip(origin,{x:0,y:1,z:3},{angle:.2,combo:frame%2});
  if(frame%4===0)v.herbalGust(origin,direction,{distance:2,previousDistance:2.2,returning:true});
  if(frame%13===0)v.herbalHit('venomfan',{x:0,y:2,z:3});v.update(1/60);
  assert(v.active.length+v.pool.length<=110);assert.equal(v.scene.children.length,v.active.length);
  for(const p of v.active){assert(!['ring','disc','waterArc'].includes(p.shape));assert(p.mesh.position.toArray().every(Number.isFinite));assert(p.mesh.quaternion.toArray().every(Number.isFinite));}
 }
 v.clear();assert.equal(v.scene.children.length,0);
});

test('new weapon sounds provide three deterministic short takes with smooth tails and different envelopes',()=>{
 const signature=data=>Array.from({length:25},(_,i)=>data[Math.floor((i+1)*data.length/26)].toFixed(6)).join(',');
 for(const rate of [22050,44100,48000]){
  const all=new Set();
  for(const id of ['mycelialwhip','venomfan']){
   assert.equal(weaponTakeCount(id),3);
   for(const event of ['shot','impact','mechanism'])for(let take=0;take<3;take++){
    const data=weaponSample(id,event,rate,0,take);assert(data.length<=Math.ceil(rate*.32));let energy=0;
    for(const n of data){assert(Number.isFinite(n)&&Math.abs(n)<.7);energy+=n*n;}
    assert(Math.sqrt(energy/data.length)>.002);assert.equal(Math.abs(data[0]),0);assert(Math.abs(data.at(-1))<.001);
    assert.deepEqual(data,weaponSample(id,event,rate,0,take));all.add(signature(data));
    for(const old of ['arcstaff','sporelantern','miasmalantern']){const prior=weaponSample(old,event,rate,0,take);if(prior)assert.notEqual(signature(data),signature(prior));}
   }
  }
  assert.equal(all.size,18);
 }
});

test('herbal contact feedback uses the existing cooldown and never moves collision roots',()=>{
 for(const id of ['mycelialwhip','venomfan']){
  const audio=new GameAudio({currentTime:1,state:'running'}),calls=[];audio.ready=true;audio.weapon=(...args)=>{calls.push(args);return true;};
  assert(audio.contact(id,'wolf'));assert.equal(calls[0][0],'surface:fur');assert.equal(calls[0][3],id==='mycelialwhip'?.30:.16);assert.equal(audio.contact(id,'golem'),false);
  audio.impact(id);audio.impact(id);assert.equal(calls.filter(c=>c[0]===id&&c[1]==='impact').length,1);
  const mesh=new T.Group(),rig=new T.Group();mesh.add(rig);mesh.userData.rig=rig;
  recordEnemyHit(mesh,{kind:id,damage:30,maxHp:100});assert(mesh.userData.hitReaction.strength<.12);
  for(let i=0;i<30;i++){restoreEnemyHit(mesh);animateEnemyHit(mesh,1/60);assert.equal(mesh.position.length(),0);}
  assert.equal(mesh.userData.hitReaction,null);assert(rig.position.length()<1e-9);
 }
});

test('whip leaves a narrow poison scratch while fan leaves a quieter spreading water contact',()=>{
 const whip=impactProfile({id:'mycelialwhip'}),fan=impactProfile({id:'venomfan'});assert.equal(whip.mark,'slash');assert.equal(fan.mark,'stain');assert(whip.splash>fan.splash);assert(fan.ripple>whip.ripple);
 const v=new SkillVFX(new T.Scene()),fx=new EnvironmentImpacts(v.scene,v,{mobile:true});
 for(const id of ['mycelialwhip','venomfan']){assert(fx.water({id},{x:0,y:.2,z:0}));assert(v.active.length<=10);fx.clear();}
 fx.dispose();v.clear();assert.equal(v.scene.children.length,0);
});

test('a previously hidden fan sample cannot invent a trail through the occluder',()=>{
 const v=new SkillVFX(new T.Scene()),front=[{x:-.4,y:1,z:2},{x:0,y:1,z:2},{x:.4,y:1,z:2}];
 v.herbalGust(origin,direction,{distance:2,previousDistance:1.8,points:front,previousPoints:[null,null,null]});
 assert.equal(v.active.length,3);assert(v.active.every(p=>p.shape==='vapor'));
 v.clear();v.herbalGust(origin,direction,{distance:2,points:[],previousPoints:[]});assert.equal(v.active.length,0);
});

test('four herbal routes use distinct compact contact accents and return cues require an actual return',()=>{
 const v=new SkillVFX(new T.Scene(),{mobile:true}),looks=new Set();
 const contact={x:3,y:4,z:5,normal:{x:0,y:0,z:-1},direction:{x:0,y:.15,z:1},compact:true};
 for(const pathId of ['mycelialwhip_tip','mycelialwhip_sweep','venomfan_return','venomfan_fold']){
  const w={id:WEAPON_ROUTE_LOOKS[pathId].weapon,pathId,pathRank:3};
  assert(weaponRouteEffect(v,w,'hit',3,5,.4,{contact,returning:true,combo:1}));
  assert(v.active.length>=1&&v.active.length<=4);assert(v.active.some(p=>p.priority===1));
  for(const p of v.active){assert(p.mesh.position.distanceTo(new T.Vector3(3,4,5))<.2);assert.equal(p.mesh.material.blending,T.NormalBlending);assert(!['ring','disc'].includes(p.shape));}
  looks.add(JSON.stringify(v.active.map(p=>[p.shape,p.size,p.velocity,p.mesh.material.color.getHex()])));v.clear();
 }
 assert.equal(looks.size,4);
 assert.equal(weaponRouteEffect(v,{id:'venomfan',pathId:'venomfan_return',pathRank:3},'hit',0,0,0,{returning:false}),false);assert.equal(v.active.length,0);
});
