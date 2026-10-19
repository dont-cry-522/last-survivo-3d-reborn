import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {buildWorld,moveActor,supportHeight,clearAt} from '../world.js';
import {resetMobility,beginJump,tickMobility} from '../adventure-mobility.js';
import {segmentGroundEntry} from '../adventure-combat.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installBiomePlaces} from '../biome-places.js';
import {installClimateLandforms} from '../climate-landforms.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {installExplorationRoutes} from '../exploration-routes.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {installExplorationComposition} from '../exploration-composition.js';
import {installAdventureGroundDetail,installHabitatDetail} from '../adventure-ground-detail.js';
import {planForestJourney,finishForestJourney,journeyPoint} from '../forest-journey.js';
import {installForestTerrain,installForestTerrainSteps} from '../forest-terrain.js';
import {forestMacroLandforms} from '../forest-macro-landform.js';
import {installEnvironmentGrounding} from '../environment-grounding.js';
import {installForestFloorRelief} from '../forest-floor-relief.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
function prepare(seed){
 const w=buildWorld('forest',seed);
 for(const install of[polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installEnvironmentClusters,installExplorationRoutes])install(w,'forest');
 planForestJourney(w,'forest');installExplorationLandmarks(w,'forest');installExplorationComposition(w,'forest');finishForestJourney(w,'forest');
 w.group.updateMatrixWorld(true);for(const o of w.obstacles)o.height=o.sceneryHeight??Math.max(.15,new T.Box3().setFromObject(o.mesh).max.y);
 installAdventureGroundDetail(w,'forest');installHabitatDetail(w,'forest');return w;
}
function release(w){w.forestJourney?.dispose?.();w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});}
const gameplay=w=>JSON.stringify({spawn:w.spawn,sites:w.sites.map(p=>[p.x,p.z,p.type,p.claimed]),discoveries:w.discoveries.map(p=>[p.x,p.z,p.kind,p.claimed]),ponds:w.ponds.map(p=>[p.x,p.z,p.rx,p.rz,p.angle]),routes:w.explorationRoutes.map(p=>p.points),journey:w.forestJourney.points,solids:w.obstacles.map(p=>[p.x,p.z,p.r,p.hp,p.sceneryHeight])});
function overlays(w){
 const out=[],p=new T.Vector3();w.group.updateMatrixWorld(true);
 w.group.traverse(mesh=>{
  if(!mesh.isMesh||mesh.isInstancedMesh||mesh===w.ground||!mesh.userData.ownedGeometry||mesh.userData.groundCue)return;
  const g=mesh.geometry,a=g.attributes.position;if(!a)return;
  for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);if(p.y<-.06||p.y>.08)return;}
  const e={mesh,geometry:g,material:mesh.material,disposed:0};g.addEventListener('dispose',()=>e.disposed++);out.push(e);
 });return out;
}

test('landward slopes form broad drainage hollows and a mid-slope bench without global noise',()=>{
 // Separate the authored cross-section from protected footprints and grade
 // limiting; the multi-seed world test below covers the final visible mesh.
 const w={half:400,spawn:{x:0,z:0},ponds:[],forestJourney:{points:[{x:0,z:0},{x:220,z:0}],length:220,landmarks:[]}};
 const field=forestMacroLandforms(w,()=>1),again=forestMacroLandforms(w,()=>1);
 const at=(p,u,v)=>{const a=u*p.rx,b=v*(v<0?p.front:p.back)+p.bow*(u*u-.35);return field.heightAt(p.x+p.tx*a+p.nx*b,p.z+p.tz*a+p.nz*b);};
 for(const p of field.records.filter(p=>p.kind!=='trail-saddle')){
  assert(at(p,-.3,0)+.6<Math.min(at(p,-.5,0),at(p,-.1,0)),'the first hollow is still a convex mound');
  if(p.kind!=='entry-spur')assert(at(p,.3,0)+.55<Math.min(at(p,.1,0),at(p,.5,0)),'the second spur has no broad saddle');
  assert(Math.abs(at(p,0,.46)-at(p,0,.55))<.09,'mid-slope bench disappeared');
  assert(at(p,0,.35)>at(p,0,.55)+.2);assert(at(p,0,.55)>at(p,0,.8)+.3,'bench no longer falls gently towards the toe');
 }
 for(let x=-80;x<300;x+=2)for(let z=-90;z<110;z+=2){const h=field.heightAt(x,z);assert(Number.isFinite(h)&&h>=0&&h<=8.4);assert.equal(h,again.heightAt(x,z));if(z<-50||z>80)assert.equal(h,0,'local relief leaked across the whole map');}
});

