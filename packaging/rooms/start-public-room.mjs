import{spawn}from'node:child_process';
import{mkdtemp,writeFile,rm,stat}from'node:fs/promises';
import{tmpdir}from'node:os';
import{resolve,join,dirname}from'node:path';
import{fileURLToPath}from'node:url';
import{parseArgs}from'node:util';
import{setTimeout as delay}from'node:timers/promises';
import{WebSocket}from'ws';
import{createRoomServer}from'../../scripts/room-server.mjs';
import{ROOM_PROTOCOL}from'../../multiplayer-protocol.js';

// cloudflared writes its announcement in chunks; accept only a complete HTTPS host.
export function quickTunnelUrlReader(){
 let text='';
 return chunk=>{
  text=(text+String(chunk)).slice(-16384);
  for(const match of text.matchAll(/https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.trycloudflare\.com(?=[\s|"'<>])/gi)){
   if(!['api','www'].includes(match[1].toLowerCase()))return`https://${match[1].toLowerCase()}.trycloudflare.com`;
  }
  return null;
 };
}

export function verifyPublicSocket(origin,{token,signal,WebSocketImpl=WebSocket}={}){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();let settled=false;
  const socket=new WebSocketImpl(origin.replace(/^https:/,'wss:')+'/room-socket',{headers:{Origin:origin},handshakeTimeout:6000,maxPayload:8192,perMessageDeflate:false});
  const done=error=>{
   if(settled)return;settled=true;signal?.removeEventListener('abort',onAbort);
   socket.on('error',()=>{});socket.terminate();error?reject(error):resolve();
  };
  const onAbort=()=>done(signal.reason||Error('连接验证已取消。'));
  signal?.addEventListener('abort',onAbort,{once:true});
  socket.once('open',()=>socket.send(JSON.stringify({type:'hello',protocol:ROOM_PROTOCOL,token})));
  socket.once('message',raw=>{
   let message;try{message=JSON.parse(String(raw));}catch{return done(Error('对战连接返回了无法识别的数据。'));}
   done(message.type==='welcome'&&message.protocol===ROOM_PROTOCOL&&typeof message.playerId==='string'?null:Error('公网对战邀请验证失败。'));
  });
  socket.once('error',()=>done(Error('HTTPS 页面可以访问，但公网对战连接尚未接通。')));
  socket.once('close',()=>done(Error('公网对战连接在验证前关闭。')));
 });
}

export async function waitForPublicGame(origin,{token,signal,fetchImpl=fetch,WebSocketImpl=WebSocket,retryMs=1000}={}){
 while(true){
  signal?.throwIfAborted();
  try{
   const response=await fetchImpl(`${origin}/play.html`,{redirect:'manual',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(6000)])});
   const body=response.status===200?await response.text():'';
   if(response.status===200&&body.includes('id="asset-loading"')&&body.includes('main.js')){
    await verifyPublicSocket(origin,{token,signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(6000)]),WebSocketImpl});return;
   }
   if(response.status!==200)await response.body?.cancel();
  }catch{signal?.throwIfAborted();}
  await delay(retryMs,undefined,{signal});
 }
}

