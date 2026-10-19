import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {HeroPreview} from '../hero-preview.js';

// Exercise the bundled renderer's clipping state rather than duplicating its
// global/local plane-count calculation in the mock renderer.
const vendor=readFileSync(new URL('../vendor/three.module.js',import.meta.url),'utf8');
const WebGLClipping=vm.runInNewContext('('+vendor.slice(vendor.indexOf('function WebGLClipping('),vendor.indexOf('function WebGLCubeMaps('))+')',{Plane:T.Plane,Matrix3:T.Matrix3});

function fixture({portrait=true,globalPlanes=[],autoClear=true,fail=null}={}){
 const button={setAttribute(){}},element={getBoundingClientRect:()=>({left:40,top:60,width:280,height:460}),addEventListener(){}};
 const globals=new Map(['document','innerWidth','innerHeight'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.assign(globalThis,{document:{querySelector:()=>button},innerWidth:960,innerHeight:720});
 const scene=new T.Scene(),hero=new T.Group(),pet=new T.Group(),light=new T.DirectionalLight();scene.fog=new T.FogExp2(0x223344,.006);
 const head=new T.Mesh(new T.BoxGeometry(.4,.5,.4),new T.MeshStandardMaterial());head.position.y=1.5;hero.add(head);hero.userData.head=head;
 const oldLocalPlanes=[new T.Plane(new T.Vector3(1,0,0),-3)],body=new T.Mesh(new T.BoxGeometry(.6,1,.3),new T.MeshStandardMaterial({clippingPlanes:oldLocalPlanes}));body.position.y=.7;hero.add(body);
 pet.add(new T.Mesh(new T.BoxGeometry(.3,.4,.5),new T.MeshStandardMaterial()));pet.position.set(4,0,2);scene.add(hero,pet,light);
 const props=new WeakMap(),clipping=new WebGLClipping({get(material){if(!props.has(material))props.set(material,{});return props.get(material);}}),primes=[],compiled=[],target={name:'HDR or direct target'};
 let resolve,reject;
 const ready=new Promise((a,b)=>{resolve=a;reject=b;}),renderer={clippingPlanes:globalPlanes,autoClear,localClippingEnabled:false,target,
  render(s,c){
   assert.notEqual(s,scene);assert.equal(s.children.length,0);assert.equal(s.background,null);assert.equal(this.autoClear,false);assert.equal(this.target,target);
   clipping.init(this.clippingPlanes,this.localClippingEnabled);clipping.beginShadows();clipping.endShadows();clipping.setGlobalState(this.clippingPlanes,c);primes.push(s);
   if(fail==='prime')throw Error('prime failed');
  },
  compileAsync(object,c,targetScene){
   assert.equal(object,hero);assert.equal(targetScene,scene);assert.equal(c,preview.camera);assert.equal(this.target,target);
   assert.equal(scene.getObjectByName('Light_HeroPreview_SoftFill'),preview.fill);assert.equal(scene.getObjectByName('Light_HeroPreview_Rim'),preview.edge);assert.equal(scene.fog.density,.028);
   assert.equal(pet.visible,!portrait);assert.equal(scene.matrixWorldAutoUpdate,false);
   compiled.push([clipping.numPlanes,clipping.numIntersection]);
   if(fail==='compile')throw Error('compile failed');
   return ready;
  }
 };
 const preview=new HeroPreview(renderer,element);preview.setPortrait(portrait);
 const original={children:scene.children.slice(),petPosition:pet.position.clone(),autoMatrix:scene.matrixWorldAutoUpdate,globalPlanes,autoClear,oldLocalPlanes};
 return{preview,scene,hero,pet,head,body,renderer,clipping,primes,compiled,target,original,ready,resolve,reject,
  dispose(){scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});for(const [key,descriptor] of globals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 };
}

function restored(f){
 assert.equal(f.renderer.clippingPlanes,f.original.globalPlanes);assert.equal(f.renderer.autoClear,f.original.autoClear);assert.equal(f.renderer.target,f.target);
 assert.equal(f.head.material.clippingPlanes,null);assert.equal(f.body.material.clippingPlanes,f.original.oldLocalPlanes);
 assert.deepEqual(f.scene.children,f.original.children);assert.equal(f.scene.fog.density,.006);assert.equal(f.scene.matrixWorldAutoUpdate,f.original.autoMatrix);
 assert.equal(f.pet.visible,true);assert(f.pet.position.equals(f.original.petPosition));
}

test('fullbody and portrait share the exact clipping variant, with fullbody and pet inside the framing margin',async()=>{
 for(const portrait of [false,true])for(const globalPlanes of [[],[new T.Plane(new T.Vector3(0,1,0),2)]]){
  const f=fixture({globalPlanes,portrait});
  try{
   const promise=f.preview.compileAsync(f.scene,f.hero,f.pet);assert.equal(promise,f.ready);restored(f);
   assert.deepEqual(f.compiled,[[globalPlanes.length+4,0]]);
   f.preview.render(f.scene,f.hero,f.pet,(s,c)=>{
    f.clipping.init(f.renderer.clippingPlanes,true);f.clipping.setGlobalState(f.renderer.clippingPlanes,c);
    for(const mesh of [f.head,f.body,...f.pet.children]){f.clipping.setState(mesh.material,c,false);assert.deepEqual([f.clipping.numPlanes,f.clipping.numIntersection],f.compiled[0]);}
    if(!portrait)for(const root of [f.hero,f.pet]){
     const bounds=new T.Box3().setFromObject(root,true);
     for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])
      assert(f.preview.clipFrustum.planes.slice(0,4).every(p=>p.distanceToPoint(new T.Vector3(x,y,z))>=-1e-6),'fullbody clipping cropped the fitted actor or pet');
    }
   });
   restored(f);f.resolve(f.hero);assert.equal(await promise,f.hero);
   await f.preview.compileAsync(f.scene,f.hero,f.pet);assert.equal(f.primes[0],f.primes[1],'empty scene should be reused');restored(f);
  }finally{f.dispose();}
 }
});

