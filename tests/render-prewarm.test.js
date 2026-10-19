import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {warmScene,prepareScenerySamples,waitForGPUPreparation} from '../render-prewarm.js';
import {BIOME_TREE_FORMS,biomeTreeTemplate} from '../biome-tree-forms.js';
import {ASH_ROCK_FORMS,biomeRockTemplate} from '../biome-rock-forms.js';
import {treeSceneryMaterials,updateTreeDetail} from '../tree-scenery.js?v=225';

function gpuFixture(statuses=[2]){
 const sync={},calls=[];
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,TIMEOUT_EXPIRED:4,WAIT_FAILED:5,
  isContextLost:()=>false,fenceSync(condition,flags){assert.equal(condition,1);assert.equal(flags,0);calls.push('fence');return sync;},
  flush(){calls.push('flush');},clientWaitSync(value,flags,timeout){assert.equal(value,sync);assert.equal(flags,0);assert.equal(timeout,0);calls.push('poll');return statuses.shift()??4;},
  deleteSync(value){assert.equal(value,sync);calls.push('delete');},finish(){assert.fail('GPU preparation must not block');},getError(){assert.fail('GPU preparation must not query GL errors');}};
 return{gl,calls,renderer:{getContext:()=>gl,render(){assert.fail('GPU preparation must not submit another draw');}}};
}

test('GPU preparation releases an already signaled or satisfied fence without padding or rendering',async()=>{
 for(const status of [2,3]){
  const f=gpuFixture([status]);await waitForGPUPreparation(f.renderer,()=>assert.fail('completed work needs no delay'));
  assert.deepEqual(f.calls,['fence','flush','poll','delete']);
 }
});

test('GPU preparation flushes once and yields between zero-timeout polls until the submitted work completes',async()=>{
 const f=gpuFixture([4,4,3]);await waitForGPUPreparation(f.renderer,async()=>f.calls.push('yield'));
 assert.deepEqual(f.calls,['fence','flush','poll','yield','poll','yield','poll','delete']);
});

test('GPU preparation failures reject and release any allocated fence exactly once',async()=>{
 for(const failure of ['lost-before','lost-during','null','unsupported','wait-failed','unexpected','flush','poll','yield']){
  const f=gpuFixture([4]);let checks=0;
  if(failure.startsWith('lost'))f.gl.isContextLost=()=>failure==='lost-before'||++checks>1;
  if(failure==='null')f.gl.fenceSync=()=>{f.calls.push('fence');return null;};
  if(failure==='unsupported')f.gl.fenceSync=undefined;
  if(failure==='wait-failed'||failure==='unexpected')f.gl.clientWaitSync=()=>failure==='wait-failed'?5:99;
  if(failure==='flush')f.gl.flush=()=>{throw Error('flush failed');};
  if(failure==='poll')f.gl.clientWaitSync=()=>{throw Error('poll failed');};
  await assert.rejects(waitForGPUPreparation(f.renderer,async()=>{throw Error('yield failed');}));
  assert.equal(f.calls.filter(call=>call==='delete').length,['lost-before','null','unsupported'].includes(failure)?0:1,failure);
 }
});

test('GPU preparation times out after ten seconds without advancing a game clock or retaining the fence',async context=>{
 let now=0;context.mock.method(performance,'now',()=>now);const f=gpuFixture();f.gl.clientWaitSync=()=>4;
 await assert.rejects(waitForGPUPreparation(f.renderer,async()=>{now+=5000;f.calls.push('yield');}),/timed out/);
 assert.equal(now,10000);assert.deepEqual(f.calls,['fence','flush','yield','yield','delete']);
});

test('GPU preparation default polling yields real tasks without RAF or fixed padding',async()=>{
 const f=gpuFixture([4,3]),oldTimer=globalThis.setTimeout,raf=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');let tasks=0;
 globalThis.setTimeout=(callback,delay)=>{assert.equal(delay,0);tasks++;return oldTimer(callback,delay);};
 globalThis.requestAnimationFrame=()=>assert.fail('hidden pages must not wait for RAF');
 try{await waitForGPUPreparation(f.renderer);assert.equal(tasks,1);assert.deepEqual(f.calls,['fence','flush','poll','poll','delete']);}
 finally{globalThis.setTimeout=oldTimer;if(raf)Object.defineProperty(globalThis,'requestAnimationFrame',raf);else delete globalThis.requestAnimationFrame;}
});

