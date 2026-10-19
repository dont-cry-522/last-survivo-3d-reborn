import test from 'node:test';
import assert from 'node:assert/strict';
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
import {installForestTerrain} from '../forest-terrain.js';
import {AdventureCamera} from '../adventure-camera.js';
import {resetMobility} from '../adventure-mobility.js';
import {segmentDistance} from '../rules.js';
import {waterDepth} from '../water.js';
import {planForestJourney,finishForestJourney,ridgeGeometry} from '../forest-journey.js';
import {runtimeImport} from './runtime-import.js';
const {forestSurfaceAssetStatus}=await runtimeImport('forest-journey.js','forest-surface-assets.js');

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const seeds=[1,7,19,43,97,522,2026,43837033];
function prepare(seed,id='forest'){
 const world=buildWorld(id,seed);
 for(const install of[polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installEnvironmentClusters,installExplorationRoutes])install(world,id);
 return world;
}
function release(world){
 if(world.forestJourney?.dispose)world.forestJourney.dispose();else for(const material of world.forestJourney?.materials||[])material.dispose();
 world.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const routeLength=points=>points.reduce((sum,p,i)=>sum+(i?distance(p,points[i-1]):0),0);
const gameplay=world=>JSON.stringify({spawn:world.spawn,sites:world.sites.map(s=>[s.x,s.z,s.type,s.claimed,s.availableAt]),ponds:world.ponds.map(p=>[p.x,p.z,p.rx,p.rz,p.angle]),discoveries:world.discoveries.map(d=>[d.x,d.z,d.kind,d.claimed])});
function checkPath(world,points,label){
 assert(points.length>=2,label+' incomplete');
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];
  for(const obstacle of world.obstacles)assert(segmentDistance(obstacle.x,obstacle.z,a.x,a.z,b.x,b.z)>obstacle.r+.55,label+' crosses collider');
  const steps=Math.ceil(distance(a,b)/.13);
  for(let n=0;n<=steps;n++){
   const x=a.x+(b.x-a.x)*n/steps,z=a.z+(b.z-a.z)*n/steps;
   assert(clearAt(world,x,z,.55),label+' blocked at '+x+','+z);
   assert(world.ponds.every(pond=>waterDepth(pond,x,z)===0),label+' crosses actual water');
  }
 }
}

