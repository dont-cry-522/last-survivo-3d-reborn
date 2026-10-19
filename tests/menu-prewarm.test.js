import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {HERO_LOADOUTS,weaponFor} from '../rules.js';
import {warmScene} from '../render-prewarm.js';
import {CinematicRenderer} from '../cinematic-renderer.js';

const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const cacheSource=source.slice(source.indexOf('const menuHeroes='),source.indexOf('function rebuildHero('));
const prepareSource=source.slice(source.indexOf('async function prepareMenuHeroes('),source.indexOf('async function preparePortrait('));
const loadouts=Object.entries(HERO_LOADOUTS).flatMap(([kind,list])=>list.map((weapon,index)=>({kind,weapon,index})));

function fixture({enabled=true,fail=null,portrait=false,visible=true,petVisible=true,current='silver'}={}){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),previewCamera=new T.PerspectiveCamera(),originalTarget={name:'original target'},events=[],created=[],pets=[],disposed=[],drawn=new Set();
 let target=originalTarget,preview=null;
 const scenery=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()),lamp=new T.PointLight();
 scenery.layers.set(3);scenery.add(lamp);scene.add(scenery);
 camera.layers.set(4);
 const renderer={
  extensions:{has:()=>enabled},capabilities:{maxSamples:2},info:{autoReset:true,reset(){}},shadowMap:{needsUpdate:false},
  getRenderTarget:()=>target,setRenderTarget(value){target=value;},getDrawingBufferSize(out){return out.set(640,360);},initTexture(){},
  async compileAsync(subject,c,s){
   assert.equal(s,scene);assert.equal(c,previewCamera);assert(preview.sample.visible);
   assert.equal(preview.sample.parent.name,'Hero_Prewarm_Sample');assert.equal(preview.sample.parent.parent,scene);
   assert.equal(subject,preview.sample.parent,'only pending actors should compile, not the forest');
   if(preview.pet)assert.equal(preview.pet.parent,preview.sample.parent);
   events.push({type:'compile',sample:preview.sample,target,portrait:preview.portrait,actors:subject.children.filter(o=>o.userData.kind).map(o=>o.userData.kind)});
   if(fail==='compile')throw Error('injected compile failure');
  },
  render(s,c){
   if(s!==scene)return; // Actual CinematicRenderer also draws its postprocess scene.
   assert.equal(scenery.layers.mask,0,'already warm scenery should not be redrawn');assert.equal(lamp.layers.mask,1,'scene lighting must stay unchanged');
   assert.equal(c,previewCamera);const sample=preview.sample;
   assert.deepEqual(sample.parent.children.filter(o=>o.userData.kind),[sample],'only the current actor may be drawn, not the whole compiler batch');
   events.push({type:'draw',sample,target,portrait:preview.portrait});drawn.add(sample);
   if(sample.userData.kind==='lingya'&&((fail==='hdrDraw'&&target===cinema.sceneTarget)||(fail==='directDraw'&&target===originalTarget)))throw Error('injected draw failure');
  }
 };
 const cinema=new CinematicRenderer(renderer),renderCinema=cinema.render.bind(cinema);
 cinema.render=(draw,quality)=>{events.push({type:'cinema',quality});return renderCinema(draw,quality);};
 function actor(kind,weapon){
  const group=new T.Group();group.userData={kind,weapon};group.name=kind+':'+weapon;
  const geometry=new T.BoxGeometry(.2,1,.2),material=new T.MeshStandardMaterial();group.add(new T.Mesh(geometry,material));
  geometry.addEventListener('dispose',()=>disposed.push(group));material.addEventListener('dispose',()=>disposed.push(group));created.push(group);return group;
 }
 const companionMesh=new T.Group();companionMesh.visible=petVisible;scene.add(companionMesh);
 const context=vm.createContext({T,HERO_LOADOUTS,weaponFor,actor,scene,camera,renderer,cinema,warmScene,renderBudget:{quality:1,postQuality:1},companionMesh,
  hero:null,heroId:current,weaponIndex:0,state:'menu',time:12,kills:3,
  loadingScreen:{setLoadingProgress(){}},yieldPreparation:async()=>{},
  heroPreview:{landscapeYaw:.66,needsFit:false,portrait,render(s,sample,pet,draw){preview={sample,pet,portrait:this.portrait};return draw?draw(s,previewCamera):renderer.render(s,previewCamera);},compileAsync(s,sample,pet,subject){return this.render(s,sample,pet,(s,c)=>renderer.compileAsync(subject,c,s));}},
  makeBadger(){const pet=new T.Group();pet.name='temporary badger';pets.push(pet);return pet;},
  animateActor(sample,time,speed){assert.equal(time,0);assert.equal(speed,0);events.push({type:'pose',sample});},
  disposeHero(sample){disposed.push(sample);},update(){assert.fail('previews must not simulate combat');},spawn(){assert.fail('previews must not spawn combat');}
 });
 vm.runInContext(cacheSource+prepareSource,context);
 context.hero=vm.runInContext(`previewHero('${current}',0)`,context);const hero=context.hero;hero.visible=visible;hero.position.set(4,.2,-7);scene.add(hero);
 return{scene,scenery,lamp,camera,renderer,cinema,originalTarget,context,events,created,pets,disposed,drawn,hero,companionMesh,portrait,
  run:()=>vm.runInContext('prepareMenuHeroes(72,94,Object.entries(HERO_LOADOUTS).flatMap(([kind,list])=>list.map((_,index)=>[kind,index])))',context),
  cleanup(){cinema.dispose();scenery.geometry.dispose();scenery.material.dispose();for(const group of created)group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
 };
}

