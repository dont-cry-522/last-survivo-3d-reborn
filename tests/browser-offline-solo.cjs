// Real offline single-player regression. Uses a fresh persistent browser profile,
// stops its own HTTP host, restarts the browser offline, then plays the actual page.
// This is desktop/viewport QA, not a physical-phone performance measurement.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=process.env.OUTPUT_DIR||path.resolve(root,'../../outputs/offline-solo-qa');
const viewport={width:Number(process.env.TEST_WIDTH)||1100,height:Number(process.env.TEST_HEIGHT)||700};
const touch=process.env.TEST_TOUCH==='1',checks=[],errors=[],failed=[],responses=[],sockets=[],socketAttempts=[],httpErrors=[],consoleErrors=[];
const log=(name,data={})=>{checks.push({name,...data});console.log('PASS '+name);};
const ready=page=>page.waitForFunction(()=>window.game3d?.surfaceReady&&!document.querySelector('#start').disabled,null,{timeout:240000});
const saved=page=>page.waitForFunction(()=>document.querySelector('#offline-status').textContent.includes('离线资源已准备好'),null,{timeout:240000});
(async()=>{
 const manifest=JSON.parse(await fs.readFile(path.join(root,'offline-package.json'),'utf8'));
 const mainHash=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'main.js'))).digest('hex');
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'reborn-offline-solo-'));
 const {createRoomServer}=await import('../scripts/room-server.mjs');
 const server=await createRoomServer({port:0,root}),url=server.url+'/play.html';
 server.server.on('request',(req,res)=>res.on('finish',()=>{if(res.statusCode>=400)httpErrors.push({path:new URL(req.url,server.url).pathname,status:res.statusCode});}));
 const options={executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport,deviceScaleFactor:1,hasTouch:touch,isMobile:touch,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']};
 let context,page,offline=false,serverStopped=false;
 const observe=async()=>{
  await context.addInitScript(()=>{window.__socketAttempts=[];window.WebSocket=new Proxy(window.WebSocket,{construct(Target,args){window.__socketAttempts.push(String(args[0]));window.__recordOfflineSocketAttempt(String(args[0]));return Reflect.construct(Target,args);}});});
  page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);
  await page.exposeFunction('__recordOfflineSocketAttempt',url=>socketAttempts.push({offline,url}));
  page.on('pageerror',e=>{errors.push({offline,message:e.message,stack:e.stack});console.error('PAGE_ERROR '+e.stack);});
  page.on('console',message=>{if(message.type()==='error'){const url=message.location().url;consoleErrors.push({offline,message:message.text().slice(0,300),path:url?new URL(url).pathname:''});}});
  page.on('requestfailed',r=>failed.push({offline,url:r.url(),error:r.failure()?.errorText}));
  page.on('response',r=>{if(offline&&r.url().startsWith(server.url))responses.push({path:new URL(r.url()).pathname,sw:r.fromServiceWorker()});});
  page.on('websocket',socket=>sockets.push(socket.url()));
 };
 const report=extra=>({version:manifest.version,build:manifest.build,mainHash,viewport,touchEmulation:touch,physicalPhone:false,serverStopped,checks,errors,failed,sockets,socketAttempts,httpErrors,consoleErrors,offlineResponses:responses,...extra});
 await fs.mkdir(output,{recursive:true});
 try{
  context=await chromium.launchPersistentContext(profile,options);await observe();
  await page.goto(url,{waitUntil:'domcontentloaded'});await ready(page);
  await page.locator('#offline-panel summary').click();await page.locator('#offline-download').click();await saved(page);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const cacheState=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller.scriptURL,caches:await caches.keys(),attempts:window.__socketAttempts}));
  assert.deepEqual(cacheState.attempts,[],'solo menu must not try to connect to a room');
  await page.screenshot({path:path.join(output,'offline-ready.png')});
  log('fresh profile saved all current offline resources',{cacheState});
  await page.evaluate(()=>localStorage.setItem('reborn-offline-qa','preserved'));
  await context.close();context=null;await server.close();serverStopped=true;offline=true;
  // Restart removes HTTP memory cache; the server is already stopped and network
  // is disabled before navigating. A different query also exercises SW URL handling.
  context=await chromium.launchPersistentContext(profile,{...options,offline:true});await observe();
  await page.goto(url+'?v=offline-qa-'+manifest.build,{waitUntil:'domcontentloaded'});await ready(page);await saved(page);
  assert.equal(await page.evaluate(()=>navigator.onLine),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('reborn-offline-qa')),'preserved');
  await page.reload({waitUntil:'domcontentloaded'});await ready(page);await saved(page);
  log('server stopped, browser cold-start and actual page reload work offline');
  await page.locator('[data-hero="scout"]').click();await ready(page);
  await page.locator('#start').click();await page.waitForFunction(()=>game3d.state==='playing'&&game3d.time>.1);
  await page.evaluate(()=>{game3d.setView('third');game3d.player.inv=999;});
  const before=await page.evaluate(()=>({x:game3d.player.x,z:game3d.player.z,shot:game3d.hero.userData.shotSerial||0}));
  await page.keyboard.down('w');await page.waitForTimeout(800);await page.keyboard.up('w');
  const after=await page.evaluate(()=>({x:game3d.player.x,z:game3d.player.z}));
  assert(Math.hypot(after.x-before.x,after.z-before.z)>.1,'actual keyboard input must move the solo player');
  await page.mouse.move(viewport.width*.55,viewport.height*.60);await page.mouse.down();
  await page.waitForFunction(n=>(game3d.hero.userData.shotSerial||0)>n,before.shot);await page.mouse.up();
  assert.equal(await page.evaluate(()=>!!game3d.roomSession),false);
  await page.screenshot({path:path.join(output,'offline-forest-third.png')});
  log('real solo forest start, keyboard movement and held mouse attack',{before,after});
  await page.locator('#pause').click();await page.waitForFunction(()=>game3d.state==='paused');
  const pausedAt=await page.evaluate(()=>game3d.time);await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>game3d.time),pausedAt);
  await page.getByRole('button',{name:'继续远征',exact:true}).click();await page.waitForFunction(t=>game3d.time>t,pausedAt);
  log('offline pause/resume UI preserves and resumes simulation clock');
  await page.evaluate(()=>game3d.setView('first'));await page.waitForTimeout(200);
  await page.screenshot({path:path.join(output,'offline-forest-first.png')});
  // First-person hides pointer interactions until Escape, matching actual play.
  await page.keyboard.press('Escape');await page.waitForFunction(()=>game3d.state==='paused');
  await page.getByRole('button',{name:'结束本局',exact:true}).click();await page.getByRole('button',{name:'确认结束',exact:true}).click();
  log('offline run exit confirmed through normal UI');
  await page.waitForFunction(()=>game3d.state==='menu');await ready(page);await page.locator('#start').click();await page.waitForFunction(()=>game3d.state==='playing');
  assert.equal(await page.evaluate(()=>game3d.player.level),1);assert.equal(await page.evaluate(()=>!!game3d.roomSession),false);
  log('UI pause freezes time, resumes, exits and starts a fresh offline run');
  // Hooks are used only for the compatibility matrix, after real UI/input checks.
  // They exercise actual build/start/attack/dodge code, not a parallel simulation.
  const cases=await page.evaluate(async version=>{const {HERO_LOADOUTS,MAPS}=await import('./rules.js?v='+version);return [...Object.keys(HERO_LOADOUTS).map(hero=>[hero,'forest']),...Object.keys(MAPS).filter(map=>!['forest','confluence'].includes(map)).map(map=>['scout',map]),['minstrel','bellvale',0],['minstrel','crystalcave',1]];},manifest.version);
  const compatibility=[];
  for(const [hero,map,weaponIndex=0]of cases){ console.log('CASE',hero,map,weaponIndex);
   // Finish the previous song before this deliberately rapid compatibility
   // switch. A normal map reset aborts stale audio by design; that would test
   // cancellation rather than whether the cached bytes can load offline.
   await page.evaluate(async()=>{await game3d.audio.recorded?.loading?.promise;});
   const result=await page.evaluate(([hero,map,weaponIndex])=>{const g=game3d;g.select(hero,map,weaponIndex);g.start(true);g.player.inv=999;g.setView('third');Object.assign(g.controls,{held:true,hasAim:true,angle:g.player.angle});for(let i=0;i<60;i++)g.step(1/60);g.controls.held=false;const shot=g.hero.userData.shotSerial||0;g.dash();for(let i=0;i<6;i++)g.step(1/60);g.pause();const pausedAt=g.time;g.step(1);const frozen=g.time===pausedAt;g.resume();return{hero,map,weapon:g.player.weaponId,state:g.state,shot,frozen,x:g.player.x,z:g.player.z,hasModel:!!g.hero.children.length,room:!!g.roomSession};},[hero,map,weaponIndex]);
   assert.equal(result.state,'playing');assert(result.hasModel);assert(result.frozen);assert(Number.isFinite(result.x)&&Number.isFinite(result.z));assert.equal(result.room,false);assert(result.shot>0,'native attack must execute for '+hero);
   await page.waitForTimeout(160);
   const audio=await page.evaluate(async()=>{const recorded=game3d.audio.recorded;await recorded?.loading?.promise;return{failed:[...(recorded?.failed||[])],lastError:recorded?.lastError??null};});
   assert.deepEqual(audio.failed,[],'offline music must load and decode for '+map);assert.equal(audio.lastError,null,'offline music reported an error for '+map);
   compatibility.push({...result,audio});
  }
  log('native game compatibility matrix, all current heroes and independent maps, plus both minstrel weapons',{compatibility});
  assert.deepEqual(await page.evaluate(()=>window.__socketAttempts),[],'solo must make no WebSocket attempts');assert.deepEqual(sockets,[]);assert.deepEqual(socketAttempts,[]);
  assert.deepEqual(errors,[],'no uncaught runtime errors');
  assert.deepEqual(failed.filter(r=>r.offline),[],'no failed runtime fetches while offline');
  assert(responses.length>80,'offline restart must really load the game resource graph');
  assert(responses.every(r=>r.sw),'every recorded same-origin offline resource must come from the service worker');
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(root,'main.js'))).digest('hex'),mainHash,'main.js changed during this QA run');
  log('offline resources served by SW and no room socket created',{resources:responses.length});
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report({ok:true}),null,2));
 }catch(error){
  const diagnostics=await page?.evaluate(()=>({state:window.game3d?.state,time:window.game3d?.time,offlineStatus:document.querySelector('#offline-status')?.textContent,dialog:document.querySelector('#dialog')?.textContent,attempts:window.__socketAttempts})).catch(()=>null);
  await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report({ok:false,error:error.message,diagnostics}),null,2));throw error;
 }finally{
  await context?.close();await server.close();
  const target=path.resolve(profile),base=path.resolve(os.tmpdir())+path.sep;
  if(target.startsWith(base)&&path.basename(target).startsWith('reborn-offline-solo-'))await fs.rm(target,{recursive:true,force:true,maxRetries:3});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
