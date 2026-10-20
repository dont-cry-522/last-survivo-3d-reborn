import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {weaponDuration,weaponGesture} from '../weapon-performance.js';
import {FirstPersonView} from '../first-person-view.js';
const world=new URL('../world.js',import.meta.url);
const entry=new URL(fs.readFileSync(world,'utf8').match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1],world);
const {loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import(entry);

before(async()=>{
 const original=Object.fromEntries(['fetch','self','ProgressEvent','createImageBitmap'].map(k=>[k,globalThis[k]]));
 try{
  globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};
  globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
  globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):original.fetch(input);};
  await loadHeroAssets();
 }finally{for(const[k,v]of Object.entries(original))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});

function warm(hero,speed=0){
 const d=hero.userData;Object.assign(d,{reloadDuration:1.5,reloadPhase:1,aimActive:true,aimAngle:0,aimPitch:0,travelAngle:0});
 for(let i=0;i<90;i++)animateSkinnedHero(hero,i/60,speed,0,0);
}
const leftPalm=hero=>hero.userData.support.hand.localToWorld(new T.Vector3(.036,.097,0));
const rightPalm=hero=>hero.userData.support.rightHand.localToWorld(new T.Vector3(-.036,.097,0));
const finite=hero=>hero.traverse(o=>assert(o.matrixWorld.elements.every(Number.isFinite),o.name));

test('minstrel bow keeps both palms attached through running, turns, pitch and repeated fast draws',()=>{
 for(const period of [1.5,.45,.22,.1])for(const pitch of [-1.15,-.65,0,.65,1.15]){
  const hero=createSkinnedHero('minstrel','windbow'),d=hero.userData;warm(hero,4.5);let time=d.lastTime;
  for(let frame=0;frame<Math.ceil(period*3*120);frame++){
   const age=frame/120,shot=Math.floor(age/period),cycle=age%period;
   Object.assign(d,{shotSerial:shot+1,reloadDuration:period,reloadPhase:cycle/period,aimPitch:pitch,aimAngle:Math.sin(age)*.45,travelAngle:.6});
   hero.rotation.y=Math.sin(age)*.20;
   animateSkinnedHero(hero,time+=1/120,4.5,0,0);hero.updateMatrixWorld(true);finite(hero);
   assert(rightPalm(hero).distanceTo(d.gun.localToWorld(new T.Vector3()))<1e-6,'bow handle detached from carrying palm');
   const motion=weaponGesture('windbow',cycle,0,period);
   if(motion.ready>.999&&motion.handPull>.01){
    const contact=d.gun.localToWorld(new T.Vector3(0,.06,-.08-.33*motion.handPull));
    assert(leftPalm(hero).distanceTo(contact)<.008,'drawing hand missed string/continued release hand path');
   }
  }
  disposeHero(hero);
 }
});

test('bow lift has no wrist flip and draw elbow rises beside the shoulder',()=>{
 const hero=createSkinnedHero('minstrel','windbow'),d=hero.userData;warm(hero);let time=d.lastTime,previous=leftPalm(hero),maxStep=0;
 for(let frame=0;frame<79;frame++){
  const age=frame/60;Object.assign(d,{shotSerial:1,reloadPhase:age/1.5});
  animateSkinnedHero(hero,time+=1/60,0,frame===0?.2:0,0);hero.updateMatrixWorld(true);
  const palm=leftPalm(hero);maxStep=Math.max(maxStep,previous.distanceTo(palm));previous=palm;
  if(age>.45&&age<.54){
   const shoulder=d.offArm.getWorldPosition(new T.Vector3()),elbow=d.offForearm.getWorldPosition(new T.Vector3());
   assert(elbow.y>shoulder.y-.16,'draw elbow hangs beneath chest instead of opening to the side');
  }
 }
 assert(maxStep<.075,'ordinary draw/return has a sudden palm jump: '+maxStep);
 disposeHero(hero);
});

test('both loadouts settle after cancellation, retain finite dodges and resume on a new shot',()=>{
 for(const id of ['windbow','resonator']){
  const hero=createSkinnedHero('minstrel',id),d=hero.userData;warm(hero);let time=d.lastTime;
  const camera=new T.PerspectiveCamera(60,844/390,.1,500),view=new FirstPersonView(camera);view.setHero(hero,id);
  for(let frame=0;frame<40;frame++){
   Object.assign(d,{shotSerial:1,reloadPhase:weaponDuration(id,1.5)*.35/1.5});
   animateSkinnedHero(hero,time+=1/120,2.5,0,0);view.update(time,1/120,{visible:true,moving:.4});
  }
  d.cancelAttack=true;let previous=leftPalm(hero),maxStep=0;
  for(let frame=0;frame<70;frame++){
   d.dashTime=frame<62?.52-frame/120:0;d.dashAngle=Math.PI/2;
   animateSkinnedHero(hero,time+=1/120,3,0,0);view.update(time,1/120,{visible:true,moving:.4,dodgePose:{kind:'step',weight:Math.sin(Math.PI*frame/70),side:1}});
   hero.updateMatrixWorld(true);view.root.updateMatrixWorld(true);finite(hero);finite(view.root);
   const palm=leftPalm(hero);maxStep=Math.max(maxStep,previous.distanceTo(palm));previous=palm;
   assert(rightPalm(hero).distanceTo(d.gun.localToWorld(new T.Vector3()))<1e-6);
  }
  assert(maxStep<.10,'cancel snaps the free/drawing hand: '+maxStep);
  assert.equal(d.minstrelCancelledSerial,1);
  if(id==='windbow'){
   assert(Math.abs(d.gun.userData.minstrelBow.arrow.position.z)<1e-9);
   assert(Math.abs(view.model.userData.minstrelBow.arrow.position.z)<1e-9);
  }
  d.dashTime=0;d.shotSerial=2;d.reloadPhase=weaponDuration(id,1.5)*.39/1.5;
  animateSkinnedHero(hero,time+=1/60,0,0,0);view.update(time,1/60,{visible:true});
  if(id==='windbow')assert(view.model.userData.minstrelBow.arrow.position.z<-.32,'cancel blocked next draw');
  view.dispose();disposeHero(hero);
 }
});

