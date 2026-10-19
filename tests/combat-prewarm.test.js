import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runtimeImport} from './runtime-import.js';
import * as T from '../vendor/three.module.js';
import {combatSampleKinds,prepareCombatSamples} from '../combat-prewarm.js';
const {MAP_ROSTERS}=await runtimeImport('combat-prewarm.js','map-enemies.js');
const {BOSS_ROUTES}=await runtimeImport('combat-prewarm.js','boss-expedition.js');
const {AIR_ROSTERS,makeAirborne}=await runtimeImport('combat-prewarm.js','airborne-enemies.js');
const {actor}=await runtimeImport('combat-prewarm.js','world.js');
const {WEAPONS,WEAPON_PATHS,weaponStats}=await runtimeImport('combat-prewarm.js','rules.js');
const {SkillVFX}=await runtimeImport('main.js','skill-vfx.js');

const player=Object.freeze({x:9,y:2,z:-7,angle:.4});
function fixture(){const scene=new T.Scene(),existing=new T.Group(),vfx=new SkillVFX(scene);scene.add(existing);return{scene,existing,vfx,player,yieldWork:async()=>{}};}
function resources(root){const result=new Set();root.traverse(o=>{if(o.isMesh){result.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])result.add(m);}});return result;}

test('prewarm covers each local roster, all three expedition bosses and local airborne species',()=>{
 for(const map of Object.keys(MAP_ROSTERS)){
  const list=combatSampleKinds(map);assert.equal(list.length,9);assert.equal(new Set(list).size,9);
  for(const kind of Object.values(MAP_ROSTERS[map]))assert(list.includes(kind),map+' '+kind);
  for(const region of BOSS_ROUTES[map])assert(list.includes(region));
  assert(list.includes(AIR_ROSTERS[map]));
 }
 const all=combatSampleKinds('confluence');assert.equal(all.length,35);
 for(const map of Object.keys(MAP_ROSTERS))for(const kind of [...Object.values(MAP_ROSTERS[map]),AIR_ROSTERS[map]])assert(all.includes(kind));
 assert.deepEqual(combatSampleKinds('unknown'),combatSampleKinds('forest'));
});

test('real models, all shared particle shapes and a ground warning remain renderable until cleanup, without disposing caches',async()=>{
 const f=fixture(),reports=[],yields=[];f.report=(done,total)=>reports.push([done,total]);f.yieldWork=async()=>yields.push(reports.at(-1)[0]);
 for(const key of ['flameTexture','shadowTexture','vaporTexture','crestTexture','streakTexture','rippleTexture'])f.vfx[key]=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 const cleanup=await prepareCombatSamples({...f,mapId:'confluence',yaw:1.2});
 const group=f.scene.getObjectByName('Combat_Prewarm_Samples');assert(group);assert.equal(group.children.length,36);
 assert.equal(f.vfx.active.length,20);assert.equal(reports.length,57);assert.deepEqual(reports,Array.from({length:57},(_,i)=>[i,56]));assert.equal(yields.length,19);
 for(const holder of group.children){assert(new T.Box3().setFromObject(holder).getSize(new T.Vector3()).length()<.57);holder.traverse(o=>{if(o.isMesh)assert.equal(o.frustumCulled,false);});}
 const variants=f.vfx.active.map(p=>p.mesh.material);
 for(const key of ['flameTexture','shadowTexture','vaporTexture','crestTexture','streakTexture','rippleTexture'])assert(variants.some(m=>m.map===f.vfx[key]));
 for(const [shape,geometry]of Object.entries(f.vfx.geometry))assert(f.vfx.active.some(p=>p.shape===shape&&p.mesh.geometry===geometry),shape+' was never uploaded');
 assert(variants.some(m=>m.vertexColors));assert(variants.some(m=>m.blending===T.AdditiveBlending));assert(variants.some(m=>m.blending===T.NormalBlending));
 assert(variants.some(m=>m.forceSinglePass));assert(variants.some(m=>!m.forceSinglePass));
 for(const shape of ['ray','shard'])for(const blending of [T.AdditiveBlending,T.NormalBlending])assert(f.vfx.active.some(p=>p.shape===shape&&p.mesh.material.blending===blending),shape+' missing its blending variant');
 const cached=new Set([...resources(group),...f.vfx.active.flatMap(p=>[p.mesh.geometry,p.mesh.material])]);let disposed=0;for(const r of cached)r.addEventListener('dispose',()=>disposed++);
 cleanup();cleanup();assert.equal(disposed,0);assert.deepEqual(f.scene.children,[f.existing]);assert.equal(f.vfx.active.length,0);assert.equal(f.vfx.pool.length,20);
 for(const r of resources(makeAirborne('duskbat')))assert(cached.has(r),'airborne geometry and materials should reuse their warmed caches');
 for(const r of resources(actor('frostking')))assert(cached.has(r),'boss geometry and materials should reuse their warmed caches');
});

