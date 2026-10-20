import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Scene} from '../vendor/three.module.js';
import {WEAPONS,HERO_LOADOUTS} from '../rules.js';
import {equipRelic,equipFieldSupply,fieldSupplyLabel} from '../expedition.js';
import {RoomReplica,sanitizeRoomSnapshot,PLAYER_FIELDS,POSE_FIELDS,ENEMY_FIELDS} from '../multiplayer-replica.js';

const packet=(overrides={})=>({time:1,players:[],enemies:[],boss:null,bullets:[],orbs:[],zones:[],world:{},...overrides});
const heroRow=(id='one',overrides={})=>({id,player:{x:1,y:2,z:3,hp:100,maxHp:120,vx:2,vz:0,heroId:'scout',weaponId:'rifle',groundHeight:2},rotation:0,pose:{shoot:.2,shotSerial:1},...overrides});
const enemy=(id='wolf1',overrides={})=>({id,kind:'wolf',x:0,y:2,z:3,hp:24,maxHp:24,alive:true,rotation:0,...overrides});
function setup(){
 const calls={actor:[],air:[],animation:[],airAnimation:[],projectile:[],flight:[],disposed:[],cueDisposed:[],fit:[],pet:[],aux:[]},scene=new Scene();
 class FX{constructor(){this.updates=[];this.disposed=0;calls.aux.push(this);}update(...args){this.updates.push(args);}dispose(){this.disposed++;}}
 const io={scene,groundHeight:(x,z)=>x*.1+z*.01,
  makeActor:kind=>{calls.actor.push(kind);const g=new Group();g.scale.set(2,2,2);return g;},makeAirborne:kind=>{calls.air.push(kind);return new Group();},
  animateActor:(...args)=>calls.animation.push(args),animateAirborne:(...args)=>calls.airAnimation.push(args),
  makeBadger:()=>new Group(),animateBadger:(...args)=>calls.pet.push(args),PoisonVFX:FX,MirageVFX:FX,
  disposeHero:g=>calls.disposed.push(g),disposeCue:g=>calls.cueDisposed.push(g),
  groundCue:()=>{const g=new Group();g.material={opacity:.5};return g;},fitGroundCue:(...args)=>calls.fit.push(args),mesh:()=>new Group(),glow:()=>new Group(),
  vfx:{projectile:w=>{calls.projectile.push(w);return new Group();},flight:(...args)=>calls.flight.push(args)}};
 const owner={player:{x:0,y:0,z:0,hp:120,weaponId:'rifle',upgrades:{}},hero:new Group(),heroId:'scout'};owner.hero.userData.bone=new Group();scene.add(owner.hero);
 const replica=new RoomReplica(io);replica.setOwners(new Map([['one',owner]]));return{replica,owner,scene,calls,io};
}

test('wire projection keeps only known typed presentation fields and never invokes getters',()=>{
 let getter=0;const row=heroRow();Object.defineProperty(row.pose,'rig',{enumerable:true,get(){getter++;throw Error('not data');}});
 row.pose.bones=[new Group()];row.pose.aimPitch=Infinity;row.pose.harpoonTarget={x:2,z:4,mesh:new Group()};
 row.player.upgrades={power:3,notAnUpgrade:999};row.player.weaponPath={id:'rifle_pierce',rank:2};row.player.melee={angle:1,pitch:.2,target:new Group()};
 const result=sanitizeRoomSnapshot(packet({players:[row],world:JSON.parse('{"__proto__":{"polluted":true},"phase":"live"}')}));
 assert.equal(getter,0);assert.equal(result.players[0].pose.rig,undefined);assert.equal(result.players[0].pose.aimPitch,undefined);
 assert.deepEqual(result.players[0].pose.harpoonTarget,{x:2,z:4});assert.deepEqual(result.players[0].player.upgrades,{power:3});
 assert.deepEqual(result.players[0].player.melee,{angle:1,pitch:.2});assert.equal({}.polluted,undefined);assert.deepEqual(result.world,{phase:'live'});
 assert.ok(PLAYER_FIELDS.includes('dashTime'));assert.ok(POSE_FIELDS.includes('shotSerial'));assert.ok(ENEMY_FIELDS.includes('flight'));
});

