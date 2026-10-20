import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {warmScene,compileWorldAsync,primeWorldShadowLights,withSceneryBatchSamples,waitForGPUPreparation} from '../render-prewarm.js';
import {CinematicRenderer} from '../cinematic-renderer.js';
import {FramePacer} from '../frame-pacing.js';

const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const locks=source.slice(source.indexOf('function lockPreparation('),source.indexOf('async function warmCurrentScene('));
const entry=source.slice(source.indexOf('async function prepareStart('),source.indexOf('// Private room adapter:'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(){
 const nodes={'#menu':{inert:false},'#start':{disabled:false},'#dialog':{close(){}},'#touch':{hidden:false}},events=[],gate=deferred(),reached=deferred();
 const context=vm.createContext({framePacer:new FramePacer(),preparing:false,roomSession:null,state:'menu',last:0,surfaceReady:Promise.resolve(),document:{hidden:false},performance:{now:()=>123},
  renderer:{},async waitForGPUPreparation(renderer){assert.equal(renderer,context.renderer);events.push('gpu-ready');},
  $:id=>nodes[id],keys:{clear(){}},releaseStick(){},clearAttack(){},unlockAudio(){events.push('audio');},restorePauseControls(){},
  player:{weaponId:'crossbow'},mapId:'forest',combatSampleKinds:map=>{assert.equal(map,'forest');return['wolf','duskbat','boss'];},AIR_ENEMIES:{duskbat:{voice:'wolf'}},
  sound:{stopWeapons(){},stopCreatures(){},async prepareWeapon(id,{yieldWork,report}){assert.equal(id,'crossbow');assert.equal(typeof yieldWork,'function');events.push(['weapon',id]);report(1,1);},
   async prepareEncounters(kinds,{voiceKinds,yieldWork,report}){assert.deepEqual(Array.from(kinds),['wolf','duskbat','boss']);assert.deepEqual(Array.from(voiceKinds),['wolf','wolf','boss']);assert.equal(typeof yieldWork,'function');events.push(['encounters']);report(1,1);}},renderBudget:{reset(){events.push('reset');}},console:{error(){}},
  yieldPreparation:async()=>{},async buildPrepared(){events.push('build');},warmCurrentScene(...args){events.push(['warm',...args]);reached.resolve();return gate.promise;},
  start(prepared){events.push(['start',prepared]);context.state='playing';},pause(){events.push('pause');context.state='paused';},requestMouseLook(){events.push('mouse');},
  loadingScreen:{show(){events.push('show');},hide(){events.push('hide');},setLoadingProgress(){},fail(message,retry){context.retry=retry;events.push('fail');}}
 });
 vm.runInContext(locks+entry,context);return{context,nodes,events,gate,reached,start:()=>vm.runInContext('prepareStart()',context)};
}

test('real entry locks input and holds loading until preparation completes; repeated start cannot build twice',async()=>{
 const f=fixture(),pending=f.start();assert.equal(f.context.state,'loading');assert(f.context.preparing);assert(f.nodes['#menu'].inert&&f.nodes['#start'].disabled);assert.equal(f.events.filter(x=>x==='build').length,0);
 await f.reached.promise;await f.start();assert.equal(f.events.filter(x=>x==='build').length,1);assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='warm').length,1);assert(!f.events.some(x=>Array.isArray(x)&&x[0]==='start'));
 assert.deepEqual(f.events.filter(x=>x==='build'||Array.isArray(x)).map(x=>Array.isArray(x)?x[0]:x),['build','weapon','encounters','warm'],'combat audio must prepare after the build and before visual warmup');
 f.gate.resolve();await pending;assert.equal(f.context.state,'playing');assert.deepEqual(f.events.find(x=>Array.isArray(x)&&x[0]==='start'),['start',true]);assert(!f.context.preparing&&!f.nodes['#menu'].inert&&!f.nodes['#start'].disabled);assert.equal(f.context.last,123);assert(f.events.includes('hide'));
});

test('entry finishing in a hidden tab pauses instead of playing unseen or locking the pointer',async()=>{
 const f=fixture();f.context.document.hidden=true;const pending=f.start();await f.reached.promise;f.gate.resolve();await pending;
 assert.equal(f.context.state,'paused');assert(f.events.includes('pause'));assert(!f.events.includes('mouse'));assert(!f.context.preparing);
});

