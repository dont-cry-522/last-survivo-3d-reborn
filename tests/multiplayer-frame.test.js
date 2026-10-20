import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOwnerScope} from '../multiplayer-state.js';

// Execute the production room-frame dispatcher and render-frame shake decay.
// Combat/render adapters are stubs, but owner saves/restores use the real scope.
const main=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const start=main.indexOf('function updateRoomGame(dt){'),end=main.indexOf('function disposeRoomOwner(',start);
assert(start>0&&end>start,'room frame dispatcher boundary changed');
const step=new Function('context','dt','with(context){'+main.slice(start,end)+'updateRoomGame(dt);}');
const decayCode=main.match(/shake=Math\.max\(0,shake-dt\);/)?.[0];
assert(decayCode,'production render shake decay boundary changed');
const decay=new Function('context','dt','with(context){'+decayCode+'}');
const noop=()=>{};

function fixture(host){
 const local={id:'local',player:{hp:120,x:0,z:0},shake:.16,hitConfirmUntil:0},remote={id:'remote',player:{hp:120,x:1,z:0},shake:.08,hitConfirmUntil:77};
 local.roomOwner=local;remote.roomOwner=remote;
 const c={roomSession:{host,ready:true,owners:new Map([['local',local],['remote',remote]]),sendClock:0,room:{paused:false}},roomClient:{playerId:'local',sendInput:noop},roomOwner:local,player:local.player,
  shake:.16,hitConfirmUntil:0,aimInput:{held:false},attackMode:'manual',time:0,state:'playing',
  readRoomInput:()=>({held:false}),performance:{now:()=>0},roomReplica:{update:noop},world:{exploration:{reveal:noop}},updateRegion:noop,
  applyRoomInput:noop,updateOwnerMovement:noop,updateRiftStrikes:noop,updateFields:noop,updateBattleFlow:noop,updateSharedCombat:noop,
  updateOwnerProjectiles:noop,updateDangerZones:noop,updateOwnerSkills:noop,showCampReward:noop,updateExperienceOrbs:noop,updateExploration:noop,publishRoomChoices:noop,sendRoomSnapshot:noop,
  withRoomFocus:(_player,fn)=>fn()};
 c.bindRoomOwner=o=>{c.player=o.player;c.roomOwner=o.roomOwner;c.shake=o.shake;c.hitConfirmUntil=o.hitConfirmUntil;};
 c.updateWorldClock=dt=>{c.time+=dt;};
 const scope=createOwnerScope({capture:()=>({player:c.player,roomOwner:c.roomOwner,shake:c.shake,hitConfirmUntil:c.hitConfirmUntil}),bind:c.bindRoomOwner});
 c.withRoomOwner=(owner,fn)=>scope.run(owner,fn);
 return{c,local,remote};
}

test('local impact shake decays across real host owner boundaries instead of reviving every frame',()=>{
 const {c,local,remote}=fixture(true);
 const samples=[];
 for(let i=0;i<60;i++){step(c,1/60);decay(c,1/60);samples.push(c.shake);}
 assert.equal(c.shake,0);assert.equal(local.shake,0);
 assert(samples.every((value,i)=>i===0||value<=samples[i-1]),'owner restore must not bring back an older impact');
 assert.equal(remote.shake,.08,'remote owner visual state must stay isolated');
 // A hit confirmation arrives outside the owner update and must survive the next bind.
 c.hitConfirmUntil=c.time+.12;const until=c.hitConfirmUntil;step(c,1/60);
 assert.equal(local.hitConfirmUntil,until);assert.equal(c.hitConfirmUntil,until);assert.equal(remote.hitConfirmUntil,77);
});

test('guest frame captures decayed observer effects before later snapshot owner binding',()=>{
 const {c,local}=fixture(false);
 for(let i=0;i<60;i++){step(c,1/60);decay(c,1/60);}
 assert.equal(c.shake,0);assert.equal(local.shake,0);
 c.bindRoomOwner(local);assert.equal(c.shake,0,'a replica packet bind cannot resurrect a finished hit shake');
 c.hitConfirmUntil=1.2;step(c,1/60);c.bindRoomOwner(local);assert.equal(c.hitConfirmUntil,1.2);
});
