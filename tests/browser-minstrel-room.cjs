// Local two-browser regression; not a public-network or physical-phone test.
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const output=process.env.OUTPUT_DIR||path.resolve(__dirname,'../../../outputs/minstrel-v228-room'),checks=[],errors=[];
(async()=>{
 const{createRoomServer}=await import('../scripts/room-server.mjs');
 const server=await createRoomServer({port:0,loadTimeoutMs:300000,hostSnapshotTimeoutMs:20000});
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 await fs.mkdir(output,{recursive:true});
 const pages=[];
 try{
  for(let i=0;i<2;i++){
   const context=await browser.newContext({viewport:i?{width:844,height:390}:{width:960,height:540},hasTouch:!!i,isMobile:!!i,deviceScaleFactor:1}),page=await context.newPage();pages.push(page);page.setDefaultTimeout(240000);
   page.on('pageerror',e=>{errors.push({page:i,message:e.message});console.error(e.message);});
  }
  for(const map of(process.env.ROOM_QA_MAPS||'bellvale,crystalcave').split(',')){
   console.log('LOAD ROOM '+map);
   let invitation=server.inviteUrl;
   for(let i=0;i<2;i++){
    const page=pages[i];await page.goto('about:blank');await page.goto(invitation,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.game3d?.roomLobby);console.log('READY PAGE '+map+' '+i);
    await page.locator('#room-open').click();await page.getByLabel('你的名字',{exact:true}).fill(i?'回声客':'风弦主');
    await page.getByLabel('冒险者',{exact:true}).selectOption('minstrel');await page.locator('select[aria-label="随行武器"]').selectOption(String(i));
    if(!i)await page.getByLabel('房主选择地图',{exact:true}).selectOption(map);
    await page.getByRole('button',{name:i?'加入房间':'创建私人房间',exact:true}).click();await page.waitForFunction(()=>game3d.roomClient.room?.players.length>0);
    if(!i)invitation=await page.getByLabel('完整房间邀请链接',{exact:true}).inputValue();
   }
   const[host,guest]=pages;
   await host.waitForFunction(()=>game3d.roomClient.room.players.length===2);
   for(const page of pages)await page.getByRole('button',{name:'准备',exact:true}).click();
   await host.getByRole('button',{name:'开始对战',exact:true}).click();
   console.log('START ROOM '+map);
   await Promise.all(pages.map(p=>p.waitForFunction(()=>game3d.state==='playing'&&game3d.roomSession?.ready,{},{timeout:300000})));
   console.log('PLAYING ROOM '+map);
   const ids=await Promise.all(pages.map(p=>p.evaluate(()=>game3d.roomClient.playerId)));
   for(let i=0;i<2;i++){
    const state=await pages[i].evaluate(()=>({map:game3d.roomClient.room.mapId,hero:game3d.player.heroId,weapon:game3d.player.weaponId,owners:game3d.roomSession.owners.size}));
    assert.equal(state.map,map);assert.equal(state.hero,'minstrel');assert.equal(state.weapon,i?'resonator':'windbow');assert.equal(state.owners,2);
    await pages[i].evaluate(()=>{document.querySelector('[data-attack-mode=manual]').click();game3d.controls.held=false;});
   }
   // Joining changes spawn positions after scene preparation. Let the actual
   // orbit/replica interpolation settle before judging the third-person framing.
   await host.waitForTimeout(1200);
   const cameraBefore=await Promise.all(pages.map(p=>p.evaluate(()=>({boom:game3d.adventureCamera._boom,position:game3d.camera.position.toArray(),player:[game3d.player.x,game3d.player.y,game3d.player.z]}))));
   const spawnCameraClearance=cameraBefore.map((view,index)=>{
    const other=cameraBefore[1-index].player,dx=view.position[0]-view.player[0],dz=view.position[2]-view.player[2],t=Math.max(0,Math.min(1,((other[0]-view.player[0])*dx+(other[2]-view.player[2])*dz)/(dx*dx+dz*dz)));
    const clearance=Math.hypot(other[0]-view.player[0]-dx*t,other[2]-view.player[2]-dz*t);
    assert(clearance>1.5,map+' initial player blocks '+(index?'guest':'host')+' camera: '+clearance);return clearance;
   });
   await guest.screenshot({path:path.join(output,map+'-guest-settled.png')});
   await guest.keyboard.down('w');await guest.waitForTimeout(650);await guest.keyboard.up('w');await guest.waitForTimeout(1200);
   const cameraAfter=await Promise.all(pages.map(p=>p.evaluate(()=>({boom:game3d.adventureCamera._boom,position:game3d.camera.position.toArray(),player:[game3d.player.x,game3d.player.y,game3d.player.z]}))));
   // Capture the unmodified, real map before the isolated combat fixture.
   for(let i=0;i<2;i++)await pages[i].screenshot({path:path.join(output,map+'-'+i+'.png')});
   // Native host-owned wave in a controlled clear lane. This exercises owner
   // scope, PvP hurt/shield, packet visual dispatch and guest health replication.
   await guest.evaluate(()=>{const g=game3d,old=g.vfx.minstrelWave;window.__wavePackets=0;g.vfx.minstrelWave=function(...args){window.__wavePackets++;return old.apply(this,args);};});
   await host.evaluate(ids=>{
    const g=game3d;g.world.obstacles=[];g.world.groundHeightAt=()=>0;g.world.overhead.firstHit=()=>null;g.world.patches=[];g.world.ponds=[];
    for(const e of g.enemies){e.mesh.removeFromParent();}g.enemies.length=0;
    for(const[id,index]of ids.map((id,index)=>[id,index])){const o=g.roomSession.owners.get(id);Object.assign(o.player,{x:0,y:0,z:index?0:3.4,hp:120,maxHp:120,inv:0,networkProtectedUntil:0,networkDodgeUntil:0});o.hero.position.set(0,0,o.player.z);o.aimInput.held=false;}
   },ids);
   const before=await host.evaluate(()=>game3d.player.hp);
   await host.evaluate(async id=>{const g=game3d,o=g.roomSession.owners.get(id),{weaponStats}=await import('./rules.js');o.resonanceWaves.cast({x:0,y:1.2,z:0},{w:weaponStats(o.player),angle:0,pitch:0});},ids[1]);
   await host.waitForFunction(hp=>game3d.player.hp<hp,before,{timeout:30000});
   await host.waitForFunction(id=>game3d.roomSession.owners.get(id).resonanceWaves.waves.length===0,ids[1],{timeout:30000});
   const after=await host.evaluate(()=>game3d.player.hp);assert(Math.abs(before-after-34.08)<.01,'one primary + one echo through native PvP path');
   await guest.waitForFunction(expected=>Math.abs(game3d.roomSession.owners.get(expected.id).player.hp-expected.hp)<.01,{id:ids[0],hp:after},{timeout:30000});
   const packets=await guest.evaluate(()=>window.__wavePackets);assert(packets>0,'guest must receive real wave visual events');
   await host.evaluate(()=>{game3d.player.upgrades.quietguard=3;game3d.dash();});
   await host.waitForFunction(()=>game3d.player.dashTime===0&&game3d.player.minstrelGuard===16,{},{timeout:30000});
   await guest.waitForFunction(id=>game3d.roomSession.owners.get(id).player.minstrelGuard===16,ids[0],{timeout:30000});
   const guardedBefore=await host.evaluate(()=>{const g=game3d;g.player.x=0;g.player.z=3.4;g.hero.position.set(0,0,3.4);return g.player.hp;});
   await host.evaluate(async id=>{const g=game3d,o=g.roomSession.owners.get(id),{weaponStats}=await import('./rules.js');o.resonanceWaves.cast({x:0,y:1.2,z:0},{w:weaponStats(o.player),angle:0,pitch:0});},ids[1]);
   await host.waitForFunction(()=>game3d.player.minstrelGuard===0,{},{timeout:30000});
   await host.waitForFunction(id=>game3d.roomSession.owners.get(id).resonanceWaves.waves.length===0,ids[1],{timeout:30000});
   const guardedAfter=await host.evaluate(()=>game3d.player.hp);assert(Math.abs(guardedBefore-guardedAfter-18.08)<.01,'actual dodge shield must absorb 16 PvP damage');
   await guest.waitForFunction(expected=>{const p=game3d.roomSession.owners.get(expected.id).player;return p.minstrelGuard===0&&Math.abs(p.hp-expected.hp)<.01;},{id:ids[0],hp:guardedAfter},{timeout:30000});
   checks.push({map,heroes:['minstrel','minstrel'],weapons:['windbow','resonator'],pvpDamage:before-after,guardedPvpDamage:guardedBefore-guardedAfter,dodgeShield:16,guestShieldSync:true,guestWaveEvents:packets,spawnCameraClearance,cameraBefore,cameraAfter});console.log('PASS',JSON.stringify(checks.at(-1)));
   await host.evaluate(()=>game3d.roomClient.leave());await guest.waitForFunction(()=>!game3d.roomSession);
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));
 }catch(error){
  const diagnostics=await Promise.all(pages.map(async(page,index)=>{try{return{index,...await page.evaluate(()=>({state:window.game3d?.state,time:window.game3d?.time,ready:window.game3d?.roomSession?.ready,phase:window.game3d?.roomClient?.room?.phase,status:document.querySelector('.room-status')?.textContent,paused:window.game3d?.roomClient?.room?.paused}))};}catch{return{index,closed:true};}}));
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:false,checks,errors,diagnostics,error:error.stack},null,2));throw error;
 }
 finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