function fixture(){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera();camera.layers.set(4);camera.layers.enable(7);
 const textures=Array.from({length:18},()=>new T.Texture()),material=new T.MeshStandardMaterial({map:textures[0],normalMap:textures[1]});
 const cycle={};cycle.self=cycle;cycle.samplers=textures.slice(2,16);
 const shader=new T.ShaderMaterial({uniforms:{direct:{value:textures[0]},nested:{value:[cycle,{sample:textures[1]}]},data:{value:new Float32Array(100)}}});
 scene.add(new T.Mesh(new T.BoxGeometry(),[material,shader]),new T.Mesh(new T.BoxGeometry(),material));
 scene.background=textures[16];scene.environment=textures[17];
 return{scene,camera,textures,material,shader};
}

test('prewarm uploads each shared texture once and yields at an eight millisecond upload budget',async context=>{
 let clock=0;context.mock.method(performance,'now',()=>clock);
 const {scene,camera,textures,material,shader}=fixture(),uploads=[],yields=[],progress=[],compiled=[],draws=[];
 const mask=camera.layers.mask,children=[...scene.children],target={},renderer={
  initTexture(texture){uploads.push(texture);clock++;},
  async compileAsync(s,c){assert.equal(s,scene);compiled.push(c.layers.mask);},
  setRenderTarget(){assert.fail('target belongs to caller');},target
 };
 let disposed=0;for(const resource of [...textures,material,shader])resource.addEventListener('dispose',()=>disposed++);
 await warmScene({renderer,scene,camera,report:(...args)=>progress.push(args),yieldWork:async()=>{yields.push(uploads.length);assert.equal(camera.layers.mask,mask);},render:pass=>{draws.push(pass);assert.equal(camera.layers.mask,mask);assert.equal(compiled.length,2);}});
 assert.deepEqual(uploads,textures);assert.deepEqual(yields.slice(0,3),[8,16,18]);assert.deepEqual(compiled,[1,2]);assert.deepEqual(draws,[0,1]);
 assert.deepEqual(progress.filter(p=>p[0]==='textures'),Array.from({length:19},(_,i)=>['textures',i,18]));
 assert.deepEqual(progress.filter(p=>p[0]==='compile'),[['compile',0,2],['compile',1,2],['compile',2,2]]);
 assert.deepEqual(progress.filter(p=>p[0]==='render'),[['render',0,2],['render',1,2],['render',2,2]]);
 assert.equal(camera.layers.mask,mask);assert.equal(disposed,0);assert.equal(renderer.target,target);assert.deepEqual(scene.children,children);
});

test('resident texture checks avoid redundant loading delays but retain bounded batches',async context=>{
 context.mock.method(performance,'now',()=>0);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),textures=Array.from({length:70},()=>new T.Texture());
 scene.add(new T.Mesh(new T.BoxGeometry(),new T.ShaderMaterial({uniforms:{maps:{value:textures}}})));
 let uploaded=0;const batches=[];
 await warmScene({scene,camera,renderer:{initTexture(){uploaded++;},async compileAsync(){}},render(){},yieldWork:async()=>batches.push(uploaded)});
 assert.equal(uploaded,70);assert.deepEqual(batches.slice(0,3),[32,64,70]);
});

test('slow uploads yield before reaching the object-count cap',async context=>{
 let clock=0,uploaded=0;const batches=[];context.mock.method(performance,'now',()=>clock);
 const {scene,camera}=fixture();
 await warmScene({scene,camera,renderer:{initTexture(){uploaded++;clock+=3;},async compileAsync(){}},render(){},yieldWork:async()=>batches.push(uploaded)});
 assert.deepEqual(batches.slice(0,6),[3,6,9,12,15,18]);
});

