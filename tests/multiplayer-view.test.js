import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.js';
import {AdventureCamera} from '../adventure-camera.js';
import {RoomReplica} from '../multiplayer-replica.js';

// Execute the real observer camera. Rendering/light adapters are inert, but
// authoritative replication, interpolation and camera collision are production.
const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const start=source.indexOf('function roomViewPosition(){'),end=source.indexOf('function resetMouseLook()',start);
assert(start>0&&end>start,'observer camera boundary changed');
const actions=new Function('context','with(context){'+source.slice(start,end)+'return {update:updateCamera,position:roomViewPosition};}');
const contactCode=source.match(/const contactPosition=roomViewPosition\(\);contactShadow\.position\.set\([^;]+;/)?.[0];
assert(contactCode,'contact shadow must use the observer position');
const contact=new Function('context','with(context){'+contactCode+'}');
const noop=()=>{};

function fixture(mode='first'){
 const hero=new T.Group(),camera=new T.PerspectiveCamera(70,16/9,.1,320),player={x:0,y:0,z:0,hp:120,maxHp:120,weaponId:'rifle',groundHeight:0};
 const adventureCamera=new AdventureCamera(camera,{mode,yaw:0,pitch:-.08});
 const owner={id:'one',heroId:'scout',hero,player,adventureCamera};
 const replica=new RoomReplica({scene:new T.Scene(),groundHeight:()=>0,animateActor:noop,vfx:{}});replica.setOwners(new Map([['one',owner]]));
 const c={roomSession:{ready:true,host:false},roomClient:{playerId:'one'},roomReplica:replica,player,hero,camera,adventureCamera,
  isLocalRoomOwner:()=>true,viewDodge:()=>null,state:'playing',eyeHeight:1.65,MOBILITY:{crouchRatio:.6},heroId:'scout',time:0,
  world:{obstacles:[],groundHeightAt:()=>0,overhead:{firstHit:()=>null}},cinema:{setUnderwater:noop},$ :()=>({style:{},dataset:{}}),
  updateEnvironmentAssets:noop,touch:false,sun:{target:{position:new T.Vector3()},position:new T.Vector3(),shadow:{camera:{right:28},mapSize:new T.Vector2(1024,1024)}},
  snapShadowFocus:noop,environmentLighting:{direction:new T.Vector3(0,1,0)},renderer:{shadowMap:{}},contactShadow:{position:new T.Vector3()},updateRemoteCamera:noop};
 const api=actions(c);c.roomViewPosition=api.position;
 const packet=(time,x,extra={})=>({time,players:[{id:'one',player:{x,y:0,z:0,hp:120,maxHp:120,heroId:'scout',weaponId:'rifle',groundHeight:0,...extra},pose:{},rotation:0}],enemies:[],boss:null,bullets:[],orbs:[],zones:[],world:{}});
 return{c,owner,replica,api,packet};
}

test('guest first-person eye and contact shadow advance at render cadence while authoritative state stays at 15 Hz',()=>{
 const {c,replica,api,packet}=fixture();
 assert.equal(api.position(),c.player,'before first packet use the existing spawn');
 replica.apply(packet(0,0));api.update(0);
 replica.apply(packet(1/15,.4));assert.equal(c.player.x,.4);assert.equal(c.hero.position.x,0);
 const positions=[];
 for(let i=0;i<4;i++){replica.update(1/60);api.update(1/60);contact(c);positions.push(c.camera.position.x);assert.equal(c.player.x,.4);assert.equal(c.contactShadow.position.x,c.hero.position.x);}
 positions.forEach((x,i)=>assert(Math.abs(x-(i+1)*.1)<1e-9));
 assert.equal(c.camera.position.y,1.65);assert.equal(c.sun.target.position.x,c.hero.position.x);
});

test('third-person camera uses the interpolated pivot and retains the real collision resolver',()=>{
 const {c,replica,api,packet}=fixture('third');
 const reference=new AdventureCamera(new T.PerspectiveCamera(58,16/9,.1,320),{mode:'third',yaw:0,pitch:-.08});
 c.world.obstacles.push({x:-.5,z:-2,r:.6,y:0,height:4});
 const step=dt=>{api.update(dt);reference.update(dt,c.hero.position,c.world.obstacles,{eyeHeight:1.65,shoulderHeight:1.65*.84,groundHeight:c.world.groundHeightAt,followRate:12});assert(c.camera.position.distanceTo(reference.camera.position)<1e-9);};
 replica.apply(packet(0,0));step(0);replica.apply(packet(1/15,.4));
 for(let i=0;i<4;i++){replica.update(1/60);step(1/60);}
 assert(c.adventureCamera._boom<6,'trees still shorten the third-person boom');
});

test('first packet, paused interpolation and a distant respawn never sweep the guest camera through the map',()=>{
 for(const mode of ['first','third']){
  const {c,replica,api,packet}=fixture(mode);
  api.update(0);replica.apply(packet(0,12));assert.equal(c.adventureCamera._ready,false);api.update(0);assert.equal(c.hero.position.x,12);assert.equal(c.adventureCamera._anchor.x,12);
  replica.apply(packet(1/15,12.4));replica.update(1/60);api.update(1/60);
  const position=c.hero.position.clone();for(let i=0;i<8;i++)replica.update(0);assert(c.hero.position.equals(position));
  replica.apply(packet(2/15,12.4,{hp:0,networkDead:true}));replica.update(1/15);api.update(1/15);
  replica.apply(packet(3/15,-20,{networkDead:false}));assert.equal(c.hero.position.x,-20);assert.equal(c.adventureCamera._ready,false);
  api.update(1/60);assert(Math.abs(c.adventureCamera._anchor.x+20)<1e-9);assert(Math.abs(c.adventureCamera._target.x+20)<.51);
  assert.equal(c.player.x,-20);replica.clear();assert.equal(api.position(),c.player);
 }
});

test('solo and host cameras retain authoritative positions even when a guest replica exists',()=>{
 const {c,replica,api,packet}=fixture();replica.apply(packet(0,0));replica.apply(packet(1/15,4));replica.update(1/60);
 for(const session of [null,{ready:true,host:true},{ready:false,host:false}]){c.roomSession=session;assert.equal(api.position(),c.player);api.update(0);assert.equal(c.camera.position.x,4);}
});

test('native silver and wraith blinks snap once while normal travel and rolls remain interpolated',()=>{
 for(const kind of ['silver','wraith','scout','tide','lingya','wuling','mirage']){
  const {c,owner,replica,api,packet}=fixture();owner.heroId=kind;
  replica.apply(packet(0,0,{dash:0,heroId:kind}));api.update(0);
  replica.apply(packet(1/15,5,{dash:2.2,dashTime:.2,heroId:kind}));
  const blink=['silver','wraith'].includes(kind);
  assert.equal(c.hero.position.x,blink?5:0,kind);assert.equal(c.adventureCamera._ready,!blink,kind);
  replica.update(1/60);api.update(1/60);assert.equal(c.player.x,5);
  const from=c.hero.position.x;
  replica.apply(packet(2/15,5.4,{dash:2.1,dashTime:.1,heroId:kind}));
  assert.equal(c.hero.position.x,from,'the remaining blink cooldown must not snap ordinary movement');
  replica.update(1/60);assert(c.hero.position.x>from&&c.hero.position.x<5.4);
 }
});

test('swim and body pose offsets do not enter the eye anchor, and jumping does not lift the contact shadow',()=>{
 const {c,replica,api,packet}=fixture(),rig=new T.Group();c.hero.add(rig);
 replica.apply(packet(0,0,{y:2,groundHeight:0}));api.update(0);contact(c);
 assert.equal(c.camera.position.y,3.65);assert.equal(c.contactShadow.position.y,.018);
 rig.position.set(.3,-2.15,.2);rig.rotation.set(.8,.2,.4);api.update(1/60);contact(c);
 assert.equal(c.camera.position.y,3.65);assert.equal(c.contactShadow.position.y,.018);
 assert.equal(c.player.y,2);assert.equal(c.player.groundHeight,0);
});
