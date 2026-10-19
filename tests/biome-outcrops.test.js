import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorld} from '../world.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installBiomePlaces} from '../biome-places.js';
import {installClimateLandforms} from '../climate-landforms.js';
import {installHarborLife} from '../harbor-life.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {installExplorationRoutes,createExplorationNavigator} from '../exploration-routes.js';
import {planBiomeJourney} from '../biome-journey.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {installBiomeOutcrops,installBiomeOutcropsSteps} from '../biome-outcrops.js';
import {waterDepth} from '../water.js';
import {bridgeContains} from '../coast.js';
import {segmentDistance} from '../rules.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
function prepare(id='coast',seed=522){
 const w=buildWorld(id,seed);
 for(const fn of [polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installHarborLife,installEnvironmentClusters,installExplorationRoutes,planBiomeJourney,installExplorationLandmarks])fn(w,id);
 return w;
}
const release=w=>w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});
const snapshot=w=>JSON.stringify({spawn:w.spawn,sites:w.sites.map(p=>[p.x,p.z,p.type]),water:w.ponds.map(p=>[p.x,p.z,p.rx,p.rz,p.angle]),bridges:w.bridges.map(p=>[p.x,p.z,p.width,p.length,p.angle]),routes:w.explorationRoutes.map(r=>r.points),journey:w.biomeJourney?.points});

test('the coast bridge opening reveals a reachable broad shoreline shoulder, without moving rewards, water or routes',t=>{
 const w=prepare(),before=snapshot(w),original=new Set(w.obstacles),protectedSolids=w.obstacles.filter(o=>o.tactic||o.place||o.environmentCluster||w.breakables.includes(o)||o.mesh.userData.coastPropKind||o.mesh.userData.district),outcrops=installBiomeOutcrops(w,'coast');
 try{
  assert.equal(snapshot(w),before);assert.equal(outcrops.records.length,1);assert.equal(outcrops.draws,1);
  const r=outcrops.records[0],node=w.biomeJourney.landmarks.find(p=>p.id===r.view);
  assert.equal(node.kind,'opening');assert(Math.abs(Math.atan2(Math.sin(Math.atan2(r.x-node.x,r.z-node.z)-node.yaw),Math.cos(Math.atan2(r.x-node.x,r.z-node.z)-node.yaw)))<.5);
  const points=r.points,length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.z-points[i].z),0);
  assert(length>8,'shoreline face collapsed into an isolated column');assert(Math.max(...points.map(p=>p.height))<3.5);
  assert(r.mesh.geometry.index.count/3<=1400);assert(r.solids.length<=28);assert.strictEqual(installBiomeOutcrops(w,'coast'),outcrops);
  for(const o of protectedSolids){assert(w.obstacles.includes(o));assert.equal(o.mesh.visible,true);}
  for(const o of outcrops.retired){assert(original.has(o));assert.equal(o.mesh.visible,false);assert(!w.obstacles.includes(o));assert(!w.foliage.some(f=>f.leaf.parent===o.mesh));}
  const nav=createExplorationNavigator(w);
  for(const route of [...w.explorationRoutes,w.biomeJourney,{points:r.access}])for(let i=1;i<route.points.length;i++)assert(nav.segment(route.points[i-1],route.points[i]),'new shoreline blocks established route or visit');
  assert(nav.route(w.biomeJourney.points[0],r.visit).length>=2);
  t.diagnostic(JSON.stringify({view:r.view,length:+length.toFixed(2),points:points.length,solids:r.solids.length,triangles:r.mesh.geometry.index.count/3,retired:outcrops.retired.length}));
 }finally{release(w);}
});

test('the continuous coast rock mesh stays on dry high-tide ground and inside its visible collision cover',()=>{
 const w=prepare(),result=installBiomeOutcrops(w,'coast');
 try{
  const high=w.ponds.map(p=>({...p,rx:(p.baseRx??p.rx)*(p.baseRx===undefined?1:1.19),rz:(p.baseRz??p.rz)*(p.baseRz===undefined?1:1.19)}));
  for(const r of result.records){
   const pos=r.mesh.geometry.attributes.position;
   for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    assert(high.every(p=>waterDepth(p,x,z)===0),'rock intrudes into high-tide water');
    assert(w.bridges.every(b=>!bridgeContains(b,x,z,.1)),'rock intrudes into bridge');
    assert(r.solids.some(o=>Math.hypot(x-o.x,z-o.z)<=o.r+.001&&y<=o.sceneryHeight+.001),'visible cliff has no matching collision');
    for(const route of [...w.explorationRoutes,w.biomeJourney])for(let n=1;n<route.points.length;n++){const a=route.points[n-1],b=route.points[n];assert(segmentDistance(x,z,a.x,a.z,b.x,b.z)>2,'rock intersects original walking corridor');}
   }
   for(const o of r.solids){let top=.15;for(let i=0;i<pos.count;i++)if(Math.hypot(pos.getX(i)-o.x,pos.getZ(i)-o.z)<=o.r+.08)top=Math.max(top,pos.getY(i));assert.equal(o.sceneryHeight,top);}
  }
 }finally{release(w);}
});

test('shore shoulders stay deterministic, bounded and local to coast, including the joined map',()=>{
 for(const id of ['coast','confluence']){
  const a=prepare(id),b=prepare(id);
  try{
   const x=installBiomeOutcrops(a,id),steps=installBiomeOutcropsSteps(b,id);let next,yields=0;do{next=steps.next();if(!next.done)yields++;}while(!next.done);const y=next.value;assert(yields>=14,'candidate work must yield before discarded candidates as well');
   assert.deepEqual(x.records.map(r=>r.points),y.records.map(r=>r.points));assert(x.records.length<=1);
   const scope=a.regions?.find(r=>r.id==='coast');
   if(scope)for(const o of x.solids){assert(scope.contains(o.x,o.z));assert(scope.obstacles.includes(o));for(let i=0;i<16;i++)assert(scope.contains(o.x+Math.sin(i*Math.PI/8)*o.r,o.z+Math.cos(i*Math.PI/8)*o.r),'solid footprint crosses regional boundary');}
   for(const o of x.retired)assert(!scope?.foliage.some(f=>f.leaf.parent===o.mesh));
   const disposed=new Set();for(const r of x.records)r.mesh.geometry.addEventListener('dispose',()=>disposed.add(r.mesh.geometry));release(a);assert.equal(disposed.size,x.records.length);
  }finally{release(b);}
 }
 for(const id of ['forest','snow','ash','sand']){const w=buildWorld(id,522),count=w.obstacles.length;try{assert.equal(installBiomeOutcrops(w,id),null);assert.equal(w.obstacles.length,count);}finally{release(w);}}
});
