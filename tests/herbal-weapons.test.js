import test from 'node:test';
import assert from 'node:assert/strict';
import {HERO_LOADOUTS,WEAPONS,WEAPON_PATHS,weaponFor,weaponStats,weaponReachText,chooseUpgrades,takeUpgrade,seeded} from '../rules.js';
import {EXTRA_BY_ID} from '../skill-catalog.js';
import {MYCELIAL_WHIP,VENOM_FAN,herbalDelay,herbalContact,herbalFront,whipTipMultiplier,HerbalWaves} from '../herbal-weapons.js';
import {PoisonCombat} from '../poison-combat.js';
import {MirageCombat} from '../mirage-combat.js';

const near=(a,b,tolerance=1e-7)=>assert(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const world=extra=>({half:64,obstacles:[],groundHeightAt:()=>0,...extra});
const foe=(x=0,z=3,extra={})=>({x,z,y:0,height:1.5,size:.5,hp:10000,alive:true,...extra});
const origin={x:0,y:1,z:0};
const player=(id,extra={})=>({heroId:id==='mycelialwhip'?'wuling':'mirage',weaponId:id,level:2,upgrades:{},hp:120,maxHp:120,x:0,z:0,...extra});
const stats=(id,path,rank=3,extra={})=>weaponStats(player(id,{weaponPath:path?{id:path,rank}:null,...extra}));
const pairs={mycelialwhip:['mycelialwhip_tip','mycelialwhip_sweep'],venomfan:['venomfan_return','venomfan_fold']};
function advance(object,seconds,step=1/60){for(let left=seconds;left>1e-9;){const dt=Math.min(left,step);object.update(dt);left-=dt;}}

test('new poison equipment occupies second slots and preserves all old base weapon numbers',()=>{
 assert.deepEqual(HERO_LOADOUTS.wuling,['sporelantern','mycelialwhip']);assert.deepEqual(HERO_LOADOUTS.mirage,['miasmalantern','venomfan']);
 assert.equal(weaponFor('wuling',0).id,'sporelantern');assert.equal(weaponFor('mirage',0).id,'miasmalantern');
 // v211 combat baselines, captured before introducing the new equipment.
 const baselines={rifle:[12,3,14],shotgun:[10,1,8],fire:[30,.9,11],crossbow:[20,2.05,16],shuriken:[13,1.4,12],dark:[26,1,10],shade:[18,1.6,8],shadowblade:[40,1.45,3.2],grimoire:[34,.8,10],harpoon:[36,1.6,3.8],boomerang:[30,1.5,11],sporelantern:[10,.8,10],miasmalantern:[32,.85,10],arcstaff:[9,4,9.5],briarpot:[44,.85,10]};
 for(const[id,[damage,rate,range]]of Object.entries(baselines)){const w=stats(id);near(w.damage,damage);near(w.rate,rate);near(w.range,range);}
 for(const id of Object.keys(pairs)){assert.equal(Object.values(WEAPON_PATHS).filter(p=>p.weapon===id).length,2);assert(weaponReachText(stats(id)).length>35);}
});

test('new routes retain 3/5/8 eligibility, randomized drafts and per-weapon exclusivity',()=>{
 for(const[id,paths]of Object.entries(pairs))for(const path of paths){
  const p=player(id),other=paths.find(q=>q!==path),random=seeded(212),seen=new Set();
  p.level=3;let withoutRoute=false;for(let i=0;i<90;i++){const cards=chooseUpgrades(p,random);withoutRoute||=!cards.some(c=>c.category==='weapon');for(const c of cards)seen.add(c.id);}
  assert(withoutRoute,'eligibility must not guarantee a route every draft');for(const key of paths)assert(seen.has('path:'+key));
  for(const[rank,level]of [3,5,8].entries()){p.level=level-1;assert(!takeUpgrade(p,'path:'+path));p.level=level;assert(takeUpgrade(p,'path:'+path));assert(!takeUpgrade(p,'path:'+other));assert.equal(weaponStats(p).pathRank,rank+1);}
  assert(!takeUpgrade(p,'path:'+path));assert.equal(weaponStats({...p,weaponId:id==='venomfan'?'miasmalantern':'sporelantern'}).pathRank,0);
  const wrong=player(id==='venomfan'?'mycelialwhip':'venomfan',{level:8});assert(!takeUpgrade(wrong,'path:'+path));
 }
});

test('new weapon drafts retain the owner skills and common spells without mixing exclusive pools',()=>{
 for(const id of Object.keys(pairs)){
  const p=player(id,{level:8}),rng=seeded(876),seen=new Set();
  for(let i=0;i<160;i++)for(const card of chooseUpgrades(p,rng)){seen.add(card.id);if(EXTRA_BY_ID[card.id])assert.equal(EXTRA_BY_ID[card.id].hero,p.heroId);if(card.category==='weapon')assert.equal(WEAPON_PATHS[card.pathId].weapon,id);assert(!/undefined|NaN/.test(card.text));}
  for(const key of ['power','haste','vitality','stride','magnet','fire','ice','storm'])assert(seen.has(key));
  const own=id==='mycelialwhip'?['poison_linger','poison_spread','poison_guard']:['mirage_residue','mirage_burial','mirage_mantle'];
  for(const key of own){assert(seen.has(key));assert(takeUpgrade(p,key));}
  for(const key of id==='mycelialwhip'?['mirage_residue','mirage_burial','mirage_mantle']:['poison_linger','poison_spread','poison_guard'])assert(!takeUpgrade(p,key));
 }
});

test('power scales each damage source once; haste and rush never multiply poison tick strength',()=>{
 const saved=JSON.stringify(WEAPONS),bonus={upgrades:{power:3,haste:4},huntBoon:'rush',huntRush:2};
 for(const[id,paths]of Object.entries(pairs))for(const path of [null,...paths]){
  const base=stats(id,path),w=stats(id,path,3,bonus);near(w.damage,base.damage*1.54*1.25);near(w.rate,base.rate*1.6);
  if(id==='mycelialwhip'){near(w.cloudDamage,base.cloudDamage*1.54);near(w.cloudDuration,base.cloudDuration);near(w.cloudRadius,base.cloudRadius);}
  else{near(w.needleDamage,base.needleDamage*1.54);near(w.needleDuration,base.needleDuration);near(w.poisonScale,1.54);}
  for(const value of Object.values(w))if(typeof value==='number')assert(Number.isFinite(value));
 }
 assert.equal(JSON.stringify(WEAPONS),saved);
});

test('route tradeoffs separate accurate whip tips, broad sweeps, returning mist and folded fan shots',()=>{
 const whip=stats('mycelialwhip'),fan=stats('venomfan');
 for(let rank=1;rank<=3;rank++){
  const tip=stats('mycelialwhip','mycelialwhip_tip',rank),sweep=stats('mycelialwhip','mycelialwhip_sweep',rank),returning=stats('venomfan','venomfan_return',rank),fold=stats('venomfan','venomfan_fold',rank);
  assert(tip.arc<whip.arc);assert(tip.range>whip.range);near(whipTipMultiplier(tip,tip.range*.49),1);near(whipTipMultiplier(tip,tip.range*.75),1+.25*rank);
  assert(sweep.arc>whip.arc);assert(sweep.damage<whip.damage);assert(sweep.cloudRadius>whip.cloudRadius);near(whipTipMultiplier(sweep,sweep.range),1);
  assert(returning.returning);assert(returning.arc>fan.arc);assert(returning.damage<fan.damage);assert(!fold.returning);assert(fold.arc<fan.arc);assert(fold.damage>fan.damage);assert(fold.needleDamage>fan.needleDamage);
 }
 near(herbalDelay(whip),MYCELIAL_WHIP.recovery*MYCELIAL_WHIP.release);near(herbalDelay(fan),VENOM_FAN.recovery*VENOM_FAN.release);
 for(const id of Object.keys(pairs)){const fast=stats(id,null,3,{upgrades:{haste:4}});assert(herbalDelay(fast)<herbalDelay(stats(id)));assert(herbalDelay(fast)>0);assert(herbalDelay(fast)<1/fast.rate);}
});

test('herbal hits follow the committed direction, real body height and finite annular front',()=>{
 const w=stats('venomfan');assert(herbalContact(origin,foe(),w,0,0,world()));
 assert.equal(herbalContact(origin,foe(0,-3),w,0,0,world()),null);assert.equal(herbalContact(origin,foe(4,0),w,0,0,world()),null);
 assert(herbalContact(origin,foe(4,0),w,Math.PI/2,0,world()));assert.equal(herbalContact(origin,foe(0,w.range+2),w,0,0,world()),null);
 const flying=foe(0,3,{y:3,height:1});assert.equal(herbalContact(origin,flying,w,0,0,world()),null);assert(herbalContact(origin,flying,w,0,Math.atan2(2.5,3),world()));
 const elevated={...origin,y:4};assert.equal(herbalContact(elevated,foe(),w,0,0,world()),null);assert(herbalContact(elevated,foe(),w,0,-Math.PI/4,world()));
 assert.equal(herbalContact(origin,foe(0,2),w,0,0,world(),4,5),null);assert(herbalContact(origin,foe(0,4.5),w,0,0,world(),4,5));
 assert.equal(herbalContact(origin,foe(0,3,{alive:false}),w,0,0,world()),null);
});

test('herbal hits and visible front stop at walls, roofs, raised terrain and map boundaries',()=>{
 const w=stats('mycelialwhip'),target=foe(0,5),barrier={x:0,y:0,z:2,r:1,height:5};
 const blocked=world({obstacles:[barrier]});assert.equal(herbalContact(origin,target,w,0,0,blocked),null);
 const points=herbalFront(origin,0,0,w.range,.12,blocked);assert.equal(points.length,13);assert(points.every(p=>p.z<2));assert(points.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
 const roof=world({overhead:{firstHit:()=>({point:{x:0,y:1,z:2},normal:{x:0,y:-1,z:0}})}});assert.equal(herbalContact(origin,target,w,0,0,roof),null);
 assert.equal(herbalContact(origin,target,w,0,0,world({groundHeightAt:(x,z)=>z>=2&&z<=3?2:0})),null);
 assert.equal(herbalContact(origin,target,w,0,0,world({half:3})),null);
 assert(herbalContact(origin,target,w,0,0,world({obstacles:[{...barrier,height:.2}]})),'a low stone must not block a chest-height whip');
});

function waveRig(extra={}){
 const r={active:true,foes:[foe()],world:world(),hits:[],draws:[],...extra};
 r.waves=new HerbalWaves({active:()=>r.active,world:()=>r.world,foes:()=>r.foes,hit:(q,e,p)=>r.hits.push({q,e,p,returning:q.returning}),draw:(q,previous)=>r.draws.push({distance:q.distance,previous})});
 return r;
}
const cast=(r,w=stats('venomfan'),o=origin)=>r.waves.cast(o,{w,angle:0,pitch:0});

test('fan fronts move over time and hit each body once per leg from 15 through 120 fps',()=>{
 for(const fps of [15,30,60,120])for(const returning of [false,true]){
  const r=waveRig({foes:[foe(0,2),foe(.7,5),foe(-.8,4),foe(0,12)]}),w=stats('venomfan',returning?'venomfan_return':null);cast(r,w);
  advance(r.waves,.02,1/fps);assert.equal(r.hits.length,0,'damage must wait for the moving front');advance(r.waves,2,1/fps);
  assert.equal(r.hits.length,returning?6:3);for(const e of r.foes.slice(0,3)){assert.equal(r.hits.filter(h=>h.e===e&&!h.returning).length,1);assert.equal(r.hits.filter(h=>h.e===e&&h.returning).length,returning?1:0);}
  assert.equal(r.waves.waves.length,0);advance(r.waves,5,1/fps);assert.equal(r.hits.length,returning?6:3);
 }
});

test('moving targets can enter a future front but not be hit twice on its outward leg',()=>{
 const e=foe(4,3),r=waveRig({foes:[e]});cast(r);advance(r.waves,.1);assert.equal(r.hits.length,0);
 e.x=0;advance(r.waves,.18);assert.equal(r.hits.length,1);e.z=5;advance(r.waves,1);assert.equal(r.hits.length,1);
 const late=foe(4,1),s=waveRig({foes:[late]});cast(s);advance(s.waves,.3);late.x=0;advance(s.waves,1);assert.equal(s.hits.length,0,'a spent front does not damage everything in its filled cone');
});

test('fan returns to its original source, cannot pierce cover, freezes on pause and clears finite state',()=>{
 const wall={x:0,y:0,z:2,r:.6,height:5},r=waveRig({world:world({obstacles:[wall]})}),w=stats('venomfan','venomfan_return'),o={...origin},q=cast(r,w,o);
 o.z=100;w.damage=1000;assert.equal(q.origin.z,0);assert.notEqual(q.w.damage,w.damage);advance(r.waves,.1);const distance=q.distance;
 r.active=false;advance(r.waves,10);near(q.distance,distance);assert.equal(r.hits.length,0);r.active=true;advance(r.waves,2);assert.equal(r.hits.length,0);
 for(let i=0;i<20;i++)cast(r);assert.equal(r.waves.waves.length,VENOM_FAN.maxWaves);r.waves.clear();assert.equal(r.waves.waves.length,0);advance(r.waves,2);assert.equal(r.hits.length,0);
});

test('a final-boss hit ending the run cannot draw another front after cleanup',()=>{
 let active=true,draws=0,hits=0;const e=foe(0,.4);
 const waves=new HerbalWaves({active:()=>active,world:()=>world(),foes:()=>[e],hit:()=>{hits++;active=false;waves.clear();},draw:()=>draws++});
 waves.cast(origin,{w:stats('venomfan'),angle:0,pitch:0});waves.update(1);assert.equal(hits,1);assert.equal(draws,0);assert.equal(waves.waves.length,0);
});

function poisonRig(id,upgrades={}){
 const p=player(id,{upgrades}),foes=[],hits=[];let active=true;
 const api={active:()=>active,player:()=>p,foes:()=>foes,blocked:()=>false,fx:()=>{},damage:(e,n,flash,source)=>{assert(e.alive);hits.push({...source,n});e.hp-=n;if(e.hp<=0)e.alive=false;}};
 const combat=id==='mycelialwhip'?new PoisonCombat(api):new MirageCombat(api);
 return{p,combat,foes,hits,pause:()=>active=false,resume:()=>active=true,foe:(extra={})=>{const e=foe(0,0,extra);foes.push(e);return e;}};
}

test('whip clouds reuse nonstacking poison, finite lifetime and actual-path carry/shield rules',()=>{
 for(const fps of [15,30,60,120]){
  const r=poisonRig('mycelialwhip',{poison_guard:3}),e=r.foe(),w=weaponStats(r.p),a=r.combat.addCloud(0,0,w);r.combat.addCloud(0,0,w);r.combat.addCloud(0,0,w);
  advance(r.combat,1,1/fps);near(10000-e.hp,w.cloudDamage);const expires=a.expires;r.combat.beginDodge(0,0);r.combat.moveDodge(0,0,3,0);assert(r.combat.endDodge(3,0));
  assert.equal(a.expires,expires);assert.equal(a.x,3);assert.equal(r.combat.clouds.length,3);assert.equal(r.combat.shield.amount,20);
  const time=r.combat.now;r.pause();advance(r.combat,10,1/fps);near(r.combat.now,time);r.resume();advance(r.combat,3,1/fps);assert.equal(r.combat.clouds.length,0);assert.equal(r.combat.shield.amount,0);
  r.combat.reset();assert.equal(r.combat.clouds.length+r.combat.marks.size,0);
 }
});

test('fan refreshes one poison status, keeps owner residue/decoy skills and never becomes lantern splash',()=>{
 for(const fps of [15,30,60,120]){
  const r=poisonRig('venomfan'),e=r.foe(),w=weaponStats(r.p);for(let i=0;i<8;i++)assert(r.combat.attackHit(e,w,{silent:true}));
  assert.equal(r.combat.marks.size,1);advance(r.combat,.5,1/fps);near(10000-e.hp,3);r.combat.attackHit(e,w,{silent:true});advance(r.combat,2.6,1/fps);near(10000-e.hp,18.6);assert.equal(r.combat.marks.size,0);assert(r.hits.every(h=>h.secondary));
  assert.equal(r.combat.burst(0,0,w),false,'folding fan cannot accidentally create the lantern terminal splash');
 }
 const r=poisonRig('venomfan',{mirage_residue:1,mirage_mantle:3}),e=r.foe();r.combat.attackHit(e,weaponStats(r.p),{silent:true});assert(r.combat.marks.get(e).residueUntil>0);
 assert(r.combat.startDodge(0,0,0,weaponStats(r.p)));advance(r.combat,.9);assert(r.combat.shield.amount>0);advance(r.combat,.6);assert.equal(r.combat.decoy,null);assert.equal(r.combat.clouds.length,1);
 r.combat.reset();assert.equal(r.combat.clouds.length+r.combat.marks.size,0);assert.equal(r.combat.shield.amount,0);
});
