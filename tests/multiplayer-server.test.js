import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {WebSocket} from 'ws';
import {createRoomServer,privateBindAddress} from '../scripts/room-server.mjs';
import {normalizeRoomInput,validRoomSelection,ROOM_MAX_MESSAGE_BYTES} from '../multiplayer-protocol.js';

const selection={name:'旅人',heroId:'scout',weaponIndex:0};
const input={moveX:1,moveZ:0,aimYaw:0,aimPitch:0,attack:true,dodge:false,jump:false,crouch:false,autoAim:false,mobile:false,view:'third',aspect:16/9,dodgeSeq:0,jumpSeq:0};
async function client(server,options={}){
  const ws=new WebSocket(server.url.replace(/^http/,'ws')+'/room-socket',{origin:server.url,...options});
  const inbox=[],waiting=[];
  ws.on('message',raw=>{const m=JSON.parse(raw);const i=waiting.findIndex(w=>w.predicate(m));if(i>=0){const [wait]=waiting.splice(i,1);clearTimeout(wait.timer);wait.resolve(m);}else inbox.push(m);});
  await once(ws,'open');
  const api={ws,send:m=>ws.send(JSON.stringify(m)),next(predicate){
    const index=inbox.findIndex(predicate);if(index>=0)return Promise.resolve(inbox.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{const wait={predicate,resolve,timer:setTimeout(()=>{waiting.splice(waiting.indexOf(wait),1);reject(Error('Message timeout; queued: '+JSON.stringify(inbox)));},2500)};waiting.push(wait);});
  }};
  api.send({type:'hello',protocol:1,token:server.token});api.welcome=await api.next(m=>m.type==='welcome');api.id=api.welcome.playerId;
  return api;
}
async function room(server,count=2){
  const players=[];for(let i=0;i<count;i++)players.push(await client(server));
  players[0].send({type:'create',...selection,mapId:'forest'});
  let current=(await players[0].next(m=>m.type==='room')).room;
  for(const peer of players.slice(1)){peer.send({type:'join',...selection,code:current.code});current=(await peer.next(m=>m.type==='room')).room;}
  await players[0].next(m=>m.type==='room'&&m.room.players.length===count);
  return {players,current};
}
async function start(players){
  for(const peer of players)peer.send({type:'ready',ready:true});
  await players[0].next(m=>m.type==='room'&&m.room.phase==='lobby'&&m.room.players.every(p=>p.ready));
  players[0].send({type:'start'});
  const loading=(await players[0].next(m=>m.type==='room'&&m.room.phase==='loading'&&m.room.runId!==players[0].runId)).room;
  for(const peer of players)peer.runId=loading.runId;
  for(const peer of players)peer.send({type:'loaded',runId:loading.runId});
  await players[0].next(m=>m.type==='room'&&m.room.phase==='playing'&&m.room.runId===loading.runId);
  return loading.runId;
}

test('private host rejects public and all-interface binds; validates loadout and finite input',()=>{
  for(const address of ['0.0.0.0','8.8.8.8','100.128.0.1','192.168.1.999','1.2.3','evil.example'])assert.equal(privateBindAddress(address),null);
  for(const address of ['127.0.0.1','10.0.0.5','192.168.8.1','172.31.1.1','100.100.9.1','::1'])assert.equal(privateBindAddress(address),address);
  assert.equal(validRoomSelection('wuling',1),true);assert.equal(validRoomSelection('wuling',2),false);assert.equal(validRoomSelection('__proto__',0),false);
  assert.equal(normalizeRoomInput({...input,moveX:NaN}),null);assert.equal(normalizeRoomInput({...input,damage:10000}),null);
  assert.ok(Math.hypot(...Object.values(normalizeRoomInput({...input,moveZ:1})).slice(0,2))<=1.000001);
});