test('prewarm awaits compilation, then real draws in order, with task yields between draws',async()=>{
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),events=[];camera.layers.set(5);
 await warmScene({scene,camera,renderer:{initTexture(){assert.fail('empty scene');},async compileAsync(s,c){events.push(`compile:${c.layers.mask}`);await Promise.resolve();events.push(`ready:${c.layers.mask}`);}},
  report:(stage,done,total)=>events.push(`${stage}:${done}/${total}`),yieldWork:async()=>events.push('yield'),render:async pass=>{assert.equal(camera.layers.mask,32);events.push(`draw:${pass}`);await Promise.resolve();events.push(`drawn:${pass}`);}});
 assert.deepEqual(events,['textures:0/0','compile:0/2','yield','compile:1','ready:1','compile:1/2','yield','compile:2','ready:2','compile:2/2','yield','render:0/2','draw:0','drawn:0','render:1/2','yield','draw:1','drawn:1','render:2/2','yield']);
});

test('compile failure restores the exact original layer mask and never reports completion or draws',async()=>{
 for(const failedLayer of [0,1]){
  const {scene,camera}=fixture(),mask=camera.layers.mask,error=new Error(`compile ${failedLayer}`),progress=[];let compileCount=0;
  await assert.rejects(warmScene({scene,camera,renderer:{initTexture(){},async compileAsync(s,c){assert.equal(c.layers.mask,1<<compileCount);if(compileCount++===failedLayer)throw error;}},
   report:(...args)=>progress.push(args),yieldWork:async()=>{},render(){assert.fail('cannot draw after compilation failed');}}),e=>e===error);
  assert.equal(camera.layers.mask,mask);assert.equal(compileCount,failedLayer+1);assert(!progress.some(p=>p[0]==='render'||p[0]==='compile'&&p[1]>failedLayer));
 }
});

test('upload, yield, report and real draw failures propagate without claiming readiness or retaining camera changes',async()=>{
 for(const failure of ['upload','yield','report','draw']){
  const {scene,camera}=fixture(),mask=camera.layers.mask,error=new Error(failure),progress=[];let draws=0;
  await assert.rejects(warmScene({scene,camera,renderer:{initTexture(){if(failure==='upload')throw error;},async compileAsync(){}},
   report:(...args)=>{if(failure==='report')throw error;progress.push(args);},yieldWork:async()=>{if(failure==='yield')throw error;},
   render:pass=>{draws++;camera.layers.set(6);if(failure==='draw'&&pass===1)throw error;}}),e=>e===error);
  assert.equal(camera.layers.mask,mask);assert(!progress.some(p=>p[0]==='render'&&p[1]===2));assert.equal(draws,failure==='draw'?2:0);
 }
});

test('default yielding uses task timers and works without requestAnimationFrame',async()=>{
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),oldTimer=globalThis.setTimeout,raf=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');let tasks=0,draws=0;
 globalThis.setTimeout=(fn,delay)=>{assert.equal(delay,0);tasks++;return oldTimer(fn,delay);};
 globalThis.requestAnimationFrame=()=>assert.fail('prewarm cannot rely on game RAF');
 try{
  await warmScene({scene,camera,renderer:{initTexture(){},async compileAsync(){}},render:()=>draws++});
  assert(tasks>=2);assert.equal(draws,2);
 }finally{globalThis.setTimeout=oldTimer;if(raf)Object.defineProperty(globalThis,'requestAnimationFrame',raf);else delete globalThis.requestAnimationFrame;}
});

test('a lobby prewarm uses its framed camera/light setup once without compiling absent first-person equipment',async()=>{
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),events=[];camera.layers.set(4);
 await warmScene({scene,camera,passes:1,renderer:{initTexture(){},compileAsync(){assert.fail('must use actual preview setup');}},
  compile:async()=>events.push('preview compile'),yieldWork:async()=>{},render:pass=>events.push(pass)});
 assert.deepEqual(events,['preview compile',0]);assert.equal(camera.layers.mask,16);
});


