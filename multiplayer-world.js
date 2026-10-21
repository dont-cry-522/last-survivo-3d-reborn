// Presentation-only replication of the existing deterministic world. No rewards,
// event advancement, terrain damage or monster spawning happens in this module.
import {mat} from './world.js?v=230';
import {animateDiscoveries} from './map-discoveries.js?v=230';
import {MAP_EVENTS} from './map-events.js?v=230';

const worlds=new WeakMap();
const SITE_STATES=[null,'warning','trial-warning','active','guarded','ready'];
const ROAM_STATES=['hidden','waiting','running','active','reward','claimed','escaped'];
const BREAK_STATES=['standing','falling','fallen','crumbling','spent'];
const BIOMES=['forest','snow','ash','sand','coast'];
const ORDERS=['XYZ','YXZ','ZXY','ZYX','YZX','XZY'];
const finite=(v,min=-1e6,max=1e6)=>Number.isFinite(v)&&v>=min&&v<=max;
const bool=v=>typeof v==='boolean';
const integer=(v,max)=>Number.isInteger(v)&&v>=0&&v<max;
const list=(v,length)=>Array.isArray(v)&&v.length===length;
const living=items=>(items||[]).filter(e=>e.alive).map(e=>e.id).filter(id=>integer(id,1e9)).slice(0,16);
const vector=mesh=>[mesh?.position?.y||0,mesh?.scale?.y??1,mesh?.rotation?.x||0,mesh?.rotation?.y||0,mesh?.rotation?.z||0,mesh?.rotation?.order||'XYZ'];
function layoutSignature(groups){
  let hash=2166136261;
  for(const group of groups){const row=group.map(o=>[o.id||o.event||o.kind||o.tactic||'',Math.round((o.x||0)*1000),Math.round((o.z||0)*1000),Math.round((o.r||0)*1000)]);
    for(const char of JSON.stringify(row))hash=Math.imul(hash^char.charCodeAt(0),16777619);
  }
  return(hash>>>0).toString(16);
}

/** Call once after building both worlds, before gates/logs can be removed. */
export function prepareNetworkWorld(world){
  if(worlds.has(world))return worlds.get(world);
  const obstacles=[...(world.obstacles||[])],sites=[...(world.sites||[])],discoveries=[...(world.discoveries||[])],roaming=[...(world.roaming||[])],breakables=[...(world.breakables||[])],regions=[...(world.regions||[])];
  if(obstacles.length>20000||sites.length>64||discoveries.length>128||roaming.length>64||breakables.length>128||regions.length>5)throw Error('World exceeds private-room replication limits.');
  const data={obstacles,sites,discoveries,roaming,breakables,regions,ids:new Map(obstacles.map((o,i)=>[o,i])),breakIds:new Map(breakables.map((o,i)=>[o,i])),
    layout:layoutSignature([obstacles,sites,discoveries,roaming,breakables,regions]),collisionKey:null,hidden:new Set(),gates:sites.map(s=>[...(s.gates||[])]),
    nodeMaterials:sites.map(s=>(s.nodes||[]).map(n=>n.mesh?.material)),eventMaterials:sites.map(s=>s.eventGlow?.material),beaconMaterials:regions.map(r=>r.beacon?.material),
    regionObstacles:regions.map(r=>[...(r.obstacles||[])])};
  worlds.set(world,data);return data;
}
function eventState(e){return e?{id:e.id,elapsed:e.elapsed||0,progress:e.progress||0,wave:e.wave||0,lastWarning:e.lastWarning??-1,done:!!e.done,blocked:!!e.blocked,flooded:!!e.flooded,choice:e.choice||null,awaiting:!!e.awaiting,trial:!!e.trial}:null;}