test('four real sockets: ready barrier, authority, sequence, selection, full room and disconnect',async t=>{
  const server=await createRoomServer({port:0});t.after(()=>server.close());
  const {players,current}=await room(server,4),[host,guest]=players;
  const fifth=await client(server);
  fifth.send({type:'join',...selection,code:current.code});assert.equal((await fifth.next(m=>m.type==='error')).code,'full');
  guest.send({type:'map',mapId:'coast'});assert.equal((await guest.next(m=>m.type==='error')).code,'host-only');
  host.send({type:'start'});assert.equal((await host.next(m=>m.type==='error')).code,'not-ready');
  guest.send({type:'select',heroId:'silver',weaponIndex:1});assert.equal((await guest.next(m=>m.type==='room'&&m.room.players.find(p=>p.id===guest.id)?.heroId==='silver')).room.players.length,4);
  const runId=await start(players);
  fifth.send({type:'join',...selection,code:current.code});assert.equal((await fifth.next(m=>m.type==='error')).code,'already-started');
  guest.send({type:'snapshot',runId,seq:0,data:{hp:999}});assert.equal((await guest.next(m=>m.type==='error')).code,'host-only');
  guest.send({type:'input',runId:'older-run',seq:0,input});assert.equal((await guest.next(m=>m.type==='error')).code,'stale-run');
  guest.send({type:'input',runId,seq:0,input});assert.deepEqual((await host.next(m=>m.type==='input')).input,input);
  guest.send({type:'input',runId,seq:0,input});assert.equal((await guest.next(m=>m.type==='error')).code,'sequence');
  host.send({type:'snapshot',runId,seq:0,data:{time:1,players:[{id:guest.id,hp:78}],enemies:[{id:2,hp:25}]}});
  for(const peer of players.slice(1))assert.equal((await peer.next(m=>m.type==='snapshot')).data.enemies[0].hp,25);
  host.send({type:'event',runId,seq:0,to:guest.id,data:{kind:'choices',nonce:'reward-1',ids:['power','haste']}});
  assert.equal((await guest.next(m=>m.type==='event')).data.nonce,'reward-1');
  guest.send({type:'choice',runId,seq:0,choice:{id:'power',nonce:'reward-1'}});
  assert.equal((await host.next(m=>m.type==='choice')).playerId,guest.id);
  players[3].ws.close();assert.equal((await host.next(m=>m.type==='player-left')).playerId,players[3].id);
  host.ws.close();for(const peer of players.slice(1,3))assert.equal((await peer.next(m=>m.type==='closed')).reason,'host-left');
  assert.equal(server.roomCount,0);
});

test('rematch receives fresh run and rejects previous-run messages',async t=>{
  const server=await createRoomServer({port:0});t.after(()=>server.close());const {players}=await room(server);
  const first=await start(players);players[0].send({type:'finish',runId:first});
  await players[0].next(m=>m.type==='room'&&m.room.phase==='lobby'&&m.room.runId===null);
  const second=await start(players);assert.notEqual(first,second);
  players[1].send({type:'input',runId:first,seq:900,input});assert.equal((await players[1].next(m=>m.type==='error')).code,'stale-run');
  players[1].send({type:'input',runId:second,seq:0,input});assert.equal((await players[0].next(m=>m.type==='input')).seq,0);
  for(const message of [{type:'loaded'},{type:'snapshot',seq:900,data:{time:999}},{type:'event',seq:900,data:{type:'result'}},{type:'suspend',paused:true,reason:'host-menu'},{type:'finish'}]){
    players[0].send({...message,runId:first});assert.equal((await players[0].next(m=>m.type==='error')).code,'stale-run');
  }
  players[0].send({type:'snapshot',runId:second,seq:0,data:{time:0}});
  assert.equal((await players[1].next(m=>m.type==='snapshot'&&m.runId===second)).seq,0,'old-run frames must not consume the new sequence');
});