test('eight actual forest seeds preserve reward routes while adding reachable dry-bank journeys and solid ridges',t=>{
 const stats=[];
 for(const seed of seeds){
  const world=prepare(seed),before=gameplay(world),originalSolids=world.obstacles.slice(),originalRoutes=world.explorationRoutes.map(route=>({route,points:structuredClone(route.points)})),originalFootprints=new Map(originalSolids.map(o=>[o,[o.x,o.z,o.r,o.sceneryHeight,o.height]])),retiredOwned=[];
  try{
   const state=planForestJourney(world,'forest');
   if(!world.forestHabitats?.approach){assert.equal(state,null);stats.push({seed,approach:false});continue;}
   assert(state);assert.strictEqual(planForestJourney(world,'forest'),state);assert.equal(gameplay(world),before);
   const originalSet=new Set(originalSolids),retired=originalSolids.filter(obstacle=>!world.obstacles.includes(obstacle)),added=world.obstacles.filter(obstacle=>!originalSet.has(obstacle));
   assert.equal(retired.length,state.retiredTrees);
   const retained=originalSolids.filter(obstacle=>!retired.includes(obstacle));assert.deepEqual(world.obstacles.filter(obstacle=>originalSet.has(obstacle)),retained,'remaining original colliders reordered');
   for(const obstacle of retained)assert.deepEqual([obstacle.x,obstacle.z,obstacle.r,obstacle.sceneryHeight,obstacle.height],originalFootprints.get(obstacle),'retained obstacle changed');
   for(const obstacle of retired){
    assert.equal(obstacle.mesh.userData.treeBiome,'forest');assert(!obstacle.tactic&&!obstacle.mesh.userData.forestVistaTrunk&&!world.breakables.includes(obstacle)&&obstacle!==world.forestHabitats.elder,'interactive or protected tree retired');
    assert(!obstacle.mesh.userData.district&&!obstacle.mesh.userData.fragile&&!world.sites.some(site=>site.mesh===obstacle.mesh||site.gates?.includes(obstacle)),'interactive scenery retired');
    assert(added.some(cliff=>distance(obstacle,cliff)<cliff.r+obstacle.r+1.401),'retired tree was not within the replaced cliff margin');
    assert.equal(obstacle.mesh.visible,false);assert(obstacle.mesh.parent,'hidden owned geometry detached from world disposal');
    assert(!world.foliage.some(entry=>entry.leaf.parent===obstacle.mesh),'removed crown still receives per-frame animation');
    obstacle.mesh.traverse(mesh=>{if(mesh.userData.ownedGeometry){const tracked={geometry:mesh.geometry,disposed:0};mesh.geometry.addEventListener('dispose',()=>tracked.disposed++);retiredOwned.push(tracked);}});
   }
   for(const obstacle of world.breakables)assert(world.obstacles.includes(obstacle),'destructible gameplay obstacle lost');
   for(const {route,points}of originalRoutes){assert.deepEqual(route.points,points);if(points.length)checkPath(world,points,seed+' original route');}
   assert.deepEqual(state.points[0],world.spawn);assert(state.length>=routeLength(world.forestHabitats.approach.points));
   checkPath(world,state.points,seed+' scenic route');assert.equal(state.landmarks.length,4);assert.equal(new Set(state.landmarks.map(p=>p.id)).size,4);
   for(const p of state.landmarks)assert(clearAt(world,p.x,p.z,.55)&&world.ponds.every(w=>waterDepth(w,p.x,p.z)===0),'landmark is not a standable dry position');
   assert(state.ridges.length<=4);assert.equal(state.group.children.length,state.ridges.length);
   assert.equal(added.length,state.ridges.reduce((sum,run)=>sum+run.length,0));
   for(const obstacle of added){assert(obstacle.forestJourney);assert(!clearAt(world,obstacle.x,obstacle.z,.45));assert(obstacle.sceneryHeight>3&&obstacle.sceneryHeight<9);}
   for(const mesh of state.group.children){assert(mesh.castShadow&&mesh.receiveShadow&&mesh.userData.ownedGeometry);assert(mesh.geometry.boundingSphere.radius>0);for(const key of ['position','normal','uv'])assert([...mesh.geometry.attributes[key].array].every(Number.isFinite));}
   stats.push({seed,approach:true,extended:state.length>routeLength(world.forestHabitats.approach.points)+10,length:Number(state.length.toFixed(2)),ridges:state.ridges.length,solidSegments:added.length,retiredTrees:retired.length,originalRoutes:originalRoutes.length});
  }finally{release(world);assert(retiredOwned.every(entry=>entry.disposed===1),'hidden retired tree geometry not released exactly once');}
 }
 t.diagnostic(JSON.stringify(stats));assert(stats.filter(s=>s.approach).length>=6,'insufficient real-seed coverage');assert(stats.some(s=>s.ridges),'no real ridge exercised');assert(stats.filter(s=>s.extended).length>=4,'bank extension rarely reaches a new view');
});

test('ridge exterior is closed and FrontSide-visible from ends, sides and above, with no degenerate faces',()=>{
 const geometry=ridgeGeometry([{x:0,z:0,r:2.45,height:6},{x:2.5,z:0,r:2.45,height:6},{x:5,z:0,r:2.45,height:6}]),material=new T.MeshBasicMaterial({side:T.FrontSide}),mesh=new T.Mesh(geometry,material),ray=new T.Raycaster();mesh.updateMatrixWorld(true);
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3(),position=geometry.attributes.position,index=geometry.index,edges=new Map();let volume=0;
 try{
  for(let i=0;i<index.count;i+=3){
   const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);
   assert(ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()>1e-7,'degenerate ridge face');volume+=a.dot(ab.crossVectors(b,c))/6;
   for(let edge=0;edge<3;edge++){const x=ids[edge],y=ids[(edge+1)%3],key=Math.min(x,y)+':'+Math.max(x,y),record=edges.get(key)||{count:0,winding:0};record.count++;record.winding+=x<y?1:-1;edges.set(key,record);}
  }
  // A taper may make the first end-on hit a shallow roof rather than a vertical
  // cap. Require a consistently outward closed shell, not an arbitrary 60° face.
  assert([...edges.values()].every(edge=>edge.count===2&&edge.winding===0),'ridge has an open, non-manifold or inconsistently wound edge');
  assert(volume>0,'closed ridge shell is globally inside-out');
  for(const [origin,direction,expected]of[
   [[-3,2,0],[1,0,0],[-1,0,0]],[[8,2,0],[-1,0,0],[1,0,0]],
   [[2.5,2,5],[0,0,-1],[0,0,1]],[[2.5,2,-5],[0,0,1],[0,0,-1]],
   [[2.5,9,0],[0,-1,0],[0,1,0]],[[2.5,-3,0],[0,1,0],[0,-1,0]]
  ]){ray.set(new T.Vector3(...origin),new T.Vector3(...direction));const hit=ray.intersectObject(mesh)[0];assert(hit,'open or back-facing ridge surface from '+origin);assert(hit.face.normal.dot(new T.Vector3(...expected))>1e-5,'surface normal points into ridge');assert(hit.face.normal.dot(ray.ray.direction)<-1e-5,'entry face does not face the external ray');}
 }finally{geometry.dispose();material.dispose();}
});

