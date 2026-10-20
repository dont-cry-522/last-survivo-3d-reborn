import test from 'node:test';
import assert from 'node:assert/strict';
import {PoisonCombat} from '../poison-combat.js';
import {weaponStats} from '../rules.js';
import {createOwnerScope,createPlayerTarget,isolateCombatMarks} from '../multiplayer-state.js';

test('native poison flight and area ticks hit mixed monster/player targets through owner scopes',()=>{
 const attacker={id:'caster',heroId:'wuling',hero:{},kills:0,player:{heroId:'wuling',weaponId:'sporelantern',upgrades:{poison_linger:1},x:0,y:0,z:-2,hp:120}};
 const victim={id:'victim',heroId:'silver',hero:{},kills:0,player:{heroId:'silver',x:0,y:0,z:0,hp:200,maxHp:200,networkDead:false}};
 let current=attacker,active=true;const hits=[];
 const scope=createOwnerScope({capture:()=>({owner:current}),bind:s=>{current=s.owner;},save:()=>{}});
 const target=createPlayerTarget(victim,{ownerId:()=>current.id});
 const monster=isolateCombatMarks({id:7,kind:'wolf',x:0,y:0,z:.2,hp:200,alive:true},()=>current.id);
 const damage=(e,n,flash,hit)=>{
  assert.equal(current,attacker);assert(e.alive,'a dead victim must not receive duplicate damage');hits.push({id:e.id,amount:n,source:hit.source});
  if(e.playerId)scope.run({owner:victim},()=>{current.player.hp=Math.max(0,current.player.hp-n);if(!current.player.hp)current.player.networkDead=true;});
  else{e.hp=Math.max(0,e.hp-n);if(!e.hp)e.alive=false;}
  if(!e.alive)current.kills++;
 };
 const poison=new PoisonCombat({player:()=>current.player,active:()=>active,foes:()=>[monster,target],groundHeight:()=>0,damage});
 scope.run({owner:attacker},()=>{
  const w=weaponStats(attacker.player);assert(poison.cast(w,{x:0,y:1,z:-2},0,{x:0,z:0}));poison.update(1);
 });
 assert(hits.some(h=>h.id==='p:victim'&&h.source==='poison-impact'));assert(hits.some(h=>h.id==='p:victim'&&h.source==='poison-main'));
 assert(hits.some(h=>h.id===7&&h.source==='poison-main'));assert(victim.player.hp<200);assert.equal(attacker.player.hp,120);assert.equal(current,attacker);
 const before=victim.player.hp,clock=poison.now;active=false;poison.update(5);assert.equal(victim.player.hp,before);assert.equal(poison.now,clock);
 active=true;victim.player.hp=1;poison.update(.4);assert.equal(victim.player.networkDead,true);assert.equal(attacker.kills,1);
 const count=hits.filter(h=>h.id==='p:victim').length;poison.update(.4);assert.equal(hits.filter(h=>h.id==='p:victim').length,count);
 // A new run retains the runtime/player identity and clears all previous poison.
 poison.reset();Object.assign(victim.player,{hp:200,networkDead:false});const resetHp=victim.player.hp;poison.update(1);
 assert.equal(victim.player.hp,resetHp);assert.equal(poison.clouds.length+poison.pods.length+poison.bands.length+poison.marks.size,0);
 assert(poison.cast(weaponStats(attacker.player),{x:0,y:1,z:-2},0,{x:0,z:0}));poison.update(1);assert(victim.player.hp<resetHp);
});
