import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {primeWorldShadowLights,withSceneryBatchSamples,prepareScenerySamples} from '../render-prewarm.js';

// Exercise this repository's real public compile(), light state, instance-buffer
// update and shadow traversal without requiring a browser/GPU in unit tests.
const vendor=readFileSync(new URL('../vendor/three.module.js',import.meta.url),'utf8');
const lightsSource=vendor.slice(vendor.indexOf('function UniformsCache('),vendor.indexOf('const vertex =',vendor.indexOf('function WebGLRenderStates(')));
const compileSource=vendor.slice(vendor.indexOf('this.compile = function ('),vendor.indexOf('// compileAsync')).replace('this.compile =','const compile =');
const createLightRenderer=()=>vm.runInNewContext(`(function(){
 ${lightsSource}
 let currentRenderState;
 const renderStateStack=[],renderStates=new WebGLRenderStates({has:()=>false,get:()=>null});
 function prepareMaterial(){throw Error('light-only priming must not compile a material');}
 ${compileSource}
 return {compile,getState:scene=>renderStates.get(scene).state,initScene:(scene,camera)=>renderStates.get(scene).init(camera)};
})()`,{...T});
const WebGLObjects=vm.runInNewContext('('+vendor.slice(vendor.indexOf('function WebGLObjects('),vendor.indexOf('const emptyTexture ='))+')',{});
const shadowSource=vendor.slice(vendor.indexOf('const vertex =',vendor.indexOf('function WebGLRenderStates(')),vendor.indexOf('const reversedFuncs ='));
const WebGLShadowMap=vm.runInNewContext(`(function(){${shadowSource};return WebGLShadowMap;})()`,{...T});

test('public empty-group compile prepares exact previous-pass lights without a draw or material compilation',()=>{
 const renderer=createLightRenderer(),scene=new T.Scene(),camera=new T.PerspectiveCamera();
 const sun=new T.DirectionalLight(),point=new T.PointLight(),fill=new T.PointLight(),rim=new T.PointLight(),hiddenParent=new T.Group();
 sun.castShadow=true;sun.layers.enable(1);hiddenParent.visible=false;hiddenParent.add(new T.PointLight());
 scene.add(sun,point,fill,rim,hiddenParent,new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()));
 camera.layers.set(0);renderer.compile(new T.Group(),camera,scene);
 const state=renderer.getState(scene);assert.equal(state.lights.state.point.length,3);
 scene.remove(fill,rim);camera.layers.enable(5);const mask=camera.layers.mask,children=[...scene.children],programs=[];
 const compile=renderer.compile;renderer.compile=function(subject,c,target){programs.push(subject);return compile(subject,c,target);};
 for(const layer of [0,1,0,1]){
  const ready=primeWorldShadowLights(renderer,scene,camera,layer);
  assert.equal(ready.size,0);assert.equal(camera.layers.mask,mask);
  assert.equal(state.lights.state.point.length,layer===0?1:0);
  assert.equal(state.lights.state.directional.length,1);
  assert.equal(state.shadowsArray.length,1);
  // init() precedes the next shadow draw and deliberately leaves light uniforms
  // from the prior pass intact until setupLights() after that shadow draw.
  renderer.initScene(scene,camera);assert.equal(state.lights.state.point.length,layer===0?1:0);
 }
 assert(programs.every(subject=>subject===programs[0]&&subject.isGroup&&subject.children.length===0));
 assert.deepEqual(scene.children,children);assert.equal(point.parent,scene);assert.equal(sun.shadow.map,null);
 scene.children.find(o=>o.isMesh).geometry.dispose();scene.children.find(o=>o.isMesh).material.dispose();
});

test('light priming restores the original camera mask on a compile failure',()=>{
 const camera=new T.PerspectiveCamera();camera.layers.set(7);camera.layers.enable(3);const mask=camera.layers.mask,scene=new T.Scene(),error=Error('compile failed');
 assert.throws(()=>primeWorldShadowLights({compile(subject,c,target){assert(subject.isGroup);assert.equal(c,camera);assert.equal(target,scene);assert.equal(c.layers.mask,2);throw error;}},scene,camera,1),e=>e===error);
 assert.equal(camera.layers.mask,mask);
});