test('combat waits for the submitted GPU work behind loading, without simulation or extra rendering',async()=>{
 for(const hidden of [false,true]){
  const f=fixture(),c=f.context,poll=deferred(),gpu=deferred(),sync={},calls=[];let polls=0;
  const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,TIMEOUT_EXPIRED:4,
   isContextLost:()=>false,fenceSync(){calls.push('fence');return sync;},flush(){calls.push('flush');},
   clientWaitSync(value,flags,timeout){assert.equal(value,sync);assert.equal(flags,0);assert.equal(timeout,0);return ++polls===1?4:3;},deleteSync(value){assert.equal(value,sync);calls.push('delete');}};
  Object.assign(c,{time:0,sceneryTime:11,renderer:{getContext:()=>gl},requestAnimationFrame(){},waitForGPUPreparation:renderer=>waitForGPUPreparation(renderer,async()=>{poll.resolve();await gpu.promise;})});
  const frame=source.slice(source.indexOf('function frame(now){'),source.indexOf('// Hidden tabs perform no rendering;',source.indexOf('function frame(now){')))+'time++;sceneryTime++;throw Error("unexpected draw");}';vm.runInContext(frame,c);
  const pending=f.start();await f.reached.promise;assert.equal(calls.length,0,'GPU fence must follow all warm draws');f.gate.resolve();await poll.promise;
  assert(c.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled);assert.equal(c.state,'loading');assert(!f.events.includes('hide'));await f.start();assert.equal(f.events.filter(x=>x==='build').length,1);
  vm.runInContext('frame(150)',c);assert.equal(c.time,0);assert.equal(c.sceneryTime,11);assert(!f.events.some(x=>Array.isArray(x)&&x[0]==='start'));
  c.document.hidden=hidden;gpu.resolve();await pending;
  assert.equal(c.state,hidden?'paused':'playing');assert(!c.preparing);assert(f.events.includes('hide'));assert.equal(c.time,0);assert.equal(c.sceneryTime,11);assert.deepEqual(calls,['fence','flush','delete']);assert.equal(f.events.includes('mouse'),!hidden);
  assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='warm').length,1);
 }
});

test('GPU preparation failure keeps entry locked and retries before starting combat',async()=>{
 const f=fixture(),c=f.context;let attempts=0;c.waitForGPUPreparation=async()=>{if(++attempts===1)throw Error('GPU preparation failed');};
 const pending=f.start();await f.reached.promise;f.gate.resolve();await pending;
 assert(c.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled);assert.equal(c.state,'loading');assert(!f.events.includes('hide'));assert(!f.events.some(x=>Array.isArray(x)&&x[0]==='start'));assert.equal(typeof c.retry,'function');
 c.warmCurrentScene=async()=>{};await c.retry();assert.equal(c.state,'playing');assert(!c.preparing);assert.equal(attempts,2);
});

test('failed entry remains safe to retry and a successful retry releases all loading input locks',async()=>{
 const f=fixture(),pending=f.start();await f.reached.promise;f.gate.reject(Error('shader upload'));await pending;
 assert.equal(f.context.state,'loading');assert(f.context.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled);assert.equal(typeof f.context.retry,'function');assert(!f.events.some(x=>Array.isArray(x)&&x[0]==='start'));
 f.context.warmCurrentScene=async()=>{};await f.context.retry();assert.equal(f.context.state,'playing');assert(!f.context.preparing&&!f.nodes['#menu'].inert&&!f.nodes['#start'].disabled);assert.equal(f.events.filter(x=>x==='build').length,2);
});

test('map preparation holds the menu lock and ignores repeated selections until the scene is ready',async()=>{
 const f=fixture(),c=f.context;
 Object.assign(c,{mapId:'forest',MAPS:{forest:{name:'森林'},coast:{name:'海港'},snow:{name:'雪地'}},renderChoices(){f.events.push('choices');},prepareLobby(){f.events.push('retry-lobby');}});
 vm.runInContext(source.slice(source.indexOf('async function prepareMap('),source.indexOf('async function prepareMenuReturn(')),c);
 await vm.runInContext("prepareMap('forest')",c);assert.equal(f.events.length,0);
 const pending=vm.runInContext("prepareMap('coast')",c);await f.reached.promise;
 assert.equal(c.state,'menu');assert.equal(c.mapId,'coast');assert(c.preparing&&f.nodes['#menu'].inert);
 await vm.runInContext("prepareMap('snow')",c);assert.equal(c.mapId,'coast');assert.equal(f.events.filter(x=>x==='build').length,1);
 f.gate.resolve();await pending;assert(!c.preparing&&!f.nodes['#start'].disabled);assert(!f.events.some(x=>Array.isArray(x)&&x[0]==='start'));
 c.state='playing';await vm.runInContext("prepareMap('snow')",c);assert.equal(c.mapId,'coast');
});

