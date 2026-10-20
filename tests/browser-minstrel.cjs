// Actual game/browser checks. Touch viewport emulation is not physical phone QA.
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.env.OUTPUT_DIR||path.resolve(__dirname,'../../../outputs/minstrel-v228-qa'),checks=[],errors=[];
(async()=>{
 // A development server includes new source modules before offline:build;
 // the separate room/offline regression uses the shipping manifest whitelist.
 const root=path.resolve(__dirname,'..'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.webmanifest':'application/manifest+json'};
 const server=require('node:http').createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 await fs.mkdir(output,{recursive:true});
 try{
  for(const [label,viewport,touch]of[['desktop',{width:1280,height:720},false],['mobile-size',{width:844,height:390},true]]){
   const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,deviceScaleFactor:1}),page=await context.newPage();
   page.setDefaultTimeout(240000);page.on('pageerror',e=>{errors.push({label,message:e.message});console.error('PAGE_ERROR '+label+' '+e.message);});
   page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE '+label+' '+m.text());});
   await page.addInitScript(()=>{const native=requestAnimationFrame;window.requestAnimationFrame=cb=>native(t=>{if(window.__qaFreeze){window.__qaFrozen=cb;return;}cb(t);});});
   await page.goto(url+'/index.html',{waitUntil:'domcontentloaded'});console.log('LOAD '+label);
   await page.waitForFunction(()=>window.game3d&&!document.querySelector('#start').disabled);
   console.log('READY '+label);
   await page.locator('[data-hero=minstrel]').click();
   await page.waitForFunction(()=>!document.querySelector('#start').disabled&&document.querySelector('[data-hero=minstrel]').classList.contains('selected'));
   await page.screenshot({path:path.join(output,label+'-menu.png')});
   await page.locator('#start').click();await page.waitForFunction(()=>game3d.state==='playing');
   await page.evaluate(()=>game3d.setView('third'));await page.waitForTimeout(350);
   await page.screenshot({path:path.join(output,label+'-third.png')});
   await page.evaluate(()=>game3d.setView('first'));await page.waitForTimeout(350);
   await page.screenshot({path:path.join(output,label+'-first.png')});
   await page.evaluate(()=>window.__qaFreeze=true);await page.waitForTimeout(100);
   const result=await page.evaluate(async()=>{
    const g=game3d,T=await import('./vendor/three.module.js'),check=(ok,text)=>{if(!ok)throw Error(text);};
    const advance=seconds=>{let left=seconds;while(left>1e-9){const dt=Math.min(left,1/60);g.step(dt);left-=dt;}};
    const clear=()=>{for(const e of g.enemies)e.mesh.removeFromParent();g.enemies.length=0;for(const b of g.bullets)b.mesh.removeFromParent();g.bullets.length=0;g.resonanceWaves.clear();g.player.melee=null;g.player.attack=0;g.controls.held=false;g.world.obstacles=[];g.vfx.clear();};
    const setup=index=>{
     g.select('minstrel','forest',index);g.start();g.setView('third');
     document.querySelector('[data-attack-mode=manual]').click();
     g.world.groundHeightAt=()=>0;g.world.obstacles=[];g.world.patches=[];g.world.ponds=[];g.world.sites=[];
     g.world.overhead.firstHit=()=>null;g.player.inv=999;g.player.x=g.player.z=g.player.y=0;g.hero.position.set(0,0,0);g.hero.rotation.y=0;
     g.adventureCamera.yaw=0;g.adventureCamera.pitch=0;
     g.adventureCamera.getRay=()=>new T.Ray(new T.Vector3(g.player.x,1.2,g.player.z),new T.Vector3(0,0,1));
     g.controls.hasAim=true;g.controls.angle=0;g.controls.held=false;g.player.attack=0;
    };
    const target=(x=0,z=4)=>{const e=g.spawn('golem',x,z);Object.assign(e,{hp:1000,maxHp:1000,xp:0,cool:999,speed:0,height:3.5,y:0});return e;};
    const shoot=()=>{g.player.attack=0;g.controls.angle=0;g.controls.hasAim=true;g.controls.held=true;advance(1/60);g.controls.held=false;};
    setup(0);let e=target();shoot();check(g.bullets.length===1&&!g.bullets[0].mesh.visible,'bow must wait in a real draw state');
    advance(.25);check(e.hp===1000&&!g.bullets[0].mesh.visible,'bow damaged before release');
    const beforeTime=g.time,delay=g.bullets[0].releaseDelay;g.pause();advance(2);check(g.time===beforeTime&&g.bullets[0].releaseDelay===delay,'pause advanced draw');g.resume();
    advance(.7);check(e.hp<1000,'drawn arrow did not hit native enemy');const bowDamage=1000-e.hp;
    clear();e=target();shoot();advance(.1);g.dash();advance(.7);check(e.hp===1000&&g.bullets.length===0,'dash did not cancel held arrow');
    advance(.1);g.player.dash=0;g.player.dashTime=0;clear();g.player.x=g.player.z=0;g.hero.position.set(0,0,0);g.player.weaponPath={id:'windbow_fan',rank:3};shoot();check(g.bullets.length===3,'fan route did not create 3 arrows');advance(.56);
    const shots=g.bullets.filter(b=>b.mesh.visible);check(shots.length===3,'fan arrows missing at release: '+JSON.stringify(g.bullets.map(b=>({delay:b.releaseDelay,at:b.releaseAt,time:g.time,visible:b.mesh.visible,life:b.life}))));
    const dirs=shots.map(b=>Math.atan2(b.vx,b.vz));check(Math.max(...dirs)-Math.min(...dirs)>.4,'release collapsed spread to one line');
    setup(1);e=target(0,3.4);shoot();check(g.player.melee?.resonator,'bell has no actual preparation');advance(.50);
    check(e.hp<1000&&g.resonanceWaves.waves.length===1,'bell primary did not reach target');const primary=1000-e.hp;
    const wave=g.resonanceWaves.waves[0],distance=wave.distance,now=g.time;g.pause();advance(3);check(g.time===now&&wave.distance===distance,'pause advanced bell');g.resume();advance(1.2);
    const total=1000-e.hp;check(Math.abs(primary-24)<.001&&Math.abs(total-34.08)<.001,'bell direct/echo damage differs: '+primary+'/'+total);
    check(g.resonanceWaves.waves.length===0,'bell persisted after finite echo');
    clear();e=target(0,4);g.world.obstacles=[{x:0,y:0,z:2,r:1.2,height:4}];shoot();advance(2);check(e.hp===1000,'bell passed through a solid tree');
    clear();shoot();advance(.3);check(g.resonanceWaves.waves.length===1,'no wave for death cleanup fixture');
    g.player.upgrades.quietguard=3;g.heroSkills.minstrelShield={amount:16,until:g.heroSkills.now+2};g.player.minstrelGuard=16;g.player.inv=0;g.damage(100000);check(g.state==='lost','damage fixture failed to end battle');check(g.resonanceWaves.waves.length===0&&g.heroSkills.minstrelShield.amount===0&&g.player.minstrelGuard===0,'death retained bell/shield');
    g.start();check(g.state==='playing'&&g.resonanceWaves.waves.length===0&&g.heroSkills.minstrelShield.amount===0,'restart retained state');
    return{bowDamage,bellPrimary:primary,bellTotal:total,drawPause:true,drawDodgeCancel:true,spreadRadians:Math.max(...dirs)-Math.min(...dirs),bellPause:true,bellCover:true,deathCleanup:true,restart:true};
   });
   checks.push({label,viewport,touchEmulation:touch,...result});console.log('PASS '+label,JSON.stringify(result));await context.close();
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));
 }catch(error){await fs.writeFile(path.join(output,'result.json'),JSON.stringify({ok:false,checks,errors,error:error.stack},null,2));throw error;}
 finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
