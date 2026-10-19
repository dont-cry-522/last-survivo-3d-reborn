import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {buildWorld,moveActor,supportHeight} from '../world.js';
import {resetMobility,beginJump,tickMobility} from '../adventure-mobility.js';
import {segmentGroundEntry} from '../adventure-combat.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installBiomePlaces} from '../biome-places.js';
import {installClimateLandforms,installJourneyEscarpment} from '../climate-landforms.js';
import {installHarborLife} from '../harbor-life.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {installExplorationRoutes} from '../exploration-routes.js';
import {planBiomeJourney} from '../biome-journey.js';
import {installBiomeTreeForms} from '../biome-tree-forms.js';
import {installBiomeRockForms} from '../biome-rock-forms.js';
import {installBiomeOutcrops} from '../biome-outcrops.js';
import {journeyPoint} from '../forest-journey.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {installExplorationComposition} from '../exploration-composition.js';
import {installAdventureGroundDetail,installHabitatDetail} from '../adventure-ground-detail.js';
import {installForestTerrain,installForestTerrainSteps} from '../forest-terrain.js';
import {BIOME_MACRO_PROFILES,biomeMacroLandforms} from '../biome-macro-landform.js';
import {biomeAt,biomeWeights} from '../confluence.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const climates=['snow','ash','sand','coast'];
function prepare(id,seed){
 const w=buildWorld(id,seed);
 for(const install of[polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installHarborLife,installEnvironmentClusters,installExplorationRoutes,planBiomeJourney,installExplorationLandmarks,installJourneyEscarpment,installBiomeOutcrops,installBiomeTreeForms,installBiomeRockForms,installExplorationComposition,installAdventureGroundDetail,installHabitatDetail])install(w,id);
 w.group.updateMatrixWorld(true);for(const o of w.obstacles)o.height=o.sceneryHeight??Math.max(.15,new T.Box3().setFromObject(o.mesh).max.y);
 return w;
}
const dispose=w=>w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});
const layout=w=>JSON.stringify({spawn:w.spawn,solids:w.obstacles.map(o=>[o.x,o.z,o.r,o.hp,o.state,o.tactic,o.sceneryHeight]),water:w.ponds.map(p=>[p.x,p.z,p.rx,p.rz,p.angle]),rewards:[...w.sites,...w.discoveries].map(p=>[p.x,p.z,p.kind,p.type,p.claimed]),routes:w.explorationRoutes.map(r=>r.points),journeys:(w.biomeJourneys||[w.biomeJourney]).filter(Boolean).map(j=>j.points)});

test('four climate profiles are deterministic local landforms with different cross-sections, not recoloured shared hills',()=>{
 const signatures=[];
 for(const id of climates){
  const w={half:400,spawn:{x:0,z:0},ponds:[],biomeJourney:{biome:id,points:[{x:0,z:0},{x:220,z:0}],length:220}},a=biomeMacroLandforms(w,id,()=>1),b=biomeMacroLandforms(w,id,()=>1);
  assert.deepEqual(a.records,b.records);assert.deepEqual(a.records.map(p=>p.kind),BIOME_MACRO_PROFILES[id].map(p=>p.kind));
  const signature=[];for(let x=-70;x<300;x+=3)for(let z=-90;z<100;z+=3){const h=a.heightAt(x,z);assert(h>=0&&h<=7.5&&Number.isFinite(h));assert.equal(h,b.heightAt(x,z));if(z<-65||z>90)assert.equal(h,0);signature.push(h.toFixed(3));}
  signatures.push(signature.join(','));assert(a.heightAt(0,0)<=1.25,'unprotected trail exceeded its raw height cap');
 }
 assert.equal(new Set(signatures).size,4);
 for(const id of ['forest','unknown',...climates])assert.equal(biomeMacroLandforms({half:96},id,()=>1),null);
});