test('loading draws all cached scenery LOD buffers once and releases only temporary meshes',async()=>{
 const scene=new T.Scene(),group=new T.Group(),material=new T.MeshStandardMaterial(),lods=[0,1,2].map(i=>new T.SphereGeometry(1,8+i*2,6));
 const leaf=new T.Mesh(lods[2],material);leaf.userData.treeTemplate={lods,canopy:lods[2]};group.add(leaf);scene.add(group);
 const rock=new T.InstancedMesh(lods[0],material,2);rock.name='SM_Scanned_Test_LOD0';rock.visible=false;group.add(rock);
 const world={group,foliage:[{leaf}]},position=new T.Vector3(2,3,4);let disposed=0;
 for(const resource of [...lods,material])resource.addEventListener('dispose',()=>disposed++);
 const cleanup=await prepareScenerySamples({world,scene,position,yieldWork:async()=>{}}),samples=scene.getObjectByName('Scenery_Prewarm_Samples');
 assert(samples);assert.equal(samples.children.length,3);assert.equal(new Set(samples.children.map(m=>m.geometry)).size,3);
 for(const mesh of samples.children){assert(lods.includes(mesh.geometry));assert.equal(mesh.material,material);assert(mesh.castShadow&&mesh.receiveShadow&&!mesh.frustumCulled);}
 assert.equal(leaf.geometry,lods[2]);assert.equal(rock.visible,false);assert.deepEqual(samples.position.toArray(),[2,4,4]);
 cleanup();cleanup();assert.equal(disposed,0);assert.deepEqual(scene.children,[group]);assert.equal(leaf.parent,group);
});

test('branching trees outside the initial view upload shared bark once before play',async()=>{
 const scene=new T.Scene(),group=new T.Group(),geometry=new T.CylinderGeometry(.3,.5,5,10),material=new T.MeshStandardMaterial();
 scene.add(group);const roots=[];let disposed=0;
 for(let i=0;i<4;i++){
  const root=new T.Group();root.userData.forestTreeForm='woodland';root.position.set(i*20,0,-60);
  const trunk=new T.Mesh(geometry,material);trunk.name='tree-trunk';root.add(trunk);group.add(root);roots.push(root);
 }
 for(const resource of [geometry,material])resource.addEventListener('dispose',()=>disposed++);
 const cleanup=await prepareScenerySamples({world:{group,foliage:[]},scene,position:new T.Vector3(),yieldWork:async()=>{}});
 const samples=scene.getObjectByName('Scenery_Prewarm_Samples');assert.equal(samples.children.length,1);
 assert.equal(samples.children[0].geometry,geometry);assert.equal(samples.children[0].material,material);
 assert.equal(samples.children[0].frustumCulled,false);cleanup();assert.equal(disposed,0);
 assert.deepEqual(group.children,roots);geometry.dispose();material.dispose();
});

test('all regional tree bark and three crown buffers are included before play and reused after a restart',async()=>{
 const scene=new T.Scene(),group=new T.Group(),foliage=[],templates=[],resources=new Set();scene.add(group);let disposed=0,yields=0;
 for(const form of Object.values(BIOME_TREE_FORMS).flat())for(const variant of[0,1]){
  const template=biomeTreeTemplate(form,variant);templates.push(template);
  // Multiple trees share one template; all are behind the initial camera.
  for(let copy=0;copy<2;copy++){
   const root=new T.Group();root.position.set(variant*30+copy*5,0,-80);root.userData.biomeTreeForm=form;
   const trunk=new T.Mesh(template.trunk,treeSceneryMaterials.bark),leaf=new T.Mesh(template.canopy,template.material);trunk.name='tree-trunk';leaf.userData.treeTemplate=template;leaf.userData.treeLOD=2;root.add(trunk,leaf);group.add(root);foliage.push({leaf});
  }
 }
 const world={group,foliage},cleanup=await prepareScenerySamples({world,scene,position:new T.Vector3(),yieldWork:async()=>yields++}),samples=scene.getObjectByName('Scenery_Prewarm_Samples');
 assert.equal(yields,templates.length*2,'each missing near/mid LOD must yield during loading');assert.equal(samples.children.length,templates.length*4,'one shared bark and three crowns per template must be scheduled');
 for(const template of templates)for(const geometry of[template.trunk,...template.lods]){
  resources.add(geometry);geometry.addEventListener('dispose',()=>disposed++);
  const matches=samples.children.filter(m=>m.geometry===geometry);assert.equal(matches.length,1);assert(!matches[0].frustumCulled&&matches[0].castShadow&&matches[0].receiveShadow);
 }
 const ids=[...resources].map(g=>g.uuid);cleanup();assert.deepEqual(scene.children,[group]);assert.equal(disposed,0);
 // Playing the LOD transition cannot invoke the construction path again.
 for(const {leaf}of foliage){const t=leaf.userData.treeTemplate,make=t.makeLOD;t.makeLOD=()=>assert.fail('LOD built during play');try{for(const distance of[5,20,40]){updateTreeDetail(leaf,leaf.parent.position.x+distance,leaf.parent.position.z);assert(resources.has(leaf.geometry));}}finally{t.makeLOD=make;}}
 const again=await prepareScenerySamples({world,scene,position:new T.Vector3(),yieldWork:async()=>assert.fail('cached templates rebuilt after map restart')});
 assert.deepEqual(scene.getObjectByName('Scenery_Prewarm_Samples').children.map(m=>m.geometry.uuid).sort(),ids.sort());again();assert.equal(disposed,0);assert.deepEqual(scene.children,[group]);
});

