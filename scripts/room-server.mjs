// Private-room relay. The host's game simulation, never a guest, owns world state.
import http from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {ROOM_PROTOCOL,ROOM_MAX_PLAYERS,ROOM_MAX_MESSAGE_BYTES,validRoomSelection,validRoomMap,roomDisplayName,normalizeRoomInput,validRoomSequence} from '../multiplayer-protocol.js';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ogg':'audio/ogg','.mp3':'audio/mpeg','.hdr':'application/octet-stream','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
const id=()=>randomBytes(12).toString('base64url');
const TYPES=new Set(['hello','ping','leave','create','join','select','ready','map','start','loaded','finish','suspend','input','choice','snapshot','event']);
export function privateBindAddress(address) {
  if(address==='localhost')return '127.0.0.1';
  if(address==='::1')return address;
  const parts=String(address).split('.').map(Number);
  if(parts.length!==4 || parts.some((n,i)=>!Number.isInteger(n)||n<0||n>255||String(n)!==String(address).split('.')[i]))return null;
  const [a,b]=parts;
  return a===127||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)?address:null;
}
function sameToken(actual,expected){
  if(typeof actual!=='string'||actual.length!==expected.length||!/^[A-Za-z0-9_-]+$/.test(actual))return false;
  return timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function trustedPublicOrigin(value){
  if(typeof value!=='string'||!/^https:\/\/[^\s\/?#\\@]+\/?$/.test(value))throw Error('Public origin must be an explicit HTTPS origin without credentials, path, query or fragment.');
  let url;try{url=new URL(value);}catch{throw Error('Invalid public HTTPS origin.');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid public HTTPS origin.');
  return url.origin;
}
function publicRoom(room){return{code:room.code,hostId:room.hostId,phase:room.phase,mapId:room.mapId,seed:room.seed,runId:room.runId,paused:room.paused,pauseReason:room.pauseReason,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,heroId:p.heroId,weaponIndex:p.weaponIndex,ready:p.ready,loaded:p.loaded}))};}
function boundedJson(value){
  const pending=[[value,0]];let count=0;
  while(pending.length){
    const [item,depth]=pending.pop();if(++count>50000||depth>32)return false;
    if(typeof item==='number'&&!Number.isFinite(item))return false;
    if(item&&typeof item==='object')for(const [key,child] of Object.entries(item)){
      if(['__proto__','prototype','constructor'].includes(key))return false;
      pending.push([child,depth+1]);
    }
  }
  return true;
}

/** Bind only an explicitly selected private address; localhost is the safe default. */
export async function createRoomServer({root=projectRoot,host='127.0.0.1',port=8898,publicOrigin,token=randomBytes(24).toString('base64url'),heartbeatMs=15000,hostSnapshotTimeoutMs=8000,loadTimeoutMs=180000,authTimeoutMs=5000,maxConnections=24}={}){
  host=privateBindAddress(host);
  if(!host)throw Error('Use a loopback, LAN or Tailscale IPv4 address; public/all-interface binds are disabled.');
  if(publicOrigin!==undefined){
    publicOrigin=trustedPublicOrigin(publicOrigin);
    if(host!=='::1'&&!host.startsWith('127.'))throw Error('Public forwarding requires a loopback listener.');
  }
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid server port.');
  if(typeof token!=='string'||token.length<24||token.length>128||!/^[A-Za-z0-9_-]+$/.test(token))throw Error('Invitation token must contain at least 24 URL-safe characters.');
  root=resolve(root);
  const manifest=JSON.parse(await readFile(resolve(root,'offline-package.json'),'utf8'));
  const allowed=new Set(manifest.files.map(file=>file.path));
  allowed.add('offline-package.json');
  let forwardingHosts=publicOrigin?new Set([new URL(publicOrigin).host]):null;
  const trustedHost=value=>!forwardingHosts||forwardingHosts.has(value);
  const rooms=new Map(), peers=new Map();
  let stopping=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    if(!trustedHost(req.headers.host)){res.writeHead(403).end();return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    let path;
    try{path=decodeURIComponent(new URL(req.url,'http://room.local').pathname).replace(/^\//,'')||'play.html';}catch{res.writeHead(400).end();return;}
    if(!allowed.has(path)||path.includes('\\')||path.split('/').includes('..')){res.writeHead(404).end();return;}
    try{
      const full=resolve(root,path),info=await stat(full);
      if(!info.isFile()){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',MIME[extname(path)]||'application/octet-stream');
      res.setHeader('Cache-Control',/\.(html|js|json|css)$/.test(path)?'no-cache':'public, max-age=3600');
      res.setHeader('Accept-Ranges','bytes');
      let start=0,end=info.size-1,status=200;
      if(req.headers.range){
        const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if(!range||(!range[1]&&!range[2])){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
        if(range[1]){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;}
        else start=Math.max(0,info.size-Number(range[2]));
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
        status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);
      }
      res.setHeader('Content-Length',Math.max(0,end-start+1));res.writeHead(status);
      if(req.method==='HEAD'||info.size===0){res.end();return;}
      const stream=createReadStream(full,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  const wss=new WebSocketServer({noServer:true,maxPayload:ROOM_MAX_MESSAGE_BYTES,perMessageDeflate:false});
  const send=(peer,message)=>{
    if(!peer||peer.ws.readyState!==WebSocket.OPEN)return false;
    if(peer.ws.bufferedAmount>2*ROOM_MAX_MESSAGE_BYTES){peer.ws.close(4008,'Connection too slow');return false;}
    // Old snapshots may be skipped; events/input must retain ordering.
    if(message.type==='snapshot'&&peer.ws.bufferedAmount>ROOM_MAX_MESSAGE_BYTES)return false;
    peer.ws.send(JSON.stringify(message));return true;
  };
  const broadcast=(room,message,except=null)=>{for(const player of room.players.values())if(player.id!==except)send(player,message);};
  const roomChanged=room=>broadcast(room,{type:'room',room:publicRoom(room)});
  const fail=(peer,code,message)=>send(peer,{type:'error',code,message});
  function closeRoom(room,reason){
    rooms.delete(room.code);
    for(const player of room.players.values()){player.room=null;player.seq={};send(player,{type:'closed',reason});}
    room.players.clear();
  }
  function maybePlay(room){
    if(room.phase==='loading'&&[...room.players.values()].every(p=>p.loaded)){
      room.phase='playing';room.lastSnapshot=Date.now();roomChanged(room);
    }
  }
  function leave(peer){
    const room=peer.room;if(!room)return;
    if(room.hostId===peer.id){closeRoom(room,'host-left');return;}
    room.players.delete(peer.id);peer.room=null;peer.seq={};
    broadcast(room,{type:'player-left',playerId:peer.id});maybePlay(room);roomChanged(room);
  }
  function sequence(peer,type,seq){
    if(!validRoomSequence(seq)||seq<=(peer.seq[type]??-1))return false;
    peer.seq[type]=seq;return true;
  }
  function rate(peer,type){
    const now=Date.now(),limit={input:65,snapshot:35,event:100,choice:10,ping:4}[type]||8;
    const bucket=peer.rates[type]??={at:now,tokens:limit*2};
    bucket.tokens=Math.min(limit*2,bucket.tokens+(now-bucket.at)*limit/1000);bucket.at=now;
    if(bucket.tokens<1)return false;bucket.tokens--;return true;
  }
  function dispatch(peer,message,bytes){
    if(!message||typeof message!=='object'||Array.isArray(message)||typeof message.type!=='string')return fail(peer,'bad-message','Invalid room message.');
    const type=message.type;
    if(!TYPES.has(type)){if(++peer.abuse>20)peer.ws.close(4008,'Unknown message types');return fail(peer,'unknown-message','Unknown room action.');}
    if(!peer.authenticated){
      if(type!=='hello'||message.protocol!==ROOM_PROTOCOL||!sameToken(message.token,token)){peer.ws.close(4001,'Invalid invitation');return;}
      peer.authenticated=true;clearTimeout(peer.authTimer);send(peer,{type:'welcome',protocol:ROOM_PROTOCOL,playerId:peer.id,...(publicOrigin?{publicOrigin}:{})});return;
    }
    if(!rate(peer,type)){if(++peer.abuse>20)peer.ws.close(4008,'Message rate exceeded');return fail(peer,'rate-limit','Messages sent too quickly.');}
    if(!['snapshot','event'].includes(type)&&bytes>4096){peer.ws.close(1009,'Message too large');return;}
    if(type==='ping'){if(Number.isFinite(message.at))send(peer,{type:'pong',at:message.at});return;}
    if(type==='leave'){leave(peer);return;}
    if(type==='create'||type==='join'){
      if(peer.room)return fail(peer,'already-in-room','Leave the current room first.');
      const name=roomDisplayName(message.name);
      if(!name||!validRoomSelection(message.heroId,message.weaponIndex))return fail(peer,'selection','Choose a valid hero and weapon.');
      let room;
      if(type==='create'){
        if(rooms.size>=4)return fail(peer,'capacity','This server already has four rooms.');
        if(!validRoomMap(message.mapId))return fail(peer,'map','Choose a valid map.');
        let code;do{code=randomBytes(6).toString('hex').toUpperCase();}while(rooms.has(code));
        room={code,hostId:peer.id,mapId:message.mapId,phase:'lobby',seed:null,runId:null,paused:false,pauseReason:null,players:new Map()};rooms.set(code,room);
      }else{
        room=rooms.get(typeof message.code==='string'?message.code.toUpperCase():'');
        if(!room)return fail(peer,'not-found','Room not found.');
        if(room.phase!=='lobby')return fail(peer,'already-started','This match already started.');
        if(room.players.size>=ROOM_MAX_PLAYERS)return fail(peer,'full','The room has four players.');
      }
      Object.assign(peer,{name,heroId:message.heroId,weaponIndex:message.weaponIndex,ready:false,loaded:false,room});
      room.players.set(peer.id,peer);roomChanged(room);return;
    }
    const room=peer.room;if(!room)return fail(peer,'not-in-room','Join a room first.');
    const isHost=room.hostId===peer.id;
    if(type==='select'){
      if(room.phase!=='lobby'||!validRoomSelection(message.heroId,message.weaponIndex))return fail(peer,'selection','Selection is unavailable.');
      peer.heroId=message.heroId;peer.weaponIndex=message.weaponIndex;peer.ready=false;roomChanged(room);return;
    }
    if(type==='ready'){
      if(room.phase!=='lobby'||typeof message.ready!=='boolean')return fail(peer,'phase','Ready is available in the lobby.');
      peer.ready=message.ready;roomChanged(room);return;
    }
    if(type==='map'){
      if(!isHost)return fail(peer,'host-only','Only the host can choose the map.');
      if(room.phase!=='lobby'||!validRoomMap(message.mapId))return fail(peer,'map','Map selection is unavailable.');
      room.mapId=message.mapId;for(const p of room.players.values())p.ready=false;roomChanged(room);return;
    }
    if(type==='start'){
      if(!isHost)return fail(peer,'host-only','Only the host can start.');
      if(room.phase!=='lobby'||room.players.size<2||![...room.players.values()].every(p=>p.ready))return fail(peer,'not-ready','At least two players must be ready.');
      room.phase='loading';room.runId=id();room.seed=randomBytes(4).readUInt32LE();room.loadingAt=Date.now();
      for(const p of room.players.values()){p.loaded=false;p.seq={};}
      roomChanged(room);return;
    }
    if(message.runId!==room.runId||!room.runId)return fail(peer,'stale-run','This message belongs to another match.');
    if(type==='loaded'){
      if(room.phase!=='loading')return fail(peer,'phase','The room is not loading.');
      peer.loaded=true;roomChanged(room);maybePlay(room);return;
    }
    if(type==='finish'){
      if(!isHost)return fail(peer,'host-only','Only the host can finish.');
      room.phase='lobby';room.runId=null;room.seed=null;room.paused=false;room.pauseReason=null;for(const p of room.players.values()){p.ready=false;p.loaded=false;p.seq={};}roomChanged(room);return;
    }
    if(room.phase!=='playing')return fail(peer,'phase','Wait for every player to load.');
    if(type==='suspend'){
      if(!isHost)return fail(peer,'host-only','Only the host can pause the shared simulation.');
      if(typeof message.paused!=='boolean'||(message.paused&&!['host-away','host-menu','choice'].includes(message.reason)))return fail(peer,'pause','Invalid shared pause.');
      room.paused=message.paused;room.pauseReason=message.paused?message.reason:null;room.lastSnapshot=Date.now();roomChanged(room);return;
    }
    if(type==='input'||type==='choice'){
      if(isHost)return fail(peer,'guest-only','Host input is applied by its simulation.');
      if(type==='input'){
        const input=normalizeRoomInput(message.input);if(!input)return fail(peer,'input','Invalid player input.');
        if(!sequence(peer,type,message.seq))return fail(peer,'sequence','Duplicate or outdated input.');
        send(room.players.get(room.hostId),{type,runId:room.runId,playerId:peer.id,seq:message.seq,input});
      }else{
        const choice=message.choice;
        if(!choice||typeof choice.id!=='string'||choice.id.length>64||typeof choice.nonce!=='string'||choice.nonce.length>64)return fail(peer,'choice','Invalid reward choice.');
        if(!sequence(peer,type,message.seq))return fail(peer,'sequence','Duplicate or outdated choice.');
        send(room.players.get(room.hostId),{type,runId:room.runId,playerId:peer.id,seq:message.seq,choice:{id:choice.id,nonce:choice.nonce}});
      }
      return;
    }
    if(type==='snapshot'||type==='event'){
      if(!isHost)return fail(peer,'host-only','Only the host simulation can publish world state.');
      if(!message.data||typeof message.data!=='object'||Array.isArray(message.data))return fail(peer,'data','World payload must be an object.');
      if(message.to!==undefined&&(type!=='event'||!room.players.has(message.to)))return fail(peer,'target','Unknown event target.');
      if(!sequence(peer,type,message.seq))return fail(peer,'sequence','Duplicate or outdated world state.');
      const frame={type,runId:room.runId,seq:message.seq,data:message.data};
      if(type==='snapshot')room.lastSnapshot=Date.now();
      if(message.to)send(room.players.get(message.to),frame);else broadcast(room,frame,peer.id);
      return;
    }
    fail(peer,'unknown-message','Unknown room action.');
  }
  server.on('upgrade',(req,socket,head)=>{
    // A tunnel may retain its public Host or replace it with the local target.
    // Only explicit configuration is trusted, never Forwarded/X-Forwarded-*.
    // The host page stays on this exact loopback origin; its simulation does
    // not need a round trip through the tunnel. Never pair a local Origin with
    // a public Host, or derive an allowed Origin from forwarded headers.
    const localPair=req.headers.origin===url&&req.headers.host===new URL(url).host;
    const allowedOrigin=publicOrigin?(req.headers.origin===publicOrigin||localPair):req.headers.origin===`http://${req.headers.host}`;
    if(req.url!=='/room-socket'||!trustedHost(req.headers.host)||!allowedOrigin||peers.size>=maxConnections){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
    const peer={id:id(),ws,room:null,authenticated:false,seq:{},rates:{},alive:true,abuse:0};peers.set(peer.id,peer);
    peer.authTimer=setTimeout(()=>ws.close(4001,'Invitation required'),authTimeoutMs);peer.authTimer.unref();
    ws.on('pong',()=>{peer.alive=true;});
    ws.on('message',(raw,isBinary)=>{
      if(isBinary){ws.close(1003,'Text JSON only');return;}
      let message;try{message=JSON.parse(raw.toString());}catch{ws.close(1007,'Invalid JSON');return;}
      if(!boundedJson(message)){ws.close(1007,'Invalid JSON structure');return;}
      dispatch(peer,message,raw.length);
    });
    ws.on('close',()=>{clearTimeout(peer.authTimer);peers.delete(peer.id);leave(peer);});
    ws.on('error',()=>{}); // close handles membership; errors never include invite credentials.
  });
  let lastPing=Date.now();
  const heartbeat=setInterval(()=>{
    const now=Date.now();
    if(now-lastPing>=heartbeatMs){
      lastPing=now;
      for(const peer of peers.values()){
        if(!peer.alive){peer.ws.terminate();continue;}
        peer.alive=false;peer.ws.ping();
      }
    }
    for(const room of rooms.values()){
      if(room.phase==='playing'&&!room.paused&&now-room.lastSnapshot>hostSnapshotTimeoutMs)closeRoom(room,'host-unresponsive');
      else if(room.phase==='loading'&&now-room.loadingAt>loadTimeoutMs)closeRoom(room,'load-timeout');
    }
  },Math.min(1000,heartbeatMs));heartbeat.unref();
  try{await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);accept();});});}
  catch(error){clearInterval(heartbeat);wss.close();throw error;}
  const address=server.address(),url=`http://${host.includes(':')?'['+host+']':host}:${address.port}`;
  forwardingHosts?.add(new URL(url).host);
  return{server,wss,url,token,get inviteUrl(){return`${publicOrigin||url}/play.html#roomToken=${encodeURIComponent(token)}`;},setPublicOrigin(value){
    // Bind the actual game before starting a tunnel, so a busy port cannot
    // accidentally expose another local service while the tunnel starts.
    if(stopping||publicOrigin!==undefined||peers.size||rooms.size)throw Error('Public origin can only be set once, before any socket joins.');
    if(host!=='::1'&&!host.startsWith('127.'))throw Error('Public forwarding requires a loopback listener.');
    const origin=trustedPublicOrigin(value);
    forwardingHosts=new Set([new URL(origin).host,new URL(url).host]);publicOrigin=origin;
    return origin;
  },get roomCount(){return rooms.size;},async close(){
    if(stopping)return;stopping=true;clearInterval(heartbeat);
    for(const room of [...rooms.values()])closeRoom(room,'server-stopped');
    for(const peer of peers.values()){clearTimeout(peer.authTimer);peer.ws.close(1001,'Host service stopped');}
    const force=setTimeout(()=>{for(const peer of peers.values())peer.ws.terminate();},100);force.unref();
    await new Promise(done=>wss.close(done));await new Promise(done=>server.close(done));clearTimeout(force);
  }};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(args.includes('--help')){
    console.log('Private host: npm run room:host -- --host <LAN-or-Tailscale-IP> --port 8898\nDefault: localhost only. Share the printed private invitation with up to three friends. Closing this process closes every room.');
  }else{
    try{
      const app=await createRoomServer({host:option('--host')||'127.0.0.1',port:option('--port')===undefined?8898:Number(option('--port'))});
      console.log(`异境回响 · 私人房间服务\n${app.inviteUrl}\n仅把此私人邀请发给一起玩的朋友。关闭此窗口会断开全部房间。`);
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
    }catch(error){console.error(`Room host could not start: ${error.message}`);process.exitCode=1;}
  }
}