for(const id of climates)test(`${id}: actual route has broad relief, exact triangle support and preserved water, rewards and solid footprints`,t=>{
 const observations=[];
 for(const seed of[7,522,43837033]){
  const w=prepare(id,seed),before=layout(w),roots=new Map(w.obstacles.map(o=>[o,{y:o.y||0,rootY:o.mesh.position.y,height:o.height}])),nodes=[];
  w.group.traverse(o=>nodes.push(o));const terrain=installForestTerrain(w,id),after=[];w.group.traverse(o=>after.push(o));
  assert.equal(layout(w),before);assert.deepEqual(after,nodes);assert.equal(terrain.cols,144);assert.equal(w.ground.geometry.index.count/3,144*144*2);assert(terrain.macro.length>=1&&terrain.macro.length<=(id==='coast'?6:3));assert.equal(terrain.axisGrade,.22);
  assert(terrain.maxHeight>(id==='coast'?1.8:3.5)&&terrain.maxHeight<=7.5,`${id}/${seed}: protected terrain did not produce visible macro relief`);
  const area=terrain.heights.filter(h=>h>1.5).length*terrain.width/terrain.cols*terrain.height/terrain.rows;assert(area>(id==='coast'?80:1300));assert(terrain.overlayTrianglesAdded<=8192);
  const {cols,rows,width,height,heights}=terrain,dx=width/cols,dz=height/rows;
  for(let z=0;z<=rows;z++)for(let x=0;x<=cols;x++){const i=z*(cols+1)+x;assert(Number.isFinite(heights[i])&&heights[i]>=0);if(x)assert(Math.abs(heights[i]-heights[i-1])<=dx*.22+1e-6);if(z)assert(Math.abs(heights[i]-heights[i-cols-1])<=dz*.22+1e-6);}
  const wet=[...w.ponds.map(p=>({...p,rx:(p.baseRx??p.rx)*(p.baseRx===undefined?1:1.19)*1.12*1.115,rz:(p.baseRz??p.rz)*(p.baseRz===undefined?1:1.19)*1.12*1.115})),...(w.ice||[]).map(p=>({...p,rx:p.rx*1.16,rz:p.rz*1.16}))];
  for(const q of wet)for(const f of[0,.5,1])for(let a=0;a<24;a++){const angle=a*Math.PI/12,u=Math.cos(angle)*q.rx*f,v=Math.sin(angle)*q.rz*f,c=Math.cos(q.angle||0),s=Math.sin(q.angle||0);assert.equal(terrain.sample(q.x+c*u+s*v,q.z-s*u+c*v),0,`${id}/${seed}: water or ice edge raised`);}
  for(const q of[w.spawn,...w.sites,...w.discoveries,...w.explorationLandmarks,...w.biomePlaces])assert.equal(terrain.sample(q.x,q.z),0,'authored interactive/place footprint raised');
  const raised=new Set(terrain.groundedObstacles.map(r=>r.obstacle));
  for(const o of w.obstacles){const previous=roots.get(o);if(!raised.has(o)){assert.equal(o.y||0,previous.y);assert.equal(o.mesh.position.y,previous.rootY);const looseCoast=id==='coast'&&o.r<=.4&&['mooring','cask','net-roll','cargo-sack'].includes(o.mesh.userData.coastPropKind)&&!o.environmentCluster,ordinary=o.mesh.parent===w.group&&(o.mesh.userData.treeBiome===id||['ash','sand'].includes(id)&&Math.abs(o.r-.65)<.0001||looseCoast)&&!o.mesh.userData.forestVistaTrunk&&!o.mesh.userData.district&&!o.mesh.userData.fragile&&!o.tactic&&!o.place&&!w.breakables.includes(o)&&!w.explorationLandmarks.some(p=>p.mesh===o.mesh||p.obstacle?.mesh===o.mesh);if(o.biomeOutcrop)assert(terrain.sample(o.x,o.z)<=1.16,'backing earth buries the cliff face');else if(!ordinary)for(let a=0;a<8;a++)assert.equal(terrain.sample(o.x+Math.cos(a*Math.PI/4)*o.r,o.z+Math.sin(a*Math.PI/4)*o.r),0,'fixed collider footprint raised');continue;}
   assert(!o.tactic&&!o.place&&!o.forestJourney&&!w.breakables.includes(o));assert.equal(o.mesh.position.y-previous.rootY,o.y-previous.y);assert.equal(o.height,previous.height);const box=new T.Box3().setFromObject(o.mesh);assert(Math.abs(box.max.y-(o.y+o.height))<1e-5,'raised mesh and collider top differ');
  }
  w.group.updateMatrixWorld(true);const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),origin=new T.Vector3();let routePeak=0;
  for(let d=0;d<w.biomeJourney.length;d+=3){const p=journeyPoint(w.biomeJourney.points,d),h=terrain.sample(p.x,p.z);routePeak=Math.max(routePeak,h);ray.set(origin.set(p.x,12,p.z),down);const hit=ray.intersectObject(w.ground)[0];assert(hit);assert(Math.abs(hit.point.y-w.ground.position.y-h)<1e-6,'actor support differs from visible triangle');}
  assert(routePeak<=1.26,`trail exceeded its conservative rise cap: ${routePeak}`);
  const actor={...w.biomeJourney.points[0],standHeight:1.8,dashTime:0};resetMobility(actor,terrain.sample(actor.x,actor.z));
  for(let d=0;d<w.biomeJourney.length-.1;d+=.2){const from=journeyPoint(w.biomeJourney.points,d),to=journeyPoint(w.biomeJourney.points,Math.min(d+.2,w.biomeJourney.length));actor.x=from.x;actor.z=from.z;resetMobility(actor,terrain.sample(from.x,from.z));moveActor(w,actor,to.x-from.x,to.z-from.z,.45);assert(Math.hypot(actor.x-to.x,actor.z-to.z)<1e-6,'existing walkable route blocked');assert(Math.abs(actor.y-supportHeight(w,actor))<1e-6);}
  assert(beginJump(actor));for(let i=0;i<90;i++)tickMobility(actor,1/60,{ground:supportHeight(w,actor)});assert(Math.abs(actor.y-terrain.sample(actor.x,actor.z))<1e-6);
  const h=terrain.sample(actor.x,actor.z),entry=segmentGroundEntry({x:actor.x,y:h+1,z:actor.z},{x:actor.x,y:h-1,z:actor.z},terrain.sample);assert(entry!==null&&Math.abs(entry-.5)<.001);
  observations.push({seed,peak:+terrain.maxHeight.toFixed(3),raisedArea:+area.toFixed(1),routePeak:+routePeak.toFixed(3),grounded:raised.size,overlayTriangles:terrain.overlayTrianglesAdded});
  assert.equal(installForestTerrain(w,id),terrain);dispose(w);assert(terrain.disposed);assert.equal(w.groundHeightAt,undefined);
 }
 t.diagnostic(JSON.stringify(observations));
});