/** Only this process's child and its loopback service are stopped on failure/exit. */
export async function startPublicRoom({cloudflaredPath,binary=cloudflaredPath??fileURLToPath(new URL('../../../runtime/cloudflared.exe',import.meta.url)),port=8898,timeoutMs=90000,signal,spawnProcess=spawn,createServer=createRoomServer,checkReady=waitForPublicGame,log=console.log,onDiagnostic=()=>{}}={}){
 binary=resolve(binary);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('端口必须在 1–65535 之间。');
 if(!Number.isFinite(timeoutMs)||timeoutMs<1)throw Error('启动等待时间无效。');
 try{if(!(await stat(binary)).isFile())throw Error();}catch{throw Error('没有找到包内 cloudflared。请完整解压包含 runtime 的异地联机包后再启动。');}
 const controller=new AbortController();let child,service,temp,closing=false,ready=false,closePromise,rejectUrl,diagnostics='';
 let resolveClosed;const closed=new Promise(resolve=>{resolveClosed=resolve;});
 const timeout=setTimeout(()=>controller.abort(Error('建立或验证公网入口超时。请检查电脑网络后重试；没有改用局域网，也没有生成可用邀请。')),timeoutMs);
 const forwardAbort=()=>controller.abort(signal.reason||Error('已取消启动。'));
 signal?.addEventListener('abort',forwardAbort,{once:true});if(signal?.aborted)forwardAbort();
 const onProcessExit=()=>{if(child?.pid&&child.exitCode===null&&child.signalCode===null)child.kill();};
 process.once('exit',onProcessExit);
 const close=()=>{
  if(closePromise)return closePromise;
  closing=true;clearTimeout(timeout);signal?.removeEventListener('abort',forwardAbort);process.off('exit',onProcessExit);
  if(!controller.signal.aborted)controller.abort(Error('房间服务已关闭。'));
  closePromise=(async()=>{
   if(child?.pid&&child.exitCode===null&&child.signalCode===null){
    const stopped=new Promise(resolve=>{const wait=setTimeout(resolve,3000);child.once('close',()=>{clearTimeout(wait);resolve();});});child.kill();
    const force=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1500);
    await stopped;clearTimeout(force);
   }
   try{await service?.close();}
   finally{if(temp){const target=resolve(temp);if(dirname(target)!==resolve(tmpdir())||!target.startsWith(join(resolve(tmpdir()),'reborn-room-tunnel-')))throw Error('临时配置目录不符合清理范围。');await rm(target,{recursive:true,force:true});}}
  })().finally(()=>resolveClosed(controller.signal.reason));
  return closePromise;
 };
 controller.signal.addEventListener('abort',()=>{rejectUrl?.(controller.signal.reason);if(ready&&!closing)void close().catch(()=>log('清理服务时遇到错误，请关闭本窗口后重新启动。'));},{once:true});
 const failed=error=>{if(!closing)controller.abort(error);};
 try{
  controller.signal.throwIfAborted();
  // Bind before exposing the port: a port conflict must never expose another local app.
  service=await createServer({host:'127.0.0.1',port});controller.signal.throwIfAborted();
  temp=await mkdtemp(join(tmpdir(),'reborn-room-tunnel-'));
  const config=join(temp,'empty.yml');await writeFile(config,'{}\n');
  controller.signal.throwIfAborted();
  log('正在建立免费临时 HTTPS 入口。朋友只需浏览器，不需要 VPN、Tailscale 或注册账号。');
  // The tested mobile route intermittently dropped QUIC/UDP streams mid-download.
  const args=['tunnel','--config',config,'--no-autoupdate','--url',service.url,'--metrics','127.0.0.1:0','--protocol','http2'];
  const urlPromise=new Promise((resolve,reject)=>{
   rejectUrl=reject;
   const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('TUNNEL_')));
   child=spawnProcess(binary,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env});
   for(const stream of[child.stdout,child.stderr]){const read=quickTunnelUrlReader();stream?.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-16384);onDiagnostic(String(chunk));const url=read(chunk);if(url)resolve(url);});}
   child.once('error',()=>failed(Error('公网隧道程序未能启动。请确认安装包完整，且系统没有拦截 runtime/cloudflared.exe。')));
   child.once('close',(code)=>failed(Error(`公网隧道已退出${Number.isInteger(code)?`（代码 ${code}）`:''}，游戏服务同时关闭。请检查网络并重新启动，再发送新的邀请。`)));
  });
  const publicOrigin=await urlPromise;controller.signal.throwIfAborted();
  service.setPublicOrigin(publicOrigin);controller.signal.throwIfAborted();
  log('入口已分配，正在检查 HTTPS 游戏页面与 WSS 对战连接……');
  await checkReady(publicOrigin,{token:service.token,signal:controller.signal});controller.signal.throwIfAborted();
  ready=true;clearTimeout(timeout);
  const inviteUrl=service.inviteUrl;
  const hostUrl=`${service.url}/play.html#roomToken=${encodeURIComponent(service.token)}`;
  log('\nHTTPS 入口已验证。房主打开下面的本机专用网址（不要发给朋友）：\n'+hostUrl);
  log('\n房主点“好友房间 → 创建私人房间”，再用游戏里的“复制邀请”发给朋友。朋友直接用手机或电脑浏览器打开，选择人物、加入并准备。');
  log('复制邀请会自动使用已验证的 HTTPS 公网入口；房主的资源和对战同步直接连接本机，避免绕行公网。');
  log('本窗口与房主游戏页保持打开；关闭窗口或按 Ctrl+C 结束。免费测试入口没有稳定性保证，重启后网址变化；不要只发房间码。');
  return{service,child,publicOrigin,inviteUrl,hostUrl,close,closed};
 }catch(error){error.tunnelLog=diagnostics;await close();throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController();const stop=()=>controller.abort(Error('房主结束了本次服务。'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('SIGHUP',stop);
 try{
  const{values}=parseArgs({options:{cloudflared:{type:'string'},port:{type:'string',default:'8898'}}});
  const app=await startPublicRoom({binary:values.cloudflared,port:Number(values.port),signal:controller.signal});
  const reason=await app.closed;
  if(!controller.signal.aborted){console.error('\n'+reason.message);process.exitCode=1;}
 }catch(error){
  console.error('\n启动失败：'+error.message+'\n');
  const detail=error.tunnelLog?.split(/\r?\n/).filter(line=>/\bERR\b|error/i.test(line)).slice(-3).map(line=>line.replace(/https?:\/\/[^\s"']+/g,'[网址]')).join('\n');
  if(detail)console.error('隧道诊断：\n'+detail);
  process.exitCode=controller.signal.aborted?0:1;
 }
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('SIGHUP',stop);}
}