test('failed map preparation keeps the partial scene locked and offers a fresh lobby rebuild',async()=>{
 const f=fixture(),c=f.context;
 Object.assign(c,{mapId:'forest',MAPS:{coast:{name:'海港'}},renderChoices(){},prepareLobby(){f.events.push('retry-lobby');}});
 vm.runInContext(source.slice(source.indexOf('async function prepareMap('),source.indexOf('async function prepareMenuReturn(')),c);
 const pending=vm.runInContext("prepareMap('coast')",c);await f.reached.promise;f.gate.reject(Error('map upload'));await pending;
 assert(c.preparing&&f.nodes['#menu'].inert);assert.equal(c.state,'menu');assert.equal(c.retry,c.prepareLobby);await c.retry();assert(f.events.includes('retry-lobby'));
});

function menuFixture(){
 const f=fixture(),c=f.context;
 for(const id of ['#damage-edge','#hud','#encounter','#toast'])f.nodes[id]={hidden:false,style:{opacity:1}};
 Object.assign(c,{state:'paused',introductions:[{}],encounterTime:2,toastTimer:3,closeMenuDetails(){},renderChoices(){},syncMobileNotices(){},build(){f.events.push('build-sync');}});
 c.document.body={classList:{remove(){}}};
 const menu=source.slice(source.indexOf('function menu('),source.indexOf("$('#pause').onclick=pause;")),returning=source.slice(source.indexOf('async function prepareMenuReturn('),source.indexOf('async function prepareMenuHeroes('));
 vm.runInContext(menu+returning,c);return f;
}

test('UI menu return locks the whole rebuild and warmup, ignores repeated actions and never starts combat',async()=>{
 const f=menuFixture(),c=f.context,pending=vm.runInContext('menu()',c);
 assert.equal(c.state,'menu');assert(c.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled);assert(!f.nodes['#menu'].hidden&&f.nodes['#hud'].hidden&&f.nodes['#touch'].hidden);assert.equal(c.introductions.length,0);assert.equal(c.encounterTime,0);assert.equal(c.toastTimer,0);
 assert(!f.events.includes('build')&&!f.events.includes('build-sync'),'return must yield before building');
 await f.reached.promise;await vm.runInContext('menu()',c);await f.start();assert.equal(f.events.filter(x=>x==='build').length,1);assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='warm').length,1);
 f.gate.resolve();await pending;assert.equal(c.state,'menu');assert(!c.preparing&&!f.nodes['#menu'].inert&&!f.nodes['#start'].disabled);assert.equal(c.last,123);assert(f.events.includes('hide'));assert(!f.events.some(x=>Array.isArray(x)&&x[0]==='start'));
});

test('failed menu warmup keeps input locked and the retry rebuilds before unlocking',async()=>{
 const f=menuFixture(),c=f.context,pending=vm.runInContext('menu()',c);await f.reached.promise;f.gate.reject(Error('menu upload'));await pending;
 assert.equal(c.state,'menu');assert(c.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled);assert.equal(c.retry,c.prepareMenuReturn);assert(!f.events.includes('hide'));
 c.warmCurrentScene=async()=>{};await c.retry();assert.equal(f.events.filter(x=>x==='build').length,2);assert.equal(c.state,'menu');assert(!c.preparing&&!f.nodes['#menu'].inert&&!f.nodes['#start'].disabled);
});

test('the exposed game3d menu retains synchronous cleanup for existing debug and integration callers',async()=>{
 const f=menuFixture(),c=f.context,exported=source.match(/menu:\(\)=>menu\(\{immediate:true\}\)/)?.[0];assert(exported,'game3d must explicitly preserve its synchronous menu entry');
 vm.runInContext('api={'+exported+'}',c);assert.equal(c.api.menu(),undefined);assert.equal(c.state,'menu');assert(!c.preparing);assert.deepEqual(f.events,['build-sync']);
 c.start();await Promise.resolve();assert.equal(c.state,'playing');assert.deepEqual(f.events,['build-sync',['start',undefined]],'a delayed menu rebuild overwrote the restarted game');
});

