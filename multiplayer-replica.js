import {WEAPONS,WEAPON_PATHS,UPGRADES,HERO_LOADOUTS,ENEMIES} from './rules.js?v=228';
import {AIR_ENEMIES,animateAirborne} from './airborne-enemies.js?v=228';
import {BOSS_ROUTES} from './boss-roster.js?v=228';
import {PET_TIMING} from './beast-companion.js?v=228';
import {RELICS,FIELD_SUPPLIES} from './expedition.js?v=228';
import {HUNT_BOONS} from './encounters.js?v=228';
import {advanceEnemyLocomotion} from './enemy-motion.js?v=228';
import {restoreMobilityPose,applyMobilityPose,airborne} from './adventure-mobility.js?v=228';
import {snapshotValue,mergeSnapshot} from './multiplayer-state.js?v=228';

const fields=s=>Object.freeze(s.split(/\s+/));
// Shared with the host capture. Renderer objects and live combat references must
// never enter these lists: clients receive poses, not a second combat engine.
export const PLAYER_FIELDS=fields('x y z vx vz hp maxHp level xp pending attack dash dashTime dashAngle dashFacing inv hurt hexSlow networkStagger networkDead groundHeight standHeight jumpVelocity jumpRest crouch landTime angle aimAngle aimTime waterDepth waterDash waterBlend swimPhase mirageHidden distance hpTrail hpLossTime lastHpLoss xpFlash xpGain huntRush scytheCount scytheLast scytheStepUntil harpoonCount heroId weaponId weaponPath upgrades spell melee crossbowHunt crossbowMark huntBoon relic fieldSupply campRewards minstrelGuard');
export const POSE_FIELDS=fields('shoot reloadPhase reloadDuration shotSerial weaponCue aimPitch aimAngle aimActive attackAngle attackPitch harpoonCombo harpoonTarget scytheCombo scytheTarget scytheFocus herbalCombo herbalPath cancelAttack waterDepth waterBlend waterDash swimPhase dashAngle dashTime travelAngle turnRate mirageConceal companionAngle walkPhase pounce attackMode landRecover pounceMissed lookTurn bossStage bossMove windProgress strikeProgress recoverProgress lift');
export const ENEMY_FIELDS=fields('id kind x y z rotation scale hp maxHp alive size height gait speed wind hurt pounce pounceDuration landRecover recovery recover attackMode phase pose flight biome pressure boss');
export const COMPANION_FIELDS=fields('x y z angle state elapsed speed turnRate waterDepth hurt alive hp maxHp reviveLeft regenerating inv');
const enemies=new Set([...Object.keys(ENEMIES),...Object.keys(AIR_ENEMIES),...Object.values(BOSS_ROUTES).flat()]);
const upgrades=new Set(UPGRADES.map(u=>u.id));
const boolFields=new Set(['networkDead','waterDash','mirageHidden','aimActive','cancelAttack','pounceMissed','alive','visible','carried','hidden','boss','regenerating','growthClaimed']);
const textFields=new Set(['weaponCue','herbalPath','attackMode','bossStage','bossMove','state','biome']);
const zoneKinds=new Set(['poison','tide','sand','root','frost','ember','meteor','boss','hex','vent']);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e7;
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const own=(o,k)=>plain(o)?Object.getOwnPropertyDescriptor(o,k)?.value:undefined;
const idValid=id=>typeof id==='string'?id.length>0&&id.length<=80:typeof id==='number'&&Number.isSafeInteger(id)&&id>=0;
const point=o=>finite(own(o,'x'))&&finite(own(o,'z'));
const numeric=(o,keys)=>{const result={};for(const key of keys){const v=own(o,key);if(finite(v))result[key]=v;}return result;};
function pick(o,keys){
 const result={};for(const key of keys){const value=own(o,key);
  if(boolFields.has(key)){if(typeof value==='boolean')result[key]=value;}
  else if(textFields.has(key)){if(typeof value==='string')result[key]=value.slice(0,48);}
  else if(finite(value))result[key]=value;
 }
 return result;
}
function poseValue(o){
 const result=pick(o,POSE_FIELDS);
 for(const key of ['harpoonTarget','scytheTarget']){const p=own(o,key);if(p===null)result[key]=null;else if(point(p))result[key]=numeric(p,['x','y','z']);}
 // A null travel/aim angle explicitly releases the previous packet's pose.
 for(const key of ['travelAngle','aimAngle'])if(own(o,key)===null)result[key]=null;
 return result;
}
function playerValue(o){
 if(!point(o))return null;const p=pick(o,PLAYER_FIELDS);
 for(const key of ['heroId','weaponId']){const id=own(o,key);if(Object.hasOwn(key==='heroId'?HERO_LOADOUTS:WEAPONS,id||''))p[key]=id;}
 const path=own(o,'weaponPath');if(path===null)p.weaponPath=null;
 else if(plain(path)&&WEAPON_PATHS[own(path,'id')]?.weapon===p.weaponId&&finite(own(path,'rank')))p.weaponPath={id:own(path,'id'),rank:clamp(Math.floor(own(path,'rank')),1,3)};
 const ranks=own(o,'upgrades');if(plain(ranks)){p.upgrades={};for(const key of upgrades)if(finite(own(ranks,key)))p.upgrades[key]=clamp(Math.floor(own(ranks,key)),0,10);}
 const spell=own(o,'spell');if(plain(spell))p.spell=numeric(spell,['fire','ice','storm','veil','chain','rift']);
 for(const [key,keys]of [['melee',['angle','pitch','elapsed','duration','combo','x','y','z']],['crossbowHunt',['until','distance']],['crossbowMark',['time','hits']]]){
  const value=own(o,key);if(value===null)p[key]=null;else if(plain(value))p[key]=numeric(value,keys);
 }
 for(const [key,catalog]of [['relic',RELICS],['fieldSupply',FIELD_SUPPLIES]]){
  const value=own(o,key),id=own(value,'id');if(value===null)p[key]=null;else if(Object.hasOwn(catalog,id||''))p[key]={id,...numeric(value,['charges','until','shots','kills','rank'])};
 }
 const boon=own(o,'huntBoon');if(boon===null)p.huntBoon=null;else if(Object.hasOwn(HUNT_BOONS,boon||''))p.huntBoon=boon;
 const rewards=own(o,'campRewards');if(Array.isArray(rewards))p.campRewards=rewards.slice(0,16).filter(plain).map(r=>({...pick(r,['x','z','growthClaimed']),...(idValid(own(r,'id'))?{id:own(r,'id')}:{})}));
 return p;
}
function visualCombat(o,mirage=false){
 if(!plain(o))return null;
 const c={now:finite(own(o,'now'))?own(o,'now'):0,clouds:[],shield:numeric(own(o,'shield'),['amount','until'])};
 for(const cloud of Array.isArray(own(o,'clouds'))?own(o,'clouds').slice(0,3):[]){
  if(!point(cloud)||!finite(own(cloud,'r'))||own(cloud,'r')<=0)continue;
  const q=pick(cloud,['x','z','r','born','expires','settledAt','stillRank','curtainUntil','angle','carried','lureRank']);q.id=idValid(own(cloud,'id'))?phaseId(own(cloud,'id')):c.clouds.length;
  q.born??=c.now;q.settledAt??=q.born;
  q.r=clamp(q.r,.01,40);c.clouds.push(q);
 }
 if(mirage){
  c.hidden=own(o,'hidden')===true;const d=own(o,'decoy');c.decoy=point(d)?pick(d,['x','z','hp','expires','born','angle','alive']):null;
  if(c.decoy)c.decoy.id=idValid(own(d,'id'))?own(d,'id'):0;
 }else{
  c.bands=[];c.pods=[];
  for(const band of Array.isArray(own(o,'bands'))?own(o,'bands').slice(0,2):[]){
   const points=own(band,'points');if(!Array.isArray(points))continue;
   const row={...numeric(band,['r','expires']),points:points.slice(0,128).filter(point).map(p=>numeric(p,['x','z']))};if(row.r!==undefined)row.r=clamp(row.r,.01,40);c.bands.push(row);
  }
  for(const pod of Array.isArray(own(o,'pods'))?own(o,'pods').slice(0,3):[]){if(point(pod)&&finite(own(pod,'startX'))&&finite(own(pod,'startZ'))&&finite(own(pod,'releaseAt'))&&finite(own(pod,'landAt'))&&own(pod,'landAt')>own(pod,'releaseAt'))c.pods.push(numeric(pod,['startX','startY','startZ','x','z','releaseAt','landAt']));}
 }
 return c;
}
function enemyValue(o){
 if(!idValid(own(o,'id'))||!enemies.has(own(o,'kind'))||!point(o))return null;
 const e=pick(o,ENEMY_FIELDS);e.id=own(o,'id');e.kind=own(o,'kind');e.pose=poseValue(own(o,'pose'));e.rotation=finite(e.rotation)?e.rotation:0;
 const scale=own(o,'scale');if(Array.isArray(scale)&&scale.length===3&&scale.every(finite))e.scale=scale.map(n=>clamp(n,.01,20));else if(finite(scale))e.scale=clamp(scale,.01,20);
 const flight=own(o,'flight');if(plain(flight)){const stage=own(flight,'stage');e.flight={stage:['orbit','wind','strike','recover'].includes(stage)?stage:'orbit',...numeric(flight,['timer'])};}
 return e;
}
function arrayValue(packet,key,limit,sanitize){
 const rows=own(packet,key);if(!Array.isArray(rows))return null;const ids=new Set(),result=[];
 for(const row of rows.slice(0,limit)){const value=sanitize(row);if(value&&!ids.has(String(value.id))){ids.add(String(value.id));result.push(value);}}
 return result;
}
function bulletValue(o){
 const id=own(o,'id'),kind=own(o,'kind');if(!idValid(id)||!Object.hasOwn(WEAPONS,kind||'')||!point(o))return null;
 const b={...pick(o,['x','y','z','visible','vx','vz','elapsed']),id,kind,ownerId:idValid(own(o,'ownerId'))?own(o,'ownerId'):null};
 const w=own(o,'w'),path=own(w,'pathId');b.w={...WEAPONS[kind],...numeric(w,['count','color']),id:kind};
 if(WEAPON_PATHS[path]?.weapon===kind){b.w.pathId=path;b.w.pathRank=finite(own(w,'pathRank'))?clamp(Math.floor(own(w,'pathRank')),0,3):0;}
 const scale=own(o,'scale');if(Array.isArray(scale)&&scale.length===3&&scale.every(finite))b.scale=scale.map(n=>clamp(n,.01,20));
 const rotation=own(o,'rotation');b.rotation=Array.isArray(rotation)&&rotation.length===3&&rotation.every(finite)?rotation.slice():[0,0,0];return b;
}
export function sanitizeRoomSnapshot(packet){
 if(!plain(packet)||!finite(own(packet,'time'))||own(packet,'time')<0)return null;
 const players=arrayValue(packet,'players',4,o=>{
  const id=own(o,'id'),player=playerValue(own(o,'player'));if(!idValid(id)||!player)return null;
  const companion=own(o,'companion');return{id,player,pose:poseValue(own(o,'pose')),rotation:finite(own(o,'rotation'))?own(o,'rotation'):0,...numeric(o,['skillClock','primeUntil']),
   poison:visualCombat(own(o,'poison')),mirage:visualCombat(own(o,'mirage'),true),
   companion:point(companion)?pick(companion,COMPANION_FIELDS):null};
 });
 const creatures=arrayValue(packet,'enemies',128,enemyValue),bullets=arrayValue(packet,'bullets',256,bulletValue);
 const orbs=arrayValue(packet,'orbs',256,o=>idValid(own(o,'id'))&&point(o)?{id:own(o,'id'),...numeric(o,['x','z','xp'])}:null);
 const zones=arrayValue(packet,'zones',256,o=>idValid(own(o,'id'))&&point(o)&&zoneKinds.has(own(o,'kind'))&&finite(own(o,'r'))&&own(o,'r')>0?{...pick(o,['x','z','r','delay','life','opacity','color','visible']),id:own(o,'id'),kind:own(o,'kind'),r:clamp(own(o,'r'),.01,80)}:null);
 if(!players||!creatures||!bullets||!orbs||!zones)return null;
 return{time:own(packet,'time'),players,enemies:creatures,boss:enemyValue(own(packet,'boss')),bullets,orbs,zones,world:snapshotValue(own(packet,'world'))||{}};
}

