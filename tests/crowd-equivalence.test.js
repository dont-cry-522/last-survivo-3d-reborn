import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyRadius,bodiesClear,bodyTravel} from '../actor-collision.js';
import {separation} from '../encounters.js';
import {observePlayer,playerHidden} from '../target-awareness.js';

// Frozen pre-optimization algorithms: compare exact results, not a second
// approximation of swept collision, crowd steering or concealed-target memory.
const intangible=p=>p.alive===false||p.mirageHidden||(p.heroId==='tide'&&p.dashTime>0)||(p.move==='burrow'&&p.stage==='strike');
function above(p,q){if(p.role!=='flyer'&&q.role!=='flyer')return false;const py=p.y||0,qy=q.y||0;return py>=qy+(q.height||q.standHeight||1.6)||qy>=py+(p.height||p.standHeight||1.6);}
function oldClear(world,p,x,z,r=bodyRadius(p)){
 for(const q of world.solidActors?.()||[]){if(q===p||intangible(q)||above(p,q))continue;if(Math.hypot(x-q.x,z-q.z)<r+bodyRadius(q)-.001)return false;}return true;
}
function oldTravel(world,p,dx,dz,r=bodyRadius(p)){
 if(intangible(p))return 1;const a=dx*dx+dz*dz;if(a<1e-12)return 1;let fraction=1;
 for(const q of world.solidActors?.()||[]){
  if(q===p||intangible(q)||above(p,q))continue;
  const x=p.x-q.x,z=p.z-q.z,radius=r+bodyRadius(q),c=x*x+z*z-radius*radius,b=x*dx+z*dz;
  if(c<-.001){if(b<0)fraction=0;continue;}
  const discriminant=b*b-a*c;if(b>=0||discriminant<0)continue;
  const hit=(-b-Math.sqrt(discriminant))/a;if(hit>=-.001&&hit<=fraction)fraction=Math.max(0,hit-.001/Math.sqrt(a));
 }return fraction;
}
function oldSeparation(e,enemies){
 let x=0,z=0;
 for(const q of enemies){if(q===e||!q.alive)continue;const dx=e.x-q.x,dz=e.z-q.z,d=Math.hypot(dx,dz),gap=(e.size+q.size)*.7;
  if(d>0.001&&d<gap){const push=(gap-d)/gap;x+=dx/d*push;z+=dz/d*push;}
 }
 const length=Math.max(1,Math.hypot(x,z));return{x:x/length*.65,z:z/length*.65};
}
function oldObserve(observer,player,dt=0,decoy=null){
 observer.reacquired=false;
 if(player.heroId==='mirage'&&decoy?.alive){observer.targetLost=false;observer.searchTime=0;observer.decoyTarget=decoy.id;observer.lastSeenPlayer={x:decoy.x,z:decoy.z,vx:0,vz:0};return decoy;}
 if(!playerHidden(player)){observer.reacquired=!!observer.targetLost||observer.decoyTarget!=null;observer.decoyTarget=null;observer.targetLost=false;observer.searchTime=0;observer.lastSeenPlayer={x:player.x,z:player.z,vx:0,vz:0};return player;}
 if(!observer.targetLost){observer.searchHeading=observer.mesh?.rotation.y||0;observer.searchTime=0;}
 observer.targetLost=true;observer.searchTime=(observer.searchTime||0)+dt;
 return observer.lastSeenPlayer||{x:observer.x,z:observer.z,vx:0,vz:0};
}
function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

