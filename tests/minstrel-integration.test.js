import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HERO_LOADOUTS,MAPS,WEAPON_PATHS,chooseUpgrades,takeUpgrade,weaponStats,seeded,weaponFor} from '../rules.js';
import {EXTRA_SKILLS} from '../skill-catalog.js';
import {HeroSkills} from '../hero-skills.js';
import {HERO_DODGES,dodgeTravel} from '../hero-dodge.js';
import {readJournal,writeJournal,recordVictory} from '../expedition.js';
import {validRoomSelection,validRoomMap} from '../multiplayer-protocol.js';
import {readFileSync} from 'node:fs';
import {createOwnerScope} from '../multiplayer-state.js';

function fixture(){
 const player={heroId:'minstrel',weaponId:'windbow',x:0,z:0,hp:120,maxHp:120,upgrades:{windwake:3,resonance_mark:3,quietguard:3}};
 const hits=[],fx=[];let active=true;
 const skills=new HeroSkills({player:()=>player,active:()=>active,foes:()=>[],blocked:()=>false,damage:(e,n)=>{hits.push(n);e.hp-=n;},fx:e=>fx.push(e)});
 return {player,skills,hits,fx,pause(){active=false;},resume(){active=true;},target:()=>({x:0,z:4,hp:1000,alive:true})};
}

test('native room damage consumes the victim minstrel shield and restores attacker scope',()=>{
 const r=fixture(),attacker={id:'host',player:{heroId:'scout',x:0,z:0,hp:120},hero:{rotation:{y:0}},heroSkills:{absorb:n=>n}};
 const victim={id:'guest',player:r.player,hero:{rotation:{y:0}},heroSkills:r.skills};
 const passthrough={absorb:n=>n};
 const context={roomSession:{host:true,owners:new Map([['host',attacker],['guest',victim]])},roomOwner:attacker,player:attacker.player,hero:attacker.hero,heroSkills:attacker.heroSkills,
  time:1,mirage:passthrough,poison:passthrough,groundAt:()=>0,attackReachesPlayer:()=>true,meleeDamageScale:()=>1,incomingRelicDamage:(_p,n)=>n,
  shake:0,hitConfirmUntil:0,queueRoomEvent(){},impactChips(){},finishRoomPlayer(){throw Error('unexpected death');}};
 const scope=createOwnerScope({capture:()=>({roomOwner:context.roomOwner,player:context.player,hero:context.hero,heroSkills:context.heroSkills}),
  bind:o=>Object.assign(context,{roomOwner:o.roomOwner||o,player:o.player,hero:o.hero,heroSkills:o.heroSkills})});
 context.withRoomOwner=(o,fn)=>scope.run(o,fn);
 const source=readFileSync(new URL('../main.js',import.meta.url),'utf8'),start=source.indexOf('function hurtRoomPlayer('),end=source.indexOf('function finishRoomPlayer(',start);
 assert(start>0&&end>start);
 const hurt=new Function('context','with(context){'+source.slice(start,end)+'return hurtRoomPlayer;}')(context);
 r.skills.onDodge(.52);r.skills.update(.53);
 assert.equal(hurt({playerId:'guest'},10,false,{kind:'rifle'}),0);
 assert.equal(r.player.hp,120);assert.equal(r.player.minstrelGuard,6);
 assert.equal(hurt({playerId:'guest'},10,false,{kind:'rifle'}),4);
 assert.equal(r.player.hp,116);assert.equal(r.player.minstrelGuard,0);
 assert.equal(context.roomOwner,attacker);assert.equal(context.heroSkills,attacker.heroSkills);assert.equal(attacker.player.hp,120);
 // A legacy victim with no new-hero shield keeps the prior damage result.
 r.player.heroId='scout';assert.equal(hurt({playerId:'guest'},10,false,{kind:'rifle'}),10);assert.equal(r.player.hp,106);
});

test('new content registers distinct selectable maps and two legal room weapons',()=>{
 assert.deepEqual(HERO_LOADOUTS.minstrel,['windbow','resonator']);
 for(const map of ['bellvale','crystalcave']){assert(MAPS[map].name);assert(validRoomMap(map));}
 for(let i=0;i<2;i++)assert(validRoomSelection('minstrel',i));
 assert(!validRoomSelection('minstrel',2));
 assert.equal(HERO_DODGES.minstrel.distance,4.8);
 assert.equal(dodgeTravel('minstrel',0),4.8);
});

