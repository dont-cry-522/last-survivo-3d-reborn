import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {buildWorld,clearAt} from '../world.js';
import {discoverSite} from '../site-discovery.js';
import {MAP_EVENTS,createMapEvent,advanceMapEvent} from '../map-events.js';
import {captureWorldState,applyWorldState} from '../multiplayer-world.js';

// Execute the actual private game handlers, not a second implementation of the
// lifecycle. Rendering/audio/dialog plumbing is stubbed; real meshes, discovery,
// event state machines, gate removal and rewards remain under test.
const main=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const extract=(start,end)=>main.slice(main.indexOf(start),main.indexOf(end,main.indexOf(start)));
const handlers=extract('function updateSiteEvent(s,dt,d){','function claimForestSite(')+
 extract('function updateSite(s,dt){','function updateRegion(');
function harness(world){
 const noop=()=>{},context={
  world,time:200,state:'playing',player:{x:0,z:0,hp:30,maxHp:120,pending:0},enemies:[],boss:null,orbs:[{attract:false}],
  renderer:{shadowMap:{}},sound:{pickup:noop,resolve:noop,threat:noop,stopWeapons:noop,stopCreatures:noop},
  vfx:{rise:noop},keys:new Set(),discoverSite,MAP_EVENTS,createMapEvent,advanceMapEvent,
  groundAt:(x,z)=>world.groundHeightAt(x,z),toast:noop,introduce:noop,introduceCircle:noop,
  releaseStick:noop,clearAttack:noop,addZone:noop,burst:noop,mat:()=>new T.MeshBasicMaterial(),
  spawn(role,x,z){const e={role,x,z,alive:true};context.enemies.push(e);return e;},
  dialog(title,description,choices){context.choices=choices;},
  resume(){context.state='playing';},
  chooseRelic(site){site.claimed=true;site.ring.visible=false;context.relicChoices=(context.relicChoices||0)+1;}
 };
 vm.createContext(context);vm.runInContext(handlers,context);return context;
}
for(const id of ['bellvale','crystalcave'])test(`${id}: real site handlers discover, complete and award every site once`,()=>{
 const world=buildWorld(id,42),h=harness(world),client=buildWorld(id,42);
 captureWorldState(world);captureWorldState(client);
 for(const s of world.sites){
  assert(s.trail?.isMesh&&s.trail.parent===world.group,'missing production route-cue contract');
  assert(s.trail.geometry.index.count>0&&s.trail.userData.ownedGeometry);
  const p=s.trail.geometry.attributes.position;
  for(let i=0;i<p.count;i++)assert(Math.abs(p.getY(i)-world.groundHeightAt(p.getX(i),p.getZ(i))-.012)<1e-5);
  Object.assign(h.player,{x:s.x,z:s.z,hp:30});h.enemies=[];h.choices=null;
  const pending=h.player.pending,relics=h.relicChoices||0;
  h.updateSite(s,.05);assert(s.discovered&&s.mesh.visible&&s.trail.visible);assert.equal(s.state,'warning');
  h.updateSite(s,2.1);assert(s.guards.length>0,'site never spawned its actual guardian wave');
  if(s.event==='beacons'){
   const elapsed=s.eventRun.elapsed;h.updateSite(s,0);assert.equal(s.eventRun.elapsed,elapsed,'zero game time advanced an event');
   for(const n of s.nodes){Object.assign(h.player,{x:n.x,z:n.z});h.updateSite(s,1.2);assert.equal(n.charge,1.2);}
   assert.equal(s.state,'ready');assert(!s.claimed);Object.assign(h.player,{x:s.x,z:s.z});
  }else{
   for(let i=0;i<8&&!s.claimed&&!h.choices;i++){
    for(const e of h.enemies)e.alive=false;
    h.updateSite(s,.1);
   }
   if(s.event==='mechanism'){
    assert.equal(h.state,'event-choice');assert.equal(h.choices.length,2);
    const gate=world.newScenery.layout.landmarks[2];assert(!clearAt(world,gate.x,gate.z,.45));
    h.choices[0][1]();assert(s.claimed);assert.equal(s.gates.length,0);assert(clearAt(world,gate.x,gate.z,.45));
    assert.equal(h.player.hp,60);
   }
  }
  h.updateSite(s,.1);assert(s.claimed,`${id} ${s.type}/${s.event||'ordinary'} cannot finish`);
  if(s.event!=='mechanism'){
   if(s.type==='altar')assert.equal(h.player.pending,pending+1);
   else if(s.type==='relic')assert.equal(h.relicChoices,relics+1);
   else{assert.equal(h.player.hp,78);assert(h.orbs.every(o=>o.attract));}
  }
  const once={hp:h.player.hp,pending:h.player.pending,relics:h.relicChoices};h.updateSite(s,1);
  assert.deepEqual({hp:h.player.hp,pending:h.player.pending,relics:h.relicChoices},once,'reward repeated after claim');
  const packet=captureWorldState(world);assert(applyWorldState(client,packet));
  const remote=client.sites[world.sites.indexOf(s)];assert(remote.claimed&&remote.discovered&&remote.mesh.visible&&remote.trail.visible);
 }
});
