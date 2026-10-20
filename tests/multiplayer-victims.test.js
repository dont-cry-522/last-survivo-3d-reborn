import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.js';
import {segmentDistance} from '../rules.js';
import {createOwnerScope} from '../multiplayer-state.js';

// Use the production attack reset, swept pounce and multiplayer victim dispatch.
// Rendering is omitted; hit geometry and owner isolation are not reimplemented.
const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
function section(from,to){const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,from+' boundary changed');return source.slice(a,b);}
const code=section('function aliveRoomOwners(','function nearestRoomOwner(')+section('function forRoomVictims(','function updateRemoteCamera(')
 +section('function finishEnemyWindup(','// Footfall feedback');
const createActions=new Function('context','with(context){'+code+'return {wind:finishEnemyWindup,pounce:enemyPounce,victims:forRoomVictims};}');
const noop=()=>{};
function fixture(hp=100){
 const owners=['host','guest'].map(id=>({id,player:{x:0,z:0,hp,networkDead:hp<=0,hexSlow:0},companion:null,mirage:{decoy:null}}));
 const c={roomSession:{host:true,owners:new Map(owners.map(o=>[o.id,o]))},player:owners[0].player,roomOwner:owners[0],companion:null,mirage:owners[0].mirage,
  T,segmentDistance,world:{},terrainAt:()=>({speed:1}),moveActor:(_world,e,dx,dz)=>{e.x+=dx;e.z+=dz;},
  enemySound:noop,enemyRecovery:(_e,recovery)=>recovery,ENEMY_MOTION:{wolf:{recover:.3},mushroom:{recover:.3}},addZone:noop,impactChips:noop,hits:[]};
 const scope=createOwnerScope({capture:()=>({player:c.player,companion:c.companion,mirage:c.mirage,roomOwner:c.roomOwner}),bind:o=>{c.player=o.player;c.companion=o.companion;c.mirage=o.mirage;c.roomOwner=o.roomOwner||o;}});
 c.withRoomOwner=(o,fn)=>scope.run(o,fn);
 c.hitPlayer=damage=>{if(c.player.hp<=0)return false;c.hits.push(c.roomOwner.id);c.player.hp=Math.max(0,c.player.hp-damage);c.player.networkDead=c.player.hp<=0;return true;};
 return{c,owners,actions:createActions(c)};
}
const wolf=()=>({x:0,z:0,role:'wolf',kind:'wolf',size:.6,damage:8,attackAngle:0,mesh:{userData:{appearance:true}}});

test('native fresh pounce after every player is down keeps running until recovery',()=>{
 const {c,actions}=fixture(0),e=wolf();actions.wind(e);
 assert.equal(e.roomHits,null,'real windup clears previous attack bookkeeping');
 assert.doesNotThrow(()=>{while(e.pounce>0)actions.pounce(e,1/60);});
 assert(e.roomHits instanceof Map);assert.equal(e.roomHits.size,0);assert.equal(e.pounceMissed,true);assert.equal(e.landRecover,.3);assert.deepEqual(c.hits,[]);
});

test('native pounce hits each of two players once, survives a wipe, and hits again after respawn',()=>{
 const {c,owners,actions}=fixture(6),e=wolf();actions.wind(e);actions.pounce(e,1/60);
 assert.deepEqual(c.hits,['host','guest']);assert(owners.every(o=>o.player.hp===0));
 while(e.pounce>0)actions.pounce(e,1/60);
 e.x=e.z=0;actions.wind(e);assert.doesNotThrow(()=>actions.pounce(e,1/60));
 assert.deepEqual(c.hits,['host','guest'],'dead players must not receive repeated damage');
 for(const o of owners)Object.assign(o.player,{hp:100,networkDead:false});
 e.x=e.z=0;actions.wind(e);actions.pounce(e,1/60);actions.pounce(e,1/60);
 assert.deepEqual(c.hits,['host','guest','host','guest']);assert.equal(e.roomHits.size,2);assert(owners.every(o=>o.player.hp===92));
 assert.equal(c.roomOwner,owners[0],'victim iteration restores the caller owner');
});

test('empty and disconnected rosters are safe for new danger zones and existing hit history',()=>{
 const {c,actions}=fixture();c.roomSession.owners.clear();
 const zone={roomHits:undefined};let callbacks=0;actions.victims(()=>callbacks++,zone);
 assert.equal(callbacks,0);assert(zone.roomHits instanceof Map);assert.equal(zone.hit,false);
 const prior={roomHits:new Map([['departed',{hit:true,hitPet:false,hitDecoy:'decoy-old'}]])};
 actions.victims(()=>callbacks++,prior);assert.equal(callbacks,0);assert.equal(prior.hit,true);assert.equal(prior.hitDecoy,'decoy-old');
});

test('per-player pet and decoy flags stay separate and solo keeps its original single callback',()=>{
 const {c,actions}=fixture(),attack={roomHits:null};
 actions.victims(()=>{attack.hit=c.roomOwner.id==='host';attack.hitPet=c.roomOwner.id==='guest';attack.hitDecoy=c.roomOwner.id==='host'?'d1':null;},attack);
 assert.deepEqual([...attack.roomHits].map(([id,v])=>[id,v.hit,v.hitPet,v.hitDecoy]),[['host',true,false,'d1'],['guest',false,true,null]]);
 c.roomSession=null;let callbacks=0;const untouched={roomHits:null};actions.victims(()=>callbacks++,untouched);
 assert.equal(callbacks,1);assert.equal(untouched.roomHits,null);
});
