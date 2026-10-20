// Real game pages against an isolated local room host. No game logic is
// reimplemented here. Device-size emulation is not a physical-phone test.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=process.env.OUTPUT_DIR||path.resolve(__dirname,'../../../outputs/private-rooms-qa');
const count=Math.max(2,Math.min(4,Number(process.env.ROOM_QA_PLAYERS)||4));
const growthOnly=process.env.ROOM_QA_FOCUS==='growth';
const results=[],errors=[],pages=[],contexts=[];
const log=(name,data={})=>{results.push({name,...data});console.log('PASS '+name);};
(async()=>{
 const {createRoomServer}=await import('../scripts/room-server.mjs');
 const server=await createRoomServer({port:0,loadTimeoutMs:300000,hostSnapshotTimeoutMs:20000});
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 fs.mkdirSync(output,{recursive:true});
 try{
  let invitation=server.inviteUrl;
  const heroes=['scout','silver','tide','lingya'];
  for(let i=0;i<count;i++){
   const mobile=i===count-1,context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:960,height:540},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});contexts.push(context);
   const page=await context.newPage();pages.push(page);page.setDefaultTimeout(180000);
   page.on('pageerror',e=>{errors.push({page:i,message:e.message});console.error('PAGE_ERROR '+i+': '+e.message);});
   await page.goto(invitation,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.game3d?.roomLobby);
   await page.locator('#room-open').click();await page.getByLabel('你的名字',{exact:true}).fill('QA '+(i+1));
   await page.getByLabel('冒险者',{exact:true}).selectOption(heroes[i]);
   await page.getByRole('button',{name:i?'加入房间':'创建私人房间',exact:true}).click();
   await page.waitForFunction(()=>window.game3d.roomClient.room?.players.length>0);
   if(i===0)invitation=await page.getByLabel('完整房间邀请链接',{exact:true}).inputValue();
  }
  const host=pages[0];await host.waitForFunction(n=>game3d.roomClient.room.players.length===n,count);
  for(const page of pages)await page.getByRole('button',{name:'准备',exact:true}).click();
  await host.getByRole('button',{name:'开始对战',exact:true}).click();
  await Promise.all(pages.map(page=>page.waitForFunction(()=>window.game3d.state==='playing'&&game3d.roomSession?.ready,{},{timeout:300000})));
  await host.waitForFunction(()=>game3d.time>3,{},{timeout:60000});
  log('multi-page UI create/join/ready/load',{players:count,screenSizes:pages.map((_,i)=>i===count-1?'844x390 touch emulation':'960x540 desktop')});
  const ids=await Promise.all(pages.map(page=>page.evaluate(()=>game3d.roomClient.playerId)));
  assert.equal(new Set(ids).size,count);
  for(let i=0;i<count;i++)assert.equal(await pages[i].evaluate(()=>game3d.roomSession.owners.size),count);
  // Clear nearby creatures only in this QA fixture so PvP/XP assertions cannot
  // be affected by random combat; subsequent tests spawn actual native actors.
  await host.evaluate(()=>{for(const e of game3d.enemies){e.speed=0;e.cool=1000;e.hp=e.maxHp=100000;}});
  if(!growthOnly){
  const before=await pages[1].evaluate(()=>({x:game3d.player.x,z:game3d.player.z}));
  await pages[1].keyboard.down('w');await pages[1].waitForTimeout(900);await pages[1].keyboard.up('w');await host.waitForTimeout(300);
  const hostPosition=await host.evaluate(id=>{const p=game3d.roomSession.owners.get(id).player;return{x:p.x,z:p.z};},ids[1]);
  const guestPosition=await pages[1].evaluate(()=>({x:game3d.player.x,z:game3d.player.z}));
  assert(Math.hypot(hostPosition.x-before.x,hostPosition.z-before.z)>.1,'remote key input must move the authoritative owner');
  assert(Math.hypot(hostPosition.x-guestPosition.x,hostPosition.z-guestPosition.z)<1,'guest position must converge to host');
  log('guest movement reaches host and replica',{hostPosition,guestPosition});
  const damage=await host.evaluate(id=>{const g=game3d,o=g.roomSession.owners.get(id);o.player.networkProtectedUntil=0;o.player.networkDodgeUntil=0;o.player.hp=o.player.maxHp;const before=o.player.hp;g.hurtEnemy(o.target,17,false,{kind:'rifle'});return{before,after:o.player.hp};},ids[1]);
  assert(damage.after<damage.before,'native hurtEnemy must damage the other player through the room target');
  await pages[1].waitForFunction(hp=>Math.abs(game3d.player.hp-hp)<.001,damage.after);
  log('authoritative PvP damage and guest health',{damage});
  }
  const waitingChoice=async page=>{
   await page.waitForFunction(()=>document.querySelector('#dialog[open] .cards button'));
   const button=page.locator('#dialog .cards button:enabled').first();assert(await button.count());await button.click();
   await page.waitForFunction(()=>!document.querySelector('#dialog[open]'));
  };
  // Use the real XP rule, then the normal UI action (the legacy debug grant
  // helper directly invokes the single-player upgrade path outside a scope).
  await host.evaluate(async()=>{const {grantExperience}=await import('./rules.js?v=227');grantExperience(game3d.player,48);});
  await host.waitForFunction(()=>document.querySelector('#dialog[open] .cards button')||!document.querySelector('#upgrade-ready').hidden);
  if(!await host.locator('#dialog[open] .cards button').count())await host.locator('#upgrade-ready').click({force:true});
  await waitingChoice(host);
  await host.waitForFunction(()=>!game3d.roomSession.room.paused);log('host growth card uses original callback');
  // Put one owned XP orb on the remote player to exercise shared pickup routing.
  await host.evaluate(id=>{
   const g=game3d,o=g.roomSession.owners.get(id);const e=g.spawn('golem',o.player.x,o.player.z);e.xp=80;e.hp=1;g.hurtEnemy(e,999999,false,{kind:'rifle'});
   const orb=g.orbs.at(-1);Object.assign(orb,{x:o.player.x,z:o.player.z,recipientId:id,attract:true});
  },ids[1]);
  await pages[1].waitForFunction(()=>document.querySelector('#dialog[open] .cards button')||!document.querySelector('#upgrade-ready').hidden);
  if(!await pages[1].locator('#dialog[open] .cards button').count())await pages[1].locator('#upgrade-ready').click({force:true});
  await waitingChoice(pages[1]);await host.waitForFunction(()=>!game3d.roomSession.room.paused);log('remote pickup and growth card resolved by host');
  await host.evaluate(()=>game3d.roomClient.suspend(true,'host-away'));
  await Promise.all(pages.map(page=>page.waitForFunction(()=>game3d.roomSession.room.paused)));
  await host.waitForTimeout(150);const pausedAt=await host.evaluate(()=>game3d.time);
  await host.waitForTimeout(500);assert.equal(await host.evaluate(()=>game3d.time),pausedAt);
  await host.evaluate(()=>game3d.roomClient.suspend(false,'host-away'));
  await host.waitForFunction(t=>game3d.time>t,pausedAt);log('shared pause freezes simulation then resumes');
  if(!growthOnly){
  await host.evaluate(id=>{const g=game3d,o=g.roomSession.owners.get(id);o.player.networkProtectedUntil=0;o.player.networkDodgeUntil=0;g.hurtEnemy(o.target,999999,false,{kind:'rifle'});},ids[1]);
  await pages[1].waitForFunction(()=>game3d.player.networkDead&&game3d.player.hp===0);
  await host.waitForFunction(id=>game3d.roomSession.owners.get(id).deaths===1,ids[1]);
  await pages[1].waitForFunction(()=>!game3d.player.networkDead&&game3d.player.hp>0,{},{timeout:60000});log('PvP death/score/respawn retains session');
  await host.evaluate(()=>game3d.spawnBoss());
  const boss=await host.evaluate(()=>({id:game3d.boss.id,kind:game3d.boss.kind,hp:game3d.boss.hp}));
  await pages[1].waitForFunction(expected=>game3d.boss?.id===expected.id&&game3d.boss.kind===expected.kind,boss);
  log('shared native boss identity and state',{boss});
  }
  for(let i=0;i<count;i++)await pages[i].screenshot({path:path.join(output,'player-'+(i+1)+'.png')});
  await host.evaluate(()=>game3d.roomClient.leave());
  for(const page of pages.slice(1))await page.waitForFunction(()=>!game3d.roomSession);
  log('host leave ends every guest room');
  assert.deepEqual(errors,[],'no uncaught browser errors');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,results,errors},null,2));
 }catch(error){
  const diagnostics=await Promise.all(pages.map(async(page,i)=>{try{return{page:i,...await page.evaluate(()=>({state:window.game3d?.state,time:window.game3d?.time,roomPhase:window.game3d?.roomSession?.room.phase,ready:window.game3d?.roomSession?.ready,paused:window.game3d?.roomSession?.room.paused,reason:window.game3d?.roomSession?.room.pauseReason,dialog:document.querySelector('#dialog')?.textContent,status:document.querySelector('.room-status')?.textContent}))};}catch{return{page:i,closed:true};}}));
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:false,error:error.message,results,errors,diagnostics},null,2));throw error;
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
