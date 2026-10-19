import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorld,clearAt} from '../world.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installBiomePlaces} from '../biome-places.js';
import {installClimateLandforms} from '../climate-landforms.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {installExplorationRoutes,createExplorationNavigator} from '../exploration-routes.js';
import {planBiomeJourney} from '../biome-journey.js';
import {installAdventureGroundDetail,installHabitatDetail} from '../adventure-ground-detail.js';
import {segmentDistance} from '../rules.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const release=world=>world.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});
function prepare(id,seed){
 const world=buildWorld(id,seed);
 for(const install of [polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installEnvironmentClusters,installExplorationRoutes])install(world,id);
 return world;
}
const snapshot=w=>JSON.stringify({spawn:w.spawn,sites:w.sites.map(p=>[p.x,p.z,p.type]),solids:w.obstacles.map(p=>[p.x,p.z,p.r]),water:w.ponds.map(p=>[p.x,p.z,p.rx,p.rz,p.angle]),routes:w.explorationRoutes.map(p=>p.points)});

test('four climate journeys preserve every existing reward, water body and route while offering continuous dry scenic walks',t=>{
 const observations=[];
 for(const biome of ['snow','ash','sand','coast'])for(const seed of [7,43,522]){
  const world=prepare(biome,seed),before=snapshot(world);
  try{
   const route=planBiomeJourney(world,biome),navigation=createExplorationNavigator(world);
   assert(route,biome+' has no journey');assert.equal(snapshot(world),before);
   assert.strictEqual(planBiomeJourney(world,biome),route);
   assert.deepEqual(route.points[0],world.spawn);assert(route.length>15&&route.length<250);
   assert.equal(route.landmarks.length,4);assert.equal(new Set(route.landmarks.map(p=>p.name)).size,4);
   for(let i=1;i<route.points.length;i++)assert(navigation.segment(route.points[i-1],route.points[i]),biome+' unsafe leg '+i);
   for(const node of route.landmarks){assert(clearAt(world,node.x,node.z,.55));assert([node.x,node.z,node.yaw,node.pitch].every(Number.isFinite));assert(node.lookAt);}
   observations.push({biome,seed,length:+route.length.toFixed(1),extended:route.extended});
  }finally{release(world);}
 }
 assert(observations.filter(p=>p.extended).length>=6,'journeys seldom reveal a second landscape angle');t.diagnostic(JSON.stringify(observations));
});

test('journey planning is repeatable and does not alter the established forest or joined-map layout',()=>{
 for(const id of ['snow','ash','sand','coast']){
  const a=prepare(id,522),b=prepare(id,522);
  try{const x=planBiomeJourney(a,id),y=planBiomeJourney(b,id);assert.deepEqual(x.points,y.points);assert.deepEqual(x.landmarks.map(p=>[p.name,p.x,p.z,p.yaw]),y.landmarks.map(p=>[p.name,p.x,p.z,p.yaw]));}finally{release(a);release(b);}
 }
 const forest=prepare('forest',522),forestBefore=snapshot(forest);assert.equal(planBiomeJourney(forest,'forest'),null);assert.equal(snapshot(forest),forestBefore);release(forest);
 const world=prepare('confluence',522),before=snapshot(world);
 try{
  const journeys=planBiomeJourney(world,'confluence'),nav=createExplorationNavigator(world);
  assert.equal(snapshot(world),before);assert.equal(journeys.length,4);assert.strictEqual(journeys,planBiomeJourney(world,'confluence'));
  assert.deepEqual(journeys.map(j=>j.biome).sort(),['ash','coast','sand','snow']);
  for(const journey of journeys){assert.equal(journey.landmarks.length,4);for(let i=1;i<journey.points.length;i++)assert(nav.segment(journey.points[i-1],journey.points[i]));}
 }finally{release(world);}
});

test('all four journeys relocate existing low and middle cover to scenic margins without multiplying plants or obstructing walking lanes',t=>{
 const reports=[];
 for(const id of ['snow','ash','sand','coast']){
  const world=prepare(id,522);planBiomeJourney(world,id);
  try{
   for(const [index,group]of [installAdventureGroundDetail(world,id),installHabitatDetail(world,id)].entries()){
    const records=group.userData.records,focused=records.filter(p=>p.journeyNode);
    assert(focused.length>0,id+' layer '+index+' has no scenic cover');
    assert(focused.length<=records.length*.3);
    for(const plant of focused){
     assert.equal(plant.biome,id);
     for(let i=1;i<world.biomeJourney.points.length;i++){const a=world.biomeJourney.points[i-1],b=world.biomeJourney.points[i];assert(segmentDistance(plant.x,plant.z,a.x,a.z,b.x,b.z)>=2+(index?1.15:.55)-1e-6,id+' covered a walk');}
    }
    reports.push({id,layer:index,count:records.length,focused:focused.length,nodes:[...new Set(focused.map(p=>p.journeyNode))]});
   }
  }finally{release(world);}
 }
 t.diagnostic(JSON.stringify(reports));
});