test('menu preview instances are reused by loadout, detached on switch and never confused with combat instances',()=>{
 const created=[],disposed=[],removed=[],c=vm.createContext({hero:null,weaponFor:(kind,index)=>({id:kind+index}),actor(kind,weapon){const h={kind,weapon};created.push(h);return h;},scene:{remove(h){removed.push(h);}},disposeHero(h){disposed.push(h);}});
 vm.runInContext(source.slice(source.indexOf('const menuHeroes='),source.indexOf('function rebuildHero(')),c);
 const one=vm.runInContext("previewHero('scout',0)",c);assert.equal(vm.runInContext("previewHero('scout',0)",c),one);
 const two=vm.runInContext("previewHero('scout',1)",c);assert.notEqual(two,one);assert.equal(created.length,2);
 c.hero=one;vm.runInContext('releaseHero()',c);assert.equal(c.hero,null);assert.deepEqual(removed,[one]);assert.equal(disposed.length,0);
 const combat={kind:'scout',weapon:'scout0'};c.hero=combat;vm.runInContext('releaseHero()',c);assert.deepEqual(disposed,[combat]);assert.equal(vm.runInContext("previewHero('scout',0)",c),one);
});

function portraitFixture({enabled=true,postQuality=1}={}){
 const f=fixture(),c=f.context,originalTarget={name:'original'},draws=[],compiles=[],first={name:'first preview'},second={name:'second preview'},scene=new T.Scene(),companionMesh=new T.Group();
 f.compileGate=deferred();f.compileReached=deferred();
 let target=originalTarget;
 const renderer={extensions:{has:()=>enabled},capabilities:{maxSamples:2},info:{autoReset:true,reset(){}},shadowMap:{needsUpdate:false},
  getRenderTarget:()=>target,setRenderTarget(value){target=value;},getDrawingBufferSize(out){return out.set(640,360);},render(){}};
 const cinema=new CinematicRenderer(renderer);f.nodes['#preview-detail']={};
 Object.assign(c,{renderer,cinema,scene,companionMesh,hero:first,time:7,sceneryTime:11,kills:3,requestAnimationFrame(){},
  heroPreview:{portrait:false,setPortrait(value){this.portrait=value;f.events.push('portrait');},async compileAsync(s,hero,pet){
   assert.equal(s,scene);assert.equal(hero,c.hero);assert.equal(pet,companionMesh);assert(c.preparing&&this.portrait);
   compiles.push({hero,target});f.events.push('compile');
   if(f.holdCompile){f.holdCompile=false;f.compileReached.resolve();await f.compileGate.promise;}
   if((f.fail==='compile-hdr'&&target===cinema.sceneTarget)||(f.fail==='compile-direct'&&target===originalTarget))throw Error('portrait compile failure');
   f.events.push('compiled');
  }},
  clearObjects(){f.events.push('clear');},rebuildHero(){c.hero=f.nextHero;f.events.push('rebuild');},
  async yieldPreparation(){
   f.events.push('yield');vm.runInContext('frame(last+16)',c);
   if(f.hold){const hold=f.hold;f.hold=null;f.reached.resolve();await hold.promise;}
  },
  renderWorld(){
   assert(c.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled,'portrait draw escaped the loading gate');
   assert(c.heroPreview.portrait);draws.push({hero:c.hero,target});f.events.push('draw');
   if((f.fail==='hdr'&&target===cinema.sceneTarget)||(f.fail==='direct'&&target===originalTarget))throw Error('portrait upload failure');
  }
 });c.renderBudget.postQuality=postQuality;
 const frame=source.slice(source.indexOf('function frame(now){'),source.indexOf('// Hidden tabs perform no rendering;',source.indexOf('function frame(now){')))+'time++;sceneryTime++;}';
 const cache=source.match(/const preparedPortraits=new WeakSet\(\);/)?.[0];assert(cache,'portrait cache must follow preview object lifetime');
 vm.runInContext(cache+frame+source.slice(source.indexOf('async function preparePortrait('),source.indexOf('async function prepareLobby('))+source.slice(source.indexOf('function replaceMenuHero('),source.indexOf('function* buildSteps(')),c);
 return Object.assign(f,{first,second,draws,compiles,originalTarget,cinema,click:()=>f.nodes['#preview-detail'].onclick(),
  prepare:()=>vm.runInContext('preparePortrait()',c),replace(hero){f.nextHero=hero;return vm.runInContext('replaceMenuHero()',c);},cleanup:()=>cinema.dispose()});
}