test('new climate slopes keep real ground overlays above triangle interiors within the existing subdivision budget',()=>{
 for(const id of climates)for(const seed of[7,522,43837033]){
  const w=prepare(id,seed),overlays=[],point=new T.Vector3();w.group.updateMatrixWorld(true);
  w.group.traverse(mesh=>{if(!mesh.isMesh||mesh.isInstancedMesh||mesh===w.ground||!mesh.userData.ownedGeometry||mesh.userData.groundCue)return;const a=mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);if(point.y<-.06||point.y>.08)return;}overlays.push(mesh);});
  const terrain=installForestTerrain(w,id);let checked=0;
  for(const mesh of overlays){const g=mesh.geometry,p=g.attributes.position,index=g.index,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),count=index?.count??p.count;
   for(let i=0;i<count;i+=3){a.fromBufferAttribute(p,index?.getX(i)??i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,index?.getX(i+1)??i+1).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,index?.getX(i+2)??i+2).applyMatrix4(mesh.matrixWorld);
    for(let u=0;u<=4;u++)for(let v=0;v<=4-u;v++){point.copy(a).multiplyScalar(u/4).addScaledVector(b,v/4).addScaledVector(c,1-(u+v)/4);const h=terrain.sample(point.x,point.z);if(h<=0)continue;assert(point.y>=h+w.ground.position.y-1e-6,`${id}/${seed}: ${mesh.name||'soil overlay'} penetrates slope by ${h+w.ground.position.y-point.y}m (${terrain.overlayTrianglesAdded})`);checked++;}
   }
  }
  assert(checked>100);dispose(w);
 }
});

test('climate terrain keeps sliced preparation deterministic and releases the same owned ground',async()=>{
 const a=prepare('sand',522),b=prepare('sand',522),sync=installForestTerrain(a,'sand'),iterator=installForestTerrainSteps(b,'sand'),stages=[];let step;
 do{step=iterator.next();if(!step.done){stages.push(step.value.stage);if(stages.length%12===0)await new Promise(resolve=>setImmediate(resolve));}}while(!step.done);
 assert(stages.length>40);assert(stages.includes('terrain-height')&&stages.includes('terrain-roots')&&stages.includes('terrain-overlay'));assert.deepEqual(step.value.heights,sync.heights);assert.deepEqual(step.value.macro,sync.macro);assert.equal(layout(a),layout(b));assert.deepEqual(a.obstacles.map(o=>[o.y,o.height]),b.obstacles.map(o=>[o.y,o.height]));dispose(a);dispose(b);assert(sync.disposed&&step.value.disposed);
});

