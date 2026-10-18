import{test}from'node:test';
import assert from'node:assert/strict';
import{HERO_LOADOUTS,WEAPONS,weaponFor,weaponStats,weaponReachText,takeUpgrade,chooseUpgrades,seeded}from'../rules.js';
import{EXTRA_SKILLS,EXTRA_BY_ID,skillPairState}from'../skill-catalog.js';
const player=(heroId='mirage')=>({heroId,weaponId:weaponFor(heroId,0).id,level:2,upgrades:{},hp:120,maxHp:120});
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('new template variant has independent loadout, weapon and three exclusive skills',()=>{
 assert.deepEqual(HERO_LOADOUTS.mirage,['miasmalantern','venomfan']);assert.deepEqual(HERO_LOADOUTS.wuling,['sporelantern','mycelialwhip']);const w=weaponStats(player());assert.equal(w.damage,32);assert.equal(w.rate,.85);assert.equal(w.range,10);assert.equal(w.speed,13);assert.equal(w.hitRadius,.34);assert.equal(w.needleDamage,8);assert.equal(w.needleDuration,2.6);assert.equal(w.burstRadius,2.2);assert.equal(w.splashDamage,14);assert.equal(w.cloudDamage,undefined);assert.equal(w.radius,0);assert.equal(w.returning,false);assert.match(weaponReachText(w),/替身/);assert.equal(EXTRA_SKILLS.filter(s=>s.hero==='mirage').length,3);
});
test('both mirage paths follow 3/5/8 eligibility, are random drafts and mutually exclusive',()=>{
 for(const name of['lure','venom']){const p=player(),id='path:miasmalantern_'+name,other='path:miasmalantern_'+(name==='lure'?'venom':'lure');
  p.level=3;const rng=seeded(720),seen=new Set();let noRoute=false;for(let i=0;i<35;i++){const choices=chooseUpgrades(p,rng);if(!choices.some(c=>c.category==='weapon'))noRoute=true;for(const c of choices)seen.add(c.id);}assert(noRoute);assert(seen.has(id));assert(seen.has(other));
  for(const [i,level]of[3,5,8].entries()){p.level=level-1;assert(!takeUpgrade(p,id));p.level=level;assert(takeUpgrade(p,id));assert(!takeUpgrade(p,other));const w=weaponStats(p);assert.equal(w.pathRank,i+1);assert.equal(w.lureRank,name==='lure'?i+1:0);assert.equal(w.venomRank,name==='venom'?i+1:0);}assert(!takeUpgrade(p,id));
  const old=player('wuling');old.level=8;assert(!takeUpgrade(old,id));assert.equal(weaponStats({...p,weaponId:'sporelantern'}).pathRank,0);
 }
});
test('mirage pool retains legal generic cards and cannot leak any exclusive skill between heroes',()=>{
 const ids=['mirage_residue','mirage_burial','mirage_mantle'];for(const heroId of Object.keys(HERO_LOADOUTS)){const p=player(heroId),seen=new Set(),rng=seeded(214);for(let i=0;i<110;i++)for(const c of chooseUpgrades(p,rng)){seen.add(c.id);if(EXTRA_BY_ID[c.id])assert.equal(EXTRA_BY_ID[c.id].hero,heroId);}for(const id of ids){assert.equal(seen.has(id),heroId==='mirage');assert.equal(takeUpgrade(p,id),heroId==='mirage');}if(heroId==='mirage'){for(const id of['power','haste','vitality','stride','magnet','fire','ice','storm'])assert(seen.has(id));for(const id of['poison_linger','poison_spread','poison_guard'])assert(!takeUpgrade(p,id));}}
});
test('poison scale follows power once, rush changes direct damage only, and global weapon definitions stay immutable',()=>{
 const p=player(),before=JSON.stringify(WEAPONS);p.upgrades={power:3,haste:2};p.weaponPath={id:'miasmalantern_venom',rank:3};p.huntBoon='rush';p.huntRush=2;const w=weaponStats(p);near(w.damage,32*1.54*1.25);near(w.needleDamage,17*1.54);near(w.splashDamage,14*1.54);near(w.poisonScale,1.54);near(w.rate,.85*1.3);assert.equal(JSON.stringify(WEAPONS),before);const old=weaponStats({...p,weaponId:'sporelantern'});near(old.cloudDamage,22*1.54);assert.equal(old.needleDamage,undefined);assert.equal(old.poisonScale,undefined);
});
test('new descriptions match natural-only trigger and nonstacking rules, no hidden pair bonus',()=>{
 for(const id of['mirage_residue','mirage_burial','mirage_mantle'])for(let rank=1;rank<=3;rank++){const text=EXTRA_BY_ID[id].describe(rank);assert(!/undefined|NaN/.test(text));assert(text.length>40);}assert.match(EXTRA_BY_ID.mirage_burial.describe(1),/被杀或被新替身替换时不触发/);assert.match(EXTRA_BY_ID.mirage_mantle.describe(1),/无回血或追加无敌/);const p=player();p.upgrades={mirage_residue:1,mirage_burial:1};const pair=skillPairState(p);assert(pair.active);assert.equal(pair.bonus,false);
});
