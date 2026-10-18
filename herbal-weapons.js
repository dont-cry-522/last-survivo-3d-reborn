import{wildWeaponBlock}from'./wild-weapons.js?v=212';

export const MYCELIAL_WHIP={rate:1.1,damage:26,range:5.8,arc:.72,cloudDamage:10,cloudRadius:1.1,cloudDuration:3.2,recovery:.70,release:.42};
export const VENOM_FAN={rate:.95,damage:20,range:6.8,arc:.50,speed:12,needleDamage:6,needleDuration:2.6,recovery:.72,release:.32,maxWaves:6};
export const herbalDelay=w=>Math.min(w.id==='mycelialwhip'?MYCELIAL_WHIP.recovery:VENOM_FAN.recovery,.9/w.rate)*(w.id==='mycelialwhip'?MYCELIAL_WHIP.release:VENOM_FAN.release);
export function herbalPoint(origin,angle,pitch,d){return{x:origin.x+Math.sin(angle)*Math.cos(pitch)*d,y:origin.y+Math.sin(pitch)*d,z:origin.z+Math.cos(angle)*Math.cos(pitch)*d};}

// A fan lies in the aimed plane. The target's body, not its ground shadow,
// determines its height; use the existing world's obstacle/ceiling query.
export function herbalContact(origin,e,w,angle,pitch,world,inner=0,outer=w.range){
 if(!e.alive)return null;
 const dx=e.x-origin.x,dz=e.z-origin.z,h=dx*Math.sin(angle)+dz*Math.cos(angle),side=dx*Math.cos(angle)-dz*Math.sin(angle),r=(e.size||.5)*.55;
 const y=Math.max(e.y||0,Math.min((e.y||0)+(e.height||1.4),origin.y+h*Math.tan(pitch))),dy=y-origin.y;
 const along=h*Math.cos(pitch)+dy*Math.sin(pitch),off=dy*Math.cos(pitch)-h*Math.sin(pitch),distance=Math.hypot(along,side);
 if(along<-r||Math.abs(off)>.42+r||Math.abs(Math.atan2(side,along))>w.arc+Math.asin(Math.min(1,r/Math.max(r,distance)))||distance-r>outer+1e-8||distance+r<inner-1e-8)return null;
 const contact={x:e.x,y,z:e.z};return wildWeaponBlock(origin,contact,world,.015).blocked?null:{...contact,distance};
}
export function herbalFront(origin,angle,pitch,range,arc,world,samples=13){
 const points=[];
 for(let i=0;i<samples;i++){const offset=arc*(2*i/(samples-1)-1),forward=range*Math.cos(offset),side=range*Math.sin(offset),end=herbalPoint(origin,angle,pitch,forward);end.x+=Math.cos(angle)*side;end.z-=Math.sin(angle)*side;const block=wildWeaponBlock(origin,end,world,.015);points.push({...block.point,block:block.blocked?block:null});}
 return points;
}
export function whipTipMultiplier(w,distance){return w.pathId==='mycelialwhip_tip'&&distance>=w.range*.5?1+.25*w.pathRank:1;}

// Finite game-time wave records; effects use the existing pooled renderer.
// Each body is hit once per outward/return leg, never once per frame.
export class HerbalWaves{
 constructor(api){this.api=api;this.waves=[];}
 clear(){this.waves=[];}
 cast(origin,strike){if(this.waves.length>=VENOM_FAN.maxWaves)this.waves.shift();const q={origin:{...origin},...strike,w:{...strike.w},distance:0,returning:false,hits:new Set(),visual:0};this.waves.push(q);return q;}
 update(dt){
  if(!(dt>0)||!this.api.active())return;
  for(const q of this.waves){let left=dt;
   while(left>1e-8&&!q.done&&this.api.active()){
    const step=Math.min(left,1/30),previous=q.distance,remaining=q.returning?q.distance:q.w.range-q.distance,used=Math.min(step,remaining/q.w.speed);
    q.distance+=used*q.w.speed*(q.returning?-1:1);left-=used;q.visual-=used;
    for(const e of this.api.foes()){if(!this.api.active())break;if(q.hits.has(e))continue;const contact=herbalContact(q.origin,e,q.w,q.angle,q.pitch,this.api.world(),Math.max(0,Math.min(previous,q.distance)-.25),Math.min(q.w.range,Math.max(previous,q.distance)+.25));if(contact){q.hits.add(e);this.api.hit(q,e,contact);}}
    if(!this.api.active())break;
    if(q.visual<=0||used<step){q.visual=1/30;this.api.draw?.(q,previous);}
    if(remaining<=q.w.speed*step+1e-8){if(q.w.returning&&!q.returning){q.returning=true;q.distance=q.w.range;q.hits.clear();}else q.done=true;}
   }
  }
  this.waves=this.waves.filter(q=>!q.done);
 }
}