function restored(f,visible,petVisible){
 assert.equal(f.hero.visible,visible);assert.equal(f.companionMesh.visible,petVisible);
 assert.equal(f.hero.parent,f.scene);assert.equal(f.companionMesh.parent,f.scene);
 assert.deepEqual(new Set(f.scene.children),new Set([f.hero,f.companionMesh,f.scenery]));
 assert.equal(f.scenery.layers.mask,1<<3);assert.equal(f.lamp.layers.mask,1);
 assert.equal(f.renderer.getRenderTarget(),f.originalTarget);assert.equal(f.camera.layers.mask,1<<4);
 assert.equal(f.context.heroPreview.portrait,f.portrait,'preparation changed the selected full/detail view');
 assert(f.context.heroPreview.needsFit&&f.renderer.shadowMap.needsUpdate);
 assert.equal(f.context.state,'menu');assert.equal(f.context.time,12);assert.equal(f.context.kills,3);
 assert.equal(f.disposed.length,0,'cached actors must keep their warmed GPU resources');
 assert(f.pets.every(p=>p.parent===null),'temporary companion escaped preview cleanup');
}


test('default heroes share fullbody/portrait programs, retain caches and restore environment and actors',async()=>{
 for(const enabled of[true,false])for(const portrait of[false,true]){
  const f=fixture({enabled,portrait,current:'lingya'}),world=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()),light=new T.PointLight();world.add(light);world.layers.set(3);f.scene.add(world);
  try{
   const run=()=>vm.runInContext('prepareMenuHeroes(84,98,Object.keys(HERO_LOADOUTS).map(kind=>[kind,0]),{portraits:true})',f.context);
   const old=f.hero.position.clone(),quaternion=f.hero.quaternion.clone();await run();
   assert.equal(world.layers.mask,1<<3);assert.equal(light.layers.mask,1);f.scene.remove(world);restored(f,true,true);
   assert(f.hero.position.equals(old)&&f.hero.quaternion.equals(quaternion));
   const compiles=f.events.filter(e=>e.type==='compile');assert.equal(compiles.length,enabled?2:1);
   for(const e of compiles)assert.equal(e.actors.length,7);
   assert.equal(f.drawn.size,7);for(const sample of f.created){const draws=f.events.filter(e=>e.type==='draw'&&e.sample===sample);assert.equal(draws.length,enabled?2:1);f.context.sample=sample;assert(vm.runInContext('preparedMenuHeroes.has(sample)&&preparedPortraits.has(sample)',f.context));}
   await run();assert.equal(f.events.filter(e=>e.type==='compile').length,compiles.length);assert.equal(f.created.length,7);
  }finally{world.geometry.dispose();world.material.dispose();f.cleanup();}
 }
});
test('preparation failure restores parent, position, visibility, layers and caches only completed actors',async()=>{
 for(const fail of['compile','hdrDraw','directDraw'])for(const current of['silver','lingya']){
  const f=fixture({fail,current,portrait:true,visible:false,petVisible:false});
  try{const p=f.hero.position.clone();await assert.rejects(vm.runInContext('prepareMenuHeroes(84,98,Object.keys(HERO_LOADOUTS).map(kind=>[kind,0]))',f.context),/injected (compile|draw) failure/);restored(f,false,false);assert(f.hero.position.equals(p));f.context.failed=fail==='compile'?f.events.findLast(e=>e.type==='compile').sample:f.created.find(o=>o.userData.kind==='lingya');assert.equal(vm.runInContext('preparedMenuHeroes.has(failed)||preparedPortraits.has(failed)',f.context),false);}
  finally{f.cleanup();}
 }
});
test('single-loadout preparation prepares only the requested actor and its portrait is immediately reusable',async()=>{
 const f=fixture({current:'silver'});try{
  await vm.runInContext('prepareMenuHeroes(10,95)',f.context);assert.equal(f.created.length,1);assert.equal(f.events.filter(e=>e.type==='compile').length,2);restored(f,true,true);
  assert(vm.runInContext('preparedPortraits.has(hero)',f.context));
  await vm.runInContext('prepareMenuHeroes(10,95,[[heroId,weaponIndex]])',f.context);assert.equal(f.events.filter(e=>e.type==='compile').length,2);assert.equal(f.created.length,1);restored(f,true,true);
 }finally{f.cleanup();}
});

