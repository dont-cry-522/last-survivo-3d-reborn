import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {compileWorldAsync} from '../render-prewarm.js';

// Use this repository's clipping implementation: compile() consumes its last
// plane counts without calling setState for each material being prepared.
const vendor=readFileSync(new URL('../vendor/three.module.js',import.meta.url),'utf8');
const WebGLClipping=vm.runInNewContext('('+vendor.slice(vendor.indexOf('function WebGLClipping('),vendor.indexOf('function WebGLCubeMaps('))+')',{Plane:T.Plane,Matrix3:T.Matrix3});

function fixture({globalPlanes=[],autoClear=true,fail}={}){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),weapon=new T.Group(),light=new T.DirectionalLight();
 camera.layers.set(1);scene.add(camera,light);camera.add(weapon);
 scene.fog=new T.FogExp2(0x203c34,.009);scene.environment=new T.Texture();
 const props=new WeakMap(),clipping=new WebGLClipping({get(m){if(!props.has(m))props.set(m,{});return props.get(m);}});
 const menuMaterial=new T.MeshStandardMaterial({clippingPlanes:Array.from({length:4},()=>new T.Plane(new T.Vector3(1,0,0),1))});
 clipping.init(globalPlanes,true);clipping.setGlobalState(globalPlanes,camera);clipping.setState(menuMaterial,camera,false);
 assert.equal(clipping.numPlanes,globalPlanes.length+4,'fixture did not leave the menu variant active');
 const target={name:'caller render target'},primes=[],compiled=[];
 let resolve,reject;const ready=new Promise((a,b)=>{resolve=a;reject=b;});
 const renderer={autoClear,autoClearColor:false,autoClearDepth:true,clippingPlanes:globalPlanes,localClippingEnabled:true,target,
  render(s,c){
   assert.notEqual(s,scene);assert.equal(s.children.length,0);assert.equal(s.background,null);assert.equal(s.environment,null);
   assert.equal(c,camera);assert.equal(this.autoClear,false);assert.equal(this.target,target);primes.push(s);
   clipping.init(this.clippingPlanes,this.localClippingEnabled);clipping.beginShadows();clipping.endShadows();clipping.setGlobalState(this.clippingPlanes,c);
   if(fail==='prime')throw Error('prime failed');
  },
  compileAsync(subject,c,targetScene){
   assert.equal(c,camera);assert.equal(targetScene,scene);assert.equal(this.autoClear,autoClear);assert.equal(this.target,target);
   assert(scene.children.includes(light));assert.equal(targetScene.fog,original.fog);assert.equal(targetScene.environment,original.environment);
   compiled.push({subject,planes:clipping.numPlanes,intersection:clipping.numIntersection});
   if(fail==='compile')throw Error('compile failed');
   return ready;
  }
 };
 const original={children:scene.children.slice(),fog:scene.fog,environment:scene.environment,mask:camera.layers.mask};
 return{scene,camera,weapon,renderer,target,primes,compiled,clipping,original,ready,resolve,reject,
  restored(){assert.equal(renderer.autoClear,autoClear);assert.equal(renderer.autoClearColor,false);assert.equal(renderer.autoClearDepth,true);assert.equal(renderer.clippingPlanes,globalPlanes);assert.equal(renderer.localClippingEnabled,true);assert.equal(renderer.target,target);assert.equal(camera.layers.mask,original.mask);assert.deepEqual(scene.children,original.children);assert.equal(weapon.parent,camera);},
  dispose(){menuMaterial.dispose();scene.environment.dispose();}
 };
}

test('combat compilation drops stale menu planes, preserves global planes and compiles world/weapon against real lighting',async()=>{
 for(const globalPlanes of [[],[new T.Plane(new T.Vector3(0,1,0),2)]])for(const autoClear of [true,false]){
  const f=fixture({globalPlanes,autoClear});
  try{
   const pending=compileWorldAsync(f.renderer,f.scene,f.camera);f.restored();assert.equal(pending,f.ready);
   assert.deepEqual(f.compiled,[{subject:f.scene,planes:globalPlanes.length,intersection:0}]);
   f.resolve(f.scene);assert.equal(await pending,f.scene);
   // A previous local-clipped draw must not contaminate the layer-1 pass either.
   f.clipping.numPlanes=9;await compileWorldAsync(f.renderer,f.scene,f.camera,f.weapon);f.restored();
   assert.deepEqual(f.compiled[1],{subject:f.weapon,planes:globalPlanes.length,intersection:0});
   assert.equal(f.primes[0],f.primes[1],'empty scene was reallocated between passes');
  }finally{f.dispose();}
 }
});

test('world compilation restores clear policy on priming, synchronous and asynchronous failures',async()=>{
 for(const fail of ['prime','compile','async'])for(const autoClear of [true,false]){
  const f=fixture({fail,autoClear});
  try{
   if(fail==='async'){
    const pending=compileWorldAsync(f.renderer,f.scene,f.camera);f.restored();f.reject(Error('async failed'));
    await assert.rejects(pending,/async failed/);
   }else assert.throws(()=>compileWorldAsync(f.renderer,f.scene,f.camera),new RegExp(fail+' failed'));
   f.restored();if(fail==='prime')assert.equal(f.compiled.length,0);
  }finally{f.dispose();}
 }
});
