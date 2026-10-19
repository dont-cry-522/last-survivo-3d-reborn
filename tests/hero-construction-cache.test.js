import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
const worldURL=new URL('../world.js',import.meta.url),entry=fs.readFileSync(worldURL,'utf8').match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1],heroURL=new URL(entry,worldURL);
const {loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import(heroURL);
const weaponURL=new URL(fs.readFileSync(heroURL,'utf8').match(/from ['"](.\/hero-model\.js[^'"]*)['"]/)[1],heroURL);
const {makeWeapon,poseCrossbow}=await import(weaponURL);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function weaponFingerprint(root){
 const nodes=[];
 root.traverse(o=>{
  const material=m=>m&&[m.type,m.name,m.color?.toArray(),m.emissive?.toArray(),m.emissiveIntensity,m.roughness,m.metalness,m.side,m.transparent,m.opacity,m.vertexColors,...['map','normalMap','roughnessMap','emissiveMap'].map(k=>{const t=m[k];return t&&[t.name,t.colorSpace,t.image?.width,t.image?.height,t.image?.data&&hash(Array.from(t.image.data))];})];
  nodes.push([o.type,o.name,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray(),o.visible,o.castShadow,o.receiveShadow,o.geometry&&[Object.entries(o.geometry.attributes).map(([k,v])=>[k,v.itemSize,hash(Array.from(v.array))]),o.geometry.index&&hash(Array.from(o.geometry.index.array))],Array.isArray(o.material)?o.material.map(material):material(o.material)]);
 });return{nodes:nodes.length,hash:hash(nodes)};
}

test('direct weapon construction retains the v223 buffers, materials and local grip transforms without building a discarded body',()=>{
 const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/weapon-v223-buffers.json',import.meta.url),'utf8'));
 for(const {hero,weapon,fingerprint}of fixtures){
  const original=T.Object3D.prototype.add;let added=0,gun;
  try{T.Object3D.prototype.add=function(...objects){added+=objects.length;return original.apply(this,objects);};gun=makeWeapon(hero,weapon);}finally{T.Object3D.prototype.add=original;}
  assert.equal(gun.parent,null);assert.deepEqual(weaponFingerprint(gun),fingerprint,hero+':'+weapon);
  assert.equal(added,fingerprint.nodes-1,'constructed nodes outside the returned weapon');
 }
});

test('reused weapon surfaces still keep moving parts and binding state independent',()=>{
 const a=makeWeapon('silver','crossbow'),b=makeWeapon('silver','crossbow');
 const snapshot=weaponFingerprint(b);poseCrossbow(a,.3);assert.deepEqual(weaponFingerprint(b),snapshot);
 assert.notEqual(a.userData.crossbowBolt,b.userData.crossbowBolt);assert.notEqual(a.userData.crossbowStrings[0],b.userData.crossbowStrings[0]);
 assert.equal(a.userData.crossbowBolt.children[0].geometry,b.userData.crossbowBolt.children[0].geometry);
 const first=makeWeapon('scout','shotgun'),second=makeWeapon('scout','shotgun');first.userData.pump.position.z=-.2;assert.equal(second.userData.pump.position.z,0);
});

test('cached clip layers and reversed tracks keep actor mixers, bones and action state independent',async()=>{
 const saved=Object.fromEntries(['fetch','self','ProgressEvent','createImageBitmap'].map(k=>[k,globalThis[k]]));
 const actors=[];
 try{
  globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
  globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):saved.fetch(input);};
  await loadHeroAssets();
  for(const [kind,weapon,other]of [['scout','rifle','shotgun'],['silver','crossbow','shuriken'],['tide','harpoon','arcstaff'],['lingya','boomerang','briarpot'],['wraith','shade','shadowblade'],['wuling','sporelantern','mycelialwhip'],['mirage','miasmalantern','venomfan']]){
   const a=createSkinnedHero(kind,weapon),b=createSkinnedHero(kind,other);actors.push(a,b);const x=a.userData,y=b.userData;
   assert.notEqual(x.mixer,y.mixer);assert.notEqual(x.model.skeleton,y.model.skeleton);assert.notEqual(x.swimHead,y.swimHead);
   for(const name of ['idle','run','walk','upperIdle','upperRun','upperWalk','backRun','backWalk']){assert.notEqual(x[name],y[name]);assert.equal(x[name].getClip(),y[name].getClip(),kind+' cloned immutable '+name);}
   const source=x.actions.Jog_Fwd_Loop.getClip(),tracks=new Map(source.tracks.map(t=>[t.name,t]));
   for(const t of x.run.getClip().tracks)assert.equal(t,tracks.get(t.name),'unchanged source tracks copied per actor');
   for(const t of x.backRun.getClip().tracks){const original=tracks.get(t.name),size=original.getValueSize();assert.notEqual(t,original);for(let i=0;i<t.times.length;i++){assert(Math.abs(t.times[i]-(source.duration-original.times[original.times.length-1-i]))<1e-6);for(let k=0;k<size;k++)assert.equal(t.values[i*size+k],original.values[(original.times.length-1-i)*size+k]);}}
   const data=hash(source.tracks.map(t=>[Array.from(t.times),Array.from(t.values)])),time=y.run.time,weight=y.run.getEffectiveWeight(),head=y.swimHead.quaternion.toArray();
   x.run.time=.3;x.run.setEffectiveWeight(.37);x.mixer.update(.02);assert.equal(y.run.time,time);assert.equal(y.run.getEffectiveWeight(),weight);assert.deepEqual(y.swimHead.quaternion.toArray(),head);
   disposeHero(a);actors.splice(actors.indexOf(a),1);animateSkinnedHero(b,.016,2,0,0);assert(y.swimHead.quaternion.toArray().every(Number.isFinite));assert.equal(hash(source.tracks.map(t=>[Array.from(t.times),Array.from(t.values)])),data);
  }
 }finally{for(const a of actors)disposeHero(a);for(const[k,v]of Object.entries(saved))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});
