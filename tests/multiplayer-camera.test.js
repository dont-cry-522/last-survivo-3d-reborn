import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.js';
import {AdventureCamera} from '../adventure-camera.js';
import {segmentGroundEntry,segmentHitsBody} from '../adventure-combat.js';
import {segmentDistance} from '../rules.js';
import {createOwnerScope} from '../multiplayer-state.js';

// Run the real room dispatcher, input application, camera and target selection.
// World/render work is stubbed; projection, collision and owner binding are real.
const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
function section(from,to){const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,from+' boundary changed');return source.slice(a,b);}
const code=section('function updateRoomGame(dt){','function disposeRoomOwner(')
 +section('function applyRoomInput(','function hurtRoomPlayer(')
 +section('function updateRemoteCamera(','function roomSpawn(')
 +section('function visibleCombatPoint(','function visibleWeaponRange(')
 +section('function closestAutoTarget(','function inflictStatus(');
const createActions=new Function('context','with(context){'+code+'return {step:updateRoomGame,refresh:updateRemoteCamera,closest:closestAutoTarget,visible:visibleEnemy};}');
const noop=()=>{};
const fields=['player','roomOwner','camera','adventureCamera','aimInput','attackMode','autoTargetLock','eyeHeight','shake','hitConfirmUntil'];
function fixture(aspect=.52,mode='third'){
 const owner=id=>{
  const camera=new T.PerspectiveCamera(58,aspect,.1,320),o={id,player:{hp:120,x:0,y:0,z:0},camera,adventureCamera:new AdventureCamera(camera,{mode,yaw:0,pitch:-.08}),eyeHeight:1.65,
   aimInput:{held:false},attackMode:'auto',autoTargetLock:null,shake:0,hitConfirmUntil:0,lastInputAt:0,lastDodge:0,lastJump:0,
   input:{aimYaw:0,aimPitch:-.08,attack:true,autoAim:true,mobile:true,view:mode,aspect}};
  o.roomOwner=o;return o;
 };
 const local=owner('local'),remote=owner('remote');
 const c={roomSession:{host:true,ready:true,owners:new Map([['local',local],['remote',remote]]),sendClock:0,room:{paused:false}},roomClient:{playerId:'local'},
  performance:{now:()=>0},roomApplyingAction:false,state:'playing',time:0,screenPoint:new T.Vector3(),MOBILITY:{crouchRatio:.6},
  world:{obstacles:[],breakables:[],groundHeightAt:()=>0,exploration:{reveal:noop}},enemies:[],segmentDistance,segmentGroundEntry,segmentHitsBody,
  updateRiftStrikes:noop,updateFields:noop,updateBattleFlow:noop,updateSharedCombat:noop,updateOwnerProjectiles:noop,updateDangerZones:noop,
  updateOwnerSkills:noop,showCampReward:noop,updateExperienceOrbs:noop,updateExploration:noop,publishRoomChoices:noop,sendRoomSnapshot:noop,
  withRoomFocus:(_point,fn)=>fn(),dash:noop,jump:noop};
 c.isLocalRoomOwner=()=>c.roomOwner?.id==='local';c.groundAt=(x,z)=>c.world.groundHeightAt(x,z);c.combatTargets=()=>c.enemies;
 c.bindRoomOwner=o=>{for(const key of fields)c[key]=o[key];};c.bindRoomOwner(local);
 const scope=createOwnerScope({capture:()=>Object.fromEntries(fields.map(k=>[k,c[k]])),bind:c.bindRoomOwner});c.withRoomOwner=(o,fn)=>scope.run(o,fn);
 c.readRoomInput=()=>({...local.input});c.updateWorldClock=dt=>{c.time+=dt;};
 const actions=createActions(c);
 // updateOwnerMovement also performs this zero-time aim/collision refresh.
 c.updateOwnerMovement=()=>{if(!c.isLocalRoomOwner())actions.refresh(0);};
 const target={id:'golem',kind:'golem',alive:true,x:0,y:0,z:2,height:1.8,size:1};c.enemies.push(target);
 actions.step(1/60);
 return {c,local,remote,target,actions,remoteCall:fn=>c.withRoomOwner(remote,fn)};
}

test('remote mobile auto aim follows a player eight metres away from spawn through real room frames',()=>{
 for(const aspect of [.52,915/412,16/9]){
  const {c,local,remote,target,actions,remoteCall}=fixture(aspect),before=remote.camera.position.clone();
  assert.equal(remoteCall(()=>actions.closest(12)),target);
  remote.player.x=8;target.x=8;
  if(aspect===.52)assert.equal(remoteCall(()=>actions.visible(target)),false,'the original spawn camera loses nearby enemies on a narrow screen');
  for(let n=0;n<60;n++)actions.step(1/60);
  assert(remote.camera.position.distanceTo(before)>7.99,'authoritative remote camera must advance with elapsed game time');
  assert.equal(remoteCall(()=>actions.closest(12)),target,'a visible nearby enemy must remain available while holding mobile attack');
  assert.equal(remote.aimInput.held,true);assert.equal(remote.attackMode,'auto');assert.equal(c.roomOwner,local,'camera updates must restore the local observer');
 }
});

test('remote camera follow is frame-rate independent and does not advance during a paused room',()=>{
 const positions=[];
 for(const hz of [30,60,144]){
  const {c,remote,actions}=fixture();remote.player.x=8;
  for(let n=0;n<hz;n++)actions.step(1/hz);
  positions.push(remote.camera.position.clone());
  c.roomSession.room.paused=true;remote.player.x=16;const held=remote.camera.position.clone();
  actions.step(1);assert(remote.camera.position.equals(held));
 }
 assert(positions[0].distanceTo(positions[1])<1e-9);assert(positions[0].distanceTo(positions[2])<1e-9);
});

test('moving remote aim retains real tree occlusion and first-person eye position',()=>{
 for(const mode of ['third','first']){
  const {c,remote,target,actions,remoteCall}=fixture(.52,mode);remote.player.x=8;target.x=8;
  for(let n=0;n<60;n++)actions.step(1/60);
  assert.equal(remoteCall(()=>actions.closest(12)),target);
  c.world.obstacles.push({x:8,z:1,r:.5,height:4});
  assert.equal(remoteCall(()=>actions.closest(12)),null,'fixing the proxy view must not allow attacks through trees');
  c.world.obstacles.length=0;
  if(mode==='first'){
   const ray=remote.adventureCamera.getRay();assert(ray.origin.distanceTo(new T.Vector3(8,1.65,0))<1e-9);
   assert(Math.abs(ray.direction.y-Math.sin(-.08))<1e-9);
  }
 }
});
