const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const url=process.env.TEST_URL||'http://127.0.0.1:8899/',output=process.env.OUTPUT_DIR||'../../outputs';
const ready=p=>p.waitForFunction(()=>window.game3d&&!document.querySelector('#start').disabled,null,{timeout:60000});
const saved=p=>p.waitForFunction(()=>document.querySelector('#offline-status').textContent.includes('离线资源已准备好'),null,{timeout:90000}).catch(async e=>{throw Error(e.message+'; '+await p.locator('#offline-status').innerText());});
(async()=>{for(const [width,height]of[[1440,900],[844,390],[390,844]].filter(([w])=>!process.env.TEST_WIDTH||w===Number(process.env.TEST_WIDTH))){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'forest3d-offline-')),options={executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width,height},hasTouch:width<1000};let context;
 try{
  context=await chromium.launchPersistentContext(profile,options);let p=context.pages()[0];
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await ready(p);await p.locator('#offline-panel summary').click();await p.locator('#offline-download').click();await saved(p);
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // A missing file must not be silently labelled ready; repair really downloads it again.
  await p.evaluate(async()=>{const name=(await caches.keys()).find(n=>n.startsWith('forest3d-offline:')),c=await caches.open(name);await c.delete(new URL('assets/bestiary/mushroom.png',location.href));});
  await p.reload({waitUntil:'domcontentloaded'});await ready(p);await p.waitForFunction(()=>document.querySelector('#offline-status').textContent.includes('不完整'));
  await p.locator('#offline-panel summary').click();await p.locator('#offline-download').click();await saved(p);
  await p.screenshot({path:output+`/v78-offline-ready-${width}.png`});
  await p.evaluate(async()=>{await caches.delete('forest3d-reborn-character-assets-v1');localStorage.setItem('forest3d-offline-test','preserved');});
  await context.close();context=null;
  // A new browser process, no HTTP memory cache, and networking disabled before navigation.
  context=await chromium.launchPersistentContext(profile,{...options,offline:true});
  await context.addInitScript(({fallback})=>{
   if(fallback)Object.defineProperty(window,'DecompressionStream',{value:undefined});
   const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>{window.nextFrame=cb;return raf(t=>{if(!window.freezeGame)cb(t);});};
  },{fallback:width===390});
  p=context.pages()[0];const errors=[],failed=[],responses=[];p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>failed.push(r.url()));p.on('response',r=>{if(r.url().startsWith('http'))responses.push({url:r.url(),sw:r.fromServiceWorker()});});
  const offlineUrl=new URL(url);offlineUrl.search='?v=offline-cold-start';await p.goto(offlineUrl.href,{waitUntil:'domcontentloaded',timeout:60000});await ready(p);await saved(p);
  assert.equal(await p.evaluate(()=>localStorage.getItem('forest3d-offline-test')),'preserved');
  await p.locator('#start').click();await p.evaluate(()=>freezeGame=true);await p.waitForTimeout(70);
  for(const [hero,map]of[['scout','forest'],['silver','snow'],['wraith','ash'],['scout','sand'],['tide','coast'],['lingya','confluence'],['wuling','forest']]){
   const result=await p.evaluate(([hero,map])=>{const g=game3d;g.select(hero,map,0);g.start();g.player.inv=999;g.player.attack=999;let t=performance.now();for(let i=0;i<30;i++)nextFrame(t+=17);g.spawn('wolf',g.player.x+5,g.player.z+5);g.pause();const time=g.time;g.step(1);const paused=time===g.time;g.resume();g.dash();for(let i=0;i<60;i++)g.step(1/60);return {state:g.state,paused,meshes:g.renderer.info.render.calls,audio:g.audio.ctx?.state};},[hero,map]);
   assert.equal(result.state,'playing');assert(result.paused);assert(result.meshes>0);assert.equal(result.audio,'running');
  }
  await p.evaluate(()=>{game3d.player.level=2;game3d.player.pending=1;game3d.grant(0);document.querySelector('#upgrade-ready').click();});assert.equal(await p.locator('[data-upgrade]').count(),3);await p.locator('[data-upgrade]').first().click();assert.equal(await p.evaluate(()=>game3d.state),'playing');
  const portraits=await p.evaluate(async()=>{const {ENEMY_GUIDE}=await import('./battle-guide.js?v=90');for(const e of Object.values(ENEMY_GUIDE)){const image=new Image();image.src=e.image;await image.decode();}return Object.keys(ENEMY_GUIDE).length;});assert.equal(portraits,30);
  await p.screenshot({path:output+`/v78-offline-playing-${width}.png`});
  await p.reload({waitUntil:'domcontentloaded'});await ready(p);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert(responses.length>80);assert(responses.every(r=>r.sw),'network used during cold offline run');
  console.log(`PASS ${width}x${height}: full download, missing-file repair, browser restart offline, six heroes across six maps, audio, upgrade/pause, 30 portraits, offline reload${width===390?', uncompressed compatibility assets':''}`);
 }finally{
  await context?.close();const resolved=path.resolve(profile);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('forest3d-offline-'))await fs.rm(resolved,{recursive:true,force:true,maxRetries:3});
 }
}})().catch(error=>{console.error(error);process.exit(1);});
