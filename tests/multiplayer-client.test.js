import test from'node:test';
import assert from'node:assert/strict';
import{RoomClient,parseRoomAddress,roomInvitation,boundedRoomData}from'../multiplayer-client.js';
import{WebSocket}from'ws';
import{createRoomServer}from'../scripts/room-server.mjs';

class Socket{
 static instances=[];
 constructor(url){this.url=url;this.readyState=0;this.listeners={};this.sent=[];Socket.instances.push(this);}
 addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
 fire(type,value={}){for(const callback of this.listeners[type]||[])callback(value);}
 open(){this.readyState=1;this.fire('open');}
 message(value){this.fire('message',{data:JSON.stringify(value)});}
 send(value){this.sent.push(JSON.parse(value));}
 close(){this.readyState=3;this.fire('close');}
}
const token='secret-invitation-token-for-test';
const players=[{id:'host',name:'房主',heroId:'scout',weaponIndex:0,ready:true,loaded:true},{id:'guest',name:'朋友',heroId:'silver',weaponIndex:1,ready:true,loaded:true}];
const room={code:'ABCDEF',hostId:'host',phase:'playing',mapId:'forest',seed:123,runId:'run-one',players};
async function connected(id='guest'){
 const client=new RoomClient({WebSocketClass:Socket});const promise=client.connect({url:'http://127.0.0.1:8898',token});const socket=Socket.instances.at(-1);socket.open();socket.message({type:'welcome',protocol:1,playerId:id});await promise;return{client,socket};
}

test('room invitation secret stays in fragment and websocket URL contains no secret',()=>{
 const invitation=roomInvitation('http://100.70.80.90:8898',token,'ABCDEF');
 assert.equal(new URL(invitation).search,'');assert.equal(new URL(invitation).pathname,'/play.html');
 const parsed=parseRoomAddress(invitation);assert.equal(parsed.token,token);assert.equal(parsed.code,'ABCDEF');assert.equal(parsed.socketURL,'ws://100.70.80.90:8898/room-socket');
 assert.equal(parseRoomAddress('https://host.example/play.html').socketURL,'wss://host.example/room-socket');
 assert.throws(()=>parseRoomAddress('javascript:alert(1)'));assert.throws(()=>parseRoomAddress('http://name:password@127.0.0.1'));
});

test('local host shares only the authenticated public origin while its socket stays local',async()=>{
 const client=new RoomClient({WebSocketClass:Socket});
 try{
  const promise=client.connect({url:'http://127.0.0.1:8898/play.html#publicOrigin=https://untrusted.example',token});
  const socket=Socket.instances.at(-1);socket.open();socket.message({type:'welcome',protocol:1,playerId:'host',publicOrigin:'https://verified.trycloudflare.com'});await promise;
  socket.message({type:'room',room});
  assert.equal(socket.url,'ws://127.0.0.1:8898/room-socket');assert.equal(client.url,'http://127.0.0.1:8898');
  const invitation=parseRoomAddress(client.inviteURL());
  assert.equal(invitation.url,'https://verified.trycloudflare.com');assert.equal(invitation.token,token);assert.equal(invitation.code,room.code);
  socket.message({type:'room',room:{...room,publicOrigin:'https://untrusted.example'}});
  assert.equal(parseRoomAddress(client.inviteURL()).url,'https://verified.trycloudflare.com');
  client.leave();assert.equal(client.shareOrigin,'');
  const privateConnection=client.connect({url:'http://100.70.80.90:8898',token});const privateSocket=Socket.instances.at(-1);
  privateSocket.open();privateSocket.message({type:'welcome',protocol:1,playerId:'host'});await privateConnection;
  assert.equal(parseRoomAddress(client.inviteURL()).url,'http://100.70.80.90:8898');
 }finally{client.destroy();}
});