export function captureWorldState(world){
  const p=prepareNetworkWorld(world),current=new Set(world.obstacles||[]);
  return{v:1,layout:p.layout,
    removed:p.obstacles.flatMap((o,i)=>current.has(o)?[]:[i]),
    logs:(world.obstacles||[]).filter(o=>p.breakIds.has(o.owner)).map(o=>[p.breakIds.get(o.owner),o.x,o.z,o.r,o.y||0,o.sceneryHeight??o.height??.15]),
    breakables:p.breakables.map(o=>[o.hp||0,o.state,o.age||0,o.angle||0,...vector(o.mesh)]),
    sites:p.sites.map(s=>({discovered:!!s.discovered,claimed:!!s.claimed,state:s.state||null,reveal:s.reveal||0,timer:s.timer||0,contested:!!s.contested,event:eventState(s.eventRun),nodes:(s.nodes||[]).map(n=>n.charge||0),guards:living(s.guards),y:s.mesh?.position?.y||0,sy:s.mesh?.scale?.y??1})),
    discoveries:p.discoveries.map(n=>({discovered:!!n.discovered,claimed:!!n.claimed,progress:n.progress||0,blocked:!!n.blocked,contested:!!n.contested,nodes:(n.nodes||[]).map(q=>!!q.lit)})),
    roaming:p.roaming.map(s=>({x:s.x,z:s.z,discovered:!!s.discovered,state:s.state,remaining:s.remaining||0,rewarded:!!s.rewarded,growthClaimed:!!s.growthClaimed,members:living(s.members),visible:!!s.mesh?.visible,y:s.mesh?.position?.y||0,sy:s.mesh?.scale?.y??1})),
    regions:p.regions.map(r=>!!r.cleared),visited:[...(world.visited||[])].filter(id=>BIOMES.includes(id)),
    tide:world.tide?{warning:!!world.tide.warning,high:!!world.tide.high,rise:world.tide.rise||0}:null,
    sandstorm:world.sandstorm?{warning:!!world.sandstorm.warning,active:!!world.sandstorm.active,strength:world.sandstorm.strength||0}:null};
}
function validEvent(e,site){
  return e===null||e&&Object.hasOwn(MAP_EVENTS,e.id)&&e.id===site.event&&finite(e.elapsed,0,1e7)&&finite(e.progress,0,100)&&integer(e.wave,100)&&finite(e.lastWarning,-1,1e7)
    &&['done','blocked','flooded','awaiting','trial'].every(k=>bool(e[k]))&&[null,'shortcut','treasure'].includes(e.choice);
}
const ids=v=>Array.isArray(v)&&v.length<=16&&v.every(id=>integer(id,1e9))&&new Set(v).size===v.length;
function validState(world,data,p){
  const half=(world.half||140)+10;
  if(!data||data.v!==1||data.layout!==p.layout)return false;
  if(!Array.isArray(data.removed)||data.removed.length>p.obstacles.length||!data.removed.every(i=>integer(i,p.obstacles.length))||new Set(data.removed).size!==data.removed.length)return false;
  if(!Array.isArray(data.logs)||data.logs.length>p.breakables.length*5||!data.logs.every(a=>list(a,6)&&integer(a[0],p.breakables.length)&&finite(a[1],-half,half)&&finite(a[2],-half,half)&&finite(a[3],.01,2)&&finite(a[4],-100,100)&&finite(a[5],.01,100)))return false;
  const perOwner=new Map();for(const log of data.logs){perOwner.set(log[0],(perOwner.get(log[0])||0)+1);if(perOwner.get(log[0])>5)return false;}
  if(!list(data.breakables,p.breakables.length)||!data.breakables.every(a=>list(a,10)&&finite(a[0],-1e7,1000)&&BREAK_STATES.includes(a[1])&&finite(a[2],0,1e7)&&finite(a[3],-1e4,1e4)&&finite(a[4],-100,100)&&finite(a[5],.001,10)&&a.slice(6,9).every(v=>finite(v,-1e4,1e4))&&ORDERS.includes(a[9])))return false;
  for(const log of data.logs)if(p.breakables[log[0]].tactic!=='timber'||data.breakables[log[0]][1]!=='fallen')return false;
  if(!list(data.sites,p.sites.length)||!data.sites.every((s,i)=>s&&bool(s.discovered)&&bool(s.claimed)&&SITE_STATES.includes(s.state)&&finite(s.reveal,0,1)&&finite(s.timer,-1,100)&&bool(s.contested)&&validEvent(s.event,p.sites[i])&&list(s.nodes,p.sites[i].nodes?.length||0)&&s.nodes.every(n=>finite(n,0,1.2))&&ids(s.guards)&&finite(s.y,-100,100)&&finite(s.sy,.001,10)))return false;
  if(!list(data.discoveries,p.discoveries.length)||!data.discoveries.every((n,i)=>n&&['discovered','claimed','blocked','contested'].every(k=>bool(n[k]))&&finite(n.progress,0,100)&&list(n.nodes,p.discoveries[i].nodes?.length||0)&&n.nodes.every(bool)))return false;
  if(!list(data.roaming,p.roaming.length)||!data.roaming.every(s=>s&&finite(s.x,-half,half)&&finite(s.z,-half,half)&&['discovered','rewarded','growthClaimed','visible'].every(k=>bool(s[k]))&&ROAM_STATES.includes(s.state)&&finite(s.remaining,0,60)&&ids(s.members)&&finite(s.y,-100,100)&&finite(s.sy,.001,10)))return false;
  if(!list(data.regions,p.regions.length)||!data.regions.every(bool)||!Array.isArray(data.visited)||data.visited.length>5||!data.visited.every(id=>p.regions.some(r=>r.id===id))||new Set(data.visited).size!==data.visited.length)return false;
  if(data.tide!==null&&(!data.tide||!bool(data.tide.warning)||!bool(data.tide.high)||!finite(data.tide.rise,0,1)))return false;
  if(data.sandstorm!==null&&(!data.sandstorm||!bool(data.sandstorm.warning)||!bool(data.sandstorm.active)||!finite(data.sandstorm.strength,0,1)))return false;
  return true;
}
function applyCollisions(world,data,p){
  const key=JSON.stringify([data.removed,data.logs]);if(key===p.collisionKey)return;
  p.collisionKey=key;const removed=new Set(data.removed),breakables=new Set(p.breakables),hidden=new Set();
  for(const i of removed){const o=p.obstacles[i];if(o.mesh&&!breakables.has(o)){o.mesh.visible=false;hidden.add(i);}}
  for(const i of p.hidden)if(!hidden.has(i)&&p.obstacles[i].mesh)p.obstacles[i].mesh.visible=true;p.hidden=hidden;
  const logs=data.logs.map(([ownerIndex,x,z,r,y,height])=>({x,z,r,y,height,sceneryHeight:height,owner:p.breakables[ownerIndex],mesh:p.breakables[ownerIndex].mesh}));
  world.obstacles=p.obstacles.filter((_,i)=>!removed.has(i)).concat(logs);
  for(const [i,s]of p.sites.entries())if(p.gates[i].length)s.gates=p.gates[i].filter(g=>!removed.has(p.ids.get(g)));
  for(const [i,r]of p.regions.entries())r.obstacles=p.regionObstacles[i].filter(o=>!removed.has(p.ids.get(o))).concat(logs.filter(o=>r.breakables?.includes(o.owner)));
}
function climatePresentation(world){
  if(world.tide)for(const pond of world.ponds||[]){if(pond.baseRx===undefined)continue;const k=1+.19*world.tide.rise;pond.rx=pond.baseRx*k;pond.rz=pond.baseRz*k;pond.r=Math.max(pond.rx,pond.rz)*1.12;pond.mesh?.scale?.set(pond.rx,1,pond.rz);pond.bank?.scale?.set(pond.rx*1.12,1,pond.rz*1.12);}
  for(const ford of world.fords||[])if(ford.mesh)ford.mesh.scale.y=1-(world.tide?.rise||0)*.92;
  for(const r of world.regions||[]){r.tide=r.id==='coast'?world.tide:null;r.sandstorm=r.id==='sand'?world.sandstorm:null;}
}
function presentation(world,time,player){
  const p=prepareNetworkWorld(world);
  for(const [i,s]of p.sites.entries()){
    if(s.mesh)s.mesh.visible=!!s.discovered;
    if(s.trail)s.trail.visible=!!s.discovered||s.type==='relic';
    if(s.ring){s.ring.visible=!!s.discovered&&!s.claimed&&(s.state==='ready'||!!player&&Math.hypot(player.x-s.x,player.z-s.z)<11);s.ring.material.opacity=s.state==='ready'?.48:.2;}
    if(!s.discovered)continue;
    if(s.crystal){s.crystal.rotation.y=time;s.crystal.position.y=1.1+Math.sin(time*2)*.12;}
    for(const [j,n]of(s.nodes||[]).entries())if(n.mesh)n.mesh.material=n.charge>=1.2?mat(0xbcefff,true):p.nodeMaterials[i][j];
    if(s.furnace&&s.eventRun)s.furnace.scale.setScalar(s.eventRun.elapsed%6<3?.8:1.15);
    if(s.eventGlow){s.eventGlow.rotation.y=time*1.8;s.eventGlow.scale.setScalar(.9+Math.sin(time*3)*.12);s.eventGlow.material=s.eventRun?.done?mat(0xe7edb8,true):p.eventMaterials[i];}
  }
  if(p.discoveries.every(n=>Array.isArray(n.markers)))animateDiscoveries(world,time);
  for(const [i,r]of p.regions.entries())if(r.beacon)r.beacon.material=r.cleared?mat(0x89b59b,true):p.beaconMaterials[i];
  for(const vent of world.patches||[]){if(vent.kind!=='vent'||!vent.marker)continue;const phase=(time+vent.phase)%4,warning=phase>=2&&phase<3.25,active=phase>=3.25&&phase<3.85;vent.marker.visible=warning||active;vent.marker.material.color.set(active?0xff603c:0xffc16d);vent.marker.material.opacity=active?.8:.58;}
  climatePresentation(world);
}