test('creek journey has real traversable hills, exact rendered support and unchanged water, rewards and XZ routes',t=>{
 const diagnostic=[];
 for(const seed of[7,19,522,43837033,9]){
  const w=prepare(seed),before=gameplay(w),original=w.ground.geometry,treeBases=new Map(w.obstacles.map(o=>[o,{y:o.y||0,rootY:o.mesh.position.y,height:o.height}])),children=[];
  w.group.traverse(o=>children.push(o));let originalDisposed=0;original.addEventListener('dispose',()=>originalDisposed++);
  const terrain=installForestTerrain(w,'forest');assert.equal(gameplay(w),before);assert(terrain.macro.length>=3&&terrain.macro.length<=5);assert(terrain.maxHeight>=2.5&&terrain.maxHeight<=8.41);assert.equal(terrain.axisGrade,.22);assert.equal(originalDisposed,1);
  const families=new Set(terrain.macro.map(p=>p.kind));for(const kind of['entry-spur','creek-escarpment','source-shelf','outcrop-backridge'])assert(families.has(kind),`${seed}: missing ${kind}`);
  const highArea=terrain.heights.filter(h=>h>1.5).length*terrain.width/terrain.cols*terrain.height/terrain.rows;
  assert(highArea>1600&&highArea<terrain.width*terrain.height*.25,'terrain must form broad local highlands while leaving a substantial lowland');
  const rockFeet=w.obstacles.filter(o=>o.forestJourney).map(o=>terrain.sample(o.x,o.z));assert(rockFeet.some(h=>h>.25),'cliff remains isolated in a flat moat');assert(rockFeet.every(h=>h<=1.16),'back slope buries the exposed cliff');

  const after=[];w.group.traverse(o=>after.push(o));assert.deepEqual(after,children,'terrain added meshes/materials instead of reshaping the existing floor');
  const {cols,rows,width,height,heights}=terrain,dx=width/cols,dz=height/rows;
  let maxGrade=0;for(let z=0;z<rows;z++)for(let x=0;x<cols;x++){
   const a=z*(cols+1)+x,b=a+cols+1;
   assert(heights[a]>=0&&Number.isFinite(heights[a]));
   for(const[gx,gz]of[[(heights[a+1]-heights[a])/dx,(heights[b]-heights[a])/dz],[(heights[b+1]-heights[b])/dx,(heights[b+1]-heights[a+1])/dz]])maxGrade=Math.max(maxGrade,Math.hypot(gx,gz));
  }assert(maxGrade<=.312,'a triangle slope exceeds the shared walkable slope bound');
  for(const pond of w.ponds){
   const rx=(pond.baseRx??pond.rx)*(pond.baseRx===undefined?1:1.19)*1.12*1.115,rz=(pond.baseRz??pond.rz)*(pond.baseRz===undefined?1:1.19)*1.12*1.115,c=Math.cos(pond.angle||0),s=Math.sin(pond.angle||0);
   for(const f of[0,.5,1])for(let n=0;n<24;n++){const a=n*Math.PI/12,u=Math.cos(a)*rx*f,v=Math.sin(a)*rz*f;assert.equal(terrain.sample(pond.x+c*u+s*v,pond.z-s*u+c*v),0,'water or its highest authored shore moved');}
  }
  for(const site of[...w.sites,...w.discoveries,...w.explorationLandmarks])assert.equal(terrain.sample(site.x,site.z),0,'interactive clearing height changed');
  for(const q of[...(w.biomePlaces||[]).map(p=>({...p,hx:10,hz:10})),...(w.bridges||[]).map(p=>({...p,hx:p.width/2+1,hz:p.length/2+1})),...(w.fords||[]).map(p=>({...p,hx:p.half+1,hz:p.width/2+1}))]){
   const c=Math.cos(q.angle||0),s=Math.sin(q.angle||0);for(const u of[-q.hx,0,q.hx])for(const v of[-q.hz,0,q.hz])assert.equal(terrain.sample(q.x+c*u+s*v,q.z-s*u+c*v),0,'place or water crossing raised');
  }
  const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),origin=new T.Vector3();w.group.updateMatrixWorld(true);
  const path=[];for(let distance=0;distance<=w.forestJourney.length;distance+=2){
   const p=journeyPoint(w.forestJourney.points,distance),h=terrain.sample(p.x,p.z);path.push(h);assert(clearAt(w,p.x,p.z,.45));
   ray.set(origin.set(p.x,8,p.z),down);const hit=ray.intersectObject(w.ground)[0];assert(hit);assert(Math.abs(hit.point.y-w.ground.position.y-h)<2e-6,'foot support does not match the visible triangles');
  }
  assert(Math.max(...path)<1.6,`seed ${seed}: scenic path gains an excessive climb`);
  // Some seeds follow the protected wet bank throughout; they must stay flat.
  if([7,522,43837033].includes(seed)){assert(Math.max(...path)>=.5,'existing dry saddle disappeared');assert(Math.max(...path)-path.at(-1)>.1,'existing route never comes back down');}
  const peak=path.indexOf(Math.max(...path))*2,p=journeyPoint(w.forestJourney.points,peak),actor={x:p.x,z:p.z,standHeight:1.8,dashTime:0};resetMobility(actor,terrain.sample(actor.x,actor.z));
  assert(beginJump(actor));for(let n=0;n<80;n++)tickMobility(actor,1/60,{ground:supportHeight(w,actor)});assert(Math.abs(actor.y-terrain.sample(actor.x,actor.z))<1e-7);
  for(let distance=0;distance<w.forestJourney.length-.1;distance+=.1){
   const from=journeyPoint(w.forestJourney.points,distance),to=journeyPoint(w.forestJourney.points,distance+.1);actor.x=from.x;actor.z=from.z;resetMobility(actor,terrain.sample(from.x,from.z));moveActor(w,actor,to.x-from.x,to.z-from.z,.45);assert(Math.hypot(actor.x-to.x,actor.z-to.z)<1e-6);assert(Math.abs(actor.y-terrain.sample(actor.x,actor.z))<1e-7);
  }
  const h=terrain.sample(p.x,p.z),entry=segmentGroundEntry({x:p.x,y:h+1,z:p.z},{x:p.x,y:h-1,z:p.z},terrain.sample);assert(entry!==null&&Math.abs(entry-.5)<.001);
  const grounded=new Set(terrain.groundedObstacles.map(r=>r.obstacle));assert(grounded.size>20);
  for(const o of w.obstacles){const base=treeBases.get(o);if(!grounded.has(o)){assert.equal(o.y||0,base.y);assert.equal(o.mesh.position.y,base.rootY);continue;}
   assert.equal(o.mesh.position.y-base.rootY,o.y-base.y);assert.equal(o.height,base.height);assert(!o.tactic&&!o.forestJourney&&!w.breakables.includes(o));
   const bound=new T.Box3().setFromObject(o.mesh);assert(Math.abs(bound.max.y-(o.y+o.height))<1e-5,'collider top and raised visual tree disagree');
   const trunk=o.mesh.getObjectByName('tree-trunk'),a=trunk.geometry.attributes.position,point=new T.Vector3();let lowest=Infinity;
   for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(trunk.matrixWorld);lowest=Math.min(lowest,point.y);}
   for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(trunk.matrixWorld);if(point.y<=lowest+.08)assert(point.y<=terrain.sample(point.x,point.z)-.014,'downhill root ring is floating');}
  }
  assert.equal(installForestTerrain(w,'forest'),terrain);diagnostic.push({seed,peak:+terrain.maxHeight.toFixed(3),routePeak:+Math.max(...path).toFixed(3),highArea:+highArea.toFixed(1),maxGrade:+maxGrade.toFixed(3),raisedTrees:grounded.size});release(w);assert(terrain.disposed);assert.equal(w.groundHeightAt,undefined);
 }
 t.diagnostic(JSON.stringify(diagnostic));
});

