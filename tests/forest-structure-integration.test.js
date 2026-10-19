import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {buildWorld,clearAt,moveActor,supportHeight} from '../world.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installBiomePlaces} from '../biome-places.js';
import {installClimateLandforms} from '../climate-landforms.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {installExplorationRoutes} from '../exploration-routes.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {installExplorationComposition} from '../exploration-composition.js';
import {planForestJourney,finishForestJourney} from '../forest-journey.js';
import {installForestTreeForms,installForestTreeBackdropVariants} from '../forest-tree-forms.js';
import {installWorldLightShafts,installForestMist,updateWorldLightShafts} from '../world-light-shafts.js';
import {installDistantLandscape} from '../environment-lighting.js';
import {installAdventureGroundDetail,installHabitatDetail} from '../adventure-ground-detail.js';
import {installForestTerrain} from '../forest-terrain.js';
import {installEnvironmentGrounding} from '../environment-grounding.js';
import {installForestFloorRelief} from '../forest-floor-relief.js';
import {createOverheadQuery} from '../adventure-overheads.js';
import {AdventureCamera} from '../adventure-camera.js';
import {resetMobility} from '../adventure-mobility.js';
import {segmentHitsBody,segmentGroundEntry} from '../adventure-combat.js';
import {fitGroundCue,disposeCue} from '../ground-cues.js';
import {waterDepth} from '../water.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
// Captured from the complete v218 snapshot before this structural upgrade.
// Only game layout is fingerprinted: art topology/materials/heights are free to improve.
const BASELINE={7:{before:'50f444cfbfc968e88278f82c97876fabf515ba70411be8e1124ed046b8bd7b50',finished:'3f1586ac52f8d18192177670725d19e2e03e1a347cfa830f146d0df069f32f60'},522:{before:'db2094ec8db9f97d751ca1c547580faf0b1aef86630e33f5b177b2a80ac5f3b5',finished:'c40d0bf3d6c18fe59d532b9dfcb1f5d8353fedf8edcf4c266eab2ea189bf4814'}};
const gameplay=w=>({spawn:w.spawn,sites:w.sites.map(p=>[p.x,p.z,p.type,p.claimed,p.availableAt]),discoveries:w.discoveries.map(p=>[p.x,p.z,p.kind,p.claimed,p.nodes?.map(n=>[n.x,n.z])]),ponds:w.ponds.map(p=>[p.x,p.z,p.rx,p.rz,p.angle]),routes:w.explorationRoutes.map(r=>r.points),breakables:w.breakables.map(p=>[p.x,p.z,p.r,p.hp,p.state,p.tactic])});
const digest=w=>createHash('sha256').update(JSON.stringify(gameplay(w))).digest('hex');
const near=(a,b,message,tolerance=1e-6)=>assert(Math.abs(a-b)<tolerance,`${message}: ${a} vs ${b}`);
function trackResource(resources,resource){if(!resource||resources.has(resource))return;const entry={count:0};resources.set(resource,entry);resource.addEventListener('dispose',()=>entry.count++);}
function trackOwned(w,resources){w.group.traverse(o=>{if(o.userData.ownedGeometry)trackResource(resources,o.geometry);if(o.isInstancedMesh)trackResource(resources,o);});}
function release(w){w.forestJourney?.dispose?.();w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();disposeCue(o);if(o.userData.ownedGeometry)o.geometry.dispose();});}