test('route rock faces fit their real solid envelopes and release owned geometry without destroying cached trees',()=>{
 for(const id of['ash','coast','confluence']){
  const w=prepare(id,522),terrain=installForestTerrain(w,id),records=[...(w.biomeOutcrops?.records||[]),...(w.journeyEscarpment?.records||[])],owned=new Map(),cached=new Map(),point=new T.Vector3();w.group.updateMatrixWorld(true);
  assert(records.length>0,id+' has no route rock face');
  for(const record of records){
   const geometry=record.mesh.geometry,vertices=geometry.attributes.position;assert(record.mesh.userData.ownedGeometry);owned.set(geometry,0);geometry.addEventListener('dispose',()=>owned.set(geometry,owned.get(geometry)+1));
   for(let i=0;i<vertices.count;i++){
    point.fromBufferAttribute(vertices,i).applyMatrix4(record.mesh.matrixWorld);
    const solids=record.solids.filter(o=>Math.hypot(point.x-o.x,point.z-o.z)<=o.r+1e-5);assert(solids.length,`${id}: visible cliff vertex outside its solid footprint`);
    assert(solids.some(o=>point.y<=(o.y||0)+(o.sceneryHeight??o.height)+1e-5),`${id}: cliff projects above its collision height`);
    if(w.regions)assert.equal(biomeAt(point.x,point.z),record.biome,'regional cliff crossed the biome boundary');
   }
  }
  for(const scope of[w,...w.regions||[]])for(const {leaf}of scope.foliage||[]){const template=leaf.userData.treeTemplate;if(!leaf.parent||!leaf.userData.biomeTreeForm||!template)continue;for(const geometry of[template.trunk,...template.lods].filter(Boolean))if(!cached.has(geometry)){cached.set(geometry,0);geometry.addEventListener('dispose',()=>cached.set(geometry,cached.get(geometry)+1));}}
  assert(cached.size>0);dispose(w);assert(terrain.disposed);assert.equal(w.groundHeightAt,undefined);
  assert([...owned.values()].every(n=>n===1),'world-owned cliff geometry was not disposed exactly once');assert([...cached.values()].every(n=>n===0),'map teardown destroyed a reusable tree template');
 }
});

test('joined expedition blends regional landforms to zero at climate boundaries and preserves its existing forest and road',t=>{
 const observations=[];
 for(const seed of[7,522,43837033]){
  const w=prepare('confluence',seed),old=prepare('confluence',seed),before=layout(w);delete old.biomeJourneys;
  const baseline=installForestTerrain(old,'confluence'),terrain=installForestTerrain(w,'confluence'),field=biomeMacroLandforms(w,'confluence',()=>1);
  assert.equal(layout(w),before);assert.equal(terrain.cols,160);assert.equal(terrain.axisGrade,.12);assert(terrain.macro.length>0&&terrain.macro.length<=14);
  const peaks={},area={},gain={};let boundaryChecks=0,forestChecks=0;
  for(let i=0;i<terrain.heights.length;i++){
   const x=i%(terrain.cols+1)*terrain.width/terrain.cols-terrain.width/2,z=Math.floor(i/(terrain.cols+1))*terrain.height/terrain.rows-terrain.height/2,id=biomeAt(x,z),weights=biomeWeights(x,z);
   peaks[id]=Math.max(peaks[id]||0,terrain.heights[i]);gain[id]=Math.max(gain[id]||0,terrain.heights[i]-baseline.heights[i]);if(terrain.heights[i]>1.5)area[id]=(area[id]||0)+terrain.width/terrain.cols*terrain.height/terrain.rows;
   if(id==='forest'){assert.equal(terrain.heights[i],baseline.heights[i],`regional upgrade altered forest at ${x},${z}, weights=${JSON.stringify(weights)}`);forestChecks++;}
   if(Math.max(...Object.values(weights))<.7){assert.equal(field.heightAt(x,z),0,'macro field has a cliff at the regional boundary');boundaryChecks++;}
   if(i%(terrain.cols+1))assert(Math.abs(terrain.heights[i]-terrain.heights[i-1])<=terrain.width/terrain.cols*.12+1e-6);
   if(i>terrain.cols)assert(Math.abs(terrain.heights[i]-terrain.heights[i-terrain.cols-1])<=terrain.height/terrain.rows*.12+1e-6);
  }
  assert(forestChecks>100&&boundaryChecks>100);for(const id of climates){assert(terrain.macro.some(p=>p.biome===id),`${seed}/${id}: no regional form`);assert(gain[id]>.1,`${seed}/${id}: no effective new relief (${gain[id]})`);}
  for(const p of w.road){const actor={x:p.x,z:p.z,standHeight:1.8,dashTime:0};resetMobility(actor,terrain.sample(p.x,p.z));assert.equal(supportHeight(w,actor),actor.y);assert(terrain.sample(p.x,p.z)<=1.26,'ring road was raised into a steep ridge');}
  for(const region of w.regions){const p=region.beacon.parent;assert.equal(p.position.y,0,'region beacon moved with ordinary rocks');}
  for(const q of[w.spawn,...w.sites,...w.discoveries])assert.equal(terrain.sample(q.x,q.z),0);
  observations.push({seed,peaks,area,gain,forms:terrain.macro.length,grounded:terrain.groundedObstacles.length,forestChecks,boundaryChecks});dispose(w);dispose(old);
 }
 t.diagnostic(JSON.stringify(observations));
});