test('departure during loading releases the remaining barrier and cannot keep authority after leaving',async t=>{
  const server=await createRoomServer({port:0});t.after(()=>server.close());
  const {players:[host,guest,leaver],current}=await room(server,3);
  leaver.send({type:'join',...selection,code:current.code});assert.equal((await leaver.next(m=>m.type==='error')).code,'already-in-room');
  for(const peer of [host,guest,leaver])peer.send({type:'ready',ready:true});
  await host.next(m=>m.type==='room'&&m.room.players.every(p=>p.ready));host.send({type:'start'});
  const runId=(await host.next(m=>m.type==='room'&&m.room.phase==='loading')).room.runId;
  host.send({type:'loaded',runId});guest.send({type:'loaded',runId});
  await host.next(m=>m.type==='room'&&m.room.players.filter(p=>p.loaded).length===2);
  leaver.send({type:'leave'});assert.equal((await host.next(m=>m.type==='player-left')).playerId,leaver.id);
  const playing=(await guest.next(m=>m.type==='room'&&m.room.phase==='playing')).room;
  assert.equal(playing.players.length,2);assert(playing.players.every(p=>p.loaded));
  leaver.send({type:'input',runId,seq:0,input});assert.equal((await leaver.next(m=>m.type==='error')).code,'not-in-room');
  leaver.send({type:'join',...selection,code:current.code});assert.equal((await leaver.next(m=>m.type==='error')).code,'already-started');
  guest.send({type:'finish',runId});assert.equal((await guest.next(m=>m.type==='error')).code,'host-only');
  host.send({type:'finish',runId});const lobby=(await guest.next(m=>m.type==='room'&&m.room.runId===null&&m.room.players.length===2)).room;
  assert.equal(lobby.phase,'lobby');assert(lobby.players.every(p=>!p.loaded&&!p.ready));assert.equal(lobby.paused,false);
});

test('a stalled load closes the room and permits a clean new room on the same authenticated connection',async t=>{
  const server=await createRoomServer({port:0,heartbeatMs:20,loadTimeoutMs:60});t.after(()=>server.close());
  const {players:[host,guest]}=await room(server);
  host.send({type:'ready',ready:true});guest.send({type:'ready',ready:true});
  await host.next(m=>m.type==='room'&&m.room.players.every(p=>p.ready));host.send({type:'start'});
  const runId=(await host.next(m=>m.type==='room'&&m.room.phase==='loading')).room.runId;
  host.send({type:'loaded',runId});assert.equal((await guest.next(m=>m.type==='closed')).reason,'load-timeout');
  assert.equal(server.roomCount,0);host.send({type:'create',...selection,mapId:'coast'});
  const replacement=(await host.next(m=>m.type==='room'&&m.room.mapId==='coast')).room;
  assert.equal(replacement.hostId,host.id);assert.equal(replacement.phase,'lobby');assert.equal(replacement.runId,null);
  guest.send({type:'loaded',runId});assert.equal((await guest.next(m=>m.type==='error')).code,'not-in-room');
});

test('authentication, origin, payload size, Unicode token and unsafe JSON fail closed',async t=>{
  const server=await createRoomServer({port:0,authTimeoutMs:40});t.after(()=>server.close());
  for(const token of ['wrong','汉'.repeat(server.token.length)]){
    const ws=new WebSocket(server.url.replace('http:','ws:')+'/room-socket',{origin:server.url});await once(ws,'open');const closed=once(ws,'close');ws.send(JSON.stringify({type:'hello',protocol:1,token}));assert.equal((await closed)[0],4001);
  }
  const crossOrigin=new WebSocket(server.url.replace('http:','ws:')+'/room-socket',{origin:'https://untrusted.example'});
  assert.match((await once(crossOrigin,'error'))[0].message,/403/);
  const peer=await client(server),closed=once(peer.ws,'close');peer.ws.send(' '.repeat(ROOM_MAX_MESSAGE_BYTES+1));assert.equal((await closed)[0],1009);
  const unsafe=await client(server),unsafeClosed=once(unsafe.ws,'close');unsafe.ws.send('{"type":"ping","__proto__":{"x":1}}');assert.equal((await unsafeClosed)[0],1007);
  const idle=new WebSocket(server.url.replace('http:','ws:')+'/room-socket',{origin:server.url});await once(idle,'open');assert.equal((await once(idle,'close'))[0],4001);
});