function prepare(seed,resources,shared){
 const w=buildWorld('forest',seed);
 for(const install of [polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installEnvironmentClusters,installExplorationRoutes])install(w,'forest');
 assert.equal(digest(w),BASELINE[seed].before,'existing game layout differs from the v218 snapshot');assert.equal(w.explorationRoutes.length,5);
 trackOwned(w,resources);planForestJourney(w,'forest');installExplorationLandmarks(w,'forest');installExplorationComposition(w,'forest');finishForestJourney(w);trackOwned(w,resources);
 installForestTreeForms(w,'forest');assert(w.forestTreeForms?.trees.length>0);
 for(const entry of w.forestTreeForms.trees){const crown=entry.root.getObjectByName('tree-canopy'),template=crown.userData.treeTemplate;for(const geometry of [template.trunk,...template.lods])trackResource(shared,geometry);}
 w.group.updateMatrixWorld(true);for(const o of w.obstacles)o.height=o.sceneryHeight??Math.max(.15,new T.Box3().setFromObject(o.mesh).max.y);
 installWorldLightShafts(w,'forest');installForestMist(w,'forest');installDistantLandscape(w,'forest');installForestTreeBackdropVariants(w,'forest');
 assert.equal(w.forestBackdrop.children.length,6);assert.equal(w.forestBackdrop.userData.records.length,240);
 for(const mesh of w.forestBackdrop.children)trackResource(shared,mesh.geometry);
 installAdventureGroundDetail(w,'forest');installHabitatDetail(w,'forest');trackOwned(w,resources);
 const footprints=w.obstacles.map(o=>[o,o.x,o.z,o.r,o.hp,o.state]),terrain=installForestTerrain(w,'forest');
 installEnvironmentGrounding(w);installForestFloorRelief(w,'forest');w.group.traverse(o=>{if(o.userData.groundCue)fitGroundCue(o,w.groundHeightAt);});w.overhead=createOverheadQuery(w);w.group.updateMatrixWorld(true);
 for(const [o,x,z,r,hp,state]of footprints)assert.deepEqual([o.x,o.z,o.r,o.hp,o.state],[x,z,r,hp,state],'elevation changed a collision footprint or combat state');
 assert.equal(digest(w),BASELINE[seed].finished,'forest structure moved a reward, water boundary, or original route');assert.equal(w.explorationRoutes.length,6,'five reward routes plus the v218 creek journey');
 trackOwned(w,resources);for(const material of w.forestJourney.materials)trackResource(resources,material);
 for(const resource of [w.environmentGrounding.material,w.environmentGrounding.texture,w.lightShafts?.material,w.forestMist?.material])trackResource(resources,resource);
 assert(terrain.macro.length>0&&terrain.groundedObstacles.length>0);return w;
}

function walkRoute(w,points,stats){
 assert(points.length>=2);const actor={...points[0],standHeight:1.7,dashTime:0},camera=new T.PerspectiveCamera(55,16/9,.05,220),rig=new AdventureCamera(camera),ground=w.groundHeightAt;
 resetMobility(actor,ground(actor.x,actor.z));let steps=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z),count=Math.max(1,Math.ceil(length/.28)),dx=(b.x-a.x)/count,dz=(b.z-a.z)/count;rig.yaw=Math.atan2(dx,dz);
  for(let n=0;n<count;n++){
   const old={x:actor.x,y:actor.y,z:actor.z};moveActor(w,actor,dx,dz,.45);
   near(actor.x,old.x+dx,'route movement blocked in X');near(actor.z,old.z+dz,'route movement blocked in Z');near(actor.y,supportHeight(w,actor),'actor lost visible terrain support');
   assert(clearAt(w,actor.x,actor.z,.45));assert(w.ponds.every(pond=>waterDepth(pond,actor.x,actor.z)===0),'dry route entered water');
   if(length>0)assert(Math.abs(actor.y-old.y)/Math.hypot(dx,dz)<=.312,'actual route crossed an abrupt terrain step');
   stats.peak=Math.max(stats.peak,actor.y);stats.steps++;
   if(steps++%11===0){
    for(const mode of ['first','third']){
     rig.setMode(mode);rig.update(1/60,actor,w.obstacles,{groundHeight:ground,snap:true});
     const anchor={x:actor.x,y:actor.y+1.15,z:actor.z};
     if(mode==='third'){const hit=w.overhead.firstHit(anchor,camera.position,.25);if(hit)rig.retract(hit.point);assert.equal(w.overhead.firstHit(anchor,camera.position),null,'third-person camera remained behind solid scenery');}
     assert(camera.position.toArray().every(Number.isFinite));assert(camera.position.y>=ground(camera.position.x,camera.position.z)+.30,'camera fell below visible ground');stats.views[mode]++;
    }
   }
  }
 }
 near(actor.x,points.at(-1).x,'route endpoint X');near(actor.z,points.at(-1).z,'route endpoint Z');
}

