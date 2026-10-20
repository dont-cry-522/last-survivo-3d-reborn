import {MathUtils} from './vendor/three.module.js';
import {journeyPoint} from './forest-journey.js?v=229';

const fade=MathUtils.smoothstep;
// Metres, before wet/interactive-footprint protection and the shared slope cap.
// These are different cross-sections: an entrance spur, a long creek escarpment
// and a broad source shelf. No new noise, random calls, meshes or collision data.
const PROFILES=[
 {kind:'entry-spur',fraction:.18,rx:27,front:17,back:25,height:3.3,bow:4,crest:.08},
 {kind:'creek-escarpment',fraction:.43,rx:42,front:23,back:35,height:5.8,bow:8,crest:.18},
 {kind:'source-shelf',fraction:.9,rx:38,front:29,back:36,height:6.4,bow:-5,crest:.22}
];

function routeFrame(points,length,along){
 const p=journeyPoint(points,along),a=journeyPoint(points,Math.max(0,along-4)),b=journeyPoint(points,Math.min(length,along+4));
 const dx=b.x-a.x,dz=b.z-a.z,n=Math.hypot(dx,dz);return n>.01?{...p,tx:dx/n,tz:dz/n}:null;
}

// This is only a build-time design field. The game continues to sample the
// final rendered triangles in forest-terrain, including all protected areas.
export function forestMacroLandforms(world,protection){
 const journey=world.forestJourney,points=journey?.points;if(!points?.length||world.regions)return null;
 const length=journey.length,records=[];
 for(const profile of PROFILES){
  const focus=routeFrame(points,length,length*profile.fraction);if(!focus)continue;
  const pond=world.ponds.reduce((best,p)=>!best||Math.hypot(p.x-focus.x,p.z-focus.z)<Math.hypot(best.x-focus.x,best.z-focus.z)?p:best,null);
  const candidates=[];
  for(const side of[-1,1])for(const offset of[19,27,35])for(const drift of[-9,0,9]){
   const nx=focus.tz*side,nz=-focus.tx*side,x=focus.x+nx*offset+focus.tx*drift,z=focus.z+nz*offset+focus.tz*drift;
   if(Math.max(Math.abs(x),Math.abs(z))>world.half-24||Math.hypot(x-world.spawn.x,z-world.spawn.z)<17||records.some(p=>Math.hypot(x-p.x,z-p.z)<23)||protection(x,z)<.98)continue;
   // A dry continuous crest scores better than a high point surrounded by
   // protected holes. The water-facing flank is narrower than the back slope.
   let score=0;
   for(const u of[-.65,-.32,0,.32,.65])for(const v of[-8,0,10]){
    const px=x+focus.tx*u*profile.rx+nx*v,pz=z+focus.tz*u*profile.rx+nz*v;
    score+=protection(px,pz)*(v===0?1.5:1);
   }
   const away=pond?((focus.x-pond.x)*nx+(focus.z-pond.z)*nz)/Math.max(1,Math.hypot(focus.x-pond.x,focus.z-pond.z)):0;
   candidates.push({...profile,x,z,tx:focus.tx,tz:focus.tz,nx,nz,score:score+away*2-offset*.035});
  }
  candidates.sort((a,b)=>b.score-a.score);if(candidates.length)records.push(candidates[0]);
 }
 // Tie the already-authored exposed rock face to the land behind it. The
 // original cliff/collider stays put; this shared ground forms its back slope.
 const ridge=journey.ridges?.slice().sort((a,b)=>b.length-a.length)[0];
 if(ridge?.length>1){
  const a=ridge[0],b=ridge.at(-1),dx=b.x-a.x,dz=b.z-a.z,n=Math.hypot(dx,dz);
  if(n>1){
   const tx=dx/n,tz=dz/n,middle=ridge.reduce((p,q)=>({x:p.x+q.x/ridge.length,z:p.z+q.z/ridge.length}),{x:0,z:0});
   const pond=world.ponds.reduce((best,p)=>!best||Math.hypot(p.x-middle.x,p.z-middle.z)<Math.hypot(best.x-middle.x,best.z-middle.z)?p:best,null);
   const side=pond&&(middle.x-pond.x)*tz-(middle.z-pond.z)*tx<0?-1:1,nx=tz*side,nz=-tx*side;
   const backs=[];
   // The backing crest needs enough run from the water to rise at the same
   // gentle grade. Keep it out of the entry clearing and put its broad flanks
   // either side of the exposed face, where the real pool view can reveal them.
   for(const offset of[26,34,42])for(const drift of[-24,-12,0,12,24]){
    const x=middle.x+nx*offset+tx*drift,z=middle.z+nz*offset+tz*drift;
    if(Math.max(Math.abs(x),Math.abs(z))>world.half-20||Math.hypot(x-world.spawn.x,z-world.spawn.z)<26)continue;
    let score=0;
    for(const u of[-24,-12,0,12,24])for(const v of[-12,0,12])score+=protection(x+tx*u+nx*v,z+tz*u+nz*v)*(u===0&&v===0?2:1);
    backs.push({x,z,score:score-Math.abs(drift)*.015-Math.abs(offset-34)*.03,offset});
   }
   backs.sort((a,b)=>b.score-a.score);
   if(backs.length)records.push({kind:'outcrop-backridge',...backs[0],tx,tz,nx,nz,rx:Math.max(44,n*.5+27),front:backs[0].offset+15,back:38,height:8.4,bow:7,crest:.14});
  }
 }
 // Preserve the actual walkable ascent through a dry saddle. Its low height
 // leaves the water-level banks and the pool opening as contrasting lowland.
 const crossings=[];
 for(let along=12;along<length-9;along+=2){
  const p=routeFrame(points,length,along);if(!p)continue;
  const a=journeyPoint(points,along-3),b=journeyPoint(points,along+3),score=protection(p.x,p.z)*2+protection(a.x,a.z)+protection(b.x,b.z);
  if(score>1.2)crossings.push({...p,rx:20,rz:12,height:1.55,kind:'trail-saddle',score});
 }
 crossings.sort((a,b)=>b.score-a.score);if(crossings.length)records.push(crossings[0]);
 if(!records.length)return null;
 const pool=journey.landmarks?.find(p=>p.kind==='pool');
 const segments=points.slice(1).map((b,i)=>{const a=points[i],dx=b.x-a.x,dz=b.z-a.z;return{a,dx,dz,l2:dx*dx+dz*dz};}).filter(s=>s.l2>.001);
 return{records,heightAt(x,z){
  let height=0,saddle=0,drainage=0;
  for(const p of records){
   const dx=x-p.x,dz=z-p.z,u=(dx*p.tx+dz*p.tz)/p.rx;if(Math.abs(u)>=1)continue;
   if(p.kind==='trail-saddle'){
    const v=(dx*p.tz-dz*p.tx)/p.rz,radius=Math.hypot(u,v-(u*u-.3)*.12);
    if(radius<1)saddle=Math.max(saddle,p.height*(1-fade(radius,.12,1)));continue;
   }
   // A bent crest with a continuous broad shoulder, not an elliptical mound.
   // The shelf has a flat upper bench; the long escarpment has two unequal
   // crests joined by a shallow saddle. Each tapers into the original floor.
   const across=dx*p.nx+dz*p.nz-p.bow*(u*u-.35),width=across<0?p.front:p.back,v=across/width,r=Math.abs(v);
   // A broad upper shoulder falls onto a gentler mid-slope bench before the
   // toe reaches the lowland. Its position shifts along the ridge, rather than
   // tracing a level terrace all around a circular hill. No extra grid cells.
   const bench=p.kind==='entry-spur'?.36:p.kind==='source-shelf'?.55:.48;
   const shoulder=.44+.07*u;
   const cross=(1-bench)*(1-fade(r,p.crest,shoulder))+bench*(1-fade(r,shoulder+.13,1));if(!cross)continue;
   const ends=1-fade(Math.abs(u),p.kind==='creek-escarpment'?.48:.2,1);
   const crown=p.kind==='creek-escarpment'?.82+.18*Math.cos((u+.23)*Math.PI)**2:p.kind==='source-shelf'?.94+.06*u:1-.16*u;
   const rise=p.height*cross*ends*crown;height=Math.max(height,rise);
   // Two unequal, broad drainage hollows break the shoulder into spurs. They
   // bend downhill towards the creek and feather into the toe, with a shallow
   // continuation over the crest. Subtract after the union so an intersecting
   // hill does not fill the hollow back in; never cut below the original floor.
   // On the exposed backridge, the central hollow must continue down its
   // creek-facing slope: a cut behind the crest is hidden from both shore
   // viewpoints. Keep the other highlands' two smaller branching channels.
   const backridge=p.kind==='outcrop-backridge';
   const first=1-fade(Math.abs(u+(backridge?-.06:.3)+.13*v),.035,backridge?.28:.24),second=p.kind==='entry-spur'||backridge?0:1-fade(Math.abs(u-.31+.18*v),.025,.21);
   const flow=(1-fade(r,backridge?.82:.6,.98))*(1-.45*fade(v,0,.6));
   drainage=Math.max(drainage,rise*Math.max(first*.59,second*.43)*flow);
  }
  if(!height)return saddle;
  height-=Math.min(height*.65,drainage);
  let distance=Infinity;
  for(const s of segments){const t=MathUtils.clamp(((x-s.a.x)*s.dx+(z-s.a.z)*s.dz)/s.l2,0,1);distance=Math.min(distance,Math.hypot(x-s.a.x-s.dx*t,z-s.a.z-s.dz*t));}
  // Keep actual walking grades gentle while allowing the hillsides beside it
  // to form a larger skyline. No XZ route or movement rule is changed.
  height=Math.min(height,1.5+6.9*fade(distance,3,15));
  // The pool is an opening at the end of a more enclosed creek passage. Its
  // low apron blends into the taller landward shelf, rather than a circular rim.
  if(pool)height*=.22+.78*fade(Math.hypot(x-pool.x,z-pool.z),5,17);
  return Math.max(saddle,height);
 }};
}
