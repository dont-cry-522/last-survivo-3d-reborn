import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {EnvironmentLighting,forestLightingContext,FOREST_CYCLE} from '../environment-lighting.js';
import {installWorldLightShafts,installForestMist,updateWorldLightShafts} from '../world-light-shafts.js';

function rig(){
 const scene=new T.Scene();scene.fog=new T.FogExp2();scene.background=new T.Color();
 const sun=new T.DirectionalLight(),hemi=new T.HemisphereLight(),rim=new T.DirectionalLight();scene.add(sun,hemi,rim);
 return new EnvironmentLighting(scene,{toneMappingExposure:1},hemi,sun,rim);
}
const values=l=>[l.hemi.intensity,l.sun.intensity,l.rim.intensity,l.scene.fog.density,l.renderer.toneMappingExposure,...l.scene.fog.color.toArray()];
function world(){return{half:96,group:new T.Group(),spawn:{x:-65,z:55},sites:[],obstacles:[],patches:[],ponds:[],forestJourney:{landmarks:[{x:-42,z:0,kind:'entry',canopy:.7},{x:-14,z:10,kind:'bend',canopy:1},{x:14,z:0,kind:'pool',canopy:.45},{x:42,z:10,kind:'overlook',canopy:.12}]}};}

test('forest route context is local, smoothly bounded and reuses its output',()=>{
 const w=world();assert.equal(forestLightingContext({},0,0),null);
 const result=forestLightingContext(w,-14,10);assert(result.canopy>.95&&result.canopy<=1);assert.equal(result.water,0);
 assert.equal(forestLightingContext(w,14,0),result);assert.equal(result.water,1);
 assert.equal(forestLightingContext(w,90,90),result);assert.deepEqual(result,{canopy:0,water:0});
 let previous={canopy:0,water:0};for(let x=-80;x<80;x+=.05){
  const sample=forestLightingContext(w,x,0);assert(sample.canopy>=0&&sample.canopy<=1&&sample.water>=0&&sample.water<=1);
  assert(Math.abs(sample.canopy-previous.canopy)<.012&&Math.abs(sample.water-previous.water)<.012,'landmark boundary creates a lighting pop');previous={...sample};
 }
 forestLightingContext(w,NaN,0);assert.deepEqual(result,{canopy:0,water:0});
});

test('woodland shade retains visibility, exposure and moonlight without affecting other climates',()=>{
 const base=rig(),local=rig(),night=(Math.PI*1.5-FOREST_CYCLE.startAngle)/Math.PI/2*FOREST_CYCLE.seconds;
 for(const time of[0,120,night]){
  base.update('forest',null,0,time);local.update('forest',null,0,time,{canopy:1,water:1});
  assert(local.sun.intensity>=base.sun.intensity*.86-1e-12&&local.sun.intensity<=base.sun.intensity);
  assert(local.hemi.intensity>=base.hemi.intensity&&local.hemi.intensity<=base.hemi.intensity+.06+1e-12);
  assert.equal(local.renderer.toneMappingExposure,base.renderer.toneMappingExposure);
  assert(Math.exp(-((local.scene.fog.density*20)**2))>.94,'local haze obscures combat silhouettes');
  assert.equal(local.scene.children.length,3);assert(local.direction.equals(base.direction));
 }
 assert.equal(local.sun.intensity,base.sun.intensity,'night acquired an additional darkness penalty');
 for(const map of['snow','ash','sand','coast']){base.update(map,null,0,0);local.update(map,null,0,0,{canopy:1,water:1});assert.deepEqual(values(local),values(base));}
 base.update('forest',null,0,0);local.update('forest',null,0,0,{canopy:NaN,water:Infinity});assert.deepEqual(values(local),values(base));
});

test('local forest adjustment respects climate weights and frame-independent transitions',()=>{
 const base=rig(),local=rig(),pureBase=rig(),pureLocal=rig();
 pureBase.update('forest',null,0,0);pureLocal.update('forest',null,0,0,{canopy:1,water:1});
 const weights={forest:.2,snow:.8};base.update('confluence',weights,0,0);local.update('confluence',weights,0,0,{canopy:1,water:1});
 for(let i=0;i<values(base).length;i++)assert(Math.abs(values(local)[i]-values(base)[i]-(values(pureLocal)[i]-values(pureBase)[i])*.2)<1e-12);
 const slow=rig(),fast=rig();slow.update('forest',null,0,0);fast.update('forest',null,0,0);
 for(let i=0;i<60;i++){slow.update('forest',null,1/30,0,{canopy:1,water:1});for(let j=0;j<2;j++)fast.update('forest',null,1/60,0,{canopy:1,water:1});}
 assert(values(slow).every((v,i)=>Math.abs(v-values(fast)[i])<1e-12));
});

test('route light and mist anchors replace the existing allocation without following the player',()=>{
 for(const mobile of[false,true]){
  const w=world(),before=JSON.stringify({spawn:w.spawn,landmarks:w.forestJourney.landmarks,obstacles:w.obstacles});
  const shafts=installWorldLightShafts(w,'forest'),mist=installForestMist(w,'forest',{mobile});
  assert.equal(shafts.count,4);assert.equal(mist.count,mobile?3:6);assert.equal(w.group.children.length,2);
  for(const point of w.forestJourney.landmarks)assert(shafts.userData.anchors.some(p=>Math.hypot(point.x-p.x,point.z-p.z)<6.6),'landmark was omitted in favor of an unrelated site');
  const pool=w.forestJourney.landmarks.find(p=>p.kind==='pool');assert(Math.hypot(mist.userData.anchors[0].x-pool.x,mist.userData.anchors[0].z-pool.z)<=18);
  assert(mist.material.fragmentShader.indexOf('#include <tonemapping_fragment>')<mist.material.fragmentShader.indexOf('#include <colorspace_fragment>'));
  const transforms=Array.from(mist.instanceMatrix.array);updateWorldLightShafts(w,2);w.spawn.x+=4;updateWorldLightShafts(w,2);w.spawn.x-=4;assert.deepEqual(Array.from(mist.instanceMatrix.array),transforms);
  assert.equal(JSON.stringify({spawn:w.spawn,landmarks:w.forestJourney.landmarks,obstacles:w.obstacles}),before);
  shafts.dispose();mist.dispose();assert(mist.userData.disposed&&shafts.userData.disposed);
 }
});