test('a forest build abandoned between plan and finish releases ridge materials and geometry exactly once',()=>{
 const baseline=forestSurfaceAssetStatus().materialCount;
 for(const seed of[7,522]){
  const world=prepare(seed),state=planForestJourney(world,'forest');assert(state?.materials.length>0);assert(!state.finished);assert.equal(typeof state.dispose,'function');
  const materials=[...new Set(state.materials)],geometries=state.group.children.map(mesh=>mesh.geometry),materialCounts=new Map(materials.map(material=>[material,0])),geometryCounts=new Map(geometries.map(geometry=>[geometry,0]));
  for(const material of materials)material.addEventListener('dispose',()=>materialCounts.set(material,materialCounts.get(material)+1));
  for(const geometry of geometries)geometry.addEventListener('dispose',()=>geometryCounts.set(geometry,geometryCounts.get(geometry)+1));
  state.dispose();state.dispose();release(world);
  assert(state.disposed);assert([...materialCounts.values()].every(count=>count===1));assert([...geometryCounts.values()].every(count=>count===1));assert.equal(forestSurfaceAssetStatus().materialCount,baseline,'aborted build retained live surface materials');
 }
});

test('route tree finishing preserves attached twigs, root footprints, shared templates and releases owned materials once',()=>{
 const countBefore=forestSurfaceAssetStatus().materialCount,world=prepare(522);planForestJourney(world,'forest');installExplorationLandmarks(world,'forest');installExplorationComposition(world,'forest');
 const old=[],shared=new Map();world.group.updateMatrixWorld(true);
 for(const obstacle of world.obstacles){
  const trunk=obstacle.mesh.getObjectByName('tree-trunk'),crown=obstacle.mesh.getObjectByName('tree-canopy'),template=crown?.userData.treeTemplate;if(!trunk||!template)continue;
  const position=trunk.geometry.attributes.position,start=position.count-template.sprays.length*11;
  const tips=template.sprays.map(([x,y,z,,,height],i)=>({index:start+i*11+10,target:new T.Vector3(x,y+height*.24-template.bottom,z)}));
  if(!shared.has(template.trunk))shared.set(template.trunk,template.trunk.attributes.position.array.slice());
  old.push({obstacle,trunk,crown,template,tips,geometry:trunk.geometry,position:position.array.slice(),root:{x:obstacle.x,z:obstacle.z,r:obstacle.r,sx:obstacle.mesh.scale.x,sz:obstacle.mesh.scale.z}});
 }
 const state=finishForestJourney(world);assert(state.trees.length>0);world.group.updateMatrixWorld(true);let tipsChecked=0;
 try{
  assert.strictEqual(finishForestJourney(world),state);const changed=new Set(state.trees.map(p=>p.x+':'+p.z));
  for(const entry of old){
   const {obstacle,trunk,crown,root}=entry;assert.deepEqual({x:obstacle.x,z:obstacle.z,r:obstacle.r,sx:obstacle.mesh.scale.x,sz:obstacle.mesh.scale.z},root);
   assert.deepEqual(entry.geometry.attributes.position.array,entry.position,'original geometry mutated');
   if(!changed.has(obstacle.x+':'+obstacle.z))continue;
   const actual=trunk.geometry.attributes.position,expanded=!trunk.geometry.index,indices=entry.template.trunk.index,original=entry.template.trunk.attributes.position;
   assert.equal(actual.count,expanded?indices.count:original.count,'unexpected branch topology after canopy/UV finish');
   for(const tip of entry.tips){
    // A widened crown legitimately moves its old twig coordinates. Match the
    // current endpoint by topology, including duplicates from bark UV seams.
    const vertices=expanded?Array.from(indices.array).flatMap((index,i)=>index===tip.index?[i]:[]):[tip.index];assert(vertices.length>0,'UV conversion lost actual branch-tip vertex');
    const target=crown.localToWorld(tip.target.clone());
    for(const vertex of vertices){const transformed=trunk.localToWorld(new T.Vector3().fromBufferAttribute(actual,vertex));assert(transformed.distanceTo(target)<1e-5,'twig no longer attaches to crown');}tipsChecked++;
   }
   for(let i=0;i<actual.count;i++){const sourceIndex=expanded?indices.getX(i):i;if(original.getY(sourceIndex)>1.8)continue;for(let axis=0;axis<3;axis++)assert.equal(actual.array[i*3+axis],entry.position[sourceIndex*3+axis],'canopy shaping changed a ground-level root vertex');}
  }
  for(const[geometry,positions]of shared)assert.deepEqual(geometry.attributes.position.array,positions,'shared tree template was changed by route finishing');
  assert(tipsChecked>100);assert(state.framedTrees>0,'fixture did not exercise the new canopy shaping');const materials=[...new Set(state.materials)],counts=new Map(materials.map(m=>[m,0]));for(const material of materials)material.addEventListener('dispose',()=>counts.set(material,counts.get(material)+1));
  state.dispose();state.dispose();assert(state.disposed);assert([...counts.values()].every(n=>n===1));assert.equal(forestSurfaceAssetStatus().materialCount,countBefore);
 }finally{release(world);}
});

