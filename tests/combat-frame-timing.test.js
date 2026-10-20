import test from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import * as T from'../vendor/three.module.js';
import{weaponStats,segmentDistance}from'../rules.js';
import{shotInterval}from'../gun-handling.js';

// Execute the production cooldown/trigger/shot-initialization code. Only the
// subsequent projectile/graphics adapters are excluded from this timing test.
const main=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const shotStart=main.indexOf('function shoot('),shotEnd=main.indexOf('player.weaponCue=0;',shotStart)+'player.weaponCue=0;'.length;
assert(shotStart>0&&shotEnd>shotStart,'shot initialization boundary changed');
const shotSetup=main.slice(shotStart,shotEnd)+'}',cooldown=main.match(/const attackOverrun=[^;]+;player\.attack=Math\.max\(0,player\.attack-dt\);/)?.[0];
const fireGate=main.match(/if\([^\n]*?\)shoot\(dt,attackOverrun\);/)?.[0];
assert(cooldown&&fireGate,'production attack timing boundary changed');
const targetsCode=main.slice(main.indexOf('function combatTargets('),main.indexOf('function aliveRoomOwners('));
const victimsCode=main.slice(main.indexOf('function forRoomVictims('),main.indexOf('function updateRemoteCamera('));
const stepAttack=new Function('context','dt','with(context){'+targetsCode+shotSetup+cooldown+fireGate+'}');
const noop=()=>{};
function attackContext(weaponId,extra={}){
 return{player:{weaponId,attack:0,dashTime:0,upgrades:{},...extra},hero:{userData:{}},aimInput:{angle:0,held:true},
  attackMode:'manual',aligned:true,autoTarget:{},touch:false,mirage:{hidden:false,modifyShot:w=>w},
  heroSkills:{prepareShot:w=>w},
  enemies:[],boss:null,companion:null,roomSession:null,roomOwner:null,state:'playing',time:0,weaponStats,shotInterval,
  visibleEnemy:()=>true,relicEvent:()=>null,applyFieldShot:noop,impactChips:noop};
}
function advanceShots(c,fps,seconds){for(let i=0;i<Math.round(fps*seconds);i++){c.time+=1/fps;stepAttack(c,1/fps);}}

test('real short-bow, rifle and sling firing rates stay consistent at 30/60/high-refresh updates',()=>{
 for(const weaponId of['crossbow','rifle','boomerang','windbow','resonator']){
  const counts=[];
  for(const fps of[30,60,90,120,144,179]){
   const c=attackContext(weaponId),w=weaponStats(c.player),damage=w.damage;advanceShots(c,fps,60);
   counts.push(c.hero.userData.shotSerial);
   assert(Math.abs(c.hero.userData.shotSerial-w.rate*60)<=1,`${weaponId} at ${fps}: ${c.hero.userData.shotSerial}`);
   assert.equal(c.hero.userData.reloadDuration,1/w.rate);assert.equal(c.player.aimTime,1/w.rate+.16);
   assert.equal(weaponStats(c.player).damage,damage,'timing must not change authored damage');
  }
  assert(Math.max(...counts)-Math.min(...counts)<=1,weaponId+' changes firing rate with display cadence');
 }
});

test('rapid-rifle chamber sequence keeps the same average firing rate and full animation intervals',()=>{
 const counts=[];
 for(const fps of[30,60,179]){
  const c=attackContext('rifle',{weaponPath:{id:'rifle_rapid',rank:3},upgrades:{haste:3}}),w=weaponStats(c.player);
  advanceShots(c,fps,60);counts.push(c.hero.userData.shotSerial);
  assert(Math.abs(c.hero.userData.shotSerial-w.rate*60)<=2);
  assert.equal(c.hero.userData.reloadDuration,(c.player.rifleBurst===0?2:.5)/w.rate);
 }
 assert(Math.max(...counts)-Math.min(...counts)<=1);
});

test('releasing attack, losing a target or dodging cannot bank expired cooldown for catch-up shots',()=>{
 const interruptions=[
  [c=>c.aimInput.held=false,c=>c.aimInput.held=true],
  [c=>{c.attackMode='auto';c.autoTarget=null;},c=>c.autoTarget={}],
  [c=>c.player.dashTime=1,c=>c.player.dashTime=0],
  [c=>c.mirage.hidden=true,c=>c.mirage.hidden=false]
 ];
 for(const fps of[30,60,179])for(const[stop,resume]of interruptions){
  const c=attackContext('crossbow'),interval=1/weaponStats(c.player).rate;
  stepAttack(c,1/fps);assert.equal(c.hero.userData.shotSerial,1);
  stop(c);advanceShots(c,fps,3);assert.equal(c.hero.userData.shotSerial,1);
  resume(c);stepAttack(c,1/fps);assert.equal(c.hero.userData.shotSerial,2);
  assert.equal(c.player.attack,interval,'first new shot starts a full cooldown after interruption');
  assert.equal(c.hero.userData.reloadDuration,interval);
  advanceShots(c,fps,.25);assert.equal(c.hero.userData.shotSerial,2,'no delayed catch-up volley');
 }
});