test('malformed public invitation origins fail connection without falling back to a local invite',async()=>{
 for(const publicOrigin of['http://room.example','https://user:pass@room.example','https://room.example/path','https://room.example?token=x','https://room.example#key','https://room.example/','javascript:alert(1)',null,42]){
  const client=new RoomClient({WebSocketClass:Socket});
  try{
   const pending=client.connect({url:'http://127.0.0.1:8898',token}),rejected=assert.rejects(pending,/邀请地址无效/);
   const socket=Socket.instances.at(-1);socket.open();socket.message({type:'welcome',protocol:1,playerId:'host',publicOrigin});await rejected;
   assert.equal(client.connected,false);assert.equal(client.shareOrigin,'');assert.equal(client.inviteURL(),'');
  }finally{client.destroy();}
 }
});

test('real local browser client connects after public setup and advertises the public invitation',async t=>{
 const server=await createRoomServer({port:0,publicOrigin:'https://verified.trycloudflare.com'});t.after(()=>server.close());
 class RealSocket extends WebSocket{constructor(url){super(url,{origin:server.url});}}
 const client=new RoomClient({WebSocketClass:RealSocket});t.after(()=>client.destroy());
 await client.connect({url:server.url,token:server.token});
 assert.equal(client.socket.url,server.url.replace('http:','ws:')+'/room-socket');
 assert.equal(client.inviteURL(),server.inviteUrl);
 assert.equal(new URL(client.inviteURL()).origin,'https://verified.trycloudflare.com');
});

test('client waits for hello acknowledgement and validates roster, runs, order and bounded snapshots',async()=>{
 const{client,socket}=await connected();let rooms=0,frames=0;client.on('room',()=>rooms++);client.on('snapshot',()=>frames++);
 assert.deepEqual(socket.sent[0],{type:'hello',protocol:1,token});
 socket.message({type:'room',room:{...room,players:[...players,players[1]]}});assert.equal(rooms,0);
 socket.message({type:'room',room:{...room,players:[players[0],{...players[1],heroId:'__proto__'}]}});assert.equal(rooms,0);
 socket.message({type:'room',room});assert.equal(rooms,1);assert.equal(client.isHost,false);
 socket.message({type:'snapshot',runId:'old-run',seq:4,data:{players:[]}});
 socket.message({type:'snapshot',runId:room.runId,seq:4,data:{players:[]}});
 socket.message({type:'snapshot',runId:room.runId,seq:3,data:{players:[]}});
 socket.message({type:'snapshot',runId:room.runId,seq:4,data:{players:[]}});assert.equal(frames,1);
 socket.message({type:'snapshot',runId:room.runId,seq:5,data:{constructor:{bad:true}}});assert.equal(frames,1);
 socket.message({type:'room',room:{...room,runId:'run-two',paused:true,pauseReason:'host-away'}});
 socket.message({type:'snapshot',runId:'run-two',seq:1,data:{players:[]}});assert.equal(frames,2);assert.equal(client.room.paused,true);assert.equal(client.room.pauseReason,'host-away');
 assert.equal(client.sendSnapshot({}),false);assert.equal(client.sendInput({moveX:1,moveZ:1,attack:true}),true);
 const input=socket.sent.at(-1);assert.equal(input.type,'input');assert.equal(input.seq,1);assert.ok(Math.abs(input.input.moveX-Math.SQRT1_2)<1e-8);assert.equal(input.input.jump,false);
 assert.equal(client.sendInput({moveX:5}),false);client.destroy();
});

test('host receives only current members input and independent sequence streams',async()=>{
 const{client,socket}=await connected('host');socket.message({type:'room',room});let inputs=0,choices=0;client.on('input',()=>inputs++);client.on('choice',()=>choices++);
 socket.message({type:'input',runId:room.runId,seq:1,playerId:'missing',input:{moveX:0}});assert.equal(inputs,0);
 socket.message({type:'input',runId:room.runId,seq:1,playerId:'guest',input:{moveX:0}});assert.equal(inputs,1);
 socket.message({type:'choice',runId:room.runId,seq:1,playerId:'guest',choice:{id:'power',nonce:'draft'}});assert.equal(choices,1);
 assert.equal(client.sendInput({}),false);assert.equal(client.sendSnapshot({players:[]}),true);assert.equal(client.sendEvent({type:'attack'},'guest'),true);assert.equal(socket.sent.at(-1).to,'guest');
 client.destroy();
});