test('only allowlisted runtime assets are served, with byte range and no source/config exposure',async t=>{
  const server=await createRoomServer({port:0});t.after(()=>server.close());
  const page=await fetch(server.url+'/play.html');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
  for(const path of ['/package.json','/node_modules/ws/package.json','/scripts/room-server.mjs','/.git/config','/..%2fpackage.json'])assert.equal((await fetch(server.url+path)).status,404);
  const full=await (await fetch(server.url+'/rules.js')).arrayBuffer();
  const range=await fetch(server.url+'/rules.js',{headers:{Range:'bytes=0-20'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,21);assert.equal(range.headers.get('content-range'),`bytes 0-20/${full.byteLength}`);
  assert.equal((await fetch(server.url+'/rules.js',{method:'POST'})).status,405);
});

test('host simulation timeout ends a match even when WebSocket responds to ping',async t=>{
  const server=await createRoomServer({port:0,heartbeatMs:30,hostSnapshotTimeoutMs:45});t.after(()=>server.close());
  const {players}=await room(server);await start(players);
  assert.equal((await players[1].next(m=>m.type==='closed')).reason,'host-unresponsive');assert.equal(server.roomCount,0);
});

test('all clients must load before simulation; shared pause is host-only and visible',async t=>{
  const server=await createRoomServer({port:0,heartbeatMs:20,hostSnapshotTimeoutMs:60});t.after(()=>server.close());
  const {players:[host,guest]}=await room(server);
  host.send({type:'ready',ready:true});guest.send({type:'ready',ready:true});
  await host.next(m=>m.type==='room'&&m.room.players.every(p=>p.ready));host.send({type:'start'});
  const runId=(await host.next(m=>m.type==='room'&&m.room.phase==='loading')).room.runId;
  host.send({type:'loaded',runId});host.send({type:'snapshot',runId,seq:0,data:{time:0}});
  assert.equal((await host.next(m=>m.type==='error')).code,'phase');
  guest.send({type:'loaded',runId});await guest.next(m=>m.type==='room'&&m.room.phase==='playing');
  guest.send({type:'suspend',runId,paused:true,reason:'choice'});assert.equal((await guest.next(m=>m.type==='error')).code,'host-only');
  host.send({type:'suspend',runId,paused:true,reason:'choice'});
  assert.equal((await guest.next(m=>m.type==='room'&&m.room.paused)).room.pauseReason,'choice');
  await new Promise(done=>setTimeout(done,130));assert.equal(server.roomCount,1);
  host.send({type:'suspend',runId,paused:false});await guest.next(m=>m.type==='room'&&m.room.phase==='playing'&&!m.room.paused);
  assert.equal((await guest.next(m=>m.type==='closed')).reason,'host-unresponsive');
});

// Public test-only localhost key: no external service or certificate tool is
// needed by this test. TLS trust is relaxed only for clients of this fixture.
const proxyKey=`-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgt0+t84TsCr2nb1au
K0dzc/6AA8VflyCerQGkcvLIASqhRANCAAShExgEyfKZnPnt4HdkE4A8ojrg4I3a
wlN7k9XX8zunjf71ZveN5LR/B+TDgFYwQZU0/ZUn2wruZsf+pgUFhk5F
-----END PRIVATE KEY-----`;
const proxyCert=`-----BEGIN CERTIFICATE-----
MIIBmDCCAT+gAwIBAgIUMzYfv87hLqxYtSIM/auZj6hIao0wCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAyMDAyNDMwM1oXDTM2MTAxNzAy
NDMwM1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEoRMYBMnymZz57eB3ZBOAPKI64OCN2sJTe5PV1/M7p43+9Wb3jeS0fwfk
w4BWMEGVNP2VJ9sK7mbH/qYFBYZORaNvMG0wHQYDVR0OBBYEFMNc7cg3rL5GqSOP
q/+BwkhC9cHlMB8GA1UdIwQYMBaAFMNc7cg3rL5GqSOPq/+BwkhC9cHlMA8GA1Ud
EwEB/wQFMAMBAf8wGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMAoGCCqGSM49
BAMCA0cAMEQCICWmUBmhlN1oCm8FNw6UMa5yCDD79yezjAeF5dPEd3J+AiB9ECvO
rqvyzs71IYRB6AQ5Aafi5jpcVA64K3bnH99JNQ==
-----END CERTIFICATE-----`;

function response(url,headers={}){
  return new Promise((resolve,reject)=>{
    const request=(url.startsWith('https:')?https:http).get(url,{headers,rejectUnauthorized:false},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body}));
    });request.on('error',reject);
  });
}