test('both new weapons keep 3/5/8 route gates, lock branches and apply conservative damage tradeoffs',()=>{
 for(const weaponId of HERO_LOADOUTS.minstrel){
  const paths=Object.entries(WEAPON_PATHS).filter(([,v])=>v.weapon===weaponId).map(([id])=>id);
  assert.equal(paths.length,2);
  const p={heroId:'minstrel',weaponId,level:2,upgrades:{}};
  assert.equal(takeUpgrade(p,'path:'+paths[0]),false);
  p.level=3;assert(takeUpgrade(p,'path:'+paths[0]));assert.equal(takeUpgrade(p,'path:'+paths[1]),false);
  assert.equal(takeUpgrade(p,'path:'+paths[0]),false);p.level=5;assert(takeUpgrade(p,'path:'+paths[0]));
  p.level=8;assert(takeUpgrade(p,'path:'+paths[0]));assert.equal(takeUpgrade(p,'path:'+paths[0]),false);
  assert(Number.isFinite(weaponStats(p).damage));
 }
 const p={heroId:'minstrel',weaponId:'windbow',upgrades:{},weaponPath:{id:'windbow_fan',rank:1}};
 assert.equal(weaponStats(p).count,3);assert.equal(weaponStats(p).range,9);assert.equal(weaponStats(p).damage,52*.48);
});

test('minstrel skills stay exclusive while all former hero pools keep their original three signatures',()=>{
 for(const hero of Object.keys(HERO_LOADOUTS)){
  const p={heroId:hero,weaponId:weaponFor(hero,0).id,level:2,upgrades:{}},seen=new Set(),random=seeded(8086);
  for(let i=0;i<70;i++)for(const card of chooseUpgrades(p,random))seen.add(card.id);
  const own=EXTRA_SKILLS.filter(s=>s.hero===hero&&(!s.weapon||s.weapon===p.weaponId));
  assert.equal(own.length,3);for(const s of own)assert(seen.has(s.id));
  for(const s of EXTRA_SKILLS.filter(s=>s.hero!==hero))assert.equal(takeUpgrade(p,s.id),false);
 }
});

test('wind wake only empowers the first committed shot after dodge and expires in game time',()=>{
 const r=fixture(),w=()=>({id:'windbow',damage:52});
 r.skills.onDodge(.52);assert.equal(r.skills.prepareShot(w()).damage,52);
 r.skills.update(.53);assert.equal(r.skills.prepareShot(w()).damage,52*1.45);
 assert.equal(r.skills.prepareShot(w()).damage,52);
 r.skills.onDodge(.52);r.skills.update(4);assert.equal(r.skills.prepareShot(w()).damage,52);
});

test('three-note mark changes target, has a cooldown, and never recurses from its own damage',()=>{
 const r=fixture(),a=r.target(),b=r.target();
 r.skills.onHit(a);r.skills.onHit(a);r.skills.onHit(b);assert.deepEqual(r.hits,[]);
 r.skills.onHit(b);r.skills.onHit(b);assert.deepEqual(r.hits,[40]);
 for(let i=0;i<8;i++)r.skills.onHit(b);assert.deepEqual(r.hits,[40]);
 r.skills.update(1.01);r.skills.onHit(b);r.skills.update(3.1);r.skills.onHit(b);r.skills.onHit(b);
 assert.deepEqual(r.hits,[40]);r.skills.onHit(b);assert.deepEqual(r.hits,[40,40]);
});

test('guard is delayed, capped, consumed, pauses, expires and resets on a fresh run',()=>{
 const r=fixture();r.skills.onDodge(.52);assert.equal(r.skills.absorb(20),20);
 r.pause();r.skills.update(20);assert.equal(r.skills.now,0);r.resume();
 r.skills.update(.53);assert.equal(r.player.minstrelGuard,16);assert.equal(r.skills.absorb(10),0);assert.equal(r.player.minstrelGuard,6);
 r.skills.onDodge(.52);r.skills.update(.6);assert.equal(r.skills.minstrelShield.amount,6);
 r.skills.update(1.5);assert.equal(r.skills.absorb(10),10);assert.equal(r.player.minstrelGuard,0);
 r.skills.update(3);r.skills.onDodge(.52);r.skills.update(.53);assert.equal(r.skills.minstrelShield.amount,16);
 r.skills.reset();assert.equal(r.skills.minstrelShield.amount,0);assert.equal(r.skills.windUntil,0);assert.equal(r.skills.minstrelMark,null);
});

test('new map and weapon victory records persist without dropping old progress',()=>{
 let saved;const storage={setItem:(k,v)=>saved=v,getItem:()=>saved},journal={relics:[],wins:['forest:rifle']};
 for(const map of ['bellvale','crystalcave'])for(const weapon of ['windbow','resonator'])assert(recordVictory(journal,map,weapon));
 assert(writeJournal(storage,journal));assert.deepEqual(readJournal(storage).wins,journal.wins);
});