test('snapshot schema rejects missing arrays and filters unknown models, duplicate IDs and excessive lists',()=>{
 assert.equal(sanitizeRoomSnapshot({time:1,players:[]}),null);
 assert.equal(sanitizeRoomSnapshot(packet({time:NaN})),null);
 const s=sanitizeRoomSnapshot(packet({players:Array.from({length:9},(_,i)=>heroRow('p'+i)),enemies:[enemy(),enemy(),enemy('bad',{kind:'unknown'})],bullets:[{id:1,kind:'missing',x:0,z:0}],orbs:Array.from({length:500},(_,i)=>({id:i,x:0,z:0,xp:6})),zones:[{id:1,x:0,z:0,r:-3,kind:'poison'}]}));
 assert.equal(s.players.length,4);assert.equal(s.enemies.length,1);assert.equal(s.bullets.length,0);assert.equal(s.orbs.length,256);assert.equal(s.zones.length,0);
});

test('player state preserves root-owned identities and bones, and interpolates visual positions without changing authoritative coordinates',()=>{
 const {replica,owner,calls,io}=setup(),player=owner.player,hero=owner.hero,bone=hero.userData.bone;
 replica.apply(packet({players:[heroRow()]}));assert.equal(owner.player,player);assert.equal(owner.hero,hero);assert.equal(hero.userData.bone,bone);assert.equal(player.x,1);assert.equal(hero.position.x,1);
 replica.apply(packet({time:1.1,players:[heroRow('one',{player:{...heroRow().player,x:11},rotation:Math.PI-.1,pose:{shoot:.4,shotSerial:2,rig:{hijack:true}}})]}));
 assert.equal(player.x,11);assert.equal(hero.position.x,1);replica.update(.05,1.05);assert.ok(Math.abs(hero.position.x-6)<1e-9);assert.equal(player.x,11);assert.equal(hero.userData.rig,undefined);
 assert.equal(calls.animation.at(-1)[0],hero);assert.equal(calls.animation.at(-1)[2],2);assert.equal(hero.userData.shotSerial,2);
 // Replacing root runtime references must never leave animation bound to old data.
 io.animateActor=mesh=>{mesh.visible=true;}; // Native skinned hit/dive animation does this.
 owner.player={...player,hp:0,networkDead:true};replica.update(.05,1.1);assert.equal(hero.visible,false);
});

test('stale or malformed packets do not destroy existing entities and clear allows a fresh round clock',()=>{
 const {replica,scene}=setup();replica.apply(packet({time:5,enemies:[enemy()]}));const model=replica.enemies.get('wolf1').mesh;
 assert.equal(replica.apply(packet({time:4})),null);assert.equal(replica.apply({time:6}),null);assert.equal(replica.enemies.get('wolf1').mesh,model);assert.ok(scene.children.includes(model));
 replica.clear();assert.equal(replica.enemies.size,0);assert.ok(replica.apply(packet({time:0,enemies:[enemy()]})));
});

test('animation advances smoothly between snapshots, pauses without simulation and is bounded on packet loss',()=>{
 const {replica,calls,owner}=setup();replica.apply(packet({time:3,players:[heroRow('one',{pose:{shoot:.2,reloadPhase:.1,reloadDuration:.5,shotSerial:1}})]}));
 const authoritative={...owner.player};for(let i=0;i<3;i++)replica.update(1/60,3);
 const times=calls.animation.map(c=>c[1]);assert.ok(times[0]>3);assert.ok(times[1]>times[0]);assert.ok(times[2]>times[1]);assert.deepEqual(owner.player,authoritative);
 assert(Math.abs(owner.hero.userData.reloadPhase-.2)<1e-8);assert(Math.abs(owner.hero.userData.shoot-.15)<1e-8);
 const phase=owner.hero.userData.reloadPhase;
 replica.update(0,3);assert.equal(calls.animation.at(-1)[1],times[2]);
 assert.equal(owner.hero.userData.reloadPhase,phase);
 for(let i=0;i<100;i++)replica.update(1/60,3);assert.ok(calls.animation.at(-1)[1]<=3.12);
 replica.apply(packet({time:4,players:[heroRow()]}));replica.update(1/60,4);assert.ok(calls.animation.at(-1)[1]>4);
});

