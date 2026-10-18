import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as T from '../vendor/three.module.js';
import {makeHerbalWeapon,poseHerbalWeapon,disposeHerbalWeapon} from '../herbal-weapon-models.js';
import {herbalPose,weaponDuration,weaponCuePhases} from '../weapon-performance.js';
import {GRIP_POINTS} from '../weapon-grips.js';
import {WEAPON_OUTLETS} from '../weapon-outlets.js';
import {FirstPersonView} from '../first-person-view.js';

const loadouts=[['wuling','mycelialwhip',1/1.1],['mirage','venomfan',1/.95]];
test('herbal tools have finite low-cost independent flexible geometry and recover without stretch',()=>{
 for(const[kind,id,period]of loadouts){const a=makeHerbalWeapon(id),b=makeHerbalWeapon(id);let dynamic,shared,triangles=0,draws=0;
  try{assert.deepEqual(a.userData.weaponIdentity,{hero:kind,weapon:id});a.traverse(o=>{if(!o.isMesh)return;draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;if(o.userData.herbalDynamic)dynamic=o;else shared=o.geometry;});assert(draws<=16&&triangles<3000);
   const other=b.getObjectByName(dynamic.name);assert.notEqual(dynamic.geometry,other.geometry);const unchanged=other.geometry.attributes.position.array.slice();
   for(const combo of[0,1])for(const path of['',id+'_tip',id==='venomfan'?'venomfan_fold':'mycelialwhip_sweep'])for(let i=0;i<=90;i++){
    poseHerbalWeapon(a,id,i/90*period,period,combo,path,i/90);assert([...dynamic.geometry.attributes.position.array,...dynamic.geometry.attributes.normal.array].every(Number.isFinite));
    if(id==='mycelialwhip'){const d=a.userData.herbalCord,length=d.centers.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(d.centers[i]),0);assert(Math.abs(length-2.4*(path==='mycelialwhip_tip'?1.12:1))<1e-8,'cord grows from idle into attack');}
   }
   assert.deepEqual(other.geometry.attributes.position.array,unchanged,'another hero shares mutable geometry');let released=0,sharedDisposed=0;dynamic.geometry.addEventListener('dispose',()=>released++);shared.addEventListener('dispose',()=>sharedDisposed++);disposeHerbalWeapon(a);disposeHerbalWeapon(a);assert.equal(released,1);assert.equal(sharedDisposed,0);
  }finally{disposeHerbalWeapon(a);disposeHerbalWeapon(b);}
 }
});

test('whip snaps at contact and fan releases at a different clock, with alternate gestures and true folded shape',()=>{
 for(const id of['mycelialwhip','venomfan'])for(const period of[.04,.2,1.05]){
  const duration=weaponDuration(id,period),hit=id==='mycelialwhip'?.42:.32,a=herbalPose(id,duration*hit,period,0),b=herbalPose(id,duration*hit,period,1);assert(a.kick>.999);assert.equal(a.yaw,-b.yaw);assert.equal(herbalPose(id,period,period).weight,0);
  const cue=weaponCuePhases(id,period)[0]*period;assert(cue>duration*hit&&cue<duration);
 }
 const fan=makeHerbalWeapon('venomfan');try{poseHerbalWeapon(fan,'venomfan',.72*.32,1,0,'');fan.updateMatrixWorld(true);const open=new T.Box3().setFromObject(fan).getSize(new T.Vector3()).x;poseHerbalWeapon(fan,'venomfan',.72*.32,1,0,'venomfan_fold');fan.updateMatrixWorld(true);const fold=new T.Box3().setFromObject(fan).getSize(new T.Vector3()).x;assert(open>fold*2.5,'fold route still uses a fully spread fan');}finally{disposeHerbalWeapon(fan);}
});