test('public forwarding accepts only an explicit HTTPS origin on a loopback listener',async t=>{
  for(const origin of [null,'','http://room.example','https://room.example/path','https://room.example/a/..','https://room.example?x=1','https://room.example?','https://room.example#key','https://room.example#','https://user:pass@room.example','https://@room.example','https://room.example\\path',' https://room.example','https://room.example ']){
    await assert.rejects(createRoomServer({port:0,publicOrigin:origin}),/origin/);
  }
  for(const host of ['192.168.1.2','100.90.80.70'])await assert.rejects(createRoomServer({host,publicOrigin:'https://room.example'}),/loopback/);
  const server=await createRoomServer({port:0,publicOrigin:'https://room.example/'});t.after(()=>server.close());
  assert.match(server.url,/^http:\/\/127\.0\.0\.1:/);
  assert.equal(server.inviteUrl,`https://room.example/play.html#roomToken=${server.token}`);
  assert.throws(()=>server.setPublicOrigin('https://different.example'),/only be set once/);
  const spoofed={'X-Forwarded-Host':'room.example','X-Forwarded-Proto':'https',Forwarded:'host=room.example;proto=https'};
  for(const options of [{origin:'https://other.example',headers:spoofed},{origin:'http://room.example',headers:spoofed},{origin:server.url,headers:{...spoofed,Host:'room.example'}},{origin:'http://localhost:'+new URL(server.url).port,headers:spoofed},{origin:'https://room.example',headers:{...spoofed,Host:'other.example'}},{headers:spoofed}]){
    const ws=new WebSocket(server.url.replace('http:','ws:')+'/room-socket',options);
    assert.match((await once(ws,'error'))[0].message,/403/);
  }
  assert.equal((await response(server.url+'/play.html',{...spoofed,Host:'other.example'})).status,403);
  assert.equal((await response(server.url+'/play.html',{Host:'room.example'})).status,200);
  const local=await client(server,{headers:spoofed});
  assert.equal(local.welcome.publicOrigin,'https://room.example');
  assert.ok(local.id,'exact local Host/Origin pair remains valid despite untrusted forwarded headers');
});

