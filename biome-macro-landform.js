import {MathUtils} from './vendor/three.module.js';
import {journeyPoint} from './forest-journey.js?v=229';
import {biomeWeights} from './confluence.js?v=229';

const fade=MathUtils.smoothstep;
// Build-time metres, before the existing water/solid masks and triangle slope
// limit. Different cross-sections give the four journeys different skylines.
// These deform the existing shared floor: no extra mesh, noise or frame work.
export const BIOME_MACRO_PROFILES={
 snow:[
  {kind:'moraine-spur',fraction:.16,rx:31,front:17,back:29,height:4.3,bow:5,crest:.13},
  {kind:'glacial-shoulder',fraction:.47,rx:46,front:24,back:38,height:7.3,bow:10,crest:.20},
  {kind:'cirque-shelf',fraction:.88,rx:39,front:29,back:36,height:6.5,bow:-8,crest:.24}
 ],
 ash:[
  {kind:'basalt-apron',fraction:.17,rx:32,front:23,back:30,height:4.6,bow:-4,crest:.23},
  {kind:'broken-caldera',fraction:.48,rx:47,front:25,back:37,height:7.5,bow:11,crest:.16},
  {kind:'cinder-shelf',fraction:.88,rx:38,front:26,back:33,height:6.1,bow:-5,crest:.28}
 ],
 sand:[
  {kind:'windward-dune',fraction:.16,rx:38,front:24,back:35,height:4.8,bow:8,crest:.04},
  {kind:'leeward-ridge',fraction:.48,rx:51,front:21,back:39,height:7.1,bow:9,crest:.07},
  {kind:'sandstone-table',fraction:.88,rx:37,front:30,back:36,height:6.4,bow:-3,crest:.32}
 ],
 coast:[
  {kind:'landward-headland',fraction:.16,rx:29,front:16,back:24,height:4.8,bow:5,crest:.16},
  {kind:'bay-bluff',fraction:.48,rx:37,front:18,back:27,height:6.8,bow:8,crest:.24},
  {kind:'harbor-terrace',fraction:.88,rx:30,front:18,back:24,height:5.2,bow:-4,crest:.31}
 ]
};

function frame(journey,fraction){
 const along=journey.length*fraction,p=journeyPoint(journey.points,along),a=journeyPoint(journey.points,Math.max(0,along-5)),b=journeyPoint(journey.points,Math.min(journey.length,along+5)),dx=b.x-a.x,dz=b.z-a.z,n=Math.hypot(dx,dz);
 return n>.01?{...p,tx:dx/n,tz:dz/n}:null;
}

function farCoastShoulders(world,journey,protection,records){
 const opening=journey.landmarks?.find(p=>p.kind==='opening');if(!opening)return;
 const scope=world.regions?.find(r=>r.id==='coast'),water=(world.ponds||[]).filter(p=>p.biome==='coast'),candidates=[];
 // The bridge crosses a channel, while the v226 route-relative shoulders all
 // fell behind the viewer. Search dry land on the far bank in that real view.
 // These are heights of the playable floor, never rocks placed over the water.
 for(const distance of [45,60,75,90,105,120])for(const offset of [-.72,-.48,-.24,0,.24,.48,.72]){
  const angle=opening.yaw+offset,x=opening.x+Math.sin(angle)*distance,z=opening.z+Math.cos(angle)*distance;
  if(Math.max(Math.abs(x),Math.abs(z))>world.half-15||scope&&!scope.contains(x,z)||protection(x,z)<.85||records.some(p=>Math.hypot(p.x-x,p.z-z)<24))continue;
  const wet=water.reduce((best,p)=>!best||Math.hypot(p.x-x,p.z-z)<Math.hypot(best.x-x,best.z-z)?p:best,null);if(!wet)continue;
  const length=Math.hypot(x-wet.x,z-wet.z)||1,nx=(x-wet.x)/length,nz=(z-wet.z)/length,tx=-nz,tz=nx;
  let score=0,continuous=0;
  for(const u of [-18,-9,0,9,18])for(const v of [-8,0,10]){
   const px=x+tx*u+nx*v,pz=z+tz*u+nz*v,w=Math.max(Math.abs(px),Math.abs(pz))>world.half-8||scope&&!scope.contains(px,pz)?0:protection(px,pz);
   score+=w;if(w>.75)continuous++;
  }
  if(continuous<7)continue;
  candidates.push({biome:'coast',kind:'outer-shore-shoulder',x,z,nx,nz,tx,tz,rx:32,front:22,back:29,height:6.6,bow:3.5,crest:.20,regional:!!scope,score:score-Math.abs(offset)*1.8-distance*.012,view:opening.id});
 }
 candidates.sort((a,b)=>b.score-a.score);let added=0;
 for(const p of candidates){if(added===2)break;if(records.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<27))continue;records.push(p);added++;}
}