test('macro slopes retain ground decals, plant batches and root shoulders without buried patches or leaked geometry',()=>{
 for(const seed of[7,522,43837033]){
  const w=prepare(seed),entries=overlays(w),matrix=new T.Matrix4(),instances=[];
  for(const group of[w.adventureGroundDetail,w.habitatDetail,w.environmentClusters?.group])for(const mesh of group?.children||[])if(mesh.isInstancedMesh)for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);instances.push({mesh,i,before:matrix.clone()});}
  const terrain=installForestTerrain(w,'forest');assert(terrain.overlayTrianglesAdded<=8192);
  for(const {mesh,i,before}of instances){mesh.getMatrixAt(i,matrix);const p=new T.Vector3().setFromMatrixPosition(before).applyMatrix4(mesh.matrixWorld),h=terrain.sample(p.x,p.z);assert(Math.abs(matrix.elements[13]-before.elements[13]-h)<1e-6);for(const n of[0,2,8,10,12,14])assert.equal(matrix.elements[n],before.elements[n]);}
  let checked=0;
  for(const e of entries){
   const mesh=e.mesh,g=mesh.geometry,a=g.attributes.position,index=g.index,p=new T.Vector3(),pa=new T.Vector3(),pb=new T.Vector3(),pc=new T.Vector3();assert.equal(mesh.material,e.material);
   const count=index?.count??a.count;
   for(let i=0;i<count;i+=3){
    pa.fromBufferAttribute(a,index?.getX(i)??i).applyMatrix4(mesh.matrixWorld);pb.fromBufferAttribute(a,index?.getX(i+1)??i+1).applyMatrix4(mesh.matrixWorld);pc.fromBufferAttribute(a,index?.getX(i+2)??i+2).applyMatrix4(mesh.matrixWorld);
    for(let u=0;u<=4;u++)for(let v=0;v<=4-u;v++){p.copy(pa).multiplyScalar(u/4).addScaledVector(pb,v/4).addScaledVector(pc,1-(u+v)/4);const floor=terrain.sample(p.x,p.z)+w.ground.position.y;assert(p.y>=floor-1e-6,`seed ${seed}: ${mesh.name||'ground overlay'} buried ${floor-p.y}m after ${terrain.overlayTrianglesAdded} subdivisions`);checked++;}
   }
  }assert(checked>1000);
  installEnvironmentGrounding(w);const caps=installForestFloorRelief(w,'forest'),p=caps.geometry.attributes.position;let raised=0;
  for(const r of caps.userData.records){if(terrain.sample(r.x,r.z)>.1)raised++;for(let i=r.start;i<r.start+r.count;i++){
   const relative=p.getY(i)-terrain.sample(p.getX(i),p.getZ(i));assert(relative<=.221&&relative>=-.039);if(i>=r.start+r.count-16)assert(relative<-.035,'root shoulder rim no longer meets local terrain');
  }}assert(raised>0,'root shoulder test never reached elevated ground');
  release(w);assert(entries.every(e=>e.disposed===1));assert(caps.userData.disposed);
 }
});


