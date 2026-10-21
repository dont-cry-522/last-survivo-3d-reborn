import{herbalContact,herbalFront}from'./herbal-weapons.js?v=230';

// Shared by rules, attack scheduling and animation. These are game-time values.
export const WINDBOW=Object.freeze({rate:.7,damage:52,range:15,speed:30,hitRadius:.085,recovery:1.30,release:.42});
export const RESONATOR=Object.freeze({rate:1.05,damage:24,range:6,speed:13,hitRadius:.10,wave:true,arc:.56,echoScale:.42,echoDelay:.34,recovery:.72,release:.32,maxWaves:6});
export function minstrelDelay(w){
 const config=w.id==='windbow'?WINDBOW:RESONATOR;
 return Math.min(config.recovery,.9/w.rate)*config.release;
}

// Apply only this weapon's route. Generic power/haste and hero skills stay in
// their existing owners; callers pass the already validated path and rank.
export function minstrelWeaponStats(w){
 const r=Math.max(0,Math.min(3,w.pathRank||0));
 if(w.id==='windbow'){
  w.hitRadius=WINDBOW.hitRadius;
  if(r&&w.pathId==='windbow_pierce'){w.pierce=1+r;w.damage*=1+.12*r;w.range+=.5*r;}
  if(r&&w.pathId==='windbow_fan'){w.count=3;w.damage*=.42+.06*r;w.range=9;w.spread=.17+.02*r;}
 }else if(w.id==='resonator'){
  w.hitRadius=RESONATOR.hitRadius;w.arc??=RESONATOR.arc;w.echoScale=RESONATOR.echoScale;w.echoDelay=RESONATOR.echoDelay;
  if(r&&w.pathId==='resonator_focus'){w.arc=.25;w.range+=.3*r;w.damage*=1+.16*r;w.echoScale+=.10*r;}
  if(r&&w.pathId==='resonator_chorus'){w.arc+=.12*r;w.range-=.15*r;w.damage*=.88;w.echoScale+=.08*r;}
 }
 return w;
}

// One outward wave, one finite delayed echo, both fixed to the release location.
// The existing contact query owns body height, ceilings, terrain and cover.
// Hit callbacks use the game's normal damage path, including PvP and rewards.
export class ResonanceWaves{
 constructor(api){this.api=api;this.waves=[];}
 clear(){this.waves.length=0;}
 cast(origin,strike){
  if(this.waves.length>=RESONATOR.maxWaves)this.waves.shift();
  const q={...strike,origin:{x:origin.x,y:origin.y,z:origin.z},w:{...strike.w},distance:0,echo:false,wait:0,hits:new Set(),visual:0};
  this.waves.push(q);return q;
 }
 update(dt){
  if(!(dt>0)||!Number.isFinite(dt)||!this.api.active())return;
  for(const q of [...this.waves]){
   let left=dt;
   // Linear sweep can consume the whole frame without frame-sized substeps.
   // At most three phases (primary, wait, echo) are visited per record.
   while(left>1e-8&&!q.done&&this.api.active()){
    if(q.wait>0){
     const used=Math.min(left,q.wait);q.wait-=used;left-=used;
     if(q.wait>1e-8)break;
     q.echo=true;q.distance=0;q.hits.clear();q.visual=0;this.api.echo?.(q);
     if(!this.api.active())break;
    }
    const remaining=Math.max(0,q.w.range-q.distance),used=Math.min(left,remaining/q.w.speed),previous=q.distance;
    q.distance=Math.min(q.w.range,q.distance+used*q.w.speed);left-=used;q.visual-=used;
    for(const e of this.api.foes()){
     if(!this.api.active())break;
     if(q.hits.has(e))continue;
     const thickness=q.w.hitRadius??RESONATOR.hitRadius,contact=herbalContact(q.origin,e,q.w,q.angle,q.pitch||0,this.api.world(),Math.max(0,previous-thickness),q.distance+thickness);
     if(contact){q.hits.add(e);this.api.hit(q,e,contact);}
    }
    if(!this.api.active())break;
    if(q.visual<=0||q.distance>=q.w.range){
     q.visual=1/30;
     this.api.draw?.(q,previous,herbalFront(q.origin,q.angle,q.pitch||0,q.distance,q.w.arc,this.api.world(),7));
    }
    if(q.distance>=q.w.range-1e-8){
     if(!q.echo&&q.w.echoScale>0)q.wait=Math.max(.001,q.w.echoDelay??RESONATOR.echoDelay);
     else q.done=true;
    }
   }
  }
  this.waves=this.waves.filter(q=>!q.done);
 }
}
