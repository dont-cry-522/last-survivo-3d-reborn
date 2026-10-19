import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {buildWorld} from '../world.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {installBiomePlaces} from '../biome-places.js';
import {installClimateLandforms,installJourneyEscarpment,installJourneyEscarpmentSteps} from '../climate-landforms.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {installExplorationRoutes,createExplorationNavigator} from '../exploration-routes.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {planBiomeJourney} from '../biome-journey.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const release=w=>w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});
function prepare(id,seed){const w=buildWorld(id,seed);for(const f of[polishEnvironmentModels,installBiomePlaces,installClimateLandforms,installEnvironmentClusters,installExplorationRoutes,planBiomeJourney,installExplorationLandmarks])f(w,id);return w;}
const gameplay=w=>JSON.stringify({spawn:w.spawn,rewards:w.sites.map(p=>[p.x,p.z,p.type,p.event,p.nodes?.map(p=>[p.x,p.z])]),water:w.ponds.map(p=>[p.x,p.z,p.rx,p.rz]),breakables:w.breakables.map(p=>[p.x,p.z,p.r]),routes:w.explorationRoutes.map(p=>p.points)});

test('ash fracture frames the journey without changing objectives, water, protected solids or dry routes',()=>{
 for(const id of['ash','confluence'])for(const seed of[7,43,522]){
  const w=prepare(id,seed),before=gameplay(w),old=[...w.obstacles];
  try{
   const state=installJourneyEscarpment(w,id),nav=createExplorationNavigator(w);assert(state,`${id}/${seed}`);assert.strictEqual(installJourneyEscarpment(w,id),state);assert.equal(gameplay(w),before);
   assert.equal(state.draws,1);assert(state.triangles<2600);const ridge=state.records[0];assert(ridge.solids.length>=5);assert(Math.max(...ridge.solids.map(s=>s.height))>5);
   assert(old.every(o=>w.obstacles.includes(o)||state.retired.includes(o)));assert(state.retired.every(o=>!o.mesh.visible&&!w.breakables.includes(o)&&!o.tactic&&!o.place));
   const journeys=w.biomeJourneys||[w.biomeJourney];
   for(const route of[...w.explorationRoutes,...journeys])for(let i=1;i<route.points.length;i++)assert(nav.segment(route.points[i-1],route.points[i]),`${id}/${seed} blocked an existing walk`);
   const scope=w.regions?.find(r=>r.id==='ash');for(const s of ridge.solids){assert(w.obstacles.includes(s));if(scope){assert(scope.obstacles.includes(s));assert(scope.contains(s.x,s.z));}}
  }finally{release(w);}
 }
});

test('fracture collider tops and radial extent match the actual solid geometry, with outward top faces',()=>{
 const w=prepare('ash',522);
 try{
  const state=installJourneyEscarpment(w,'ash'),ridge=state.records[0],positions=ridge.mesh.geometry.attributes.position;w.group.updateMatrixWorld(true);let hits=0;
  for(const o of ridge.solids){let r=0,y=-Infinity;for(let i=o.climateSpan.first;i<o.climateSpan.first+o.climateSpan.count;i++){r=Math.max(r,Math.hypot(positions.getX(i)-o.x,positions.getZ(i)-o.z));y=Math.max(y,positions.getY(i));}assert(Math.abs(r-o.r)<1e-6);assert(Math.abs(y-o.height)<1e-6);assert.equal(o.height,o.sceneryHeight);
   const ray=new T.Raycaster(new T.Vector3(o.x,20,o.z),new T.Vector3(0,-1,0)),intersection=ray.intersectObject(ridge.mesh)[0];if(intersection){assert(intersection.point.y<=o.height+1e-6);hits++;}}
  assert(hits>=ridge.solids.length-1);
 }finally{release(w);}
});

test('fracture plans are deterministic, world geometry is released, and other climates remain unchanged',()=>{
 const a=prepare('ash',522),b=prepare('ash',522),x=installJourneyEscarpment(a,'ash'),steps=installJourneyEscarpmentSteps(b,'ash');let step,yields=0;do{step=steps.next();if(!step.done)yields++;}while(!step.done);const y=step.value;assert(yields>0);
 const plan=s=>s.records.map(r=>[r.x,r.z,r.angle,r.solids.map(o=>[o.x,o.z,o.r,o.height])]);assert.deepEqual(plan(x),plan(y));assert.equal(x.records[0].mesh.material,y.records[0].mesh.material);assert.notEqual(x.records[0].mesh.geometry,y.records[0].mesh.geometry);
 let disposed=0;x.records[0].mesh.geometry.addEventListener('dispose',()=>disposed++);release(a);assert.equal(disposed,1);release(b);
 for(const id of['forest','snow','sand','coast']){const w=prepare(id,522),count=w.obstacles.length;assert.equal(installJourneyEscarpment(w,id),null);assert.equal(w.obstacles.length,count);release(w);}
});
