import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {buildWorld,buildWorldSteps,clearAt,animateWorld,moveActor,supportHeight} from '../world.js';
import {createOverheadQuery} from '../adventure-overheads.js';
import {createExplorationNavigator} from '../exploration-routes.js';
import {newExpeditionLayout,NEW_EXPEDITION_MAPS} from '../new-expedition-maps.js';
import {captureWorldState,applyWorldState} from '../multiplayer-world.js';
import {BOSS_ROUTES} from '../boss-roster.js';
import {mapBrief} from '../expedition-brief.js';
import {MAP_ROSTERS} from '../map-enemies.js';
import {AIR_ROSTERS,AIR_ENEMIES} from '../airborne-enemies.js';
import {ENEMIES} from '../rules.js';
import {discoveryInfo,advanceDiscovery} from '../map-discoveries.js';
import {EnvironmentLighting,installDistantLandscape} from '../environment-lighting.js';
import {BIOME_THEMES,scoreBiome} from '../biome-music.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installBiomePlaces} from '../biome-places.js';
import {installClimateLandforms,installJourneyEscarpment} from '../climate-landforms.js';
import {installHarborLife} from '../harbor-life.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {installExplorationRoutes} from '../exploration-routes.js';
import {planForestJourney,finishForestJourney} from '../forest-journey.js';
import {planBiomeJourney} from '../biome-journey.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {installBiomeOutcrops} from '../biome-outcrops.js';
import {installBiomeTreeForms} from '../biome-tree-forms.js';
import {installBiomeRockForms} from '../biome-rock-forms.js';
import {installExplorationComposition} from '../exploration-composition.js';
import {installForestTreeForms,installForestTreeBackdropVariants} from '../forest-tree-forms.js';
import {installWorldLightShafts,installForestMist} from '../world-light-shafts.js';
import {installAdventureGroundDetail,installHabitatDetail} from '../adventure-ground-detail.js';
import {installForestTerrain} from '../forest-terrain.js';
import {installEnvironmentGrounding} from '../environment-grounding.js';
import {installForestFloorRelief} from '../forest-floor-relief.js';
import {installEnvironmentAssets} from '../environment-assets.js';
import {resetMobility,beginJump,tickMobility} from '../adventure-mobility.js';
import {AdventureCamera} from '../adventure-camera.js';
import {waterDepth} from '../water.js';
import {disposeCue} from '../ground-cues.js';

