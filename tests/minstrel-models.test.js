import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as T from '../vendor/three.module.js';
import {weaponGesture,weaponDuration} from '../weapon-performance.js';
import {makeMinstrelWeapon,poseMinstrelWeapon} from '../minstrel-weapon-models.js';
import {FirstPersonView} from '../first-person-view.js';
const worldURL=new URL('../world.js',import.meta.url),modulePath=fs.readFileSync(worldURL,'utf8').match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1],entry=new URL(modulePath,worldURL);
const {loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import(entry);

test('longbow nock and fingers share the projectile release clock and settle at haste',()=>{
 for(const period of [.1,.25,.7,1.5]){
  const duration=weaponDuration('windbow',period),hit=duration*.42,bow=makeMinstrelWeapon('windbow'),d=bow.userData.minstrelBow;
  poseMinstrelWeapon(bow,'windbow',hit-1e-7,period);assert(d.arrow.visible);
  assert(weaponGesture('windbow',hit,0,period).pull>.99);
  const back=d.arrow.position.z;assert(back<-.32);
  poseMinstrelWeapon(bow,'windbow',hit+1e-7,period);assert(!d.arrow.visible);
  poseMinstrelWeapon(bow,'windbow',period,period);assert(d.arrow.visible);assert(Math.abs(d.arrow.position.z)<1e-8);
  assert.equal(weaponGesture('windbow',period,1,period).handPull,0);
  assert.equal(weaponGesture('windbow',period,1,period).ready,0);
  assert.equal(weaponGesture('windbow',hit,0,period).ready,1);
  const [lower,upper]=d.strings;assert(lower.scale.y>.7&&upper.scale.y>.6);assert.notEqual(lower.quaternion.x,upper.quaternion.x);
 }
 const bell=makeMinstrelWeapon('resonator');poseMinstrelWeapon(bell,'resonator',.72*.45,1);
 assert(bell.userData.minstrelBell.bell.rotation.z>.4);assert(bell.getObjectByName('SM_Resonator_HollowBell'));
});

test('minstrel has a new fitted wardrobe, finite moving skeleton, drawn string and working first person',async()=>{
 const original=Object.fromEntries(['fetch','self','ProgressEvent','createImageBitmap'].map(k=>[k,globalThis[k]]));
 try{
  globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};
  globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
  globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):original.fetch(input);};
  await loadHeroAssets();
  const silver=createSkinnedHero('silver','crossbow'),silverBody=silver.userData.model.getObjectByName('SM_Hero_Body_silver'),originalVisible=silverBody.visible;
  for(const weapon of ['windbow','resonator']){
   const hero=createSkinnedHero('minstrel',weapon),d=hero.userData,model=d.model;
   assert(model.userData.minstrelRebuilt);const mark=hero.getObjectByName('SM_Hero_Identity_minstrel');assert(mark?.parent.isBone);assert.equal(mark.parent.name,'spine_03');assert(model.getObjectByName('SM_Hero_Minstrel_TailoredCoat').visible);
   assert.equal(model.getObjectByName('SM_Hero_Body_silver').visible,false);assert(hero.getObjectByName('SM_Hero_Minstrel_SweptPonytail'));
   const skin=model.getObjectByName('SM_Hero_Minstrel_TailoredCoat');assert(skin.isSkinnedMesh);assert(skin.geometry.attributes.position.count>700);assert(skin.userData.continuousWaistcoat);
   const outside=skin.geometry.userData.outerVertexCount,weights=skin.geometry.attributes.skinWeight,indices=skin.geometry.attributes.skinIndex;
   for(let i=0;i<outside;i++)for(let k=0;k<4;k++){assert.equal(weights.array[i*4+k],weights.array[(i+outside)*4+k]);assert.equal(indices.array[i*4+k],indices.array[(i+outside)*4+k]);}
   assert(model.getObjectByName('Superhero_Female').userData.minstrelFaceRefined);
   assert.notEqual(model.getObjectByName('Superhero_Female').geometry,silver.userData.model.getObjectByName('Superhero_Female').geometry);
   const w=skin.geometry.attributes.skinWeight;for(let i=0;i<w.count;i++)assert(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<.0001);
   const camera=new T.PerspectiveCamera(60,16/9,.1,500),view=new FirstPersonView(camera);view.setHero(hero,weapon);
   const hair=hero.getObjectByName('SM_Hero_Minstrel_SweptPonytail'),start=hair.geometry.attributes.position.array.slice();
   for(let i=0;i<180;i++){
    d.shotSerial=1+Math.floor(i/90);d.reloadDuration=1.5;d.reloadPhase=(i%90)/90;d.aimActive=true;d.aimAngle=.3;d.aimPitch=.12;d.travelAngle=.3;d.dashTime=i>100&&i<120?.52-(i-101)/60:0;
    animateSkinnedHero(hero,i/60,3.5,.18,0);view.update(i/60,1/60,{visible:true,moving:1,attack:.18,yaw:.3,pitch:.12});
    hero.updateMatrixWorld(true);view.root.updateMatrixWorld(true);
    for(const root of[hero,view.root])root.traverse(o=>assert(o.matrixWorld.elements.every(Number.isFinite),o.name));
   }
   assert(hair.geometry.attributes.position.array.some((v,i)=>Math.abs(v-start[i])>.001));
   for(let i=0;i<90;i++){d.dashTime=.26;d.dashAngle=Math.PI/2;animateSkinnedHero(hero,4+i/60,0,0,0);assert(Math.abs(d.rig.rotation.z)<=.221,'side step must not accumulate a full-body roll');}
   d.dashTime=0;animateSkinnedHero(hero,6,0,0,0);assert(Math.abs(d.rig.rotation.z)<1e-9);
   assert.equal(view.profile.type,weapon==='windbow'?'longbow':'bell');assert(view.hands.every(h=>h.visible));
   if(weapon==='windbow'){
    d.reloadPhase=1;view.update(3,.016,{visible:true});const idleHeight=view.weapon.position.y,idleHand=view.hands[1].position.clone();
    d.reloadPhase=weaponDuration(weapon,1.5)*.39/1.5;view.update(3.016,.016,{visible:true});
    assert(view.weapon.position.y>idleHeight+.05,'raise bow only during an actual shot');
    assert(view.hands[1].position.distanceTo(idleHand)>.10,'free idle hand must move to the string before release');
   }
   d.cancelAttack=true;animateSkinnedHero(hero,3.01,0,0,0);view.update(3.01,.016,{visible:true});
   if(weapon==='windbow'){assert(Math.abs(d.gun.userData.minstrelBow.arrow.position.z)<1e-8);assert(Math.abs(view.model.userData.minstrelBow.arrow.position.z)<1e-8);}
   camera.aspect=384/738;camera.updateProjectionMatrix();view.update(3.1,.016,{visible:true,dodgePose:{kind:'step',weight:.8,side:1,forward:0}});view.root.updateMatrixWorld(true);view.root.traverse(o=>assert(o.matrixWorld.elements.every(Number.isFinite)));
   view.dispose();disposeHero(hero);
  }
  assert.equal(silverBody.visible,originalVisible,'new wardrobe must not hide existing actors');disposeHero(silver);
 }finally{for(const[k,v]of Object.entries(original))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});
