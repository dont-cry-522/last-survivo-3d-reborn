import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {FirstPersonView} from '../first-person-view.js';

// Use the bundled renderer's actual layer/visibility traversal and shadow pass.
// These CPU operation checks do not measure GPU time or presented frame rate.
const vendor=readFileSync(new URL('../vendor/three.module.js',import.meta.url),'utf8');
const projectSource=vendor.slice(vendor.indexOf('function projectObject('),vendor.indexOf('function renderScene('));
const shadowSource=vendor.slice(vendor.indexOf('const vertex =',vendor.indexOf('function WebGLRenderStates(')),vendor.indexOf('const reversedFuncs ='));
const WebGLShadowMap=vm.runInNewContext(`(function(){${shadowSource};return WebGLShadowMap;})()`,{...T});

function fixture(){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(70,16/9,.1,320),world=new T.Group(),view=new FirstPersonView(camera);
 const geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial(),tree=new T.Mesh(geometry,material),held=new T.Mesh(geometry,material);
 scene.background=new T.Color(0x74958a);scene.fog=new T.FogExp2(0x74958a,.01);scene.environment=new T.Texture();
 tree.name='world caster';tree.castShadow=true;tree.frustumCulled=false;world.add(tree,new T.PointLight());
 for(let b=0;b<100;b++){
  const branch=new T.Group();branch.position.set(b%10*3,0,Math.floor(b/10)*3);world.add(branch);
  for(let i=0;i<24;i++){const node=new T.Object3D();node.position.set(i*.04,Math.sin(i)*.1,i*.03);branch.add(node);}
 }
 held.name='held receiver';held.layers.set(1);held.receiveShadow=true;held.frustumCulled=false;held.position.set(.3,-.2,-.8);
 view.weapon=held;view.root.add(held);view.root.visible=true;camera.position.set(2,1.6,4);
 const sun=new T.DirectionalLight(),hemi=new T.HemisphereLight(),rim=new T.DirectionalLight();
 sun.name='sun';hemi.name='sky';rim.name='rim';sun.position.set(5,8,4);sun.castShadow=true;
 for(const light of [sun,hemi,rim])light.layers.enable(1);
 scene.add(world,camera,sun,sun.target,hemi,rim);scene.updateMatrixWorld(true);
 let visits=0;world.traverse(node=>{const test=node.layers.test;node.layers.test=function(layers){visits++;return test.call(this,layers);};});
 const lights=[],shadows=[],draws=[],depthDraws=[],frames=[],objects={update:object=>object.geometry};
 const project=vm.runInNewContext('('+projectSource+')',{_frustum:new T.Frustum(),_vector4:new T.Vector4(),objects,
  currentRenderState:{pushLight:light=>lights.push(light),pushShadow:light=>shadows.push(light)},
  currentRenderList:{push:object=>draws.push(object)}});
 let target=null;
 const renderer={autoClear:true,localClippingEnabled:false,getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  setRenderTarget(value){target=value;},clear(){},clearDepth(){this.depthClears=(this.depthClears||0)+1;},
  state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}}},
  renderBufferDirect(c,s,g,m,object){depthDraws.push(object);},
  render(s,c){
   assert.equal(s,scene);if(s.matrixWorldAutoUpdate)s.updateMatrixWorld();
   lights.length=shadows.length=draws.length=0;project(s,c,0,false);
   this.shadowMap.render(shadows,s,c);
   frames.push({mask:c.layers.mask,lights:[...lights],draws:[...draws],fog:s.fog,environment:s.environment,
    shadow:sun.shadow.map,held:held.matrixWorld.toArray(),camera:c.matrixWorld.toArray(),receive:held.receiveShadow,cast:held.castShadow});
  }};
 renderer.shadowMap=new WebGLShadowMap(renderer,objects,{maxTextureSize:2048});renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=T.PCFSoftShadowMap;
 return{scene,camera,world,view,renderer,sun,tree,held,frames,depthDraws,get visits(){return visits;},
  dispose(){view.dispose();geometry.dispose();material.dispose();scene.environment.dispose();sun.shadow.map?.dispose();}};
}

test('overlay skips only world traversal and retains actual world shadows, light list and equipment draw',()=>{
 const f=fixture(),{renderer,scene,camera,view,world}=f;
 try{
  renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
  assert.equal(renderer.shadowMap.needsUpdate,false);assert.deepEqual(f.depthDraws,[f.tree]);
  const firstVisits=f.visits;view.render(renderer,scene);
  const legacyVisits=f.visits-firstVisits,legacy=f.frames.at(-1),before=f.visits,depthCount=f.depthDraws.length;
  view.render(renderer,scene,world);
  assert.equal(legacyVisits,2503);assert.equal(f.visits-before,0,'layer filtering still traversed the scenery branch');
  assert.deepEqual(f.frames.at(-1),legacy,'equipment, lights, environment or world shadow changed');
  assert.deepEqual(legacy.lights.map(light=>light.name),['sun','sky','rim']);assert.deepEqual(legacy.draws,[f.held]);
  assert(legacy.shadow&&legacy.receive&&!legacy.cast);assert.equal(f.depthDraws.length,depthCount,'overlay regenerated the world shadow');
  assert.equal(world.visible,true);assert.equal(world.parent,scene);assert.equal(scene.matrixWorldAutoUpdate,true);
  assert.equal(camera.layers.mask,1);assert.equal(renderer.autoClear,true);assert.equal(renderer.getRenderTarget(),null);
  // The next world pass must still find every caster after an overlay.
  renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);assert.equal(f.depthDraws.at(-1),f.tree);
 }finally{f.dispose();}
});

test('automatic or pending shadow work retains the full world branch',()=>{
 for(const [autoUpdate,needsUpdate]of [[true,false],[false,true]]){
  const f=fixture();
  try{
   f.renderer.shadowMap.autoUpdate=autoUpdate;f.renderer.shadowMap.needsUpdate=needsUpdate;
   const render=f.renderer.render;f.renderer.render=function(scene,camera){assert.equal(f.world.visible,true);return render.call(this,scene,camera);};
   f.view.render(f.renderer,f.scene,f.world);assert(f.visits>0);assert.equal(f.world.visible,true);
  }finally{f.dispose();}
 }
});

test('overlay restores an already hidden world and all caller state after draw or depth-clear failure',()=>{
 for(const visible of [true,false])for(const failure of ['clearDepth','render']){
  const f=fixture();
  try{
   f.world.visible=visible;f.camera.layers.set(3);f.renderer.autoClear=false;f.scene.matrixWorldAutoUpdate=false;
   const background=f.scene.background,environment=f.scene.environment,fog=f.scene.fog;
   f.renderer[failure]=()=>{assert.equal(f.world.visible,false);assert.equal(f.camera.layers.mask,2);throw Error(failure+' failed');};
   assert.throws(()=>f.view.render(f.renderer,f.scene,f.world),new RegExp(failure+' failed'));
   assert.equal(f.world.visible,visible);assert.equal(f.world.parent,f.scene);assert.equal(f.camera.layers.mask,8);
   assert.equal(f.renderer.autoClear,false);assert.equal(f.scene.matrixWorldAutoUpdate,false);assert.equal(f.scene.background,background);
   assert.equal(f.scene.environment,environment);assert.equal(f.scene.fog,fog);assert.equal(f.renderer.shadowMap.needsUpdate,false);
  }finally{f.dispose();}
 }
});
