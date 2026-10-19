import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {installAdventureGroundDetail,installHabitatDetail} from '../adventure-ground-detail.js';
import {segmentDistance} from '../rules.js';

function forest(journey=true){
 const points=[{x:0,z:0},{x:0,z:24},{x:20,z:40},{x:40,z:62}],ids=['entry','bend','pool','overlook'];
 const trees=[[-10,14],[11,14],[-10,28],[12,30],[12,50],[30,39],[30,67],[51,61],[-35,-30],[30,-35],[-42,65],[68,34]];
 const obstacles=trees.map(([x,z])=>{const mesh=new T.Group();mesh.userData.treeBiome='forest';return{x,z,r:.8,mesh};});
 const world={seed:522,half:96,spawn:points[0],group:new T.Group(),obstacles,breakables:[],sites:[],patches:[],ponds:[],discoveries:[],roaming:[],explorationRoutes:[{points,biome:'forest'}],forestHabitats:{groves:[],ponds:[]}};
 if(journey)world.forestJourney={points,landmarks:points.map((p,i)=>({...p,id:ids[i]}))};
 return world;
}
const install=w=>[installAdventureGroundDetail(w,'forest'),installHabitatDetail(w,'forest')];
const release=w=>w.group.traverse(m=>{if(m.isInstancedMesh)m.dispose();if(m.userData.ownedGeometry)m.geometry.dispose();});
const batches=groups=>groups.map(g=>g.children.map(m=>[m.name,m.count,m.geometry.index?.count??m.geometry.attributes.position.count]).sort());

test('forest journey redistributes the existing understory to every scenic node without growing GPU batches or closing the path',()=>{
 const before=forest(false),after=forest(),original=install(before),current=install(after);
 assert.deepEqual(batches(current),batches(original),'same material/kind/quadrant population must retain the original GPU budget');
 for(const [layer,group]of current.entries()){
  const footprint=layer?1.15:.55,records=group.userData.records,focused=records.filter(p=>p.journeyNode);
  assert(focused.length>=24,'the new sources never received a visible part of the existing quota');
  assert(focused.length<=Math.floor(records.length*.30),'landscape quota grew beyond its redistribution cap');
  for(const node of after.forestJourney.landmarks)assert(focused.filter(p=>p.journeyNode===node.id).length>=4,'missing route-edge pocket: '+node.id);
  for(const p of focused){
   assert.equal(p.landscape,'woodland-edge');assert(!p.edge&&!p.transition&&!p.shoulder);
   for(let i=1;i<after.forestJourney.points.length;i++){const a=after.forestJourney.points[i-1],b=after.forestJourney.points[i];assert(segmentDistance(p.x,p.z,a.x,a.z,b.x,b.z)>=2+footprint);}
   assert(after.obstacles.every(o=>Math.hypot(p.x-o.x,p.z-o.z)>=o.r+footprint+.2));
   assert(Math.hypot(p.x,p.z)>=10);
   if(layer&&p.kind==='shrub')assert(p.landscapeHeight>=.9&&p.landscapeHeight<=1.21);
   if(layer&&p.kind==='fern')assert.equal(p.landscapeHeight,undefined,'low apron turned into a tall plant');
  }
 }
 const middle=current[1].userData.records.filter(p=>p.journeyNode);
 assert(middle.filter(p=>p.kind==='fern').length>=16,'no low fern apron joins the shrubs');
 assert(middle.filter(p=>p.kind==='shrub').length>=16,'the mid-height tree line disappeared');
 assert.deepEqual(after.obstacles.map(o=>[o.x,o.z,o.r]),before.obstacles.map(o=>[o.x,o.z,o.r]));
 release(before);release(after);
});

test('new forest-edge pockets are seed-stable and keep the existing installation/disposal lifecycle',()=>{
 const a=forest(),b=forest(),first=install(a),second=install(b);
 assert.deepEqual(first.map(g=>g.userData.records),second.map(g=>g.userData.records));
 assert.equal(installAdventureGroundDetail(a,'forest'),first[0]);assert.equal(installHabitatDetail(a,'forest'),first[1]);
 let disposed=0;for(const g of first)for(const m of g.children)m.geometry.addEventListener('dispose',()=>disposed++);
 release(a);assert.equal(disposed,first.reduce((n,g)=>n+g.children.length,0));assert(first.every(g=>g.userData.disposed));release(b);
});
