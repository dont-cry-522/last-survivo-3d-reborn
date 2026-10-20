import{MAPS}from'./rules.js?v=228';
import{ROOM_PROTOCOL,ROOM_MAX_PLAYERS,ROOM_MAX_MESSAGE_BYTES,validRoomSelection,normalizeRoomInput}from'./multiplayer-protocol.js?v=228';

export{ROOM_PROTOCOL,validRoomSelection};
export const ROOM_HERO_NAMES={scout:'林地游侠',silver:'霜影',wraith:'影裔',tide:'潮行者',lingya:'铃芽',wuling:'雾苓',mirage:'雾苓·蜃影',minstrel:'岚歌'};
const own=(value,key)=>Object.hasOwn(value,key);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const roomErrors={'already-in-room':'请先离开当前房间。',selection:'请选择有效的人物与对应武器。',capacity:'房主电脑上的房间已满，请稍后再试。',map:'当前不能更改这张地图。','not-found':'没有找到这个房间，请核对房间码。','already-started':'这局已经开始，请等房主回到房间后再加入。',full:'房间已有 4 人。','not-in-room':'请先创建或加入房间。','host-only':'这项操作需要由房主完成。','not-ready':'至少两名玩家准备后，房主才能开始。',phase:'当前阶段暂时不能执行这项操作。','stale-run':'这是上一局的操作，已忽略。',sequence:'重复或过期的操作已忽略。','rate-limit':'操作过于频繁，请稍等。',choice:'成长选择已失效，请使用本轮提供的选项。'};
const roomClosures={'host-left':'房主已离开，当前房间已结束。','host-unresponsive':'房主的游戏停止响应，当前房间已结束。','load-timeout':'有玩家加载超时，请重新建房再试。','server-stopped':'房主已关闭服务，当前房间已结束。'};

// The invitation secret remains in memory / URL fragments, never in a query,
// localStorage, request log, or the game save. Only WebSocket hello sends it.
export function parseRoomAddress(value,base='http://127.0.0.1:8898/'){
 const url=new URL(value||base,base);
 if(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password)throw new Error('请输入房主提供的 http / https 地址。');
 const fragment=new URLSearchParams(url.hash.slice(1));
 const token=fragment.get('roomToken')||'',code=(fragment.get('roomCode')||'').toUpperCase();
 url.protocol=url.protocol==='https:'||url.protocol==='wss:'?'https:':'http:';
 url.pathname='/';url.search='';url.hash='';
 const socket=new URL('/room-socket',url);socket.protocol=url.protocol==='https:'?'wss:':'ws:';
 return{url:url.origin,socketURL:socket.href,token,code};
}
export function roomInvitation(url,token,code=''){
 const address=parseRoomAddress(url),link=new URL('/play.html',address.url);
 link.hash=new URLSearchParams({roomToken:token,...(code?{roomCode:code}:{})}).toString();
 return link.href;
}

function roomFromMessage(value){
 if(!object(value)||!identifier(value.code)||!identifier(value.hostId)||!['lobby','loading','playing'].includes(value.phase)||!own(MAPS,value.mapId)||!Array.isArray(value.players)||value.players.length<1||value.players.length>ROOM_MAX_PLAYERS)return null;
 if(!(value.phase==='lobby'&&value.seed===null)&&(!Number.isSafeInteger(value.seed)||value.seed<0||value.seed>0xffffffff))return null;
 if(value.runId!==null&&value.runId!==undefined&&!identifier(value.runId))return null;
 const players=[],seen=new Set();
 for(const p of value.players){
  if(!object(p)||!identifier(p.id)||seen.has(p.id)||typeof p.name!=='string'||p.name.length>32||!validRoomSelection(p.heroId,p.weaponIndex)||typeof p.ready!=='boolean'||typeof p.loaded!=='boolean')return null;
  seen.add(p.id);players.push({id:p.id,name:p.name,heroId:p.heroId,weaponIndex:p.weaponIndex,ready:p.ready,loaded:p.loaded});
 }
 if(!seen.has(value.hostId))return null;
 return{code:value.code,hostId:value.hostId,phase:value.phase,mapId:value.mapId,seed:value.seed,runId:value.runId||null,players,paused:value.paused===true,pauseReason:['host-away','host-menu','choice'].includes(value.pauseReason)?value.pauseReason:null};
}

// Game adapters validate their own entity fields; this envelope rejects unsafe
// shapes, non-finite numbers and unbounded payloads before they reach adapters.
export function boundedRoomData(value){
 let remaining=20000;
 function visit(v,depth){
  if(--remaining<0||depth>16)return false;
  if(v===null||typeof v==='boolean')return true;
  if(typeof v==='number')return Number.isFinite(v);
  if(typeof v==='string')return v.length<=16384;
  if(Array.isArray(v))return v.length<=2048&&v.every(item=>visit(item,depth+1));
  if(!object(v))return false;
  const keys=Object.keys(v);
  return keys.length<=512&&keys.every(key=>!['__proto__','prototype','constructor'].includes(key)&&key.length<=128&&visit(v[key],depth+1));
 }
 return visit(value,0);
}

