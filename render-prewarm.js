import * as T from './vendor/three.module.js';
import {prepareTreeDetail} from './tree-scenery.js?v=229';

const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const worldCompileScene=new T.Scene();
const shadowLightSample=new T.Group();
const preparedProgramInterfaces=new WeakSet();

// Wait only for already-submitted loading work, without blocking the main thread
// or adding a fixed delay. Every poll has a zero GPU wait timeout.
export async function waitForGPUPreparation(renderer,yieldWork=yieldTask){
 const gl=renderer.getContext();
 if(gl.isContextLost())throw new Error('GPU preparation context lost');
 if(typeof gl.fenceSync!=='function')throw new Error('GPU preparation requires WebGL2 sync');
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
 if(!sync)throw new Error('GPU preparation fence unavailable');
 const started=performance.now();
 try{
  gl.flush();
  for(;;){
   if(gl.isContextLost())throw new Error('GPU preparation context lost');
   const status=gl.clientWaitSync(sync,0,0);
   if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)return;
   if(status!==gl.TIMEOUT_EXPIRED)throw new Error('GPU preparation wait failed');
   if(performance.now()-started>=10000)throw new Error('GPU preparation timed out');
   await yieldWork();
  }
 }finally{gl.deleteSync(sync);}
}

// This bundled Three.js defers diagnostics and uniform/attribute reflection
// until a linked program is first used. compileAsync alone does not perform
// that work, including for compiled trees outside the initial camera view.
// Keep the renderer's own checks and caches; never query GL or alter shaders.
export async function prepareProgramInterfaces(renderer,yieldWork=yieldTask){
 const programs=renderer.info?.programs;if(!programs)return;
 let started=performance.now(),count=0;
 for(const program of [...programs]){
  if(preparedProgramInterfaces.has(program))continue;
  if(typeof program.getUniforms!=='function'||typeof program.getAttributes!=='function')throw new Error('Unsupported Three.js program preparation interface');
  while(typeof program.isReady==='function'&&!program.isReady())await yieldWork();
  program.getUniforms();program.getAttributes();
  if(program.diagnostics?.runnable===false)throw new Error('Shader preparation failed: '+(program.name||program.id));
  preparedProgramInterfaces.add(program);
  if(++count>=16||performance.now()-started>=8){await yieldWork();started=performance.now();count=0;}
 }
}

// compileAsync reads clipping counts from the last draw, which may be a menu
// actor with four local planes. Prime the actual global state without drawing
// or clearing anything, then compile against the world's real lights and fog.
export function compileWorldAsync(renderer,scene,camera,subject=scene){
 const autoClear=renderer.autoClear;
 try{renderer.autoClear=false;renderer.render(worldCompileScene,camera);}
 finally{renderer.autoClear=autoClear;}
 return renderer.compileAsync(subject,camera,scene);
}

// The shadow pass precedes setupLights in this Three.js version. Its program
// keys therefore inherit the previous scene pass: world lights in third person,
// layer-1 weapon lights in first person. compile() on an empty group gathers
// that exact light state without drawing or preparing any extra materials.
export function primeWorldShadowLights(renderer,scene,camera,previousLayer=0){
 const mask=camera.layers.mask;
 try{camera.layers.set(previousLayer);return renderer.compile(shadowLightSample,camera,scene);}
 finally{camera.layers.mask=mask;}
}

// A plain Mesh cannot upload an InstancedMesh's own instance buffer or prepare
// its shadow variant. Borrow each real batch for this synchronous loading draw,
// including empty LOD batches; one existing instance bounds the extra work.
// No matrix, parent, resource or disposal ownership changes hands.
export function withSceneryBatchSamples(world,draw){
 const state=world?.environmentAssets,saved=[],seen=new Set();
 try{
  const registered=new Set(state?.batches.map(({mesh})=>mesh)),batches=state&&!state.disposed?[...registered]:[];
  // Bridges and authored environment clusters are real instance batches too.
  // They can be outside the entry shadow frustum, so compileAsync never draws
  // their instancing/instanceColor depth variants. Warm one existing instance
  // in the same loading draw; retain its buffers, placement and shadow quality.
  world?.group?.traverse(mesh=>{if(mesh.isInstancedMesh&&mesh.castShadow&&!registered.has(mesh))batches.push(mesh);});
  for(const mesh of batches){
   if(seen.has(mesh)||!mesh?.isInstancedMesh||!mesh.instanceMatrix.count)continue;
   seen.add(mesh);saved.push({mesh,count:mesh.count,visible:mesh.visible,frustumCulled:mesh.frustumCulled});
   mesh.count=1;mesh.visible=true;mesh.frustumCulled=false;
  }
  return draw();
 }finally{
  for(const {mesh,count,visible,frustumCulled} of saved){mesh.count=count;mesh.visible=visible;mesh.frustumCulled=frustumCulled;}
 }
}

