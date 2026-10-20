import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {buildWorld,clearAt} from '../world.js';
import {damageTerrain,updateTactics} from '../map-tactics.js';
import {createMapEvent} from '../map-events.js';
import {updateTide} from '../coast.js';
import {sandWeather} from '../sand-weather.js';
import {prepareNetworkWorld,captureWorldState,applyWorldState,createWorldReplica} from '../multiplayer-world.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const serial=world=>JSON.parse(JSON.stringify(captureWorldState(world)));
function fixture(){
  const group=new T.Group(),part=()=>{const m=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0x446644}));group.add(m);return m;};
  const tree={x:0,z:0,r:.65,tactic:'timber',hp:42,state:'standing',age:0,mesh:part()},gate={x:7,z:1,r:.9,mesh:part()},rock={x:20,z:0,r:1,mesh:part()};
  const site={x:4,z:5,type:'altar',event:'beacons',discovered:false,claimed:false,reveal:0,mesh:part(),ring:part(),trail:part(),eventGlow:part(),crystal:part(),gates:[gate],nodes:[{charge:0,mesh:part()},{charge:0,mesh:part()},{charge:0,mesh:part()}]};
  const find={x:9,z:10,id:'snow',variant:'native',discovered:false,claimed:false,progress:0,phase:0,mesh:part(),nodes:[{lit:false},{lit:false}],markers:[part(),part()]};
  const camp={kind:'camp',biome:'forest',x:11,z:12,discovered:false,state:'hidden',remaining:18,rewarded:false,mesh:part(),members:[]};camp.mesh.visible=false;
  const region={id:'forest',cleared:false,beacon:part(),breakables:[tree],obstacles:[tree,gate,rock]};
  const pond={baseRx:3,baseRz:5,rx:3,rz:5,r:5.6,mesh:part(),bank:part()};
  return{half:100,group,obstacles:[tree,gate,rock],breakables:[tree],sites:[site],discoveries:[find],roaming:[camp],regions:[region],visited:new Set(['forest']),activeBiome:'forest',ponds:[pond],fords:[{mesh:part()}],patches:[{kind:'vent',phase:0,marker:part()}]};
}
function dispose(w){w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});}

test('stable layout IDs survive gate deletion; repeated apply does not rebuild colliders or invoke gameplay',()=>{
  const host=fixture(),guest=fixture();prepareNetworkWorld(host);prepareNetworkWorld(guest);
  const gate=host.sites[0].gates[0],guestGate=guest.sites[0].gates[0];host.obstacles=host.obstacles.filter(o=>o!==gate);gate.mesh.removeFromParent();host.sites[0].gates=[];host.sites[0].claimed=true;
  guest.reward=guest.spawn=()=>{throw Error('Guest must never award or spawn during replication');};
  const state=serial(host);assert.equal(state.removed.length,1);assert.equal(applyWorldState(guest,state),true);
  assert.equal(guest.obstacles.length,2);assert.equal(guestGate.mesh.visible,false);assert.deepEqual(guest.sites[0].gates,[]);
  const colliders=guest.obstacles;for(let i=0;i<20;i++)assert.equal(applyWorldState(guest,state),true);assert.strictEqual(guest.obstacles,colliders);
  assert.equal(guest.sites[0].claimed,true);assert.equal(guest.sites[0].ring.visible,false);
});

test('fallen log collider proxies and mesh pose match the host and disappear on expiry',()=>{
  const host=fixture(),guest=fixture(),tree=host.breakables[0];prepareNetworkWorld(host);prepareNetworkWorld(guest);
  damageTerrain(tree,100,{x:0,z:-2});updateTactics(host,.75,{player:{x:90,z:90},foes:[],clear:()=>true,fx(){}});
  assert.equal(tree.state,'fallen');assert.equal(applyWorldState(guest,serial(host)),true);
  const proxies=guest.obstacles.filter(o=>o.owner===guest.breakables[0]);assert.equal(proxies.length,5);
  assert.equal(guest.breakables[0].state,'fallen');assert.equal(guest.breakables[0].mesh.rotation.x,tree.mesh.rotation.x);
  assert.deepEqual(proxies.map(o=>[o.x,o.z,o.r,o.height]),host.obstacles.filter(o=>o.owner===tree).map(o=>[o.x,o.z,o.r,o.height]));
  assert.equal(clearAt(guest,0,1,.4),false);
  updateTactics(host,8,{player:{x:90,z:90},foes:[],clear:()=>true,fx(){}});assert.equal(applyWorldState(guest,serial(host)),true);
  assert.equal(guest.breakables[0].state,'spent');assert.equal(guest.obstacles.filter(o=>o.owner).length,0);assert.equal(guest.breakables[0].mesh.position.y,-.2);
});

