import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerScope,createPlayerTarget,isolateCombatMarks,snapshotValue,mergeSnapshot} from '../multiplayer-state.js';
import {bodyTravel,bodiesClear} from '../actor-collision.js';
import {segmentHitsBody} from '../adventure-combat.js';

function context(){
 let live={name:'local',bullets:[],attack:0};
 const scope=createOwnerScope({capture:()=>({...live}),bind:s=>{live={...s};}});
 return{scope,get live(){return live;}};
}

test('nested owner scopes save replaced arrays and cooldowns even when combat throws',()=>{
 const c=context(),a={name:'a',bullets:[],attack:0},b={name:'b',bullets:[],attack:0};
 assert.throws(()=>c.scope.run(a,()=>{
  c.live.bullets=[{owner:'a'}];c.live.attack=.4;
  c.scope.run(b,()=>{c.live.bullets=[{owner:'b'}];c.live.attack=.8;});
  assert.equal(c.live.name,'a');assert.equal(c.live.attack,.4);
  c.live.bullets=c.live.bullets.filter(()=>false);
  throw new Error('hit callback failed');
 }),/hit callback failed/);
 assert.equal(c.live.name,'local');assert.deepEqual(c.live.bullets,[]);
 assert.deepEqual(a.bullets,[]);assert.equal(a.attack,.4);
 assert.deepEqual(b.bullets,[{owner:'b'}]);assert.equal(b.attack,.8);
});

test('re-entering the same owner retains nested replacement instead of stale snapshot',()=>{
 const c=context(),a={name:'a',bullets:[],attack:0};
 c.scope.run(a,()=>{
  c.live.bullets=['first'];
  c.scope.run(a,()=>{assert.deepEqual(c.live.bullets,['first']);c.live.bullets=['second'];});
  assert.deepEqual(c.live.bullets,['second']);c.live.attack=1;
 });
 assert.deepEqual(a.bullets,['second']);assert.equal(a.attack,1);assert.equal(c.live.name,'local');
});

test('attacker -> victim -> attacker reward scopes preserve replaced arrays and scalar counters',()=>{
 const c=context(),a={name:'attacker',bullets:['before'],attack:0},b={name:'victim',bullets:['victim'],attack:0};
 c.scope.run(a,()=>{
  c.scope.run(b,()=>{
   c.live.attack=.7;
   c.scope.run(a,()=>{c.live.bullets=['after reward'];c.live.attack=4;});
   assert.equal(c.live.name,'victim');assert.equal(c.live.attack,.7);
  });
  assert.equal(c.live.name,'attacker');assert.deepEqual(c.live.bullets,['after reward']);assert.equal(c.live.attack,4);
 });
 assert.deepEqual(a.bullets,['after reward']);assert.equal(a.attack,4);assert.equal(c.live.name,'local');
});

test('async functions are rejected before execution and thenables restore context',()=>{
 const c=context(),a={name:'a',bullets:[],attack:0};let ran=false;
 assert.throws(()=>c.scope.run(a,async()=>{ran=true;}),/synchronous/);assert.equal(ran,false);
 assert.throws(()=>c.scope.run(a,()=>{c.live.attack=2;return Promise.resolve();}),/promise/);
 assert.equal(a.attack,2);assert.equal(c.live.name,'local');
});

test('a failed bind or custom save still restores the previous owner',()=>{
 let current={name:'local'};
 const scope=createOwnerScope({capture:()=>({...current}),bind:s=>{current=s;if(s.name==='bad')throw new Error('bind');},save:(r,s)=>{Object.assign(r,s);if(r.name==='throw-save')throw new Error('save');}});
 assert.throws(()=>scope.run({name:'bad'},()=>{}),/bind/);assert.equal(current.name,'local');
 assert.throws(()=>scope.run({name:'throw-save'},()=>{}),/save/);assert.equal(current.name,'local');
});

function runtime(id='one'){
 return{id,heroId:'tide',hero:{userData:{}},player:{heroId:'tide',x:2,y:0,z:0,hp:100,maxHp:100,standHeight:1.7,crouch:0}};
}

test('player target follows replaced player and hero references with real hit geometry',()=>{
 const r=runtime(),target=createPlayerTarget(r,{height:p=>p.standHeight*(1-p.crouch*.5)});
 assert.equal(target.id,'p:one');assert.equal(target.playerId,'one');assert.equal(target.kind,'tide');
 assert(segmentHitsBody(0,.8,0,4,.8,0,target,.03));
 target.x=4;assert.equal(r.player.x,4);
 r.player={...r.player,x:8,hp:30,crouch:1};const hero={userData:{new:true}};r.hero=hero;
 assert.equal(target.x,8);assert.equal(target.hp,30);assert.equal(target.mesh,hero);assert.equal(target.height,.85);
 assert(!segmentHitsBody(6,1.4,0,10,1.4,0,target,.03));
 target.hp=10;assert.equal(r.player.hp,10);
});

test('live players block bodies while dead and diving players retain existing exceptions',()=>{
 const r=runtime(),target=createPlayerTarget(r),walker={heroId:'scout',x:0,z:0,hp:100},world={solidActors:()=>[walker,target]};
 assert(bodyTravel(world,walker,3,0,.45)<1);assert(!bodiesClear(world,walker,2,0,.45));
 r.player.dashTime=1;assert.equal(bodyTravel(world,walker,3,0,.45),1);
 r.player.dashTime=0;r.player.hp=0;assert(!target.alive);assert.equal(bodyTravel(world,walker,3,0,.45),1);
 r.player.hp=100;r.player.networkDead=true;assert(!target.alive);
 r.player.networkDead=false;r.networkDead=true;assert(!target.alive);
});