function batchFixture(){
 const scene=new T.Scene(),group=new T.Group(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial({alphaTest:.4,map:new T.Texture()});scene.add(group);
 const batches=Array.from({length:3},(_,level)=>{
  const mesh=new T.InstancedMesh(geometry,material,3);mesh.name='SM_Scanned_Test_LOD'+level;
  mesh.castShadow=mesh.receiveShadow=true;mesh.position.set(level,2,3);mesh.rotation.y=.2;mesh.scale.setScalar(1.1);
  for(let i=0;i<3;i++)mesh.setMatrixAt(i,new T.Matrix4().makeTranslation(1000+level*10+i,0,0));
  mesh.instanceMatrix.needsUpdate=true;mesh.count=level===1?3:0;mesh.visible=level===1;mesh.frustumCulled=level!==2;group.add(mesh);
  return {mesh};
 });
 const snapshots=batches.map(({mesh})=>({mesh,count:mesh.count,visible:mesh.visible,frustumCulled:mesh.frustumCulled,parent:mesh.parent,
  position:mesh.position.clone(),rotation:mesh.rotation.clone(),scale:mesh.scale.clone(),matrix:mesh.instanceMatrix,array:Array.from(mesh.instanceMatrix.array),version:mesh.instanceMatrix.version}));
 const world={group,foliage:[],environmentAssets:{batches,disposed:false}};
 return {scene,group,geometry,material,world,batches,snapshots,
  restored(){
   assert.deepEqual(group.children,batches.map(b=>b.mesh));
   for(const s of snapshots){const m=s.mesh;assert.equal(m.count,s.count);assert.equal(m.visible,s.visible);assert.equal(m.frustumCulled,s.frustumCulled);
    assert.equal(m.parent,s.parent);assert(m.position.equals(s.position));assert(m.rotation.equals(s.rotation));assert(m.scale.equals(s.scale));
    assert.equal(m.instanceMatrix,s.matrix);assert.deepEqual(Array.from(m.instanceMatrix.array),s.array);assert.equal(m.instanceMatrix.version,s.version);
    assert.equal(m.geometry,geometry);assert.equal(m.material,material);
   }
  },
  dispose(){for(const {mesh}of batches)mesh.dispose();geometry.dispose();material.map.dispose();material.dispose();}
 };
}

test('real scanned batches upload every independent instance buffer and traverse real shadow depth variants',()=>{
 const f=batchFixture(),camera=new T.PerspectiveCamera(),sun=new T.DirectionalLight(),uploaded=[],removed=[],geometryUploads=[],draws=[];
 const objects=new WebGLObjects({ARRAY_BUFFER:34962},{get:(o,g)=>g,update:g=>geometryUploads.push(g)},
  {update:attribute=>uploaded.push(attribute),remove:attribute=>removed.push(attribute)},{render:{frame:1}});
 let target=null;
 const renderer={localClippingEnabled:false,getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  setRenderTarget(value){target=value;},clear(){},
  state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}}},
  renderBufferDirect(c,s,g,m,object){draws.push({object,material:m,count:object.count});}
 };
 const shadow=new WebGLShadowMap(renderer,objects,{maxTextureSize:2048});shadow.enabled=true;shadow.autoUpdate=false;
 sun.position.set(5,8,4);sun.castShadow=true;f.scene.add(sun);f.scene.updateMatrixWorld(true);sun.target.updateMatrixWorld(true);
 try{
  withSceneryBatchSamples(f.world,()=>{
   for(const {mesh}of f.batches){assert.equal(mesh.count,1);assert(mesh.visible);assert.equal(mesh.frustumCulled,false);}
   shadow.needsUpdate=true;shadow.render([sun],f.scene,camera);
  });
  f.restored();assert.equal(target,null);
  assert.deepEqual(draws.map(d=>d.object),f.batches.map(b=>b.mesh));
  assert(draws.every(d=>d.material.isMeshDepthMaterial&&d.count===1));
  assert.equal(geometryUploads.length,1,'shared geometry still uploads once');
  assert.deepEqual(uploaded,f.batches.map(b=>b.mesh.instanceMatrix),'each real LOD buffer must be prepared, even with identical geometry/material');
  assert.equal(removed.length,0,'preparation must not dispose a temporary shared-buffer owner');
 }finally{f.dispose();sun.shadow.map?.dispose();}
 assert.deepEqual(removed,uploaded,'only final world disposal releases these actual buffers');
});