for(const localHost of[false,true])test(`real HTTPS and WSS proxy preserves invitation auth, both allowed Host forms and ${localHost?'local':'public'} host room flow`,async t=>{
  const backend=await createRoomServer({port:0});let rewriteHost=false;
  const sockets=new Set();
  const track=socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>socket.destroy());return socket;};
  const headers=req=>({...req.headers,...(rewriteHost?{host:new URL(backend.url).host}:{})});
  const proxy=https.createServer({key:proxyKey,cert:proxyCert},(req,res)=>{
    const upstream=http.request(backend.url+req.url,{method:req.method,headers:headers(req)},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>res.destroy());req.pipe(upstream);
  });
  proxy.on('connection',track);
  proxy.on('upgrade',(req,socket,head)=>{
    track(socket);const target=new URL(backend.url);
    const upstream=track(net.connect({host:target.hostname,port:target.port},()=>{
      upstream.write(`GET ${req.url} HTTP/1.1\r\n${Object.entries(headers(req)).map(([key,value])=>`${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if(head.length)upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    }));
    socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const publicOrigin=`https://127.0.0.1:${proxy.address().port}`;
  t.after(async()=>{for(const socket of sockets)socket.destroy();await backend?.close();await new Promise(resolve=>proxy.close(resolve));});
  backend.setPublicOrigin(publicOrigin);
  assert.equal(backend.inviteUrl,`${publicOrigin}/play.html#roomToken=${backend.token}`);
  const publicServer={url:publicOrigin,token:backend.token};
  assert.equal((await response(publicOrigin+'/play.html')).status,200);
  assert.equal((await response(publicOrigin+'/scripts/room-server.mjs')).status,404);
  const host=await client(localHost?backend:publicServer,localHost?{}:{rejectUnauthorized:false});
  assert.equal(host.welcome.publicOrigin,publicOrigin);
  rewriteHost=true;
  const guest=await client(publicServer,{rejectUnauthorized:false});
  assert.equal(guest.welcome.publicOrigin,publicOrigin);
  host.send({type:'create',...selection,mapId:'forest'});
  const code=(await host.next(m=>m.type==='room')).room.code;
  guest.send({type:'join',...selection,code});await guest.next(m=>m.type==='room');
  await host.next(m=>m.type==='room'&&m.room.players.length===2);
  const runId=await start([host,guest]);
  guest.send({type:'input',runId,seq:0,input});assert.deepEqual((await host.next(m=>m.type==='input')).input,input);
  host.send({type:'snapshot',runId,seq:0,data:{time:1}});assert.equal((await guest.next(m=>m.type==='snapshot')).data.time,1);
  const unauthorized=new WebSocket(publicOrigin.replace('https:','wss:')+'/room-socket',{origin:publicOrigin,rejectUnauthorized:false});
  await once(unauthorized,'open');const rejected=once(unauthorized,'close');
  unauthorized.send(JSON.stringify({type:'hello',protocol:1,token:'wrong'}));assert.equal((await rejected)[0],4001);
  host.ws.close();assert.equal((await guest.next(m=>m.type==='closed')).reason,'host-left');
});

test('private default ignores forwarded headers and does not implicitly trust HTTPS origins',async t=>{
  const server=await createRoomServer({port:0});t.after(()=>server.close());
  const headers={'X-Forwarded-Host':'room.example','X-Forwarded-Proto':'https',Forwarded:'host=room.example;proto=https'};
  const peer=await client(server,{headers});assert.ok(peer.id);assert.ok(server.inviteUrl.startsWith(server.url));
  const ws=new WebSocket(server.url.replace('http:','ws:')+'/room-socket',{origin:'https://room.example',headers});
  assert.match((await once(ws,'error'))[0].message,/403/);
});

test('tunnel origin is set once after binding and cannot change an active or closed service',async t=>{
  const server=await createRoomServer({port:0});t.after(()=>server.close());
  const initial=server.inviteUrl;
  assert.throws(()=>server.setPublicOrigin('http://room.example'),/origin/);assert.equal(server.inviteUrl,initial);
  assert.equal(server.setPublicOrigin('https://room.example/'),'https://room.example');
  assert.equal(server.inviteUrl,`https://room.example/play.html#roomToken=${server.token}`);
  assert.throws(()=>server.setPublicOrigin('https://room.example'),/only be set once/);
  const busy=await createRoomServer({port:0});t.after(()=>busy.close());
  await client(busy);assert.throws(()=>busy.setPublicOrigin('https://room.example'),/before any socket joins/);
  await busy.close();assert.throws(()=>busy.setPublicOrigin('https://room.example'),/only be set once/);
});