test('site progress, crystal lighting, finds, roaming rewards and regional beacons are presentation-only',()=>{
  const host=fixture(),guest=fixture();prepareNetworkWorld(host);prepareNetworkWorld(guest);
  const site=host.sites[0];Object.assign(site,{discovered:true,state:'ready',reveal:1,eventRun:createMapEvent('beacons')});site.eventRun.progress=3;site.eventRun.done=true;site.nodes.forEach(n=>n.charge=1.2);
  const find=host.discoveries[0];Object.assign(find,{discovered:true,progress:2,claimed:true});find.nodes.forEach(n=>n.lit=true);
  const camp=host.roaming[0];Object.assign(camp,{discovered:true,state:'claimed',rewarded:true,growthClaimed:true,x:13,z:14,members:[{id:3,alive:false}]});camp.mesh.visible=true;camp.mesh.scale.y=.35;
  host.regions[0].cleared=true;
  assert.equal(applyWorldState(guest,serial(host),{time:33,player:{x:4,z:5}}),true);
  assert.equal(guest.sites[0].ring.visible,true);assert.equal(guest.sites[0].nodes[0].mesh.material.color.getHex(),0xbcefff);
  assert.equal(guest.discoveries[0].markers[0].visible,false);assert.equal(guest.discoveries[0].claimed,true);
  assert.equal(guest.roaming[0].mesh.position.x,13);assert.equal(guest.roaming[0].mesh.scale.y,.35);assert.deepEqual(guest.roaming[0].members,[]);
  assert.equal(guest.regions[0].beacon.material.color.getHex(),0x89b59b);assert.equal(guest.activeBiome,'forest');
  const state=serial(host);state.sites[0].event.progress=0;assert.equal(guest.sites[0].eventRun.progress,3,'snapshot objects must not be shared with world');
});

test('tide shoreline, ford height, weather and vent indicators follow authoritative state',()=>{
  const host=fixture(),guest=fixture();prepareNetworkWorld(host);prepareNetworkWorld(guest);
  host.tide={warning:false,high:true,rise:1};host.sandstorm=sandWeather(23);
  assert.equal(applyWorldState(guest,serial(host),{time:3.4}),true);
  assert.equal(guest.ponds[0].rx,3*1.19);assert.equal(guest.ponds[0].mesh.scale.z,5*1.19);assert.equal(guest.fords[0].mesh.scale.y,1-.92);
  assert.equal(guest.sandstorm.active,true);assert.equal(guest.patches[0].marker.visible,true);assert.equal(guest.patches[0].marker.material.opacity,.8);
  host.tide={warning:false,high:false,rise:0};assert.equal(applyWorldState(guest,serial(host),{time:0}),true);assert.equal(guest.ponds[0].rx,3);assert.equal(guest.patches[0].marker.visible,false);
});

test('malformed or mismatched snapshots do not partially mutate any world state',()=>{
  const host=fixture(),guest=fixture();prepareNetworkWorld(host);prepareNetworkWorld(guest);const before=serial(guest);
  const bad=[s=>s.layout='wrong',s=>s.removed.push(99999),s=>s.sites[0].nodes.push(99),s=>s.sites[0].event={id:'__proto__'},s=>s.roaming[0].x=1e30,s=>s.breakables[0][0]=NaN,s=>s.logs.push([0,1e9,0,.34,0,.8]),s=>s.visited.push('fake-biome')];
  for(const modify of bad){const state=serial(host);state.sites[0].claimed=true;modify(state);assert.equal(applyWorldState(guest,state),false);assert.deepEqual(serial(guest),before);}
});

test('replica updates local visibility without advancing rewards and stops after disposal',()=>{
  const host=fixture(),guest=fixture();prepareNetworkWorld(host);host.sites[0].discovered=true;host.sites[0].reveal=1;
  const player={x:4,z:5};let calls=0;const replica=createWorldReplica(guest,{player:()=>player,time:()=>12,onChange:()=>calls++});
  assert.equal(replica.apply(serial(host)),true);assert.equal(calls,1);assert.equal(guest.sites[0].ring.visible,true);
  player.x=90;replica.update(13);assert.equal(guest.sites[0].ring.visible,false);assert.equal(guest.sites[0].claimed,false);
  replica.dispose();host.sites[0].claimed=true;assert.equal(replica.apply(serial(host)),false);assert.equal(guest.sites[0].claimed,false);assert.equal(replica.capture(),null);
});

test('real forest, sand, coast and confluence builds retain deterministic IDs and compact snapshots',()=>{
  for(const id of ['forest','sand','coast','confluence']){
    const host=buildWorld(id,13),guest=buildWorld(id,13);prepareNetworkWorld(host);prepareNetworkWorld(guest);
    const site=host.sites[0];site.discovered=true;site.reveal=1;site.claimed=true;
    if(id==='sand'||id==='confluence'){
      const mechanism=host.sites.find(s=>s.event==='mechanism');for(const gate of mechanism.gates){host.obstacles=host.obstacles.filter(o=>o!==gate);gate.mesh.removeFromParent();}mechanism.gates=[];
    }
    if(id==='coast'||id==='confluence')updateTide(host,21);
    const state=serial(host);assert.ok(JSON.stringify(state).length<16000,`${id} world snapshot exceeded 16 KB`);
    assert.equal(applyWorldState(guest,state,{time:21,player:guest.spawn}),true,id);assert.equal(guest.sites[0].claimed,true);assert.equal(guest.obstacles.length,host.obstacles.length);
    assert.deepEqual(serial(guest),state,id+' replica changed authoritative state');dispose(host);dispose(guest);
  }
});