const angleLerp=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const phaseId=id=>typeof id==='number'?id:[...String(id)].reduce((v,c)=>(v*31+c.charCodeAt(0))%997,0);
// Models/materials come from the same factories as the host. The replica owns
// roots it creates, never the shared factories' geometry/material caches.
export class RoomReplica{
 constructor(io){
  this.io=io;this.owners=new Map();this.players=new Map();this.enemies=new Map();this.bullets=new Map();this.orbs=new Map();this.zones=new Map();this.aux=new Map();this.lastTime=-1;this.state=null;
 }
 setOwners(owners){if(!(owners instanceof Map))throw new TypeError('Replica owners must be a Map');this.owners=owners;}
 owner(id){return this.owners.get(id)||this.owners.get(String(id));}
 // Presentation only: the owner player remains the latest authoritative state.
 playerPosition(id){const record=this.players.get(String(id));return record?.ready&&record.mesh===this.owner(id)?.hero?record.mesh.position:null;}
 ground(x,z){const y=this.io.groundHeight?.(x,z);return finite(y)?y:0;}
 target(record,data,duration){
  const p=record.mesh.position;record.from={x:p.x,y:p.y,z:p.z,rotation:record.mesh.rotation.y};
  record.to={x:data.x,y:finite(data.y)?data.y:this.ground(data.x,data.z),z:data.z,rotation:finite(data.rotation)?data.rotation:0};record.data=data;record.elapsed=0;record.duration=duration;
  if(!record.ready){p.set(record.to.x,record.to.y,record.to.z);record.mesh.rotation.y=record.to.rotation;record.from={...record.to};record.ready=true;}
 }
 motion(record,dt){
  record.elapsed+=dt;const t=clamp(record.elapsed/record.duration,0,1),a=record.from,b=record.to,p=record.mesh.position,oldX=p.x,oldZ=p.z;
  p.set(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);record.mesh.rotation.y=angleLerp(a.rotation,b.rotation,t);
  return Math.hypot(p.x-oldX,p.z-oldZ);
 }
 remove(map,id,type){
  const record=map.get(id);if(!record)return;this.io.scene.remove(record.mesh);
  if(type==='zone')this.io.disposeCue?.(record.mesh);else if(type==='enemy')this.io.disposeHero?.(record.mesh);
  map.delete(id);
 }
 sync(map,rows,create,type,duration){
  const present=new Set();for(const data of rows){const id=String(data.id);present.add(id);let record=map.get(id);
   if(record&&record.data.kind!==data.kind){this.remove(map,id,type);record=null;}
   if(!record){const model=create(data);if(!model)continue;record={mesh:model,baseScale:[model.scale.x,model.scale.y,model.scale.z]};map.set(id,record);this.io.scene.add(model);}
   this.target(record,data,duration);
  }
  for(const id of map.keys())if(!present.has(id))this.remove(map,id,type);
 }
 apply(packet){
  const state=sanitizeRoomSnapshot(packet);if(!state||state.time<this.lastTime)return null;
  const duration=this.lastTime<0?.05:clamp(state.time-this.lastTime,.02,.25);this.lastTime=state.time;this.state=state;this.visualTime=Math.max(this.visualTime??state.time,state.time);
  const present=new Set();for(const row of state.players){const owner=this.owner(row.id);if(!owner?.hero||!owner.player)continue;
   const id=String(row.id);present.add(id);let record=this.players.get(id);
   if(!record||record.mesh!==owner.hero){record={mesh:owner.hero};this.players.set(id,record);}
   // The room roster chooses character/weapon. A packet cannot swap models or
   // overwrite bones, mixers, owned materials, target references or callbacks.
   const data={...row.player};if(data.heroId!==owner.heroId)delete data.heroId;if(data.weaponId&&owner.player.weaponId&&data.weaponId!==owner.player.weaponId)delete data.weaponId;
   // Respawn and the two native blink dodges are discontinuities, not travel
   // across the intervening map. Ordinary rolls still use continuous poses.
   const respawn=record.row&&(record.row.player.networkDead||record.row.player.hp<=0)&&row.player.hp>0&&!row.player.networkDead;
   const blink=record.row&&['silver','wraith'].includes(owner.heroId)&&row.player.dash>(record.row.player.dash||0)+.1;
   if(!record.ready||respawn||blink){record.ready=false;if(owner.adventureCamera)owner.adventureCamera._ready=false;}
   mergeSnapshot(owner.player,data,PLAYER_FIELDS);mergeSnapshot(owner.hero.userData,row.pose,POSE_FIELDS);
   this.target(record,{...row.player,rotation:row.rotation},duration);record.row=row;
   if(row.companion){if(owner.companion)mergeSnapshot(owner.companion,row.companion,COMPANION_FIELDS);const aux=this.auxFor(id),pet=owner.companionMesh||(aux.companionMesh??=this.makeCompanion());if(pet){if(!record.pet||record.pet.mesh!==pet)record.pet={mesh:pet};this.target(record.pet,{...row.companion,rotation:row.companion.angle},duration);}}
   else if(record.pet)record.pet.mesh.visible=false;
  }
  for(const [id,record]of this.players)if(!present.has(id)){record.mesh.visible=false;if(record.pet)record.pet.mesh.visible=false;this.players.delete(id);this.disposeAux(id);}
  this.sync(this.enemies,[...state.enemies,...(state.boss?[state.boss]:[])],d=>AIR_ENEMIES[d.kind]?this.io.makeAirborne(d.kind):this.io.makeActor(d.kind),'enemy',duration);
  this.sync(this.bullets,state.bullets,d=>{
   if(d.kind!=='briarpot')return this.io.vfx.projectile(d.w);
   // The native BriarPods system owns its seed outside the bullets array.
   // Reuse its exact seed appearance, including the planted growth scale.
   const model=this.io.mesh('IcosahedronGeometry',[.15,1],0xb99867,d.x,d.y,d.z);model.name='SM_Weapon_BriarSeed_Flight';return model;
  },'bullet',duration);
  this.sync(this.orbs,state.orbs,d=>{const m=this.io.mesh('OctahedronGeometry',[.22],0x76f0ef,d.x,this.ground(d.x,d.z)+.35,d.z,null,true);if(this.io.glow)m.add(this.io.glow(0x61e6ed,2.2));return m;},'orb',duration);
  this.sync(this.zones,state.zones,d=>this.io.groundCue(d.color??0xee9be4,d.r,d.kind==='meteor'?'glow':'danger',d.opacity??.58),'zone',duration);
  for(const record of this.zones.values()){const d=record.data,m=record.mesh;m.position.set(d.x,.09,d.z);m.scale.set(d.r,d.r,1);m.visible=d.visible!==false;if(m.material&&finite(d.opacity))m.material.opacity=clamp(d.opacity,0,1);this.io.fitGroundCue?.(m,this.io.groundHeight);}
  return state;
 }
 auxFor(id){let aux=this.aux.get(id);if(!aux){aux={};this.aux.set(id,aux);}return aux;}
 makeCompanion(){const pet=this.io.makeBadger?.();if(pet)this.io.scene.add(pet);return pet;}
 visualCombat(owner,id,key,value){
  const aux=this.auxFor(id),Factory=key==='poisonVFX'?this.io.PoisonVFX:this.io.MirageVFX;
  const fx=owner[key]||aux[key]||(value&&Factory?(aux[key]=new Factory(this.io.scene,this.io.vfx,{groundHeight:this.io.groundHeight})):null);
  if(fx)fx.update(value?{...value,now:value.now+Math.max(0,this.visualTime-this.lastTime)}:null,owner.player,owner.hero);
 }
 update(dt,time=this.lastTime){
  if(!this.state)return;dt=finite(dt)?clamp(dt,0,.1):0;
  // Simulation time arrives at 15 Hz. Interpolate presentation at render rate
  // so skeleton mixers do not freeze between packets. Never advance gameplay,
  // and freeze after a short missing-packet grace period or an explicit pause.
  this.visualTime=Math.min(this.lastTime+.12,this.visualTime+dt);time=this.visualTime;
  for(const [id,record]of this.players){const owner=this.owner(record.row.id);if(!owner?.hero||owner.hero!==record.mesh)continue;
   const p=owner.player,d=record.mesh.userData;this.motion(record,dt);
   const pose=record.row.pose,lead=Math.max(0,this.visualTime-this.lastTime);
   if(finite(pose.shoot))d.shoot=Math.max(0,pose.shoot-lead);
   if(finite(pose.reloadPhase)&&pose.reloadDuration>0)d.reloadPhase=clamp(pose.reloadPhase+lead/pose.reloadDuration,0,1);
   record.mesh.visible=!p.networkDead&&p.hp>0;
   restoreMobilityPose(record.mesh);this.io.animateActor(record.mesh,time,airborne(p)?0:Math.hypot(p.vx||0,p.vz||0),d.shoot||0,p.hurt||0);applyMobilityPose(record.mesh,p);
   // Native skinned animation restores visibility for hit blinking and diving.
   // A network-dead owner must stay hidden after that animation has run.
   if(p.networkDead||!(p.hp>0))record.mesh.visible=false;
   this.visualCombat(owner,id,'poisonVFX',record.row.poison);this.visualCombat(owner,id,'mirageVFX',record.row.mirage);
   const pet=record.pet,c=record.row.companion;if(pet&&c){this.motion(pet,dt);pet.mesh.visible=c.alive!==false?!(c.hurt>0&&Math.floor(c.hurt*25)%2):(c.elapsed||0)<1.2;pet.mesh.userData.waterDepth=c.waterDepth||0;pet.mesh.userData.hurt=c.hurt||0;this.io.animateBadger?.(pet.mesh,time,c.speed||0,c.state||'sniff',clamp((c.elapsed||0)/(PET_TIMING[c.state]||1),0,1),c.turnRate||0);}
  }
  for(const record of this.enemies.values()){
   const e=record.data,m=record.mesh,d=m.userData,distance=this.motion(record,dt);mergeSnapshot(d,e.pose,POSE_FIELDS);
   m.visible=e.alive!==false&&e.hp!==0;const scale=Array.isArray(e.scale)?e.scale:finite(e.scale)?[e.scale,e.scale,e.scale]:record.baseScale;m.scale.set(...scale);
   if(AIR_ENEMIES[e.kind]){(this.io.animateAirborne||animateAirborne)({...e,id:phaseId(e.id),mesh:m},time);continue;}
   if(e.pose.walkPhase===undefined)d.walkPhase=e.gait||0;if(e.pose.pounce===undefined)d.pounce=e.pounce>0?e.pounce/Math.max(.01,e.pounceDuration||1):0;
   d.attackMode=e.attackMode??d.attackMode;d.landRecover=e.landRecover||0;
   advanceEnemyLocomotion(d,dt,distance,distance>0);this.io.animateActor(m,e.boss?time:time+phaseId(e.id),dt>0?distance/dt:0,e.wind||0,e.hurt||0);
  }
  for(const record of this.bullets.values()){
   this.motion(record,dt);const b=record.data,m=record.mesh;m.rotation.set(...b.rotation);m.visible=b.visible!==false;if(b.scale)m.scale.set(...b.scale);
   const dx=record.to.x-record.from.x,dz=record.to.z-record.from.z;
   const visual=record.flight??={trail:0};Object.assign(visual,{mesh:m,kind:b.kind,x:m.position.x,z:m.position.z,height:m.position.y,vx:dx/record.duration,vz:dz/record.duration,pathId:b.w.pathId,elapsed:b.elapsed||time});
   if(m.visible&&b.kind!=='briarpot')this.io.vfx.flight?.(visual,dt);
  }
  for(const record of this.orbs.values()){this.motion(record,dt);record.mesh.position.y=this.ground(record.mesh.position.x,record.mesh.position.z)+.35+Math.sin(time*3+phaseId(record.data.id))*.06;record.mesh.rotation.y=time*1.4;}
 }
 disposeAux(id){const aux=this.aux.get(id);if(!aux)return;for(const key of ['poisonVFX','mirageVFX'])aux[key]?.dispose();if(aux.companionMesh){this.io.scene.remove(aux.companionMesh);this.io.disposeHero?.(aux.companionMesh);}this.aux.delete(id);}
 clear(){
  for(const [map,type]of [[this.enemies,'enemy'],[this.bullets,'bullet'],[this.orbs,'orb'],[this.zones,'zone']])for(const id of map.keys())this.remove(map,id,type);
  for(const id of this.aux.keys())this.disposeAux(id);this.players.clear();this.state=null;this.lastTime=-1;this.visualTime=undefined;
 }
}