test('selected projectiles and both routes warm reusable resources without creating combat or mutating the player',async()=>{
 const projectileIds=['rifle','shotgun','fire','crossbow','shuriken','dark','shade','boomerang','miasmalantern'];
 for(const weaponId of Object.keys(WEAPONS)){
  const f=fixture(),selected=Object.freeze({...player,weaponId,upgrades:Object.freeze({power:2,haste:1})}),calls=[],reports=[],projectile=f.vfx.projectile.bind(f.vfx);
  f.vfx.projectile=w=>{calls.push(w);return projectile(w);};
  const routes=Object.entries(WEAPON_PATHS).filter(([,p])=>p.weapon===weaponId).map(([id])=>id),expected=projectileIds.includes(weaponId)?[weaponStats(selected),...routes.map(id=>weaponStats({...selected,weaponPath:{id,rank:3}}))]:[];
  const cleanup=await prepareCombatSamples({...f,player:selected,mapId:'forest',report:(...args)=>reports.push(args)});
  const group=f.scene.getObjectByName('Combat_Prewarm_Samples'),samples=group.children.filter(o=>o.name.startsWith('Combat_Prewarm_Projectile_'));
  assert.deepEqual(calls,expected,weaponId+' missing its selected/base or route projectile');assert.equal(samples.length,expected.length);assert.equal(f.vfx.active.length,20);
  assert.deepEqual(reports,Array.from({length:31+expected.length},(_,i)=>[i,30+expected.length]));
  const warmed=new Set(samples.flatMap(sample=>[...resources(sample)]));let disposed=0;for(const resource of warmed)resource.addEventListener('dispose',()=>disposed++);
  for(const sample of samples){assert.equal(sample.parent,group);sample.traverse(o=>{if(o.isMesh)assert.equal(o.frustumCulled,false);});}
  cleanup();cleanup();assert.equal(disposed,0);assert.deepEqual(f.scene.children,[f.existing]);assert.equal(f.vfx.active.length,0);assert.equal(f.vfx.pool.length,20);
  if(!expected.length)continue;
  const geometries={...f.vfx.geometry},materials=new Map(f.vfx.materials);
  for(const w of [weaponStats(selected),...routes.flatMap(id=>[1,2,3].map(rank=>weaponStats({...selected,weaponPath:{id,rank}})))])for(const resource of resources(projectile(w)))assert(warmed.has(resource),weaponId+' recreated a projectile resource during combat');
  assert.deepEqual(f.vfx.geometry,geometries);assert.deepEqual(f.vfx.materials,materials);assert.equal(disposed,0);
 }
});

test('failed preparation cleans its samples and preserves the visual pool for retry',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(prepareCombatSamples({...f,mapId:'forest',yieldWork:async()=>{if(++calls===4)throw Error('interrupted');}}),/interrupted/);
 assert.deepEqual(f.scene.children,[f.existing]);assert.equal(f.vfx.active.length,0);assert.equal(f.vfx.pool.length,3);
 const cleanup=await prepareCombatSamples({...f,mapId:'forest'});assert.equal(f.vfx.active.length,20);cleanup();assert.equal(f.vfx.pool.length,20);
 await assert.rejects(prepareCombatSamples({...f,mapId:'forest',report(){throw Error('report failed');}}),/report failed/);
 assert.deepEqual(f.scene.children,[f.existing]);
});

