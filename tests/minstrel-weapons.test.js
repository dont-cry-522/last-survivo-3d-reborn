import test from'node:test';
import assert from'node:assert/strict';
import*as T from'../vendor/three.module.js';
import{WINDBOW,RESONATOR,minstrelDelay,minstrelWeaponStats,ResonanceWaves}from'../minstrel-weapons.js';
import{weaponSample,weaponTakeCount}from'../weapon-audio.js';
import{SkillVFX}from'../skill-vfx.js';

const origin={x:0,y:1,z:0};
const foe=(x=0,z=3,extra={})=>({x,z,y:0,size:.5,height:1.8,alive:true,...extra});
const world=(extra={})=>({half:50,obstacles:[],groundHeightAt:()=>0,...extra});
const stats=(id,pathId='',pathRank=0)=>minstrelWeaponStats({id,...(id==='windbow'?WINDBOW:RESONATOR),count:1,pierce:1,spread:.12,pathId,pathRank});
function rig(extra={}){
 const r={active:true,foes:[foe()],hits:[],draws:[],echoes:0,world:world(),...extra};
 r.waves=new ResonanceWaves({active:()=>r.active,foes:()=>r.foes,world:()=>r.world,
  hit:(q,e,p)=>{r.hits.push({e,p,echo:q.echo,damage:q.w.damage*(q.echo?q.w.echoScale:1)});},
  draw:(q,previous,points)=>r.draws.push({echo:q.echo,distance:q.distance,previous,points}),
  echo:()=>r.echoes++});
 return r;
}
function advance(r,seconds,dt=1/60){for(let elapsed=0;elapsed<seconds-1e-8;){const step=Math.min(dt,seconds-elapsed);r.waves.update(step);elapsed+=step;}}
const cast=(r,w=stats('resonator'),angle=0,pitch=0)=>r.waves.cast(origin,{w,angle,pitch});

test('bow routes choose long piercing shots or a shorter spread without multiplying haste or generic damage',()=>{
 const base=stats('windbow');assert.equal(base.damage,52);assert.equal(base.range,15);
 const a=stats('windbow','windbow_pierce',3),b=stats('windbow','windbow_fan',3);
 assert.equal(a.count,1);assert.equal(a.pierce,4);assert.equal(a.range,16.5);assert.equal(a.damage,52*1.36);
 assert.equal(b.count,3);assert.equal(b.pierce,1);assert.equal(b.range,9);assert(Math.abs(b.damage-52*.60)<1e-8);
 assert.equal(a.rate,base.rate);assert.equal(b.rate,base.rate);
 const old={id:'rifle',damage:12,count:1,rate:3,pathId:'windbow_pierce',pathRank:3},snapshot={...old};assert.deepEqual(minstrelWeaponStats(old),snapshot);
});

test('attack release remains before recovery and matches the same animated cycle under haste',()=>{
 for(const id of['windbow','resonator'])for(const haste of[1,1.15,1.6,2.5]){
  const w=stats(id),config=id==='windbow'?WINDBOW:RESONATOR;w.rate*=haste;
  const delay=minstrelDelay(w),cycle=Math.min(config.recovery,.9/w.rate);
  assert(delay>0&&delay<1/w.rate);assert.equal(delay,cycle*config.release);
 }
 assert(minstrelDelay(stats('windbow'))>.53);assert(minstrelDelay(stats('resonator'))<.24);
});

test('bell routes trade broad coverage for concentrated reach without creating more echoes',()=>{
 const focus=stats('resonator','resonator_focus',3),chorus=stats('resonator','resonator_chorus',3);
 assert.equal(focus.arc,.25);assert(focus.range>6);assert(focus.damage>24);assert(focus.echoScale<1);
 assert(chorus.arc>.9);assert(chorus.range<6);assert(chorus.damage<24);assert(chorus.echoScale<1);
 assert.equal(focus.echoDelay,RESONATOR.echoDelay);assert.equal(chorus.echoDelay,RESONATOR.echoDelay);
});

test('bell hits once per moving primary and once per delayed echo at 15, 30, 60 and 120 FPS',()=>{
 for(const fps of[15,30,60,120]){
  const e=foe(),r=rig({foes:[e,foe(0,9)]}),w=stats('resonator');cast(r,w);advance(r,.10,1/fps);assert.equal(r.hits.length,0,'damage must wait for the front');
  advance(r,.27,1/fps);assert.equal(r.hits.length,1);assert.equal(r.hits[0].echo,false);
  advance(r,.30,1/fps);assert.equal(r.hits.length,1,'there must be a real quiet gap before the echo');
  advance(r,2,1/fps);assert.equal(r.hits.length,2);assert.equal(r.hits[1].echo,true);
  assert(Math.abs(r.hits.reduce((sum,h)=>sum+h.damage,0)-24*1.42)<1e-8);
  assert.equal(r.echoes,1);assert.equal(r.waves.waves.length,0);advance(r,10,1/fps);assert.equal(r.hits.length,2);
 }
});

test('a long game-time frame sweeps the same two waves without extra ticks or missed stationary targets',()=>{
 const slow=rig(),fast=rig();cast(slow);cast(fast);advance(slow,2,2);advance(fast,2,1/120);
 assert.deepEqual(slow.hits.map(h=>[h.echo,h.damage]),fast.hits.map(h=>[h.echo,h.damage]));
 assert.equal(slow.echoes,1);assert.equal(slow.waves.waves.length,0);
});