// Only an authored journey enables the larger relief. Old worlds and the
// forest sample keep their exact surface; regional journeys are optional.
export function biomeMacroLandforms(world,mapId,protection){
 const journeys=world.regions?world.biomeJourneys||[]:[world.biomeJourney];
 const records=[],lanes=[];
 for(const journey of journeys){
  const biome=journey?.biome||mapId,profiles=BIOME_MACRO_PROFILES[biome];
  if(!profiles||!world.half||!(journey?.length>16)||journey.points?.length<2)continue;
  const scope=world.regions?.find(r=>r.id===biome),water=[...(world.ponds||[]),...(world.ice||[])],segments=[];
  for(let i=1;i<journey.points.length;i++){const a=journey.points[i-1],b=journey.points[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;if(l2>.001)segments.push({a,dx,dz,l2});}
  lanes.push(...segments);
  for(const profile of profiles){
   const focus=frame(journey,profile.fraction);if(!focus)continue;
   const candidates=[];
   // Rank dry continuous shoulders beside actual walkable routes, not grid
   // peaks. Water stays low and a shorter landward flank reveals its shoreline.
   const wet=water.reduce((best,p)=>!best||Math.hypot(p.x-focus.x,p.z-focus.z)<Math.hypot(best.x-focus.x,best.z-focus.z)?p:best,null);
   for(const side of[-1,1])for(const offset of biome==='coast'?[10,16,24,32]:[12,20,29,38])for(const drift of[-15,0,15]){
    const nx=focus.tz*side,nz=-focus.tx*side,x=focus.x+nx*offset+focus.tx*drift,z=focus.z+nz*offset+focus.tz*drift;
    if(Math.max(Math.abs(x),Math.abs(z))>world.half-(biome==='coast'?12:23)||scope&&!scope.contains(x,z)||Math.hypot(x-world.spawn.x,z-world.spawn.z)<17||records.some(p=>Math.hypot(x-p.x,z-p.z)<23)||protection(x,z)<.95)continue;
    let score=0,continuous=0;
    for(const u of[-.62,-.31,0,.31,.62])for(const v of biome==='coast'?[-7,0,9]:[-11,0,13]){
     const px=x+focus.tx*u*profile.rx+nx*v,pz=z+focus.tz*u*profile.rx+nz*v;
     const weight=Math.max(Math.abs(px),Math.abs(pz))>world.half-9||scope&&!scope.contains(px,pz)?0:protection(px,pz);
     score+=weight*(v===0?1.65:1);if(weight>.9)continuous++;
    }
    if(continuous<6)continue;
    const away=wet?((focus.x-wet.x)*nx+(focus.z-wet.z)*nz)/Math.max(1,Math.hypot(focus.x-wet.x,focus.z-wet.z)):0;
    candidates.push({...profile,biome,x,z,tx:focus.tx,tz:focus.tz,nx,nz,regional:!!scope,score:score+away*(biome==='coast'?3:1.3)-offset*.035-Math.abs(drift)*.015});
   }
   candidates.sort((a,b)=>b.score-a.score);if(candidates.length)records.push(candidates[0]);
  }
  if(biome==='coast')farCoastShoulders(world,journey,protection,records);
 }
 // Connect the real bay rock face to its landward shoulder. Its lower foot is
 // capped by forest-terrain so the cliff stays exposed and collider tops stay
 // at their existing height; water and all non-rock footprints still win.
 for(const face of world.biomeOutcrops?.records||[]){
  const first=face.points?.[0],last=face.points?.at(-1);if(!first||!last)continue;
  const dx=last.x-first.x,dz=last.z-first.z,length=Math.hypot(dx,dz);if(length<1)continue;
  const tx=dx/length,tz=dz/length,wet=(world.ponds||[]).reduce((best,p)=>!best||Math.hypot(p.x-face.x,p.z-face.z)<Math.hypot(best.x-face.x,best.z-face.z)?p:best,null);
  const side=wet&&(face.x-wet.x)*tz-(face.z-wet.z)*tx<0?-1:1,nx=tz*side,nz=-tx*side,candidates=[];
  const scope=world.regions?.find(r=>r.id===face.biome);
  for(const offset of[8,13,18])for(const drift of[-10,0,10]){
   const x=face.x+nx*offset+tx*drift,z=face.z+nz*offset+tz*drift;
   if(Math.max(Math.abs(x),Math.abs(z))>world.half-9||scope&&!scope.contains(x,z)||protection(x,z)<.75)continue;
   let score=0;for(const u of[-12,0,12])for(const v of[-6,0,8])score+=protection(x+tx*u+nx*v,z+tz*u+nz*v);
   candidates.push({x,z,offset,score:score-Math.abs(drift)*.035-offset*.025});
  }
  candidates.sort((a,b)=>b.score-a.score);if(candidates.length){const best=candidates[0];records.push({...best,biome:face.biome,kind:'coastal-outcrop-backridge',tx,tz,nx,nz,rx:Math.max(23,length*.5+15),front:best.offset+10,back:26,height:6,bow:4,crest:.2,regional:!!scope});}
 }
 if(!records.length)return null;
 // The road remains a continuous low crossing through climate transitions.
 if(world.regions&&world.road?.length)for(let i=0;i<world.road.length;i++){const a=world.road[i],b=world.road[(i+1)%world.road.length],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;if(l2>.001)lanes.push({a,dx,dz,l2});}
 const weights={};
 return{records,heightAt(x,z){
  if(world.regions)biomeWeights(x,z,weights);
  let height=0;
  for(const p of records){
   // The joined world uses its already-authored climate blend. A broad zero
   // apron near each border avoids a vertical cut at scope.contains edges.
   const regional=p.regional?fade(weights[p.biome],.7,1):1;if(!regional)continue;
   const dx=x-p.x,dz=z-p.z,u=(dx*p.tx+dz*p.tz)/p.rx;if(Math.abs(u)>=1)continue;
   const across=dx*p.nx+dz*p.nz-p.bow*(u*u-.35),v=across/(across<0?p.front:p.back),r=Math.abs(v);if(r>=1)continue;
   const ends=1-fade(Math.abs(u),.26,1);let cross,crown=1;
   if(p.biome==='sand'&&p.kind!=='sandstone-table'){
    // A smooth windward back and a narrow lee face, with a curved knife crest.
    cross=(1-fade(r,p.crest,1))**(v<0?1.45:.82);crown=.88+.12*Math.cos((u+.15)*Math.PI);
   }else if(p.biome==='ash'){
    // Broad cooled lava benches and an open saddle through the caldera rim.
    cross=.64*(1-fade(r,p.crest,.51))+.36*(1-fade(r,.63,1));
    crown=p.kind==='broken-caldera'?.64+.36*fade(Math.abs(u+.12),.03,.28):.92+.08*u;
   }else if(p.biome==='snow'){
    // Rounded, glacially scoured shoulders taper into two shallow tributaries.
    cross=.62*(1-fade(r,p.crest,.58))+.38*(1-fade(r,.63,1));
    crown=1-.27*(1-fade(Math.abs(u+.28+.11*v),.04,.22))-.17*(1-fade(Math.abs(u-.37-.14*v),.03,.19));
   }else{
    // A broad dry upper terrace and a lower apron facing the open water.
    cross=.56*(1-fade(r,p.crest,.53))+.44*(1-fade(r,.64,1));
    crown=p.kind==='outer-shore-shoulder'?.94-.26*(1-fade(Math.abs(u-.16),.025,.28))+.06*u:.9+.1*u;
   }
   height=Math.max(height,p.height*cross*ends*crown*regional);
  }
  if(!height)return 0;
  let distance=Infinity;
  for(const s of lanes){const t=MathUtils.clamp(((x-s.a.x)*s.dx+(z-s.a.z)*s.dz)/s.l2,0,1);distance=Math.min(distance,Math.hypot(x-s.a.x-s.dx*t,z-s.a.z-s.dz*t));}
  // Existing trail lines remain gently traversable; higher skyline shoulders
  // grow beside them. The final shared grade limiter also controls the flanks.
  return Math.min(height,1.25+6.25*fade(distance,3,16));
 }};
}