test('leaving, transport closure and canceled connection clear state exactly once',async()=>{
 const{client,socket}=await connected();socket.message({type:'room',room});let closed=0;client.on('closed',()=>closed++);client.leave();assert.equal(closed,1);assert.equal(client.connected,false);assert.equal(client.room,null);socket.message({type:'room',room});assert.equal(client.room,null);
 const pending=client.connect({url:'http://127.0.0.1:8898',token});client.close();await assert.rejects(pending,/取消/);assert.equal(closed,2);
 const second=await connected();let reason='';second.client.on('closed',event=>reason=event.reason);second.socket.message({type:'closed',reason:'房主已退出'});assert.equal(reason,'房主已退出');assert.equal(second.client.connected,false);assert.equal(second.client.room,null);
 client.destroy();second.client.destroy();
});

test('malformed payloads cannot exceed recursive or numeric budgets',()=>{
 assert.equal(boundedRoomData({x:Infinity}),false);assert.equal(boundedRoomData(JSON.parse('{"__proto__":{"bad":true}}')),false);
 assert.equal(boundedRoomData(Array.from({length:2049},()=>1)),false);let deep={};for(let i=0;i<18;i++)deep={next:deep};assert.equal(boundedRoomData(deep),false);
 assert.equal(boundedRoomData({players:[{id:'host',hp:100,x:1,z:-4}],time:2}),true);
});

test('browser transport API matches real private host create, load, input, snapshots and shutdown',async t=>{
 const server=await createRoomServer({port:0});t.after(()=>server.close());
 class RealSocket extends WebSocket{constructor(url){super(url,{origin:server.url});}}
 const host=new RoomClient({WebSocketClass:RealSocket}),guest=new RoomClient({WebSocketClass:RealSocket});t.after(()=>{host.destroy();guest.destroy();});
 const next=(client,type,predicate=()=>true)=>new Promise((resolve,reject)=>{const off=client.on(type,value=>{if(predicate(value)){off();clearTimeout(timer);resolve(value);}});const timer=setTimeout(()=>{off();reject(Error('Timeout waiting for '+type));},2500);});
 await Promise.all([host.connect({url:server.url,token:server.token}),guest.connect({url:server.url,token:server.token})]);
 const created=next(host,'room');host.create({name:'房主',heroId:'scout',weaponIndex:0,mapId:'forest'});await created;
 const joined=next(host,'room',r=>r.players.length===2),guestJoined=next(guest,'room');guest.join({code:host.room.code,name:'朋友',heroId:'silver',weaponIndex:0});await Promise.all([joined,guestJoined]);
 const ready=next(host,'room',r=>r.players.every(p=>p.ready));host.setReady(true);guest.setReady(true);await ready;
 const loading=next(host,'room',r=>r.phase==='loading'),guestLoading=next(guest,'room',r=>r.phase==='loading');host.start();await Promise.all([loading,guestLoading]);
 const playing=next(host,'room',r=>r.phase==='playing'),guestPlaying=next(guest,'room',r=>r.phase==='playing');host.loaded();guest.loaded();await Promise.all([playing,guestPlaying]);
 const receivedInput=next(host,'input');guest.sendInput({moveX:.7,attack:true,mobile:true,view:'first',aspect:2,dodgeSeq:1});assert.equal((await receivedInput).input.dodgeSeq,1);
 const snapshot=next(guest,'snapshot');host.sendSnapshot({time:1,players:[{id:guest.playerId,hp:100}]});assert.equal((await snapshot).data.time,1);
 const paused=next(guest,'room',r=>r.paused);host.suspend(true,'choice');assert.equal((await paused).pauseReason,'choice');
 const closed=next(guest,'closed');host.leave();assert.match((await closed).reason,/房主已离开/);assert.equal(guest.room,null);
});