test('new dry-bank paths use real terrain support and both camera modes throughout actual movement',()=>{
 for(const seed of[7,522]){
  const world=prepare(seed);try{
   const state=planForestJourney(world,'forest');assert(state);installExplorationLandmarks(world,'forest');installExplorationComposition(world,'forest');finishForestJourney(world);installForestTerrain(world,'forest');
   world.group.updateMatrixWorld(true);for(const obstacle of world.obstacles)obstacle.height=obstacle.sceneryHeight??Math.max(.15,new T.Box3().setFromObject(obstacle.mesh).max.y);
   const actor={...world.spawn,standHeight:1.7},camera=new T.PerspectiveCamera(55,16/9,.05,200),control=new AdventureCamera(camera),ground=world.groundHeightAt;resetMobility(actor,ground?.(actor.x,actor.z)||0);
   let steps=0;for(let i=1;i<state.points.length;i++){
    const a=state.points[i-1],b=state.points[i],n=Math.ceil(distance(a,b)/.12),dx=(b.x-a.x)/n,dz=(b.z-a.z)/n;control.yaw=Math.atan2(dx,dz);
    for(let j=0;j<n;j++){
     const x=actor.x,z=actor.z;moveActor(world,actor,dx,dz,.45);assert(Math.hypot(actor.x-x,actor.z-z)>=Math.hypot(dx,dz)*.99,'new ridge blocks actual movement');assert(Math.abs(actor.y-supportHeight(world,actor))<1e-7,'actor floats from triangle support');
     if(steps++%10===0)for(const mode of['first','third']){control.setMode(mode);control.update(1/60,actor,world.obstacles,{groundHeight:ground,snap:true});assert(camera.position.toArray().every(Number.isFinite));assert(camera.position.y>=(ground?.(camera.position.x,camera.position.z)||0)+.30,'camera under terrain');}
    }
   }
   assert(distance(actor,state.points.at(-1))<1e-6);assert(steps>100);
  }finally{release(world);}
 }
});

test('missing shores and unrelated maps allocate nothing; partial finish safely does nothing',()=>{
 for(const id of['snow','ash','sand','coast','confluence']){const world=prepare(522,id);try{const children=world.group.children.length,obstacles=world.obstacles.length;assert.equal(planForestJourney(world,id),null);assert.equal(finishForestJourney(world),undefined);assert.equal(world.group.children.length,children);assert.equal(world.obstacles.length,obstacles);}finally{release(world);}}
 const world=buildWorld('forest',522);try{const children=world.group.children.length;assert.equal(planForestJourney(world,'forest'),null);assert.equal(world.group.children.length,children);assert.equal(world.forestJourney,undefined);}finally{release(world);}
});
