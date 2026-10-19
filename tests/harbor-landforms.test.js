import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {buildWorld,supportHeight,clearAt} from '../world.js';
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
import {installBiomeOutcrops} from '../biome-outcrops.js';
import {installBiomeTreeForms} from '../biome-tree-forms.js';
import {installExplorationComposition} from '../exploration-composition.js';
import {installForestTerrain} from '../forest-terrain.js';
import {installDistantLandscape} from '../environment-lighting.js';
import {harborHeadlandSilhouette} from '../harbor-horizon.js';
import {biomeAt} from '../confluence.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
function prepare(id,seed){
 const w=buildWorld(id,seed);
 for(const install of[polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installHarborLife,installEnvironmentClusters,installExplorationRoutes,planBiomeJourney,installExplorationLandmarks,installBiomeOutcrops,installBiomeTreeForms,installExplorationComposition])install(w,id);
 w.group.updateMatrixWorld(true);for(const o of w.obstacles)o.height=o.sceneryHeight??Math.max(.15,new T.Box3().setFromObject(o.mesh).max.y);
 return w;
}
const release=w=>w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});

test('loose coast dressing follows real bank slopes without moving gameplay footprints or changing its jumpable top',t=>{
 const reports=[];
 for(const seed of[7,522]){
  const w=prepare('coast',seed),before=new Map(w.obstacles.map(o=>[o,{x:o.x,z:o.z,r:o.r,height:o.height,base:o.y||0,position:o.mesh.position.clone(),bounds:new T.Box3().setFromObject(o.mesh)}])),terrain=installForestTerrain(w,'coast');
  try{
   const loose=terrain.groundedObstacles.filter(p=>p.obstacle.mesh.userData.coastPropKind);assert(loose.length>15,'small cargo still pins the whole coast to a flat plane');
   for(const {obstacle:o,lift}of loose){
    const old=before.get(o),bounds=new T.Box3().setFromObject(o.mesh);
    assert.deepEqual([o.x,o.z,o.r,o.height],[old.x,old.z,old.r,old.height]);assert(!o.place&&!o.tactic&&!o.environmentCluster&&!w.breakables.includes(o));
    assert.equal(o.mesh.position.y-old.position.y,lift);assert.equal(o.y-old.base,lift);
    assert(Math.abs(bounds.max.y-(o.y+o.height))<1e-6);assert(Math.abs(bounds.min.y-old.bounds.min.y-lift)<1e-6);
    const low=Math.min(...[bounds.min.x,o.x,bounds.max.x].flatMap(x=>[bounds.min.z,o.z,bounds.max.z].map(z=>terrain.sample(x,z))));
    assert(bounds.min.y<=low+.04,'loose dressing floats above the downhill ground');
    const actor={x:o.x,z:o.z,y:o.y+o.height};assert.equal(supportHeight(w,actor,.1),actor.y,'standing top disagrees with visible prop');assert(clearAt(w,o.x,o.z,.1,actor.y));assert(!clearAt(w,o.x,o.z,.1,Math.max(0,actor.y-.05)));
   }
   for(const o of w.obstacles)if(o.place||o.tactic||o.harborLife||w.breakables.includes(o)||o.mesh.userData.district){const old=before.get(o);assert.equal(o.y||0,old.base);assert.deepEqual(o.mesh.position,old.position);}
   reports.push({seed,groundedDressing:loose.length,maxLift:Math.max(...loose.map(p=>p.lift))});
  }finally{release(w);}
 }
 t.diagnostic(JSON.stringify(reports));
});

test('the far-bank shoulders are real reachable land facing the bridge reveal, not collision-less backdrop props',t=>{
 const w=prepare('coast',522),terrain=installForestTerrain(w,'coast');
 try{
  const forms=terrain.macro.filter(p=>p.kind==='outer-shore-shoulder');assert.equal(forms.length,2);
  const nav=createExplorationNavigator(w),opening=w.biomeJourney.landmarks.find(p=>p.kind==='opening'),report=[];
  for(const form of forms){
   assert(nav.route(w.spawn,form).length>1,'far-bank shoulder is not reachable');
   assert(terrain.sample(form.x,form.z)>1.2,'visual headland is not present on the playable floor');
   const angle=Math.atan2(form.x-opening.x,form.z-opening.z),turn=Math.abs(Math.atan2(Math.sin(angle-opening.yaw),Math.cos(angle-opening.yaw)));assert(turn<=.73);
   const ray=new T.Raycaster(new T.Vector3(form.x,30,form.z),new T.Vector3(0,-1,0));w.group.updateMatrixWorld(true);const hit=ray.intersectObject(w.ground)[0];assert(hit&&Math.abs(hit.point.y-w.ground.position.y-terrain.sample(form.x,form.z))<1e-6);
   report.push({x:form.x,z:form.z,height:terrain.sample(form.x,form.z)});
  }
  assert.equal(w.ground.geometry.index.count/3,144*144*2,'real landform added a second floor or more floor triangles');t.diagnostic(JSON.stringify(report));
 }finally{release(w);}
});

test('coast distant headlands reshape only the existing outer ring and preserve quay supports, offshore water and non-coast sectors',()=>{
 assert.equal(harborHeadlandSilhouette({biomeJourney:{biome:'coast'}}),null,'draft journeys must not require completed landmarks');
 for(const id of['coast','confluence']){
  const a=prepare(id,522),b=prepare(id,522);
  try{
   const profile=harborHeadlandSilhouette(a);assert(profile?.length===2);delete b.biomeJourney;delete b.biomeJourneys;
   const ridge=installDistantLandscape(a,id,biomeAt),old=installDistantLandscape(b,id,biomeAt),p=ridge.geometry.attributes.position,q=old.geometry.attributes.position,near=(192+1)*9;
   assert.equal(p.count,q.count);assert.deepEqual(ridge.geometry.index.array,old.geometry.index.array);
   let raised=0,high=0;for(let i=0;i<p.count;i++){
    assert.equal(p.getX(i),q.getX(i));assert.equal(p.getZ(i),q.getZ(i));
    if(i<near)assert.equal(p.getY(i),q.getY(i),'the near quay-bearing shelf changed');
    else if(p.getY(i)>q.getY(i)+1){raised++;high=Math.max(high,p.getY(i));}
    const climate=ridge.geometry.attributes.ridgeClimate;if(climate.getX(i)+climate.getY(i)+climate.getZ(i)+climate.getW(i)>.99999)assert.equal(p.getY(i),q.getY(i),'far headland leaked into another biome');
   }
   assert(raised>40&&high>15,'outer range remains visually flat');
   assert.deepEqual(a.harborHorizon.userData.records,b.harborHorizon.userData.records,'new hills displaced existing off-map quays');
   assert.deepEqual(a.harborBay.boats,b.harborBay.boats);assert.deepEqual(a.harborBay.water.geometry.attributes.position.array,b.harborBay.water.geometry.attributes.position.array);
   for(const boat of a.harborBay.boats){const ray=new T.Raycaster(new T.Vector3(boat.x,200,boat.z),new T.Vector3(0,-1,0));assert(ray.intersectObject(ridge,false)[0].point.y<a.harborBay.y-.13,'new headland closed the sailing water');}
  }finally{release(a);release(b);}
 }
});