test('wave yaw and pitch target real body height, including elevated PvP-shaped bodies',()=>{
 const horizontal=rig({foes:[foe(3,0),foe(0,3)]});cast(horizontal,stats('resonator'),Math.PI/2);advance(horizontal,2);assert.equal(horizontal.hits.length,2);assert(horizontal.hits.every(h=>h.e===horizontal.foes[0]));
 const sky=rig({foes:[foe(0,4,{y:3,kind:'player',networkOwner:'guest'}),foe(0,4)]});cast(sky,stats('resonator'),0,.55);advance(sky,2);assert.equal(sky.hits.length,2);assert(sky.hits.every(h=>h.e===sky.foes[0]));
});

test('cover, overhead geometry, elevated ground and map edge block both primary and echo',()=>{
 for(const obstruction of[
  {obstacles:[{x:0,z:1.5,y:0,r:1,height:5}]},
  {overhead:{firstHit:()=>({point:{x:0,y:1,z:1},normal:{x:0,y:0,z:-1}})}},
  {groundHeightAt:(x,z)=>z>1&&z<2?2:0},
  {half:2}
 ]){
  const r=rig({world:world(obstruction)});cast(r);advance(r,2);assert.equal(r.hits.length,0);
  assert(r.draws.every(d=>d.points.every(p=>[p.x,p.y,p.z].every(Number.isFinite))));
 }
 const low=rig({world:world({obstacles:[{x:0,z:1.5,y:0,r:.5,height:.2}]})});cast(low);advance(low,2);assert.equal(low.hits.length,2);
});

test('moving into a future wave can be hit, but moving behind its spent front cannot',()=>{
 const e=foe(4,3),r=rig({foes:[e]});cast(r);advance(r,.10);assert.equal(r.hits.length,0);e.x=0;advance(r,.20);assert.equal(r.hits.length,1);e.z=5;advance(r,.15);assert.equal(r.hits.length,1);
 const late=rig({foes:[foe(4,1)]});cast(late);advance(late,.20);late.foes[0].x=0;advance(late,.20);assert.equal(late.hits.length,0);
});

test('cast captures release origin and stats; pause, clear and bounded capacity leave no timers',()=>{
 const r=rig(),o={...origin},w=stats('resonator'),q=r.waves.cast(o,{w,angle:0,pitch:0});
 o.z=50;w.damage=999;assert.equal(q.origin.z,0);assert.equal(q.w.damage,24);
 advance(r,.1);const distance=q.distance;r.active=false;advance(r,5);assert.equal(q.distance,distance);assert.equal(r.hits.length,0);
 r.active=true;advance(r,2);assert.equal(r.hits.length,2);
 for(let i=0;i<30;i++)cast(r);assert.equal(r.waves.waves.length,RESONATOR.maxWaves);
 r.waves.clear();assert.equal(r.waves.waves.length,0);advance(r,10);assert.equal(r.hits.length,2);
});

test('a primary kill ending the encounter cannot continue through echo or draw after cleanup',()=>{
 const r=rig({foes:[foe(0,.4)]});r.waves.api.hit=()=>{r.active=false;r.waves.clear();};cast(r);advance(r,3,3);
 assert.equal(r.waves.waves.length,0);assert.equal(r.echoes,0);assert.equal(r.draws.length,0);
});

test('bow and bronze bell have distinct finite audio takes with soft ends and quiet mechanisms',()=>{
 for(const rate of[22050,44100,48000])for(const id of['windbow','resonator']){
  assert.equal(weaponTakeCount(id),3);const signatures=new Set();
  for(let take=0;take<3;take++)for(const event of['shot','impact','mechanism']){
   const data=weaponSample(id,event,rate,0,take);assert(data.length<=rate*.5);let energy=0;
   for(const n of data){assert(Number.isFinite(n)&&Math.abs(n)<.65);energy+=n*n;}
   assert(energy/data.length>.000002);assert.equal(Math.abs(data[0]),0);assert(Math.abs(data.at(-1))<.001);
   signatures.add(Array.from({length:12},(_,i)=>data[Math.floor((i+1)*data.length/13)].toFixed(5)).join(','));
  }
  assert.equal(signatures.size,9);
 }
 assert.notDeepEqual(weaponSample('windbow','shot',22050).slice(0,100),weaponSample('resonator','shot',22050).slice(0,100));
});

test('arrow and pressure fronts reuse bounded effects, have no full range rings, and recycle after impact',()=>{
 const vfx=new SkillVFX(new T.Scene(),{mobile:true}),arrow=vfx.projectile(stats('windbow'));
 assert.equal(arrow.name,'SM_Windbow_FeatherArrow_A');assert.equal(arrow.children.length,5);
 assert(arrow.getObjectByName('SM_Windbow_ArrowFeather_2'));const again=vfx.projectile(stats('windbow'));
 assert.equal(arrow.children[0].geometry,again.children[0].geometry);assert.equal(arrow.children[0].material,again.children[0].material);
 const r=rig();cast(r);advance(r,.2);const d=r.draws.at(-1);vfx.minstrelWave(origin,d.points,{echo:false,angle:0});vfx.minstrelHit('resonator',{x:0,y:1,z:3});vfx.minstrelHit('windbow',{x:0,y:1,z:3});
 for(const kind of['minstrelWake','minstrelChord','minstrelGuard'])vfx.skill({kind,x:0,z:0,angle:0});
 assert(vfx.active.length>10&&vfx.active.length<30);assert(!vfx.active.some(p=>['ring','disc'].includes(p.shape)));
 for(const p of vfx.active)assert(p.mesh.position.toArray().every(Number.isFinite));
 for(let i=0;i<120;i++)vfx.update(1/60);assert.equal(vfx.active.length,0);vfx.clear();assert.equal(vfx.scene.children.length,0);
});