export class RoomClient{
 constructor({WebSocketClass=globalThis.WebSocket,now=()=>performance.now(),connectTimeout=10000,heartbeatInterval=10000}={}){
  this.WebSocketClass=WebSocketClass;this.now=now;this.connectTimeout=connectTimeout;this.heartbeatInterval=heartbeatInterval;
  this.listeners=new Map();this.room=null;this.playerId=null;this.socket=null;this.connected=false;this.url='';this.shareOrigin='';this.token='';this.latency=null;this.generation=0;this.outgoing=new Map();this.incoming=new Map();
 }
 get isHost(){return!!this.room&&this.room.hostId===this.playerId;}
 on(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);return()=>this.listeners.get(type)?.delete(listener);}
 emit(type,data){for(const listener of this.listeners.get(type)||[])listener(data);}
 async connect({url,token}={}){
  const address=parseRoomAddress(url,globalThis.location?.href);
  token=token||address.token;
  if(typeof token!=='string'||token.length<16||token.length>256)throw new Error('缺少邀请密钥。请粘贴房主提供的完整邀请链接。');
  if(globalThis.location?.origin&&globalThis.location.origin!==address.url)throw new Error('请先打开房主游戏页，再从同一页面创建或加入房间。');
  if(globalThis.location?.protocol==='https:'&&address.socketURL.startsWith('ws:'))throw new Error('请直接打开房主的完整邀请链接，再从房主页面加入；HTTPS 页面不能连接不加密的本地房间。');
  if(this.connected&&this.url===address.url&&this.token===token)return this;
  if(this.room)throw new Error('请先离开当前房间，再连接另一台电脑。');
  this.close('',false);const generation=++this.generation;
  this.url=address.url;this.token=token;this.emit('status',{state:'connecting',text:'正在连接房主电脑…'});
  const socket=this.socket=new this.WebSocketClass(address.socketURL);
  return new Promise((resolve,reject)=>{
   let settled=false;
   const fail=message=>{if(!settled){settled=true;reject(new Error(message));}};
   const timeout=setTimeout(()=>{fail('连接超时。请使用房主本次启动的完整 HTTPS 邀请，确认双方能正常联网，且房主电脑的服务窗口与游戏页保持打开。');if(generation===this.generation)this.close('连接超时。');},this.connectTimeout);timeout.unref?.();
   this.cancelConnect=()=>{clearTimeout(timeout);fail('连接已取消。');};
   const current=()=>generation===this.generation;
   socket.addEventListener('open',()=>{if(current())socket.send(JSON.stringify({type:'hello',protocol:ROOM_PROTOCOL,token}));});
   socket.addEventListener('message',event=>{
    if(!current())return;
    let message;try{if(typeof event.data!=='string'||event.data.length>ROOM_MAX_MESSAGE_BYTES)throw new Error();message=JSON.parse(event.data);}catch{this.emit('error',{message:'收到无效房间数据。'});return;}
    if(message?.type==='welcome'){
     if(settled||message.protocol!==ROOM_PROTOCOL||!identifier(message.playerId)){fail('房间版本不兼容，请更新游戏与房主服务。');this.close('房间版本不兼容。');return;}
     // Only the authenticated server announces the public invitation origin.
     // Keep the socket on the page's own origin; never follow an invitation
     // override supplied in a fragment, query, or later room message.
     let shareOrigin=address.url;
     if(message.publicOrigin!==undefined){
      try{const link=new URL(message.publicOrigin);if(typeof message.publicOrigin!=='string'||link.protocol!=='https:'||link.origin!==message.publicOrigin)throw Error();shareOrigin=link.origin;}
      catch{fail('房间邀请地址无效，请重启房主服务。');this.close('房间邀请地址无效。');return;}
     }
     this.shareOrigin=shareOrigin;
     settled=true;clearTimeout(timeout);this.cancelConnect=null;this.playerId=message.playerId;this.connected=true;
     this.heartbeat=setInterval(()=>{if(current()&&this.connected)this.send('ping',{at:this.now()});},this.heartbeatInterval);this.heartbeat.unref?.();
     this.emit('status',{state:'connected',text:'已连接房主电脑。'});this.emit('welcome',{playerId:this.playerId});resolve(this);return;
    }
    if(!this.connected){if(message?.type==='error'){fail(typeof message.message==='string'?message.message:'邀请已失效或连接被拒绝。');this.close('连接被拒绝。');}return;}
    this.receive(message);
   });
   socket.addEventListener('error',()=>{if(current()){fail('无法连接房主。请重新打开房主本次提供的完整邀请，并确认网络正常、房主服务窗口与游戏页仍在运行。');this.emit('error',{message:'房间连接发生错误。'});this.close('连接失败，请检查本次完整邀请、网络与房主服务。');}});
   socket.addEventListener('close',event=>{clearTimeout(timeout);if(!current())return;const reason=event.code===4001?'邀请密钥不正确或已失效，请重新获取房主的邀请链接。':event.code===4008?'连接过慢或消息过多，已断开房间。':'已与房主断开连接，当前联机对局已停止。';fail(reason);this.cancelConnect=null;this.reset();this.emit('closed',{reason});});
  });
 }
 receive(message){
  if(!object(message)||typeof message.type!=='string')return;
  if(message.type==='room'){
   const room=roomFromMessage(message.room);if(!room||!room.players.some(p=>p.id===this.playerId))return;
   if(this.room?.runId!==room.runId){this.incoming.clear();this.outgoing.clear();}
   this.room=room;this.emit('room',room);return;
  }
  if(['snapshot','event','input','choice'].includes(message.type)){
   if(!this.room||message.runId!==this.room.runId||!Number.isSafeInteger(message.seq)||message.seq<0)return;
   const from=message.playerId||this.room.hostId,key=message.type+':'+from;
   if(message.seq<=(this.incoming.get(key)??-1))return;
   if(['input','choice'].includes(message.type)&&(!this.isHost||!this.room.players.some(p=>p.id===message.playerId)))return;
   const data=message.type==='input'?message.input:message.type==='choice'?message.choice:message.data;
   if(!boundedRoomData(data))return;
   this.incoming.set(key,message.seq);this.emit(message.type,{runId:message.runId,seq:message.seq,...(message.playerId?{playerId:message.playerId}:{}),[message.type==='input'?'input':message.type==='choice'?'choice':'data']:data});return;
  }
  if(message.type==='pong'&&Number.isFinite(message.at)){this.latency=Math.max(0,Math.round(this.now()-message.at));this.emit('latency',this.latency);return;}
  if(message.type==='error'){this.emit('error',{message:roomErrors[message.code]||(typeof message.message==='string'?message.message.slice(0,512):'房间操作失败。'),code:typeof message.code==='string'?message.code:''});return;}
  if(message.type==='closed'){const reason=roomClosures[message.reason]||(typeof message.reason==='string'?message.reason.slice(0,512):'房主已离开，房间结束。');this.close(reason);return;}
  if(message.type==='player-left'&&identifier(message.playerId))this.emit('player-left',{playerId:message.playerId});
 }
 send(type,payload={}){if(!this.connected||this.socket?.readyState!==1)return false;this.socket.send(JSON.stringify({type,...payload}));return true;}
 sequence(type){const next=(this.outgoing.get(type)||0)+1;this.outgoing.set(type,next);return next;}
 create(selection){return this.send('create',selection);}
 join(selection){return this.send('join',selection);}
 select(heroId,weaponIndex){return this.send('select',{heroId,weaponIndex});}
 setReady(ready){return this.send('ready',{ready:!!ready});}
 setMap(mapId){return this.send('map',{mapId});}
 start(){return this.send('start');}
 loaded(runId=this.room?.runId){return this.send('loaded',{runId});}
 sendInput(input){const normalized=normalizeRoomInput({moveX:0,moveZ:0,aimYaw:0,aimPitch:0,attack:false,dodge:false,jump:false,crouch:false,autoAim:false,...input});return!!this.room&&!this.isHost&&!!normalized&&this.send('input',{runId:this.room.runId,seq:this.sequence('input'),input:normalized});}
 sendChoice(choice){return!!this.room&&this.send('choice',{runId:this.room.runId,seq:this.sequence('choice'),choice});}
 sendSnapshot(data){return this.isHost&&this.send('snapshot',{runId:this.room.runId,seq:this.sequence('snapshot'),data});}
 sendEvent(data,to){return this.isHost&&this.send('event',{runId:this.room.runId,seq:this.sequence('event'),data,...(to?{to}:{})});}
 finish(){return this.isHost&&this.send('finish',{runId:this.room.runId});}
 suspend(paused,reason='host-menu'){return this.isHost&&this.send('suspend',{runId:this.room.runId,paused:!!paused,reason});}
 inviteURL(){return this.connected&&this.url&&this.token?roomInvitation(this.shareOrigin||this.url,this.token,this.room?.code):'';}
 leave(){this.send('leave');this.close('已离开私人房间。');}
 reset(){clearInterval(this.heartbeat);this.heartbeat=null;this.room=null;this.playerId=null;this.connected=false;this.shareOrigin='';this.latency=null;this.outgoing.clear();this.incoming.clear();}
 close(reason='已断开房间连接。',notify=true){const hadConnection=!!this.socket;this.cancelConnect?.();this.cancelConnect=null;this.generation++;const socket=this.socket;this.socket=null;this.reset();try{socket?.close(1000);}catch{}if(notify&&hadConnection)this.emit('closed',{reason});}
 destroy(){this.close('',false);this.listeners.clear();this.token='';}
}