test('cooldown overrun only shortens the next deadline, not the authored reload or aim duration',()=>{
 const c=attackContext('crossbow'),interval=1/weaponStats(c.player).rate;
 c.player.attack=.01;stepAttack(c,1/30);
 assert(Math.abs(c.player.attack-(interval+.01-1/30))<1e-12);
 assert.equal(c.hero.userData.reloadDuration,interval);assert.equal(c.player.aimTime,interval+.16);
 assert.equal(c.hero.userData.shotSerial,1);
});

const pounceStart=main.indexOf('function lungeEase('),pounceEnd=main.indexOf('// Footfall feedback',pounceStart);
assert(pounceStart>0&&pounceEnd>pounceStart,'production pounce boundary changed');
const stepPounce=new Function('context','e','dt','with(context){'+victimsCode+main.slice(pounceStart,pounceEnd)+'return enemyPounce(e,dt);}');
function pounceContext(speed=1){
 const c={T,world:{},terrainAt:()=>({speed}),moveActor:(_world,e,dx,dz)=>{e.x+=dx;e.z+=dz;},
  mirage:{},companion:null,roomSession:null,player:{x:100,z:100},segmentDistance,hits:0,
  ENEMY_MOTION:{wolf:{recover:.3},mushroom:{recover:.3}},enemyRecovery:(_e,recover)=>recover,
  enemySound:noop,addZone:noop,impactChips:noop};
 c.hitPlayer=()=>{c.hits++;return true;};return c;
}
function pouncingEnemy(role='wolf'){
 const duration=role==='wolf'?.24:.22;
 return{x:0,z:0,role,kind:role,size:.6,pounceDuration:duration,pounce:duration,attackAngle:0,damage:10,mesh:{userData:{appearance:true}}};
}

test('production pounces preserve authored total distance even when their last frame is partial',()=>{
 for(const role of['wolf','mushroom'])for(const fps of[30,60,90,120,144,179])for(const speed of[1,.7]){
  const c=pounceContext(speed),e=pouncingEnemy(role),distance=(role==='wolf'?14:10)*e.pounceDuration*speed;
  for(let i=0;i<100&&e.pounce>0;i++)stepPounce(c,e,1/fps);
  assert.equal(e.pounce,0);assert.equal(e.landed,true);assert.equal(e.landRecover,.3);
  assert(Math.abs(e.z-distance)<1e-10,`${role} ${fps} Hz: ${e.z} instead of ${distance}`);
 }
});

test('pounce segment hits remain single-hit and a long final frame cannot overshoot',()=>{
 for(const fps of[30,60,179]){
  const c=pounceContext(),e=pouncingEnemy();c.player={x:0,z:1};
  while(e.pounce>0)stepPounce(c,e,1/fps);
  assert.equal(c.hits,1);assert.equal(e.hit,true);
 }
 const c=pounceContext(),e=pouncingEnemy();stepPounce(c,e,.04);stepPounce(c,e,1);
 assert(Math.abs(e.z-14*.24)<1e-10);assert.equal(e.pounce,0);
});

test('visibility resets pacing on both sides even when hidden tabs stop RAF entirely',()=>{
 const callback=main.match(/document\.addEventListener\('visibilitychange',(\(\)=>\{[^\n]*?\})\);/)?.[1];
 assert(callback,'visibility handler boundary changed');
 const c={document:{hidden:true},state:'menu',performance:{now:()=>123},resets:[],pauses:0};
 c.framePacer={reset:now=>c.resets.push(now)};c.pause=()=>c.pauses++;
 const changed=new Function('context','with(context){return '+callback+';}')(c);
 changed();c.document.hidden=false;changed();assert.deepEqual(c.resets,[123,123]);assert.equal(c.pauses,0);
 c.state='playing';c.document.hidden=true;changed();assert.equal(c.pauses,1);assert.equal(c.resets.length,3);
});

test('pause/resume and finished preparation restart the actual pacing clock',()=>{
 const pause=main.match(/^function pause\(\)[^\n]+/m)?.[0],resume=main.match(/^function resume\(\)[^\n]+/m)?.[0];
 const start=main.indexOf('function unlockPreparation(){'),end=main.indexOf('async function warmCurrentScene',start);
 assert(pause&&resume&&start>0&&end>start,'lifecycle boundary changed');
 const c={state:'playing',roomSession:null,preparing:true,last:0,keys:new Set(),performance:{now:()=>456},resets:[],
  sound:{stopWeapons:noop,stopCreatures:noop},releaseStick:noop,clearAttack:noop,showPauseDialog:noop,
  restorePauseControls:noop,syncViewUI:noop,unlockAudio:noop,$:()=>({close:noop}),
  loadingScreen:{hide:noop},renderBudget:{reset:noop}};
 c.framePacer={reset:now=>c.resets.push(now)};
 const actions=new Function('context','with(context){'+pause+resume+main.slice(start,end)+'return {pause,resume,unlockPreparation};}')(c);
 actions.pause();assert.equal(c.state,'paused');actions.resume();assert.equal(c.state,'playing');
 actions.unlockPreparation();assert.equal(c.preparing,false);assert.deepEqual(c.resets,[456,456,456]);
});
