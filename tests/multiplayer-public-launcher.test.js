import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import{EventEmitter}from'node:events';
import{spawn}from'node:child_process';
import{copyFile,mkdtemp,writeFile,rm,stat,chmod}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join,resolve,dirname,isAbsolute}from'node:path';
import{quickTunnelUrlReader,verifyPublicSocket,waitForPublicGame,startPublicRoom}from'../packaging/rooms/start-public-room.mjs';

// The full suite runs many CPU-heavy Three.js workers; executable startup is not
// the behavior under test. Keep the production 90s deadline untouched.
const fixtureStartupMs=30000;
let directory,binary,script;
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'reborn public cli '));binary=join(directory,process.platform==='win32'?'fake cloudflared.exe':'fake cloudflared');script=join(directory,'fake cloudflared.cjs');
 await copyFile(process.execPath,binary);if(process.platform!=='win32')await chmod(binary,0o755);
 await writeFile(script,`const fs=require('fs');const args=process.argv.slice(2);if(args[0]!=='tunnel'||fs.readFileSync(args[args.indexOf('--config')+1],'utf8').trim()!=='{}')process.exit(9);if(process.env.FAKE_MODE==='exit'){process.stderr.write('ERR fake tunnel unavailable\\n');process.exit(7);}setInterval(()=>{},1000);if(process.env.FAKE_MODE!=='quiet'){process.stderr.write('https://api.trycloudflare.com \\nhttps://test-');setTimeout(()=>process.stderr.write('four-friends.trycloudflare.com \\n'),20);}if(process.env.FAKE_MODE==='late-exit')process.on('message',message=>{if(message==='exit-now')process.exit(6);});`);
});
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));await rm(target,{recursive:true,force:true});});

function fixture(mode='ready'){
 const events=[],logs=[];let child,config,closed=0,origin;
 const service={url:'http://127.0.0.1:8898',token:'test-invitation-token',setPublicOrigin(value){events.push('origin');origin=value;},get inviteUrl(){return`${origin}/play.html#roomToken=${this.token}`;},async close(){closed++;events.push('close');}};
 return{events,logs,service,get child(){return child;},get config(){return config;},get closed(){return closed;},options:{cloudflaredPath:binary,timeoutMs:fixtureStartupMs,log:value=>logs.push(value),
  createServer:async options=>{assert.deepEqual(options,{host:'127.0.0.1',port:8898});events.push('server');return service;},
  spawnProcess:(file,args,options)=>{assert.equal(isAbsolute(file),true);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.env.TUNNEL_TOKEN,undefined);assert.equal(args[args.indexOf('--protocol')+1],'http2');events.push('spawn');config=args[args.indexOf('--config')+1];child=spawn(file,[script,...args],{...options,stdio:[...options.stdio,'ipc'],env:{...options.env,FAKE_MODE:mode}});return child;},
  checkReady:async(url,{token})=>{assert.equal(url,'https://test-four-friends.trycloudflare.com');assert.equal(token,service.token);assert.ok(!logs.join('').includes(url));events.push('ready');}
 }};
}

test('quick tunnel URL reader handles split logs, skips API links, and rejects lookalike hosts',()=>{
 const read=quickTunnelUrlReader();assert.equal(read('https://api.trycloudflare.com \nhttps://nice-'),null);
 assert.equal(read('forest.trycloudflare.co'),null);assert.equal(read('m'),null);
 assert.equal(read(' |\n'),'https://nice-forest.trycloudflare.com');
 for(const invalid of['http://forest.trycloudflare.com \n','https://forest.trycloudflare.com.evil.test \n','https://forest.trycloudflare.com/path \n','https://example.com \n'])assert.equal(quickTunnelUrlReader()(invalid),null);
});

test('fake tunnel uses a spaced executable, binds first, verifies before announcing and cleans only its child',async()=>{
 const f=fixture();const app=await startPublicRoom(f.options);
 try{assert.deepEqual(f.events,['server','spawn','origin','ready']);
  assert.equal(app.hostUrl,`${f.service.url}/play.html#roomToken=${f.service.token}`);
  assert.equal(app.inviteUrl,`https://test-four-friends.trycloudflare.com/play.html#roomToken=${f.service.token}`);
  assert.ok(f.logs.join('').includes(app.hostUrl));assert.ok(!f.logs.join('').includes(app.inviteUrl));
  await app.close();await app.close();await app.closed;
 }finally{await app.close();}
 assert.equal(f.closed,1);assert.ok(f.child.exitCode!==null||f.child.signalCode!==null);await assert.rejects(stat(f.config),/ENOENT/);
});