// Geometry not currently selected by LOD still needs a real draw before play.
// Temporary meshes reference existing resources, never copy/dispose them.
export async function prepareScenerySamples({world,scene,position,yieldWork=yieldTask}){
 const samples=new T.Group();samples.name='Scenery_Prewarm_Samples';
 try{
  const resources=await prepareTreeDetail(world,{yieldWork}),seen=new Map();
  world.group.traverse(o=>{
   // New branching models may start behind the camera. Upload their shared
   // bark buffers in the loading pass, before a turn reveals the next grove.
   if(o.isMesh&&(o.name==='tree-trunk'&&(o.parent?.userData.forestTreeForm||o.parent?.userData.biomeTreeForm)||o.parent?.userData.biomeRockForm))resources.push({geometry:o.geometry,material:o.material});
  });
  // These two route landmarks can start outside the lobby camera. Their
  // world-owned buffers need the same first draw as the cached tree variants.
  for(const state of[world.biomeOutcrops,world.journeyEscarpment])for(const {mesh}of state?.records||[])
   if(mesh?.isMesh)resources.push({geometry:mesh.geometry,material:mesh.material});
  for(const {geometry,material} of resources){
   let materials=seen.get(geometry);if(!materials)seen.set(geometry,materials=new Set());
   if(materials.has(material))continue;materials.add(material);
   geometry.computeBoundingSphere();const sphere=geometry.boundingSphere;
   const mesh=new T.Mesh(geometry,material),scale=.12/Math.max(.01,sphere.radius);
   mesh.scale.setScalar(scale);mesh.position.copy(sphere.center).multiplyScalar(-scale);
   mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;samples.add(mesh);
  }
  samples.position.copy(position);samples.position.y+=1;scene.add(samples);
  return ()=>{samples.removeFromParent();samples.clear();};
 }catch(error){samples.removeFromParent();samples.clear();throw error;}
}

function sceneTextures(scene){
 const textures=new Set(),materials=new Set(),seen=new Set();
 const uniformTextures=value=>{
  if(!value||typeof value!=='object'||seen.has(value))return;
  seen.add(value);
  if(value.isTexture){textures.add(value);return;}
  // Uniform structs/arrays can contain samplers. Do not walk arbitrary scene
  // objects, typed arrays, or material userData looking for hidden resources.
  if(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)
   for(const child of Object.values(value))uniformTextures(child);
 };
 scene.traverse(object=>{
  const list=Array.isArray(object.material)?object.material:[object.material];
  for(const material of list){
   if(!material||materials.has(material))continue;
   materials.add(material);
   for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
   uniformTextures(material.uniforms);
  }
 });
 for(const value of [scene.background,scene.environment])if(value?.isTexture)textures.add(value);
 return [...textures];
}

// The caller owns the render target and the actual world -> weapon -> postprocess
// draw. No simulation update occurs here. Custom onBeforeCompile samplers and
// shadow/postprocess resources are also exercised by the two real draw passes.
export async function warmScene({renderer,scene,camera,render,passes=2,compile=()=>renderer.compileAsync(scene,camera),report=()=>{},yieldWork=yieldTask}){
 const mask=camera.layers.mask;
 try{
  const textures=sceneTextures(scene);
  report('textures',0,textures.length);
  let batchStart=performance.now(),batchCount=0;
  for(let i=0;i<textures.length;i++){
   renderer.initTexture(textures[i]);
   report('textures',i+1,textures.length);
   // Real uploads yield after a short time slice. Already-resident textures are
   // cheap: do not pay the caller's loading delay after every eight cache hits.
   if(++batchCount>=32||performance.now()-batchStart>=8||i+1===textures.length){
    await yieldWork();batchStart=performance.now();batchCount=0;
   }
  }
  report('compile',0,passes);
  await yieldWork();
  for(let layer=0;layer<passes;layer++){
   try{
    camera.layers.set(layer);
    await compile(layer);
   }finally{camera.layers.mask=mask;}
   await prepareProgramInterfaces(renderer,yieldWork);
   report('compile',layer+1,passes);
   await yieldWork();
  }
  report('render',0,passes);
  for(let pass=0;pass<passes;pass++){
   await render(pass);
   await prepareProgramInterfaces(renderer,yieldWork);
   report('render',pass+1,passes);
   await yieldWork();
  }
 }finally{camera.layers.mask=mask;}
}