test('native creature, boss and airborne factories are reused with original proportions and pure pose animation',()=>{
 const {replica,calls}=setup();replica.apply(packet({enemies:[enemy(),enemy('bat',{kind:'duskbat',flight:{stage:'wind',timer:.2}})],boss:enemy('boss',{kind:'thornstag',pose:{bossStage:'wind',bossMove:'antlerrush',windProgress:.4}})}));
 replica.update(.05,1);assert.deepEqual(calls.actor,['wolf','thornstag']);assert.deepEqual(calls.air,['duskbat']);
 assert.equal(replica.enemies.get('wolf1').mesh.scale.x,2);assert.equal(replica.enemies.get('boss').mesh.userData.bossMove,'antlerrush');
 assert.equal(calls.airAnimation[0][0].flight.stage,'wind');assert.equal(typeof calls.airAnimation[0][0].id,'number');
 replica.apply(packet({time:1.1,enemies:[enemy('wolf1',{kind:'golem',scale:[1.4,1.5,1.4]})]}));replica.update(.05,1.1);
 assert.equal(calls.actor.at(-1),'golem');assert.equal(replica.enemies.get('wolf1').mesh.scale.y,1.5);assert.equal(calls.disposed.length,3);
});

test('every real weapon projectile uses native appearance and all seven hero identities survive packets',()=>{
 const {replica,calls}=setup(),owners=new Map();for(const [id,weapons]of Object.entries(HERO_LOADOUTS))owners.set(id,{heroId:id,hero:new Group(),player:{weaponId:weapons[0],hp:120}});replica.setOwners(owners);
 const list=[...owners];for(let start=0;start<list.length;start+=4){
  const players=list.slice(start,start+4).map(([id,owner])=>heroRow(id,{player:{x:0,z:0,hp:120,heroId:id,weaponId:owner.player.weaponId}}));
  replica.apply(packet({time:start+1,players,bullets:Object.keys(WEAPONS).map((kind,i)=>({id:i,kind,ownerId:players[0].id,x:i,y:1,z:2,w:{id:kind,color:123}}))}));replica.update(.05,start+1);
  for(const row of players)assert.equal(owners.get(row.id).player.heroId,row.id);
 }
 assert.deepEqual(calls.projectile.map(w=>w.id),Object.keys(WEAPONS).filter(id=>id!=='briarpot'));assert.equal(calls.flight.length,(Object.keys(WEAPONS).length-1)*2);
});

test('native planted briar seeds keep their shape and guest HUD skill clocks remain authoritative',()=>{
 const {replica,calls,io}=setup(),meshes=[];io.mesh=(...args)=>{meshes.push(args);return new Group();};
 const row=heroRow('one',{skillClock:17.3,primeUntil:20.5});
 const result=replica.apply(packet({players:[row],bullets:[{id:'seed',kind:'briarpot',x:2,y:.12,z:4,scale:[1.85,1.35,1.85],rotation:[1,2,.2]}]}));
 replica.update(.05,1);const seed=replica.bullets.get('seed').mesh;
 assert.deepEqual(meshes[0].slice(0,3),['IcosahedronGeometry',[.15,1],0xb99867]);assert.deepEqual(seed.scale.toArray(),[1.85,1.35,1.85]);
 assert.equal(seed.name,'SM_Weapon_BriarSeed_Flight');assert.equal(calls.projectile.length,0);assert.equal(calls.flight.length,0);
 assert.equal(result.players[0].skillClock,17.3);assert.equal(result.players[0].primeUntil,20.5);
 const bad=sanitizeRoomSnapshot(packet({players:[heroRow('one',{skillClock:Infinity,primeUntil:'bad'})]})).players[0];
 assert.equal(bad.skillClock,undefined);assert.equal(bad.primeUntil,undefined);
});