function portraitRestored(f){
 const c=f.context;assert.equal(c.state,'menu');assert.equal(c.time,7);assert.equal(c.sceneryTime,11);assert.equal(c.kills,3);
 assert.equal(c.renderer.getRenderTarget(),f.originalTarget);assert(c.renderer.shadowMap.needsUpdate);
 assert(!c.preparing&&!f.nodes['#menu'].inert&&!f.nodes['#start'].disabled);assert.equal(c.last,123);
}

test('portrait prepares only on request, locks before yielding, covers both targets even at low budget and reuses the same preview',async()=>{
 for(const enabled of [true,false])for(const postQuality of [1,.65]){
  const f=portraitFixture({enabled,postQuality}),c=f.context;
  try{
   await f.prepare();assert.equal(f.events.length,0);assert.equal(f.draws.length,0,'fullbody triggered portrait preparation');
   c.state='playing';c.heroPreview.portrait=true;await f.prepare();assert.equal(f.events.length,0);c.state='menu';c.heroPreview.portrait=false;
   f.hold=f.gate;const pending=f.click();assert(c.heroPreview.portrait&&c.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled);
   assert.deepEqual(f.events,['portrait','show','yield']);assert.equal(f.draws.length,0,'first draw ran before the loading layer could paint');
   await f.reached.promise;await f.click();await f.prepare();assert.equal(f.events.filter(e=>e==='show').length,1);
   f.holdCompile=true;f.gate.resolve();await f.compileReached.promise;assert.equal(f.draws.length,0,'portrait drew before async compilation completed');assert(c.preparing);f.compileGate.resolve();await pending;portraitRestored(f);
   const expected=(enabled?[f.cinema.sceneTarget,f.originalTarget]:[f.originalTarget]).map(target=>({hero:f.first,target}));assert.deepEqual(f.draws,expected);assert.deepEqual(f.compiles,expected);
   assert.deepEqual(f.events.filter(e=>['yield','compile','compiled','draw'].includes(e)),['yield',...expected.flatMap(()=>['compile','compiled','yield','draw','yield'])],'each target must compile, yield, then draw');
   c.heroPreview.setPortrait(false);await f.click();await f.prepare();portraitRestored(f);assert.deepEqual(f.draws,expected,'cached portrait drew again');assert.deepEqual(f.compiles,expected,'cached portrait compiled again');assert.equal(f.events.filter(e=>e==='show').length,1);
  }finally{f.cleanup();}
 }
});

test('switching loadout in portrait prepares the new preview once and returning to a cached preview needs no loading',async()=>{
 const f=portraitFixture(),c=f.context;
 try{
  await f.replace(f.second);assert.equal(f.draws.length,0);assert(!c.preparing,'fullbody switch unexpectedly locked the menu');
  await f.click();assert.equal(f.draws.length,2);assert(f.draws.every(draw=>draw.hero===f.second));portraitRestored(f);
  const pending=f.replace(f.first);assert.equal(c.hero,f.first);assert(c.preparing&&f.nodes['#menu'].inert);await pending;
  assert.equal(f.draws.length,4);assert(f.draws.slice(2).every(draw=>draw.hero===f.first));portraitRestored(f);
  await f.replace(f.second);assert.equal(f.draws.length,4);assert.deepEqual(f.compiles,f.draws);assert.equal(f.events.filter(e=>e==='show').length,2);portraitRestored(f);
 }finally{f.cleanup();}
});