test('crowd early exits preserve exact sweeps, clearance and steering across seeded scenes',()=>{
 const rnd=random(230),pick=list=>list[Math.floor(rnd()*list.length)],signed=n=>(rnd()-.5)*n;
 for(let scene=0;scene<2000;scene++){
  const p={x:signed(300),z:signed(300),size:.2+rnd()*2,alive:true,y:rnd()*4,role:pick(['wolf','golem','flyer']),heroId:pick([undefined,'scout','tide','mirage']),dashTime:rnd()<.1?1:0,mirageHidden:rnd()<.05},actors=[p];
  for(let i=0;i<24;i++)actors.push({x:p.x+signed(i%3?60:4),z:p.z+signed(i%3?60:4),size:.2+rnd()*2,alive:rnd()>.1,y:rnd()*4,height:rnd()*3,role:pick(['wolf','golem','flyer']),boss:rnd()<.08,mirageHidden:rnd()<.03,move:i===5?'burrow':'walk',stage:pick(['wind','strike'])});
  const world={solidActors:function*(){yield*actors;}},dx=signed(20),dz=signed(20),r=pick([undefined,.001,.45,1.6,-.1]);
  const before=oldTravel(world,p,dx,dz,r),after=bodyTravel(world,p,dx,dz,r);assert.equal(after,before,`sweep ${scene}`);
  assert.deepEqual({x:p.x+dx*after,z:p.z+dz*after},{x:p.x+dx*before,z:p.z+dz*before},`position ${scene}`);
  assert.equal(bodiesClear(world,p,p.x+dx,p.z+dz,r),oldClear(world,p,p.x+dx,p.z+dz,r),`clearance ${scene}`);
  assert.deepEqual(separation(p,actors),oldSeparation(p,actors),`steering ${scene}`);
 }
});

test('sweep tangencies, old overlaps, negative root tolerance and unusual numbers remain exact',()=>{
 const p={x:0,z:0,size:1,alive:true};
 for(const radius of[.001,.45,-.4,1.6,0,NaN,Infinity])for(const qx of[-1.05,-1.0499,-.3,0,.3,1.0499,1.05])for(const qz of[-.001,0,.001,1.05])for(const [dx,dz]of[[0,0],[1e-7,0],[-2,0],[2,0],[0,2],[1,1],[1000,-1000],[NaN,1],[Infinity,0]]){
  const q={x:qx,z:qz,size:1,alive:true},world={solidActors:()=>[p,q]};
  assert.equal(bodyTravel(world,p,dx,dz,radius),oldTravel(world,p,dx,dz,radius));
  assert.equal(bodiesClear(world,p,dx,dz,radius),oldClear(world,p,dx,dz,radius));
 }
 const q={x:1,z:0,size:1,alive:true},world={solidActors:()=>[p,q]};
 assert.equal(bodyTravel(world,p,-1,0),1,'overlap must permit escape');assert.equal(bodyTravel(world,p,1,0),0,'overlap must not deepen');
});

test('reused sighting snapshots match old concealment and decoy transitions without sharing coordinates',()=>{
 const rnd=random(522),p={heroId:'tide',x:1,z:2,vx:4,vz:5},decoy={id:1,x:3,z:4,alive:false},current={x:0,z:8},previous={x:0,z:8};
 let retained;
 for(let i=0;i<1000;i++){
  p.heroId=rnd()<.5?'tide':'mirage';p.dashTime=rnd()<.5?1:0;p.mirageHidden=rnd()<.5;p.x=rnd()*30;p.z=rnd()*30;decoy.alive=rnd()<.3;decoy.x=rnd()*10;decoy.z=rnd()*10;
  const before=oldObserve(previous,p,.02,decoy),after=observePlayer(current,p,.02,decoy);
  assert.deepEqual(after,before);assert.equal(after===p,before===p);assert.equal(after===decoy,before===decoy);assert.deepEqual(current,previous);
  if(current.lastSeenPlayer){if(retained)assert.equal(current.lastSeenPlayer,retained);retained=current.lastSeenPlayer;assert.notEqual(retained,p);assert.notEqual(retained,decoy);}
 }
 p.heroId='tide';p.dashTime=0;observePlayer(current,p);const other={x:7,z:7};observePlayer(other,p);assert.notEqual(other.lastSeenPlayer,current.lastSeenPlayer);
 const remembered={...current.lastSeenPlayer};p.dashTime=1;p.x+=50;p.z-=50;decoy.x+=50;assert.deepEqual(observePlayer(current,p),remembered);
 const newborn={x:9,z:11};assert.deepEqual(observePlayer(newborn,p),{x:9,z:11,vx:0,vz:0});assert.equal(newborn.lastSeenPlayer,undefined);
});