test('clear removes only replica roots and owned auxiliary effects, never shared owners, materials or borrowed VFX',()=>{
 const {replica,owner,scene,calls}=setup(),foreign=new Group(),pet=new Group();scene.add(foreign,pet);owner.companionMesh=pet;
 const borrowed={updates:0,disposed:0,update(){this.updates++;},dispose(){this.disposed++;}};owner.poisonVFX=borrowed;
 replica.apply(packet({players:[heroRow('one',{poison:{now:1,clouds:[],shield:{amount:4,until:3}},mirage:{now:1,clouds:[],decoy:null},companion:{x:0,z:0,hp:30,alive:true,state:'pounce',elapsed:.15}})],enemies:[enemy()],bullets:[{id:1,x:0,z:0,kind:'rifle'}],orbs:[{id:1,x:0,z:0,xp:5}],zones:[{id:1,x:2,z:3,r:2,kind:'frost',opacity:.4}]}));
 replica.update(.05,1);assert.equal(borrowed.updates,1);assert.equal(calls.aux.length,1);assert.equal(calls.pet[0][3],'pounce');assert.equal(calls.pet[0][4],.5);assert.equal(calls.fit.length,1);
 replica.clear();assert.equal(borrowed.disposed,0);assert.equal(calls.aux[0].disposed,1);assert.equal(calls.cueDisposed.length,1);assert.equal(calls.disposed.length,1);
 assert.deepEqual(new Set(scene.children),new Set([owner.hero,foreign,pet]));replica.clear();assert.equal(calls.aux[0].disposed,1);
});

test('effects are bounded, references do not leak, missing players release only replica-created companions',()=>{
 const {replica,owner,scene,calls}=setup();
 const clouds=Array.from({length:20},(_,i)=>({id:i,x:i,z:0,r:2,born:0,expires:4,target:new Group()}));
 const result=replica.apply(packet({players:[heroRow('one',{poison:{now:1,clouds,bands:[{r:.3,expires:4,points:Array.from({length:200},(_,i)=>({x:i,z:0}))}],pods:[]},companion:{x:0,z:0,state:'sniff',alive:true}})]}));
 replica.update(.05,1);assert.equal(result.players[0].poison.clouds.length,3);assert.equal(result.players[0].poison.bands[0].points.length,128);assert.equal(result.players[0].poison.clouds[0].target,undefined);
 const pet=replica.players.get('one').pet.mesh;assert.ok(scene.children.includes(pet));assert.equal(owner.companionMesh,undefined);
 replica.apply(packet({time:2}));assert.ok(!scene.children.includes(pet));assert.ok(scene.children.includes(owner.hero));assert.equal(calls.aux[0].disposed,1);
});

test('actual relic, supply, camp and companion HUD fixtures retain IDs and state without transferring behavior',()=>{
 const {replica,owner}=setup(),row=heroRow();equipRelic(row.player,'wind');equipFieldSupply(row.player,'forest');row.player.huntBoon='rush';row.player.campRewards=[{id:'camp1',x:3,z:4,growthClaimed:false,enemies:[new Group()]}];
 const api={damage(){throw Error('must remain local');}},syncHealth=()=>{};owner.companion={hp:150,maxHp:150,alive:true,api,syncHealth};
 row.companion={x:1,z:2,alive:false,hp:0,maxHp:166,reviveLeft:7,state:'down',regenerating:false,api:{damage:'not a function'},syncHealth:()=>{}};
 replica.apply(packet({players:[row],boss:enemy('boss',{kind:'boss',boss:true,biome:'forest',pressure:1.2})}));
 assert.deepEqual(owner.player.relic,{id:'wind',charges:0,until:0,shots:0,kills:0});assert.equal(fieldSupplyLabel(owner.player),'回生药束 · 剩余 3 次');assert.equal(owner.player.huntBoon,'rush');assert.equal(owner.player.campRewards.length,1);assert.equal(owner.player.campRewards[0].enemies,undefined);
 assert.equal(owner.companion.hp,0);assert.equal(owner.companion.reviveLeft,7);assert.equal(owner.companion.alive,false);assert.equal(owner.companion.api,api);assert.equal(owner.companion.syncHealth,syncHealth);
 assert.equal(replica.state.boss.boss,true);assert.equal(replica.state.boss.biome,'forest');assert.equal(replica.state.boss.pressure,1.2);
 const invalid=heroRow();invalid.player.relic={id:'not a relic'};invalid.player.fieldSupply={id:'no'};invalid.player.huntBoon='<img>';invalid.player.weaponPath={id:'rifle_pierce',rank:'not finite'};
 const sanitized=sanitizeRoomSnapshot(packet({players:[invalid]})).players[0].player;for(const key of ['relic','fieldSupply','huntBoon','weaponPath'])assert.equal(sanitized[key],undefined);
});