test('first-person palms follow actual weapon contact points and pause freezes the held pose',()=>{
 for(const id of ['windbow','resonator']){
  const hero=createSkinnedHero('minstrel',id),d=hero.userData;warm(hero);let time=d.lastTime;
  const camera=new T.PerspectiveCamera(60,390/844,.1,500),view=new FirstPersonView(camera);view.setHero(hero,id);
  for(let frame=0;frame<100;frame++){
   const age=frame/120;d.shotSerial=1;d.reloadPhase=age/1.5;
   animateSkinnedHero(hero,time+=1/120,3,0,0);view.update(time,1/120,{visible:true,moving:.6,yaw:age*.3,pitch:.2});
   view.root.updateMatrixWorld(true);
   const held=view.hands[0].localToWorld(new T.Vector3(0,.045,-.023));
   assert(held.distanceTo(view.model.localToWorld(new T.Vector3()))<1e-6);
   const motion=weaponGesture(id,age,0,1.5);
   if(id==='windbow'&&motion.ready===1){
    const drawing=view.hands[1].localToWorld(new T.Vector3(0,.045,-.023));
    assert(drawing.distanceTo(view.model.localToWorld(new T.Vector3(0,.06,-.08-.33*motion.handPull)))<1e-6);
   }
  }
  const old=view.hands.map(h=>h.matrixWorld.elements.slice()),arrow=view.model.userData.minstrelBow?.arrow.position.z;
  for(let i=0;i<30;i++){view.update(time+10,0,{visible:true,moving:1,yaw:2,pitch:1});view.root.updateMatrixWorld(true);}
  assert.deepEqual(view.hands.map(h=>h.matrixWorld.elements.slice()),old);
  if(id==='windbow')assert.equal(view.model.userData.minstrelBow.arrow.position.z,arrow);
  view.dispose();disposeHero(hero);
 }
});

test('minstrel off-hand follows the stride while the weapon remains held',()=>{
 for(const id of ['windbow','resonator']){
  const hero=createSkinnedHero('minstrel',id),d=hero.userData;warm(hero,4.5);let time=d.lastTime,min=Infinity,max=-Infinity;
  for(let i=0;i<100;i++){animateSkinnedHero(hero,time+=1/60,4.5,0,0);hero.updateMatrixWorld(true);const p=leftPalm(hero);min=Math.min(min,p.z);max=Math.max(max,p.z);}
  assert(max-min>.10,'free hand is held rigid while legs run');
  disposeHero(hero);
 }
});

// Captured from immutable commit 068c58f with exactly this deterministic input.
// Protect shared locomotion, grip code and rifle/crossbow behavior, not appearance.
test('scout and silver motion matches the previous release exactly',()=>{
 for(const[kind,id,expected]of[
  ['scout','rifle','ba57d731ce2b10bb37ec34001a4fa07ae009ab870bbc8fbd4c2281b8bb4dac87'],
  ['silver','crossbow','1fb0d12eda6056217fbdd87d31ffe8e183f15df6e0fb62ec719dc6b7d906e73f']
 ]){
  const hero=createSkinnedHero(kind,id),d=hero.userData,out=[];
  for(let i=0;i<180;i++){
   const t=i/60;Object.assign(d,{shotSerial:i>=60?1:0,reloadDuration:1.2,reloadPhase:i>=60&&i<132?(i-60)/72:1,aimActive:i>30,aimAngle:Math.sin(t)*.3,aimPitch:.15,travelAngle:.2,dashTime:i>145?Math.max(0,.58-(i-145)/60):0});
   animateSkinnedHero(hero,t,i>20&&i<150?4.5:0,i===60?.2:0,0);hero.updateMatrixWorld(true);
   if(i%15===0)for(const node of[d.pelvis,d.spine,d.swimHead,d.aimArm,d.firingForearm,d.offArm,d.offForearm,d.support.rightHand,d.support.hand,d.gun])out.push(...node.matrixWorld.elements.map(x=>Math.round(x*1e6)));
  }
  assert.equal(createHash('sha256').update(JSON.stringify(out)).digest('hex'),expected,kind+' motion changed');disposeHero(hero);
 }
});