/** Reject a malformed snapshot as a whole, without partial scene mutation. */
export function applyWorldState(world,data,{time=0,player=null}={}){
  const p=prepareNetworkWorld(world);if(!validState(world,data,p))return false;
  applyCollisions(world,data,p);
  for(const [i,a]of data.breakables.entries()){
    const o=p.breakables[i];[o.hp,o.state,o.age,o.angle]=a;
    if(o.mesh){o.mesh.position.y=a[4];o.mesh.scale.y=a[5];o.mesh.rotation.set(a[6],a[7],a[8],a[9]);}
  }
  for(const [i,s]of data.sites.entries()){
    const target=p.sites[i];for(const key of['discovered','claimed','state','reveal','timer','contested'])target[key]=s[key];
    target.eventRun=s.event?eventState(s.event):null;target.guards=s.guards.map(id=>({id,alive:true}));
    s.nodes.forEach((charge,j)=>{target.nodes[j].charge=charge;});
    if(target.mesh){target.mesh.position.y=s.y;target.mesh.scale.y=s.sy;}
  }
  for(const [i,n]of data.discoveries.entries()){
    const target=p.discoveries[i];for(const key of['discovered','claimed','progress','blocked','contested'])target[key]=n[key];n.nodes.forEach((lit,j)=>{target.nodes[j].lit=lit;});
  }
  for(const [i,s]of data.roaming.entries()){
    const target=p.roaming[i];for(const key of['x','z','discovered','state','remaining','rewarded','growthClaimed'])target[key]=s[key];target.members=s.members.map(id=>({id,alive:true}));
    if(target.mesh){target.mesh.position.set(s.x,s.y,s.z);target.mesh.visible=s.visible;target.mesh.scale.y=s.sy;}
  }
  data.regions.forEach((cleared,i)=>{p.regions[i].cleared=cleared;});if(p.regions.length){world.visited??=new Set();world.visited.clear();for(const id of data.visited)world.visited.add(id);}
  world.tide=data.tide?{warning:data.tide.warning,high:data.tide.high,rise:data.tide.rise,label:data.tide.warning?'涨潮将至':data.tide.high?'涨潮 · 水流减速，沿栈桥通行':'退潮 · 探索滩地'}:null;
  world.sandstorm=data.sandstorm?{warning:data.sandstorm.warning,active:data.sandstorm.active,strength:data.sandstorm.strength,label:data.sandstorm.warning?'沙暴将至 · 离开深色流沙':data.sandstorm.active?'沙暴 · 流沙更黏滞，踏石路通行':'风息 · 可以挖掘古匣'}:null;
  presentation(world,finite(time,0,1e7)?time:0,player);return true;
}
export function createWorldReplica(world,{player=()=>null,time=()=>0,onChange=()=>{}}={}){
  prepareNetworkWorld(world);let disposed=false;
  return{capture:()=>disposed?null:captureWorldState(world),apply(data){if(disposed)return false;const result=applyWorldState(world,data,{player:player(),time:time()});if(result)onChange();return result;},
    update(at=time()){if(!disposed&&finite(at,0,1e7))presentation(world,at,player());},dispose(){disposed=true;worlds.delete(world);}};
}