test('both herbal first-person weapons retain grip, visible outlet, independent deformation and paused state on desktop and phone',()=>{
 const camera=new T.PerspectiveCamera(70,16/9,.1,100),view=new FirstPersonView(camera);
 try{for(const[kind,id,period]of loadouts){const gun=makeHerbalWeapon(id),actor={userData:{gun,kind,shotSerial:1,reloadDuration:period}};try{
  view.setHero(actor,id);assert.equal(view.profile.type,id==='mycelialwhip'?'whip':'fan');const dynamic=view.parts.find(([p])=>p.userData.herbalDynamic);assert.notEqual(dynamic[0].geometry,dynamic[1].geometry);
  const original=dynamic[0].geometry.attributes.position.array.slice();
  for(const aspect of[16/9,844/390,390/844])for(const path of['',id==='venomfan'?'venomfan_fold':'mycelialwhip_sweep'])for(let frame=0;frame<=30;frame++){
   camera.aspect=aspect;camera.updateProjectionMatrix();const age=period*frame/30;Object.assign(actor.userData,{attackAge:age,reloadPhase:age/period,herbalPath:path,herbalCombo:frame%2});view.update(2+age,1/60,{visible:true});camera.updateMatrixWorld(true);
   const palm=view.hands[0].localToWorld(new T.Vector3(0,.045,-.023)),grip=view.model.localToWorld(new T.Vector3(...GRIP_POINTS[id]));assert(palm.distanceTo(grip)<1e-7,id+' grip slips');
   const outlet=view.launchPoint(),authored=view.model.localToWorld(new T.Vector3(...WEAPON_OUTLETS[id]));assert(outlet.distanceTo(authored)<1e-8);const screen=outlet.project(camera);assert(Math.abs(screen.x)<1&&Math.abs(screen.y)<1,id+' outlet out of frame: '+screen.toArray());
   view.root.traverse(n=>assert(n.matrixWorld.elements.every(Number.isFinite)));assert(view.hands.every(h=>h.visible));
  }
  assert.deepEqual(dynamic[0].geometry.attributes.position.array,original,'first-person pose edits world weapon');const paused=dynamic[1].geometry.attributes.position.array.slice(),matrix=view.weapon.matrix.elements.slice();view.update(90,0,{visible:true});assert.deepEqual(dynamic[1].geometry.attributes.position.array,paused);assert.deepEqual(view.weapon.matrix.elements,matrix);
  let disposed=0;dynamic[1].geometry.addEventListener('dispose',()=>disposed++);view.clear();assert.equal(disposed,1);
 }finally{disposeHerbalWeapon(gun);}}}finally{view.dispose();}
});

const world=new URL('../world.js',import.meta.url),entry=fs.readFileSync(world,'utf8').match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1];
const{loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import(new URL(entry,world));
before(async()=>{const original=Object.fromEntries(['fetch','self','ProgressEvent','createImageBitmap'].map(k=>[k,globalThis[k]]));try{globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):original.fetch(input);};await loadHeroAssets();}finally{for(const[k,v]of Object.entries(original))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});

test('real herbal hero rigs grip their new tools, animate while moving, cancel on dodge, and retain concealment without lamp assumptions',()=>{
 for(const[kind,id,period]of loadouts){const hero=createSkinnedHero(kind,id),d=hero.userData;let t=0;try{
  assert(!d.sporePod,'whip carries the old throwable pod');assert(!d.gun.userData.heart,'new tool is still a lantern');Object.assign(d,{aimActive:true,aimAngle:0,aimPitch:0,attackAngle:0,attackPitch:0,reloadDuration:period,reloadPhase:1,shotSerial:0});for(let n=0;n<90;n++)animateSkinnedHero(hero,t+=1/60,0,0,0);
  for(let n=0;n<180;n++){const age=n/60%period;Object.assign(d,{herbalCombo:Math.floor(n/60/period)%2,herbalPath:id==='venomfan'&&n>90?'venomfan_fold':'',shotSerial:1+Math.floor(n/60/period),reloadPhase:age/period,aimPitch:Math.sin(t)*.8,mirageConceal:n>120?1:0});animateSkinnedHero(hero,t+=1/60,n>45?3:0,age<1/60?.15:0,0);hero.updateMatrixWorld(true);hero.traverse(o=>assert(o.matrixWorld.elements.every(Number.isFinite)));const palm=d.support.rightHand.localToWorld(new T.Vector3(-.036,.097,0)),grip=d.gun.localToWorld(new T.Vector3(...GRIP_POINTS[id]));assert(palm.distanceTo(grip)<1e-6,id+' full-body hand slips');}
  d.cancelAttack=true;d.reloadPhase=.20;animateSkinnedHero(hero,t+=1/60,0,0,0);assert.equal(d.herbalCancelledSerial,d.shotSerial);assert.equal(d.attackGesture,0);animateSkinnedHero(hero,t+=1/60,0,0,0);assert.equal(d.attackGesture,0,'cancelled windup resumes on the next frame');d.shotSerial++;animateSkinnedHero(hero,t+=1/60,0,.15,0);assert(d.attackGesture>0,'new shot cannot clear cancellation');
  let disposed=0;const geometry=d.gun.userData.herbalOwned.geometries[0];geometry.addEventListener('dispose',()=>disposed++);disposeHero(hero);assert.equal(disposed,1);
 }finally{if(d.gun.userData.herbalOwned.geometries.length)disposeHero(hero);}}
});