test('batch samples restore on draw errors, skip disposed/zero-capacity batches and tolerate duplicate references',()=>{
 const f=batchFixture(),zero=new T.InstancedMesh(f.geometry,f.material,0),error=Error('draw failed');
 f.world.environmentAssets.batches.push({mesh:zero},f.batches[0]);
 try{
  assert.throws(()=>withSceneryBatchSamples(f.world,()=>{assert.equal(zero.count,0);throw error;}),e=>e===error);
  f.world.environmentAssets.batches.splice(3);f.restored();
  f.world.environmentAssets.disposed=true;
  assert.equal(withSceneryBatchSamples(f.world,()=>{f.restored();return 17;}),17);
  assert.equal(withSceneryBatchSamples(null,()=>23),23);
 }finally{zero.dispose();f.dispose();}
});

test('scanned assets no longer create ordinary-mesh substitutes with the wrong instancing shader flag',async()=>{
 const f=batchFixture();
 try{
  const cleanup=await prepareScenerySamples({world:f.world,scene:f.scene,position:new T.Vector3(),yieldWork:async()=>{}});
  const samples=f.scene.getObjectByName('Scenery_Prewarm_Samples');assert(samples);assert.equal(samples.children.length,0);f.restored();
  cleanup();f.restored();assert.equal(f.scene.getObjectByName('Scenery_Prewarm_Samples'),undefined);
 }finally{f.dispose();}
});

test('offscreen bridge and colored cluster batches traverse their actual depth variants before play',()=>{
 const scene=new T.Scene(),group=new T.Group(),camera=new T.PerspectiveCamera(),sun=new T.DirectionalLight();scene.add(group,sun);
 const geometry=new T.BoxGeometry(),materials=[new T.MeshStandardMaterial(),new T.MeshStandardMaterial({side:T.DoubleSide})];
 const batches=materials.map((material,i)=>{
  const mesh=new T.InstancedMesh(geometry,material,2);mesh.name=i?'SM_Cluster_coast':'Bridge_Boards';
  mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(1000,0,0));mesh.setMatrixAt(1,new T.Matrix4().makeTranslation(1002,0,0));
  if(i)mesh.setColorAt(0,new T.Color(.7,.8,.9));mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
 });
 const ignored=new T.InstancedMesh(geometry,materials[0],2);ignored.visible=false;group.add(ignored);
 const snapshots=batches.map(m=>({matrix:m.instanceMatrix,array:Array.from(m.instanceMatrix.array),color:m.instanceColor,version:m.instanceMatrix.version})),draws=[],uploaded=[];
 const objects=new WebGLObjects({ARRAY_BUFFER:34962},{get:(o,g)=>g,update(){}},{update:a=>uploaded.push(a),remove(){}},{render:{frame:1}});
 const renderer={localClippingEnabled:false,getRenderTarget:()=>null,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget(){},clear(){},
  state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}}},
  renderBufferDirect(c,s,g,m,object){draws.push({object,side:m.side,depth:m.isMeshDepthMaterial,color:!!object.instanceColor,count:object.count});}};
 const shadow=new WebGLShadowMap(renderer,objects,{maxTextureSize:2048});shadow.enabled=true;shadow.autoUpdate=false;
 sun.position.set(5,8,4);sun.castShadow=true;scene.updateMatrixWorld(true);sun.target.updateMatrixWorld(true);
 const world={group};
 try{
  withSceneryBatchSamples(world,()=>{shadow.needsUpdate=true;shadow.render([sun],scene,camera);});
  assert.deepEqual(draws.map(d=>d.object),batches);
  assert.deepEqual(draws.map(d=>[d.depth,d.side,d.color,d.count]),[[true,T.BackSide,false,1],[true,T.DoubleSide,true,1]]);
  assert(uploaded.includes(batches[0].instanceMatrix)&&uploaded.includes(batches[1].instanceColor));
  assert.equal(ignored.visible,false);assert.equal(ignored.count,2);
  for(const [i,m]of batches.entries()){const s=snapshots[i];assert.equal(m.count,2);assert(m.visible&&m.frustumCulled);assert.equal(m.parent,group);assert.equal(m.instanceMatrix,s.matrix);assert.equal(m.instanceColor,s.color);assert.deepEqual(Array.from(m.instanceMatrix.array),s.array);assert.equal(m.instanceMatrix.version,s.version);}
  assert.throws(()=>withSceneryBatchSamples(world,()=>{throw Error('draw failed');}),/draw failed/);
  assert(batches.every(m=>m.count===2&&m.visible&&m.frustumCulled));
 }finally{for(const m of [...batches,ignored])m.dispose();geometry.dispose();materials.forEach(m=>m.dispose());sun.shadow.map?.dispose();}
});