function signature(w){
 return JSON.stringify({spawn:w.spawn,sites:w.sites.map(s=>[s.x,s.z,s.event,s.type,s.availableAt]),obstacles:w.obstacles.map(o=>[o.x,o.z,o.r]),terrain:Array.from(w.authoredTerrain.heights)});
}
for(const id of NEW_EXPEDITION_MAPS)test(`${id}: deterministic playable world, connected routes and bounded geometry`,()=>{
 for(const seed of[1,42,228]){
  const steps=buildWorldSteps(id,seed);let item,yields=0;do{item=steps.next();yields++;}while(!item.done);const w=item.value,copy=buildWorld(id,seed);
  assert.equal(signature(w),signature(copy));assert(yields>10);assert.equal(w.sites.length,5);assert.equal(w.discoveries.length,5);assert.equal(w.roaming.length,2);
  assert(w.obstacles.length<130);assert(w.newScenery.triangles<160000);assert(clearAt(w,w.spawn.x,w.spawn.z,.6));
  const route=w.newScenery.layout.route,navigator=createExplorationNavigator(w);
  for(let i=1;i<route.length;i++){
   const a=route[i-1],b=route[i];assert(navigator.segment(a,b),'authored dry route is blocked');
   for(let j=0;j<=20;j++){const t=j/20,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;assert(clearAt(w,x,z,.6));assert(Number.isFinite(w.groundHeightAt(x,z)));}
  }
  for(const s of [...w.sites,...w.discoveries,...w.roaming]){assert(navigator.route(w.spawn,s).length>=2,'reward inaccessible');assert(clearAt(w,s.x,s.z,1.5));}
  let max=0;for(const h of w.authoredTerrain.heights){assert(Number.isFinite(h)&&h>=0);max=Math.max(max,h);}assert(max>(id==='bellvale'?5:1.8));
  const before=signature(w);animateWorld(w,1,w.spawn.x,w.spawn.z);animateWorld(w,1,w.spawn.x,w.spawn.z);assert.equal(signature(w),before);
 }
});
test('random trees and crystals reserve every discovery footprint across varied seeds',()=>{
 for(const id of NEW_EXPEDITION_MAPS)for(const seed of[6,10,12,14,21,23,28,29,30,37,39,41,44,49,55,58,63,68,73]){
  const w=buildWorld(id,seed);for(const p of w.discoveries)assert(clearAt(w,p.x,p.z,1.5),`${id}:${seed}: discovery occluded`);
 }
});
test('terrain sampler matches actual visible triangle intersections rather than an unrelated height approximation',()=>{
 const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0);
 for(const id of NEW_EXPEDITION_MAPS){
  const w=buildWorld(id,42);w.group.updateMatrixWorld(true);
  for(const [x,z]of [[-58,-2],[-47,-45],[42,32],[25,-43],[-45,55],[0,0]]){
   ray.set(new T.Vector3(x,40,z),down);const hits=ray.intersectObject(w.ground,false);
   assert(hits.length);assert(Math.abs(hits[0].point.y-w.groundHeightAt(x,z))<1e-5);
  }
 }
});
test('cavern has real high overheads and the valley stays open above its route',()=>{
 const cave=buildWorld('crystalcave',42),vale=buildWorld('bellvale',42);
 cave.overhead=createOverheadQuery(cave);vale.overhead=createOverheadQuery(vale);
 assert(cave.overhead.meshes.length>=3);
 const hit=cave.overhead.firstHit({x:-37,y:3,z:22},{x:-37,y:35,z:22});assert(hit&&hit.point.y>10,'cave vault is not solid overhead');
 assert.equal(vale.overhead.firstHit({x:vale.spawn.x,y:3,z:vale.spawn.z},{x:vale.spawn.x,y:35,z:vale.spawn.z}),null);
 assert.equal(cave.newScenery.bells.length,0);assert.equal(vale.newScenery.vaults.length,0);assert.equal(vale.newScenery.bells.length,2);
 for(const p of cave.newScenery.layout.route)assert(cave.overhead.firstHit({x:p.x,y:3,z:p.z},{x:p.x,y:36,z:p.z}),'route must stay under a connected cave roof');
 const ray=new T.Raycaster(new T.Vector3(cave.spawn.x,2,cave.spawn.z),new T.Vector3(0,0,1),0,100),shell=cave.group.getObjectByName('SM_Cavern_ContinuousShell');cave.group.updateMatrixWorld(true);
 assert(ray.intersectObject(shell,false).length,'entry rear view still looks through missing cave walls');
});
test('new-map rewards, ecology and three-boss route use existing authoritative lifecycles',()=>{
 for(const id of NEW_EXPEDITION_MAPS){
  const w=buildWorld(id,42);assert.equal(new Set(BOSS_ROUTES[id]).size,3);const brief=mapBrief(id);assert(brief.goal.includes('三位'));
  for(const [role,kind]of Object.entries(MAP_ROSTERS[id]))assert(role==='boss'||ENEMIES[kind]?.hp>0);
  assert(AIR_ENEMIES[AIR_ROSTERS[id]]);
  for(const n of w.discoveries){const info=discoveryInfo(n);assert(info.name&&info.xp>0);const paused=advanceDiscovery(n,0,{time:500,player:n});assert(!paused.complete);assert(advanceDiscovery(n,.1,{time:500,player:n}).complete);assert(!advanceDiscovery(n,.1,{time:500,player:n}).complete);}
 }
});
test('new worlds replicate unchanged geometry and discoveries without adding a sixth confluence region',()=>{
 for(const id of NEW_EXPEDITION_MAPS){
  const host=buildWorld(id,42),guest=buildWorld(id,42);host.discoveries[0].discovered=true;host.discoveries[0].claimed=true;const data=captureWorldState(host);
  assert(applyWorldState(guest,data,{time:1,player:guest.spawn}));assert(guest.discoveries[0].claimed);assert.equal(data.regions.length,0);assert.equal(data.visited.length,0);
 }
});
test('bell-court mechanism opens a real side gate and replicates removal without blocking the main route',()=>{
 const host=buildWorld('bellvale',42),guest=buildWorld('bellvale',42),site=host.sites.find(s=>s.event==='mechanism'),remote=guest.sites.find(s=>s.event==='mechanism'),gatePoint=host.newScenery.layout.landmarks[2];
 assert.equal(site.gates.length,3);assert(site.gates.every(g=>host.obstacles.includes(g)&&g.mesh.parent===host.group));assert(!clearAt(host,gatePoint.x,gatePoint.z,.45));
 // Capture first, as production does before interaction, to retain stable IDs.
 captureWorldState(host);captureWorldState(guest);
 for(const gate of site.gates){host.group.remove(gate.mesh);host.obstacles=host.obstacles.filter(o=>o!==gate);}site.gates=[];site.claimed=true;site.state='ready';site.eventRun={id:'mechanism',elapsed:2,progress:0,wave:1,lastWarning:-1,done:true,choice:'shortcut'};
 assert(clearAt(host,gatePoint.x,gatePoint.z,.45));
 const packet=captureWorldState(host);assert.equal(packet.removed.length,3);assert(applyWorldState(guest,packet));assert(remote.claimed);assert.equal(remote.gates.length,0);assert(clearAt(guest,gatePoint.x,gatePoint.z,.45));
 assert.equal(guest.obstacles.length,host.obstacles.length);
});
test('new lighting and original music keep separate valley/cavern identity without extra scene lights',()=>{
 const scene=new T.Scene();scene.fog=new T.FogExp2();scene.background=new T.Color();const renderer={toneMappingExposure:1},hemi=new T.HemisphereLight(),sun=new T.DirectionalLight(),rim=new T.DirectionalLight(),light=new EnvironmentLighting(scene,renderer,hemi,sun,rim);
 const values=[];
 for(const id of NEW_EXPEDITION_MAPS){
  light.update(id);values.push([sun.color.getHex(),hemi.color.getHex(),sun.intensity,scene.fog.color.getHex()]);assert(hemi.intensity>1&&sun.intensity>1);assert(renderer.toneMappingExposure>1&&renderer.toneMappingExposure<1.1);
  const w=buildWorld(id,42);assert(id==='crystalcave'?installDistantLandscape(w,id)===null:installDistantLandscape(w,id)?.isMesh);
 }
 assert.notDeepEqual(values[0],values[1]);
 const notes=[];for(const id of NEW_EXPEDITION_MAPS){notes.length=0;const theme=BIOME_THEMES[id];scoreBiome({musicNote:(...args)=>notes.push(args),voice(){},noise(){}},theme,0,0,.3,.5);assert(notes.length>=2);assert(notes.every(n=>n.slice(1).every(Number.isFinite)));}
});
test('production scenery installers preserve authored terrain, route movement, jumps and both camera modes',()=>{
 for(const id of NEW_EXPEDITION_MAPS){
  const w=buildWorld(id,42),sample=w.groundHeightAt,before=signature(w),owned=new Map();
  for(const install of [polishEnvironmentModels,installForestVista,installForestHabitats,installBiomePlaces,installClimateLandforms,installHarborLife,installEnvironmentClusters,installExplorationRoutes,planForestJourney,planBiomeJourney,installExplorationLandmarks,installJourneyEscarpment,installBiomeOutcrops,installBiomeTreeForms,installBiomeRockForms,installExplorationComposition,finishForestJourney,installForestTreeForms])install(w,id);
  w.group.updateMatrixWorld(true);for(const o of w.obstacles)o.height=o.sceneryHeight??Math.max(.15,new T.Box3().setFromObject(o.mesh).max.y);
  for(const install of [installWorldLightShafts,installForestMist,installDistantLandscape,installForestTreeBackdropVariants,installAdventureGroundDetail,installHabitatDetail,installForestTerrain,installEnvironmentGrounding,installForestFloorRelief])install(w,id);
  w.overhead=createOverheadQuery(w);installEnvironmentAssets(w);assert.equal(w.groundHeightAt,sample);assert.equal(signature(w),before);
  const points=w.newScenery.layout.route,p={...w.spawn,standHeight:1.7,dashTime:0},camera=new T.PerspectiveCamera(55,16/9,.05,220),rig=new AdventureCamera(camera);resetMobility(p,sample(p.x,p.z));
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],count=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.3),dx=(b.x-a.x)/count,dz=(b.z-a.z)/count;rig.yaw=Math.atan2(dx,dz);
   for(let j=0;j<count;j++){
    const old={...p};moveActor(w,p,dx,dz,.45);assert(Math.hypot(p.x-old.x-dx,p.z-old.z-dz)<1e-7);assert(Math.abs(p.y-supportHeight(w,p))<1e-7);
    assert(w.ponds.every(pond=>waterDepth(pond,p.x,p.z)===0),'authored dry route entered water');
    for(const mode of ['first','third']){
     rig.setMode(mode);rig.update(1/60,p,w.obstacles,{groundHeight:sample,snap:true});
     const anchor={x:p.x,y:p.y+1.15,z:p.z};
     if(mode==='third'){const hit=w.overhead.firstHit(anchor,camera.position,.25);if(hit)rig.retract(hit.point);assert.equal(w.overhead.firstHit(anchor,camera.position),null);}
     assert(camera.position.toArray().every(Number.isFinite));assert(camera.position.y>=sample(camera.position.x,camera.position.z)+.30);
    }
   }
  }
  assert(beginJump(p));for(let i=0;i<100;i++)tickMobility(p,1/60,{ground:supportHeight(w,p)});assert(Math.abs(p.y-sample(p.x,p.z))<1e-7);
  w.group.traverse(o=>{if(o.userData.ownedGeometry&&!owned.has(o.geometry)){owned.set(o.geometry,0);o.geometry.addEventListener('dispose',()=>owned.set(o.geometry,owned.get(o.geometry)+1));}});
  w.environmentAssets.dispose();w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();disposeCue(o);if(o.userData.ownedGeometry)o.geometry.dispose();});assert([...owned.values()].every(n=>n===1),'owned geometry must have a single release path');
 }
});