test('port failure never starts a public tunnel and spawn failure closes the game service',async()=>{
 const f=fixture();await assert.rejects(startPublicRoom({...f.options,createServer:async()=>{throw Error('EADDRINUSE');}}),/EADDRINUSE/);
 assert.equal(f.child,undefined);
 const g=fixture();await assert.rejects(startPublicRoom({...g.options,spawnProcess:()=>{throw Error('spawn failure');}}),/spawn failure/);assert.equal(g.closed,1);
});

test('tunnel creation timeout and immediate exit close the service without announcing an invitation',async()=>{
 for(const[mode,timeoutMs,pattern]of[['quiet',350,/超时/],['exit',fixtureStartupMs,/隧道已退出/]]){
  const f=fixture(mode);await assert.rejects(startPublicRoom({...f.options,timeoutMs}),pattern);
  assert.equal(f.closed,1);assert.ok(!f.logs.join('').includes('#roomToken='));assert.ok(f.child.exitCode!==null||f.child.signalCode!==null);await assert.rejects(stat(f.config),/ENOENT/);
 }
});

test('readiness failure and late tunnel exit clean both resources',async()=>{
 const f=fixture();await assert.rejects(startPublicRoom({...f.options,checkReady:async()=>{throw Error('WSS failed');}}),/WSS failed/);assert.equal(f.closed,1);assert.ok(!f.logs.join('').includes('#roomToken='));
 const g=fixture('late-exit');const app=await startPublicRoom(g.options);
 try{
  g.child.send('exit-now');const reason=await app.closed;
  assert.match(reason.message,/隧道已退出/);assert.equal(g.closed,1);await assert.rejects(stat(g.config),/ENOENT/);
 }finally{await app.close();}
});

test('cancel during readiness closes tunnel and server before the public URL is shown',async()=>{
 const f=fixture();const controller=new AbortController();
 const task=startPublicRoom({...f.options,signal:controller.signal,checkReady:async(_url,{signal})=>{controller.abort(Error('cancelled'));signal.throwIfAborted();}});
 await assert.rejects(task,/cancelled/);assert.equal(f.closed,1);assert.ok(!f.logs.join('').includes('#roomToken='));
});

class FakeSocket extends EventEmitter{
 static last;constructor(url,options){super();FakeSocket.last=this;this.url=url;this.options=options;queueMicrotask(()=>this.emit('open'));}
 send(raw){this.hello=JSON.parse(raw);queueMicrotask(()=>this.emit('message',JSON.stringify({type:'welcome',protocol:1,playerId:'probe'})));}
 terminate(){this.terminated=true;}
}
test('readiness verifies HTTPS game HTML and authenticated WSS hello, then closes the probe',async()=>{
 let fetches=0;const controller=new AbortController();
 await waitForPublicGame('https://test.trycloudflare.com',{token:'sample-token',signal:controller.signal,retryMs:1,WebSocketImpl:FakeSocket,fetchImpl:async()=>{fetches++;return fetches===1?{status:503,body:{cancel:async()=>{}}}:{status:200,text:async()=>'<div id="asset-loading"></div><script src="main.js"></script>'};}});
 assert.equal(fetches,2);assert.equal(FakeSocket.last.url,'wss://test.trycloudflare.com/room-socket');assert.equal(FakeSocket.last.options.headers.Origin,'https://test.trycloudflare.com');assert.equal(FakeSocket.last.hello.token,'sample-token');assert.equal(FakeSocket.last.terminated,true);
 class BadSocket extends FakeSocket{send(){queueMicrotask(()=>this.emit('close'));}}
 await assert.rejects(verifyPublicSocket('https://test.trycloudflare.com',{token:'sample',WebSocketImpl:BadSocket}),/验证前关闭/);
});