test('failed portrait HDR or direct compile/draw restores the target, stays locked and retries the uncached preview without advancing game time',async()=>{
 for(const [enabled,fail] of [[true,'compile-hdr'],[true,'compile-direct'],[false,'compile-direct'],[true,'hdr'],[true,'direct'],[false,'direct']]){
  const f=portraitFixture({enabled}),c=f.context;f.fail=fail;
  try{
   await f.click();assert(c.preparing&&f.nodes['#menu'].inert&&f.nodes['#start'].disabled);assert.equal(c.state,'menu');assert.equal(c.time,7);assert.equal(c.sceneryTime,11);assert.equal(c.kills,3);
   assert.equal(c.renderer.getRenderTarget(),f.originalTarget);assert(c.renderer.shadowMap.needsUpdate);assert.equal(typeof c.retry,'function');assert(!f.events.includes('hide'));
   const failedDraws=f.draws.length,failedCompiles=f.compiles.length;await f.click();assert.equal(f.draws.length,failedDraws,'failure allowed another unguarded request');assert.equal(f.compiles.length,failedCompiles);
   if(fail.startsWith('compile'))assert.equal(failedDraws,failedCompiles-1,'failed compile still drew its target');
   f.fail=null;await c.retry();portraitRestored(f);
   const expected=(enabled?[f.cinema.sceneTarget,f.originalTarget]:[f.originalTarget]).map(target=>({hero:f.first,target}));assert.deepEqual(f.draws.slice(failedDraws),expected,'failed attempt was incorrectly cached');assert.deepEqual(f.compiles.slice(failedCompiles),expected);
   await f.click();assert.equal(f.draws.length,failedDraws+expected.length);assert.equal(f.compiles.length,failedCompiles+expected.length);assert.equal(f.events.filter(e=>e==='show').length,2);portraitRestored(f);
  }finally{f.cleanup();}
 }
});

test('the actual animation entry advances neither simulation nor scenery during preparation',()=>{
 const frame=source.slice(source.indexOf('function frame(now){'),source.indexOf('// Hidden tabs perform no rendering;',source.indexOf('function frame(now){')))+'time++;sceneryTime++;}';
 const context=vm.createContext({framePacer:new FramePacer(),preparing:true,last:0,time:6,sceneryTime:13,scheduled:0,requestAnimationFrame(){context.scheduled++;}});vm.runInContext(frame,context);
 for(let i=1;i<=30;i++)vm.runInContext(`frame(${i*16})`,context);
 assert.equal(context.time,6);assert.equal(context.sceneryTime,13);assert.equal(context.last,480);assert.equal(context.scheduled,30);
 context.preparing=false;vm.runInContext('frame(496)',context);assert.equal(context.time,7);
});