function checkRaisedTrees(w){
 let newForms=0;const point=new T.Vector3(),bounds=new T.Box3();
 for(const {obstacle:o}of w.forestTerrain.groundedObstacles){
  const root=o.mesh,trunk=root.getObjectByName('tree-trunk'),positions=trunk.geometry.attributes.position;bounds.setFromObject(root);
  near(bounds.max.y,o.y+o.height,'raised collider top differs from visible tree');assert(!clearAt(w,o.x,o.z,.45,o.y+1),'standing tree ceased to be solid');
  assert(segmentHitsBody(o.x-o.r-1,o.y+1,o.z,o.x+o.r+1,o.y+1,o.z,o),'spatial shot passes through raised trunk');
  assert(!segmentHitsBody(o.x-o.r-1,o.y+o.height+.3,o.z,o.x+o.r+1,o.y+o.height+.3,o.z,o),'raised cylinder extends beyond its measured top');
  let lowest=Infinity;for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(trunk.matrixWorld);lowest=Math.min(lowest,point.y);}
  let closest=-Infinity;for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(trunk.matrixWorld);if(point.y>lowest+.08)continue;const gap=point.y-w.groundHeightAt(point.x,point.z);assert(gap<=-.014,'root ring is floating downhill');closest=Math.max(closest,gap);}
  near(closest,-.015,'entire root ring was buried instead of seated',1e-5);
  if(root.userData.forestTreeForm)newForms++;
 }
 assert(newForms>0,'combined test never exercised a replacement tree on a raised slope');return newForms;
}

function checkOverheads(w){
 // Hit actual authored triangles; a batch AABB may contain a wide empty arch.
 assert(w.overhead.meshes.length>0);const a=new T.Vector3(),b=a.clone(),c=a.clone(),normal=a.clone();let checked=0;
 for(const mesh of w.overhead.meshes){
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index,count=index?.count??p.count;
  for(let i=0;i<count;i+=3){
   a.fromBufferAttribute(p,index?.getX(i)??i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,index?.getX(i+1)??i+1).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,index?.getX(i+2)??i+2).applyMatrix4(mesh.matrixWorld);
   normal.crossVectors(b.clone().sub(a),c.clone().sub(a));if(normal.lengthSq()<1e-9)continue;
   normal.normalize();const center=a.clone().add(b).add(c).multiplyScalar(1/3),from=center.clone().addScaledVector(normal,.04),to=center.clone().addScaledVector(normal,-.04),hit=w.overhead.firstHit(from,to);
   assert(hit,'authored overhead no longer returns its first segment hit');assert(hit.distance>=0&&hit.distance<=.081);assert(Number.isFinite(hit.point.y));checked++;break;
  }
 }
 assert(checked>0);return checked;
}

for(const seed of [7,522])test(`forest structure integrates actual tree, terrain, route and camera pipelines for seed ${seed}`,t=>{
 const resources=new Map(),shared=new Map();let w;
 try{
  w=prepare(seed,resources,shared);const stats={seed,steps:0,peak:0,views:{first:0,third:0}};
  for(const route of w.explorationRoutes)walkRoute(w,route.points,stats);
  assert(stats.steps>300&&stats.peak>.4);assert(stats.views.first>20&&stats.views.third===stats.views.first);
  stats.raisedNewTrees=checkRaisedTrees(w);stats.overheads=checkOverheads(w);
  // Existing lighting layers are installed before terrain. Their first real
  // update must re-seat them once, without cumulative drift while paused.
  updateWorldLightShafts(w,0);const matrix=new T.Matrix4();
  for(const [layer,offset]of [[w.lightShafts,.40],[w.forestMist,.08]])if(layer){
   const before=layer.instanceMatrix.array.slice();updateWorldLightShafts(w,0);assert.deepEqual(layer.instanceMatrix.array,before);
   for(const [i,p]of layer.userData.anchors.entries()){layer.getMatrixAt(i,matrix);near(matrix.elements[13],w.groundHeightAt(p.x,p.z)+offset,'atmosphere layer detached from new terrain');}
  }
  const terrain=w.forestTerrain,peak=terrain.heights.indexOf(terrain.maxHeight),x=(peak%(terrain.cols+1))*terrain.width/terrain.cols-terrain.width/2,z=Math.floor(peak/(terrain.cols+1))*terrain.height/terrain.rows-terrain.height/2,y=w.groundHeightAt(x,z);
  near(segmentGroundEntry({x,y:y+1,z},{x,y:y-1,z},w.groundHeightAt),.5,'spatial projectile floor differs from visible hill',1e-4);
  t.diagnostic(JSON.stringify({...stats,ownedResources:resources.size,sharedGeometries:shared.size}));
 }finally{
  if(w){release(w);w.forestJourney.dispose();assert(w.forestTerrain.disposed&&w.environmentGrounding.disposed&&w.forestFloorRelief.userData.disposed);assert.equal(w.groundHeightAt,undefined);}
  if(w)assert.deepEqual([...resources].filter(([,r])=>r.count!==1).map(([resource,r])=>[resource.name||resource.type,r.count]),[],'world-owned geometry, material or instance leaked or disposed twice');assert([...shared.values()].every(r=>r.count===0),'world cleanup disposed application-shared tree templates');
 }
});