test('all existing weapon previews remain compatible with explicit batch preparation and a cached retry',async()=>{
 const f=fixture();try{
  await f.run();restored(f,true,true);assert.equal(f.created.length,loadouts.length);
  const compiles=f.events.filter(e=>e.type==='compile');assert.equal(compiles.length,2);for(const e of compiles)assert.equal(e.actors.length,loadouts.length);
  for(const {kind,weapon}of loadouts){
   const sample=f.created.find(o=>o.userData.kind===kind&&o.userData.weapon===weapon);assert(sample);
   assert.equal(f.events.filter(e=>e.type==='draw'&&e.sample===sample).length,2);
  }
  await f.run();restored(f,true,true);assert.equal(f.events.filter(e=>e.type==='compile').length,2);
 }finally{f.cleanup();}
});

test('the real lobby prepares all existing loadouts in both views before enabling selection',async()=>{
 const f=fixture();try{
  const lobby=source.slice(source.indexOf('async function prepareLobby('),source.indexOf('async function prepareStart(')),calls=[];
  Object.assign(f.context,{lockPreparation(){},unlockPreparation(){calls.push('ready');},loadHeroAssets:async()=>{},surfaceReady:Promise.resolve(),buildPrepared:async()=>{},warmCurrentScene:async()=>{},prepareMenuHeroes:async(a,b,choices,options)=>{calls.push({choices,options});}});
  Object.assign(f.context.loadingScreen,{show(){},fail(){assert.fail('lobby prep failed');}});
  vm.runInContext(lobby,f.context);await vm.runInContext('prepareLobby()',f.context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].choices)),loadouts.map(({kind,index})=>[kind,index]));
  assert.equal(calls[0].options,undefined);assert.equal(calls[1],'ready');
 }finally{f.cleanup();}
});