test('real scene warmup covers every view/target and restores samples, camera and target after each failure stage',async()=>{
 const warm=source.slice(source.indexOf('async function warmCurrentScene('),source.indexOf('async function prepareMap('));
 for(const mode of ['first','third'])for(const combat of [false,true])for(const enabled of [false,true])for(const fail of [null,'scenery',...(combat?['combat','compile-first','final-prime']:[]),'compile','draw']){
  const events=[],originalTarget={},hdrTarget={},scene=new T.Scene(),camera=new T.PerspectiveCamera(),previewCamera=new T.PerspectiveCamera(),hero=new T.Group(),firstRoot=new T.Group(),scenery=new T.Group(),samples=new T.Group();scene.fog={color:{}};firstRoot.layers.set(1);scene.add(hero,firstRoot);camera.layers.set(4);
  let target=originalTarget,firstVisible=false,compileCount=0,drawCount=0;
  const context=vm.createContext({scene,camera,hero,heroId:'scout',mirageVFX:null,companionMesh:null,vfx:{},mapId:'forest',player:{},warmScene,compileWorldAsync,primeWorldShadowLights,withSceneryBatchSamples,yieldPreparation:async()=>{},renderBudget:{quality:1,postQuality:1},
   sceneryTime:4,world:{},localBiome:()=> 'forest',hemisphere:{color:{}},sun:{color:{},intensity:3.25},environmentLighting:{direction:{},day:1},atmosphere:{update(time,camera,options){assert.equal(time,4);assert.equal(options.visible,combat);}},
   renderer:{autoClear:true,getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},shadowMap:{},initTexture(){},compile(subject,c,lightingScene){assert(combat);assert.equal(subject.children.length,0);assert.equal(c,camera);assert.equal(lightingScene,scene);assert.equal(c.layers.mask,context.adventureCamera.mode==='first'?2:1);if(fail==='draw'&&drawCount>0)throw Error('cleanup prime masked draw error');events.push({stage:'shadow-lights',target,layer:c.layers.mask});if(fail==='final-prime'&&drawCount===(enabled?4:2))throw Error('fixture failure');},render(s,c){assert(combat);assert.equal(s.children.length,0);assert.notEqual(s,scene);assert.equal(c,camera);assert.equal(this.autoClear,false);events.push({stage:'prime',target,layer:c.layers.mask});},async compileAsync(s,c,lightingScene){assert.equal(this.autoClear,true);assert.equal(s,combat&&c.layers.mask===2?firstRoot:scene);assert.equal(c,combat?camera:previewCamera);assert.equal(lightingScene,combat?scene:undefined);events.push({stage:'compile',target,layer:c.layers.mask,object:s,lightingScene});if((fail==='compile'&&++compileCount===1)||(fail==='compile-first'&&s===firstRoot))throw Error('fixture failure');}},
   adventureCamera:{mode,yaw:.5,pitch:0,setMode(mode){this.mode=mode;}},firstPerson:{root:firstRoot,update(time,dt,options){firstVisible=options.visible;}},updateCamera(){},
   renderWorld(){assert.equal(context.renderer.shadowMap.needsUpdate,true);events.push({stage:'draw',target,mode:context.adventureCamera.mode,first:firstVisible});drawCount++;if(fail==='draw'&&drawCount===1)throw Error('fixture failure');},
   heroPreview:{compileSceneAsync(s,h,pet){assert.equal(h,hero);return context.renderer.compileAsync(s,previewCamera);}},
   cinema:{enabled,sceneTarget:hdrTarget,render(draw,quality){assert.equal(quality,1);const previous=target;try{target=hdrTarget;draw();}finally{target=previous;}}},loadingScreen:{setLoadingProgress(){}},
   async prepareScenerySamples(options){assert.equal(options.scene,scene);assert.equal(options.position,hero.position);if(fail==='scenery')throw Error('fixture failure');scene.add(scenery);return()=>{events.push('clear-scenery');scenery.removeFromParent();};},
   async prepareCombatSamples(){if(fail==='combat')throw Error('fixture failure');scene.add(samples);return()=>{events.push('clear-combat');samples.removeFromParent();};}
  });vm.runInContext(warm,context);
  const result=vm.runInContext(`warmCurrentScene(30,98,{combat:${combat}})`,context);if(fail)await assert.rejects(result,/fixture failure/);else await result;
  assert.equal(events.filter(e=>e==='clear-scenery').length,fail==='scenery'?0:1);assert.equal(events.filter(e=>e==='clear-combat').length,combat&&!['scenery','combat'].includes(fail)?1:0);assert.deepEqual(scene.children,[hero,firstRoot]);
  assert.equal(context.adventureCamera.mode,mode);assert.equal(firstVisible,combat&&mode==='first');assert.equal(context.renderer.autoClear,true);assert.equal(context.renderer.shadowMap.needsUpdate,true);assert.equal(camera.layers.mask,1<<4);assert.equal(target,originalTarget);
  if(!fail){
   const targets=enabled?[hdrTarget,originalTarget]:[originalTarget],views=combat?['third','first']:[mode];
   const expectedDraws=targets.flatMap(target=>views.map(mode=>({stage:'draw',target,mode,first:combat&&mode==='first'}))),expectedCompiles=targets.flatMap(target=>views.map((_,i)=>({stage:'compile',target,layer:combat?1<<i:1,object:combat&&i===1?firstRoot:scene,lightingScene:combat?scene:undefined})));
   assert.deepEqual(events.filter(e=>e.stage==='compile'),expectedCompiles);assert.deepEqual(events.filter(e=>e.stage==='draw'),expectedDraws);
   assert.deepEqual(events.filter(e=>e.stage==='prime'),combat?expectedCompiles.map(({target,layer})=>({stage:'prime',target,layer})):[]);
   assert.deepEqual(events.filter(e=>e.stage==='shadow-lights'),combat?[...expectedCompiles.map(({target,layer})=>({stage:'shadow-lights',target,layer})),{stage:'shadow-lights',target:originalTarget,layer:mode==='first'?2:1}]:[]);
  }
 }
});