test('terrain preparation yields between bounded work batches without changing the final surface or object attachments',async()=>{
 const a=prepare(522),b=prepare(522),sync=installForestTerrain(a,'forest'),steps=installForestTerrainSteps(b,'forest'),events=[];let step;
 do{step=steps.next();if(!step.done){events.push(step.value);if(events.length%9===0)await new Promise(resolve=>setImmediate(resolve));}}while(!step.done);
 const sliced=step.value;assert(events.length>40);for(const stage of['terrain-plan','terrain-height','terrain-colour','terrain-grade','terrain-roots','terrain-plants','terrain-overlay'])assert(events.some(p=>p.stage===stage),`missing preparation yield: ${stage}`);
 assert.deepEqual(sliced.heights,sync.heights);assert.deepEqual(b.ground.geometry.attributes.position.array,a.ground.geometry.attributes.position.array);assert.deepEqual(b.ground.geometry.attributes.normal.array,a.ground.geometry.attributes.normal.array);
 assert.deepEqual(sliced.macro,sync.macro);assert.equal(sliced.draped,sync.draped);assert.equal(sliced.overlayTrianglesAdded,sync.overlayTrianglesAdded);assert.equal(gameplay(a),gameplay(b));
 assert.deepEqual(a.obstacles.map(o=>[o.y,o.height,o.mesh.position.y]),b.obstacles.map(o=>[o.y,o.height,o.mesh.position.y]));
 const attrs=w=>{const buffers=[];w.group.traverse(o=>{if(o.isInstancedMesh)buffers.push(o.instanceMatrix.array);else if(o.userData.ownedGeometry)buffers.push(o.geometry.attributes.position.array);});return buffers;};assert.deepEqual(attrs(a),attrs(b));
 const again=installForestTerrainSteps(b,'forest').next();assert(again.done);assert.equal(again.value,sliced);
 release(a);release(b);assert(sync.disposed&&sliced.disposed);assert.equal(a.groundHeightAt,undefined);assert.equal(b.groundHeightAt,undefined);
 for(const id of['unknown','forest','snow']){const empty={};assert.deepEqual(installForestTerrainSteps(empty,id).next(),{value:null,done:true});assert.equal(empty.groundHeightAt,undefined);}
});