test('compilation restores renderer and preview state after priming, synchronous compilation, or asynchronous compilation failures',async()=>{
 for(const fail of ['prime','compile','async']){
  const f=fixture({autoClear:false,fail});
  try{
   if(fail==='async'){
    const promise=f.preview.compileAsync(f.scene,f.hero,f.pet);restored(f);f.reject(Error('async failed'));await assert.rejects(promise,/async failed/);
   }else assert.throws(()=>f.preview.compileAsync(f.scene,f.hero,f.pet),new RegExp(fail+' failed'));
   restored(f);
  }finally{f.dispose();}
 }
});

test('whole lobby preparation compiles environment without local planes, then actors with four, restoring attachments even on failure',async()=>{
 for(const portrait of [false,true])for(const fail of [null,'environment','environment-async','hero','pet']){
  const f=fixture({portrait,globalPlanes:[new T.Plane(new T.Vector3(0,1,0),2)]}),calls=[];
  f.renderer.compileAsync=(object,c,targetScene)=>{
   assert.equal(c,f.preview.camera);assert.equal(f.scene.getObjectByName('Light_HeroPreview_SoftFill'),f.preview.fill);
   const stage=object===f.scene?'environment':object===f.hero?'hero':'pet';calls.push(stage);
   if(stage==='environment'){
    assert.equal(targetScene,undefined);assert.equal(f.hero.parent,null);assert.equal(f.pet.parent,null);
    assert.equal(f.clipping.numPlanes,1,'environment inherited the last actor clipping count');
   }else{
    assert.equal(targetScene,f.scene);assert.equal(f.hero.parent,f.scene);assert.equal(f.pet.parent,f.scene);
    assert.equal(f.clipping.numPlanes,5,'actor did not prepare its four local planes');
   }
   if(fail===stage)throw Error('injected '+stage);
   if(fail==='environment-async'&&stage==='environment')return Promise.reject(Error('injected async'));
   return Promise.resolve(object);
  };
  try{
   f.clipping.numPlanes=9; // Simulate stale clipping state from another draw.
   const pending=f.preview.compileSceneAsync(f.scene,f.hero,f.pet);restored(f);
   if(fail)await assert.rejects(pending,/injected/);else{await pending;assert.deepEqual(calls,['environment','hero','pet']);}
   restored(f);
  }finally{f.dispose();}
 }
});

test('four global prime planes compile every grouped material with the same variant as its real local portrait draw',async()=>{
 for(const globalPlanes of[[],[new T.Plane(new T.Vector3(0,1,0),2)]]){
  const f=fixture({globalPlanes}),batch=new T.Group(),other=new T.Group(),otherHead=new T.Mesh(new T.BoxGeometry(.5,.5,.5),new T.MeshStandardMaterial({clippingPlanes:[new T.Plane(),new T.Plane()]})),otherBody=new T.Mesh(new T.BoxGeometry(.6,1,.3),new T.MeshStandardMaterial({clippingPlanes:[new T.Plane()]}));otherHead.position.y=1.5;otherBody.position.y=.7;other.userData.head=otherHead;other.add(otherHead,otherBody);other.position.x=2;batch.add(f.hero,other);f.scene.add(batch);
  const planes=[otherHead.material.clippingPlanes,otherBody.material.clippingPlanes],compiled=new Map();
  f.renderer.compileAsync=(object,c,s)=>{assert.equal(object,batch);assert.equal(s,f.scene);object.traverse(o=>{if(o.isMesh)compiled.set(o.material,[f.clipping.numPlanes,f.clipping.numIntersection]);});return Promise.resolve(object);};
  try{
   await f.preview.compileAsync(f.scene,f.hero,f.pet,batch);assert.equal(compiled.size,4);for(const value of compiled.values())assert.deepEqual(value,[4+globalPlanes.length,0]);
   for(const hero of[f.hero,other])f.preview.render(f.scene,hero,null,(s,c)=>{f.clipping.init(f.renderer.clippingPlanes,true);f.clipping.setGlobalState(f.renderer.clippingPlanes,c);hero.traverse(o=>{if(!o.isMesh)return;f.clipping.setState(o.material,c,false);assert.deepEqual([f.clipping.numPlanes,f.clipping.numIntersection],compiled.get(o.material));});});
   assert.equal(f.renderer.clippingPlanes,globalPlanes);assert.equal(f.head.material.clippingPlanes,null);assert.equal(f.body.material.clippingPlanes,f.original.oldLocalPlanes);assert.equal(otherHead.material.clippingPlanes,planes[0]);assert.equal(otherBody.material.clippingPlanes,planes[1]);
  }finally{f.dispose();}
 }
});