function selectionFixture(){
 const f=fixture(),c=f.context,first={name:'scout:0'},second={name:'silver:0'};
 const cache=new Map([['scout:scout0',first]]),ready=new WeakSet([first]);
 Object.assign(c,{heroId:'scout',weaponIndex:0,hero:first,menuHeroes:cache,preparedMenuHeroes:ready,preparedPortraits:new WeakSet(),
  weaponFor:(kind,index)=>({id:kind+index}),heroPreview:{portrait:false},
  renderChoices(){f.events.push('choices');},clearObjects(){f.events.push('clear');},
  rebuildHero(){f.events.push('rebuild');c.hero=second;cache.set(c.heroId+':'+c.heroId+c.weaponIndex,second);},
  replaceMenuHero(){f.events.push('cached');c.hero=cache.get(c.heroId+':'+c.heroId+c.weaponIndex);},
  async yieldPreparation(){f.events.push('yield');f.reached.resolve();await f.gate.promise;},
  async prepareMenuHeroes(from,to,choices){assert.equal(choices.length,1);assert.equal(choices[0][0],c.heroId);f.events.push('warm');ready.add(c.hero);},
  async preparePortrait(){assert(!c.preparing);c.preparing=true;f.events.push('portrait');c.preparedPortraits.add(c.hero);vm.runInContext('unlockPreparation()',c);}
 });
 vm.runInContext(source.slice(source.indexOf('async function prepareMenuLoadout('),source.indexOf('function replaceMenuHero(')),c);
 return Object.assign(f,{cache,ready,first,second,select:(kind,index=0)=>vm.runInContext(`prepareMenuLoadout('${kind}',${index})`,c)});
}

test('cold selection yields before construction, warms only the request and reuses the same instance afterwards',async()=>{
 const f=selectionFixture(),c=f.context,pending=f.select('silver');
 assert(c.preparing&&f.nodes['#menu'].inert);assert.equal(c.hero,f.first);assert(!f.events.includes('rebuild'));
 await f.reached.promise;await f.select('mirage');assert.equal(c.heroId,'scout','second request escaped preparation lock');
 f.gate.resolve();await pending;assert.equal(c.hero,f.second);assert(f.ready.has(f.second));assert(!c.preparing);
 assert.deepEqual(f.events.filter(e=>['yield','rebuild','warm'].includes(e)),['yield','rebuild','warm']);
 await f.select('scout');await f.select('silver');assert.equal(f.events.filter(e=>e==='warm').length,1);assert.equal(f.events.filter(e=>e==='cached').length,2);
 c.state='playing';await f.select('mirage');assert.equal(c.heroId,'silver');
});

test('cold selection keeps failed resources locked and retries; portrait prepares before unlocking',async()=>{
 const f=selectionFixture(),c=f.context;
 c.prepareMenuHeroes=async()=>{throw Error('injected upload failure');};
 const pending=f.select('silver');f.gate.resolve();await pending;
 assert(c.preparing&&f.nodes['#menu'].inert);assert(!f.ready.has(f.second));assert.equal(typeof c.retry,'function');
 c.prepareMenuHeroes=async()=>{f.ready.add(c.hero);};c.heroPreview.portrait=true;
 await c.retry();assert(!c.preparing);assert(c.preparedPortraits.has(f.second));assert(f.events.includes('portrait'));
});

test('preparation yields a real task without a fixed idle delay, with a timer fallback',async()=>{
 const declaration=source.slice(source.indexOf('const yieldPreparation='),source.indexOf('document.body.classList.toggle'));
 let calls=0;
 const native=vm.createContext({scheduler:{yield(){calls++;return Promise.resolve('native');}},setTimeout(){assert.fail('native yield should not add a timer');}});
 vm.runInContext(declaration,native);assert.equal(await vm.runInContext('yieldPreparation()',native),'native');assert.equal(calls,1);
 let release,delay;
 const fallback=vm.createContext({setTimeout(resolve,ms){release=resolve;delay=ms;}});
 vm.runInContext(declaration,fallback);const pending=vm.runInContext('yieldPreparation()',fallback);
 assert.equal(delay,0);assert.equal(typeof release,'function');release();await pending;
});

test('incremental preparation groups cheap chunks but yields across CPU budget and keeps progress bounded',async()=>{
 let clock=0,yields=0,steps=0;const progress=[];
 const c=vm.createContext({performance:{now:()=>clock},loadingScreen:{setLoadingProgress:(stage,value)=>progress.push({stage,value})},
  yieldPreparation:async()=>{yields++;},
  buildSteps:function*(){for(let major=0;major<20;major++){for(let i=0;i<30;i++){clock+=.5;steps++;yield {stage:'geometry',completed:i,total:30};}yield 'stage '+major;}}
 });
 vm.runInContext(source.slice(source.indexOf('async function buildPrepared('),source.indexOf('function renderChoices(')),c);
 await vm.runInContext('buildPrepared(18,58)',c);
 assert.equal(steps,600);assert(yields>=40&&yields<60,'each tiny chunk must not introduce a separate delay');
 assert.equal(progress.length,20);assert.equal(progress.at(-1).value,58);assert(progress.every(p=>p.value>=18&&p.value<=58));
});