test('remote shore and ash landmark buffers receive a loading draw and remain owned by their world',async()=>{
 const scene=new T.Scene(),group=new T.Group(),material=new T.MeshStandardMaterial(),geometries=[new T.BoxGeometry(12,5,3),new T.BoxGeometry(28,6,4)];scene.add(group);
 let disposed=0;const meshes=geometries.map((geometry,i)=>{const mesh=new T.Mesh(geometry,material);mesh.position.set(80+i*20,0,-90);mesh.userData.ownedGeometry=true;group.add(mesh);geometry.addEventListener('dispose',()=>disposed++);return mesh;});
 const world={group,foliage:[],biomeOutcrops:{records:[{mesh:meshes[0]},{mesh:meshes[0]}]},journeyEscarpment:{records:[{mesh:meshes[1]}]}},cleanup=await prepareScenerySamples({world,scene,position:new T.Vector3(),yieldWork:async()=>{}});
 const samples=scene.getObjectByName('Scenery_Prewarm_Samples');assert.equal(samples.children.length,2,'record duplicates must not upload twice');
 for(const mesh of meshes){const sample=samples.children.find(m=>m.geometry===mesh.geometry);assert(sample);assert.equal(sample.material,material);assert(!sample.frustumCulled&&sample.castShadow&&sample.receiveShadow);assert(!sample.userData.ownedGeometry);}
 cleanup();cleanup();assert.equal(disposed,0);assert.deepEqual(scene.children,[group]);assert.deepEqual(group.children,meshes);
 group.traverse(o=>{if(o.userData.ownedGeometry)o.geometry.dispose();});assert.equal(disposed,2);material.dispose();
});

test('the six real ash rock variants are uploaded once regardless of scatter copies',async()=>{
 const scene=new T.Scene(),group=new T.Group(),material=new T.MeshStandardMaterial(),geometries=[];scene.add(group);let disposed=0;
 for(const form of ASH_ROCK_FORMS)for(const variant of[0,1]){
  const {geometry}=biomeRockTemplate(form,variant);geometries.push(geometry);geometry.addEventListener('dispose',()=>disposed++);
  for(let copy=0;copy<3;copy++){const root=new T.Group();root.userData.biomeRockForm=form;root.position.set(-80,0,variant*20+copy);root.add(new T.Mesh(geometry,material));group.add(root);}
 }
 const cleanup=await prepareScenerySamples({world:{group,foliage:[]},scene,position:new T.Vector3(),yieldWork:async()=>{}}),samples=scene.getObjectByName('Scenery_Prewarm_Samples');
 assert.equal(samples.children.length,6);assert.deepEqual(new Set(samples.children.map(m=>m.geometry)),new Set(geometries));cleanup();assert.equal(disposed,0);assert.equal(group.children.length,18);material.dispose();
});