test('owner-specific marks do not charge a different attackers combo',()=>{
 const r=runtime();let owner='a';const target=createPlayerTarget(r,{ownerId:()=>owner});
 target.shadowMark={hits:2,time:1};target.scytheMarks=2;target.scytheMarkAt=1;target.lingyaMark=3;
 owner='b';assert.equal(target.shadowMark,undefined);assert.equal(target.scytheMarks,undefined);assert.equal(target.lingyaMark,undefined);
 target.shadowMark={hits:1,time:2};target.scytheMarks=1;
 owner='a';assert.equal(target.shadowMark.hits,2);assert.equal(target.scytheMarks,2);assert.equal(target.scytheMarkAt,1);assert.equal(target.lingyaMark,3);
 assert.equal(r.marks.size,2);
});

test('shared monster marks isolate all attackers without replacing AI identity or other combat state',()=>{
 let owner='one';const monster={id:7,hp:100,shadowMark:{hits:1,time:3},scytheMarks:2,scytheMarkAt:3,lingyaMark:4},guards=[monster],hits=new Set([monster]),poison=new Map([[monster,{until:8}]]);
 assert.equal(isolateCombatMarks(monster,()=>owner),monster);assert.equal(guards[0],monster);assert(hits.has(monster));assert.equal(poison.get(monster).until,8);
 owner='two';assert.equal(monster.shadowMark,undefined);assert.equal(monster.scytheMarks,undefined);assert.equal(monster.lingyaMark,undefined);
 monster.shadowMark={hits:2,time:5};monster.scytheMarks=1;monster.scytheMarkAt=5;monster.lingyaMark=6;monster.hp-=10;
 owner='one';assert.deepEqual(monster.shadowMark,{hits:1,time:3});assert.equal(monster.scytheMarks,2);assert.equal(monster.scytheMarkAt,3);assert.equal(monster.lingyaMark,4);assert.equal(monster.hp,90);
 assert.equal(isolateCombatMarks(monster,()=>{throw Error('reinstallation must not replace callback');}),monster);
 owner='two';assert.equal(monster.shadowMark.hits,2);monster.scytheMarks=0;owner='one';assert.equal(monster.scytheMarks,2);
});

test('slow, stagger and burn attribution live on the actual victim',()=>{
 const r=runtime();let owner='a';const target=createPlayerTarget(r,{ownerId:()=>owner});
 target.slow=2;target.stagger=.4;target.burnTime=3;target.burnDamage=6;
 assert.equal(r.player.hexSlow,2);assert.equal(r.player.networkStagger,.4);assert.equal(r.player.burnOwnerId,'a');
 owner='b';target.burnTime-=.1;assert.equal(target.burnOwnerId,'a');
 target.burnDamage=8;assert.equal(target.burnOwnerId,'b');
 // inflictStatus writes the explicit source before writing timer and damage.
 target.burnOwnerId='c';assert.equal(r.player.burnOwnerId,'c');
});

test('snapshot projection drops scene resources, object references, getters and cycles',()=>{
 let reads=0;const value={x:1,alive:true,mesh:{isObject3D:true},target:{id:'e:1'},marks:new Map(),hits:new Set(),fn(){},pose:{isObject3D:true},point:{x:2}};
 value.self=value;Object.defineProperty(value,'unsafe',{enumerable:true,get(){reads++;return 2;}});
 Object.defineProperty(value,'isTexture',{enumerable:true,get(){reads++;return false;}});
 const result=snapshotValue(value);
 assert.deepEqual(result,{x:1,alive:true,point:{x:2}});assert.equal(reads,0);
 assert.notEqual(result.point,value.point);assert.equal(JSON.stringify(result),'\u007b"x":1,"alive":true,"point":{"x":2}}');
});

test('snapshot limits depth, arrays, object keys, text and nonfinite numbers',()=>{
 const data={array:Array.from({length:1000},(_,i)=>i),text:'x'.repeat(5000),bad:Infinity,nan:NaN,zero:0,deep:{a:{b:{c:{d:{e:{f:{g:1}}}}}}}};
 const result=snapshotValue(data);assert.equal(result.array.length,256);assert.equal(result.text.length,4096);assert(!('bad'in result));assert(!('nan'in result));assert.equal(result.zero,0);
 assert.deepEqual(result.deep,{a:{b:{c:{d:{e:{}}}}}});
 assert.deepEqual(snapshotValue({a:{b:1}},{maxDepth:1}),{a:{}});
 assert.equal(Object.keys(snapshotValue(Object.fromEntries(Array.from({length:1000},(_,i)=>['n'+i,i])))).length,256);
});

test('whitelist merge ignores injected and inherited fields and clones accepted values',()=>{
 const target={hp:100,admin:false},source=JSON.parse('{"hp":70,"admin":true,"upgrades":{"power":2},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
 mergeSnapshot(target,source,['hp','upgrades','__proto__','constructor']);
 assert.deepEqual(target,{hp:70,admin:false,upgrades:{power:2}});assert.equal({}.polluted,undefined);
 source.upgrades.power=5;assert.equal(target.upgrades.power,2);
 const inherited=Object.create({hp:1});mergeSnapshot(target,inherited,['hp']);assert.equal(target.hp,70);
 let read=false;Object.defineProperty(source,'hp',{get(){read=true;return 0;}});mergeSnapshot(target,source,['hp']);assert.equal(read,false);assert.equal(target.hp,70);
});