test('one cached ground warning retains its real texture and material across cleanup, failure and retry',async()=>{
 const f=fixture(),cleanup=await prepareCombatSamples({...f,mapId:'forest'}),cue=f.scene.getObjectByName('Combat_Prewarm_Danger');assert(cue?.isMesh);
 const {geometry,material}=cue,map=material.map;assert.equal(cue.userData.groundCue,'danger');assert(map.isDataTexture);assert.equal(map.image.width,128);assert.equal(map.image.height,128);
 assert(material.polygonOffset&&material.transparent);assert.equal(material.depthWrite,false);assert.equal(material.side,T.DoubleSide);assert.equal(cue.frustumCulled,false);
 let disposed=0;for(const resource of [geometry,material,map])resource.addEventListener('dispose',()=>disposed++);
 cleanup();cleanup();assert.equal(cue.parent,null);assert.equal(disposed,0);
 await assert.rejects(prepareCombatSamples({...f,mapId:'forest',report(done,total){if(done!==total)return;assert.equal(f.scene.getObjectByName('Combat_Prewarm_Danger'),cue);throw Error('after warning');}}),/after warning/);
 assert.equal(cue.parent,null);assert.deepEqual(f.scene.children,[f.existing]);assert.equal(f.vfx.active.length,0);assert.equal(disposed,0);
 const retryCleanup=await prepareCombatSamples({...f,mapId:'forest'}),group=f.scene.getObjectByName('Combat_Prewarm_Samples');
 assert.equal(group.children.filter(child=>child.userData.groundCue).length,1);assert.equal(f.scene.getObjectByName('Combat_Prewarm_Danger'),cue);assert.equal(cue.geometry,geometry);assert.equal(cue.material,material);assert.equal(cue.material.map,map);
 retryCleanup();assert.equal(cue.parent,null);assert.equal(disposed,0);assert.deepEqual(f.scene.children,[f.existing]);
});

test('prewarm refuses live effects and contains no simulation, persistence or sound hooks',async()=>{
 const f=fixture(),live=f.vfx.particle('ember',0xffffff,0,0,0);await assert.rejects(prepareCombatSamples({...f,mapId:'forest'}),/cleared effects/);
 assert.equal(f.vfx.active.length,1);assert.equal(live.parent,f.scene);assert.equal(f.scene.children.length,2);
 const source=readFileSync(new URL('../combat-prewarm.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\b(?:spawn|spawnBoss|tickAirborne|animateActor|hurtEnemy|localStorage|sound|setInterval)\s*[.(]/);
 assert.doesNotMatch(source,/Math\.random|\.dispose\s*\(/);
});

test('the real pickup glow survives preparation without disposal and failed ghost setup cleans the sample',async()=>{
 const f=fixture(),map=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1),material=new T.SpriteMaterial({map,transparent:true,depthWrite:false,blending:T.AdditiveBlending});let calls=0,disposed=0;
 material.addEventListener('dispose',()=>disposed++);map.addEventListener('dispose',()=>disposed++);
 const createGlow=()=>{calls++;return new T.Sprite(material);},reports=[];
 const cleanup=await prepareCombatSamples({...f,mapId:'forest',createGlow,report:(...args)=>reports.push(args)}),sample=f.scene.getObjectByName('Combat_Prewarm_PickupGlow');
 assert(sample?.isSprite);assert.equal(sample.material,material);assert.equal(sample.material.map,map);assert.equal(sample.frustumCulled,false);assert.deepEqual(reports.at(-1),[31,31]);
 cleanup();cleanup();assert.equal(sample.parent,null);assert.equal(disposed,0);assert.deepEqual(f.scene.children,[f.existing]);
 await assert.rejects(prepareCombatSamples({...f,mapId:'forest',createGlow,mirageVFX:{prepareSnapshotSample(){throw Error('ghost capture failed');}}}),/ghost capture failed/);
 assert.equal(calls,2);assert.equal(disposed,0);assert.deepEqual(f.scene.children,[f.existing]);assert.equal(f.vfx.active.length,0);
});
