import{networkInterfaces}from'node:os';
import{createInterface}from'node:readline/promises';
import{parseArgs,promisify}from'node:util';
import{execFile}from'node:child_process';
import{isIPv4}from'node:net';
import{fileURLToPath}from'node:url';
import{resolve,join}from'node:path';
import{createRoomServer,privateBindAddress}from'../../scripts/room-server.mjs';

const runFile=promisify(execFile);
const onlineSetup='首次设置请看根目录 README.md 的“Tailscale 备用方式”：每人用自己的账号登录 Tailscale，房主邀请朋友加入同一个私人网络，不要共享密码。';

export function tailscaleHostAddress(status,interfaces=networkInterfaces()){
 if(!status||typeof status!=='object'||Array.isArray(status))throw Error('无法读取 Tailscale 状态。请更新或重新打开 Tailscale 后再试。');
 const state=status.BackendState;
 if(state==='NeedsLogin')throw Error('Tailscale 尚未登录。请本人打开 Tailscale，点击登录并完成浏览器授权。'+onlineSetup);
 if(state==='NeedsMachineAuth')throw Error('这台电脑尚未获得 Tailscale 设备授权。请私人网络的管理员在 Tailscale 管理页面批准该设备，再重新启动。');
 if(state==='Stopped')throw Error('Tailscale 当前已断开。请打开 Tailscale，点击连接，确认连接的是与朋友相同的私人网络后再试。');
 if(state!=='Running')throw Error('Tailscale 尚未就绪。请确认已登录、已连接，等待几秒后重试。'+onlineSetup);
 if(status.Self?.Online!==true)throw Error('Tailscale 显示这台电脑尚未在线。请检查网络并在 Tailscale 中重新连接；不会改用只能同 Wi-Fi 访问的地址。');
 const assigned=new Set(Object.values(interfaces).flatMap(items=>(items||[]).filter(item=>!item.internal&&['IPv4',4].includes(item.family)).map(item=>item.address)));
 const address=(Array.isArray(status.Self.TailscaleIPs)?status.Self.TailscaleIPs:[]).find(ip=>typeof ip==='string'&&isIPv4(ip)&&privateBindAddress(ip)&&!ip.startsWith('127.')&&assigned.has(ip));
 if(!address)throw Error('Tailscale 尚未给本机网卡分配可用的私人 IPv4 地址。请重新连接 Tailscale 后再试；不会回退到局域网地址。');
 return address;
}

export async function onlineHostAddress({candidates,run=runFile,interfaces=networkInterfaces()}={}){
 candidates??=process.platform==='win32'?[...new Set([process.env.ProgramFiles,process.env.ProgramW6432].filter(Boolean).map(root=>join(root,'Tailscale','tailscale.exe'))),'tailscale.exe']:['tailscale'];
 for(const file of candidates){
  let stdout;
  try{({stdout}=await run(file,['status','--json'],{windowsHide:true,timeout:8000,maxBuffer:2*1024*1024,encoding:'utf8',shell:false}));}
  catch(error){
   if(error.code==='ENOENT')continue;
   // Some CLI versions return status JSON with a nonzero exit code while logged out.
   if(error.stdout?.trim().startsWith('{'))stdout=error.stdout;
   else throw Error('无法连接 Tailscale 后台服务。请先打开 Tailscale；若仍失败，请检查 Windows 的 Tailscale 服务是否运行，再重新启动。不会自动改用局域网。');
  }
  let status;try{status=JSON.parse(stdout);}catch{throw Error('Tailscale 返回的状态无法识别。请更新或重新打开 Tailscale 后再试。');}
  return tailscaleHostAddress(status,interfaces);
 }
 throw Error('没有找到已安装的 Tailscale。请从 https://tailscale.com/download 安装 Windows 版本并由本人登录，再重新双击 START_TAILSCALE_ROOM.cmd。'+onlineSetup);
}

export function hostAddressChoices(interfaces=networkInterfaces()){
 const choices=[],seen=new Set();
 for(const[name,addresses]of Object.entries(interfaces))for(const item of addresses||[]){
  if(item.internal||!['IPv4',4].includes(item.family)||!privateBindAddress(item.address)||seen.has(item.address))continue;
  seen.add(item.address);const parts=item.address.split('.').map(Number),tailscale=parts[0]===100&&parts[1]>=64&&parts[1]<=127;
  choices.push({address:item.address,name,tailscale});
 }
 choices.sort((a,b)=>Number(b.tailscale)-Number(a.tailscale)||a.name.localeCompare(b.name)||a.address.localeCompare(b.address));
 return[{address:'127.0.0.1',name:'仅这台电脑测试，朋友无法加入',tailscale:false},...choices];
}

export async function startPrivateRoom(args=process.argv.slice(2)){
 const{values}=parseArgs({args,options:{host:{type:'string'},port:{type:'string',default:'8898'},online:{type:'boolean',default:false}}});
 const choices=hostAddressChoices();let host=values.host;
 if(values.online){
  console.log('\n异境回响 REBORN · 异地好友联机\n正在检查 Tailscale 登录、在线状态与本机地址……');
  const onlineHost=await onlineHostAddress();
  if(host&&host!==onlineHost)throw Error('异地模式只允许已验证的本机 Tailscale 地址；请去掉 --host 后重试。');
  host=onlineHost;
  console.log('Tailscale 已连接。朋友可使用其他 Wi-Fi 或手机流量，但须先在 Tailscale 中连接同一个私人网络。');
 }else if(host){if(!choices.some(choice=>choice.address===host))throw Error('请选择本机已连接的局域网 / 私人组网地址；不允许公网或全部网卡监听。');}
 else{
  console.log('\n异境回响 REBORN · 好友私人房间\n');
  console.log('最多 4 人。此窗口与房主游戏页必须保持打开。不会自动开放路由器端口或修改防火墙。');
  console.log('同一 Wi-Fi 选择局域网；异地朋友先加入同一个私人组网，再选择对应地址。\n');
  choices.forEach((choice,index)=>console.log(`${index}. ${choice.tailscale?'私人组网（优先）':index?'局域网':'本机测试'} · ${choice.name} · ${choice.address}`));
  const suggested=choices.length>1?1:0;
  if(!process.stdin.isTTY)throw Error('请选择监听地址后启动；非交互模式须显式传入 --host 私人地址。');
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{
   const answer=(await terminal.question(`\n输入序号，回车选择 ${suggested}：`)).trim();
   if(answer&&!/^\d+$/.test(answer))throw Error('请输入上方列表中的序号。');
   const selected=answer?Number(answer):suggested;if(!choices[selected])throw Error('该序号不在列表中。');host=choices[selected].address;
  }finally{terminal.close();}
 }
 const port=Number(values.port);if(!Number.isInteger(port)||port<1||port>65535)throw Error('端口必须在 1–65535 之间。');
 const service=await createRoomServer({host,port});
 console.log('\n服务已启动。房主先复制此完整网址到电脑浏览器：\n');
 console.log(`${service.url}/play.html#roomToken=${encodeURIComponent(service.token)}`);
 console.log('\n进入游戏后点“好友房间”→“创建私人房间”，选择人物与地图，再复制邀请链接给朋友。');
 console.log('朋友从邀请链接进入，选择人物、加入房间并准备；全部准备后由房主开始。');
 console.log('不要只发房间码，完整链接含本次服务的私密钥匙。仅分享给一起玩的朋友。');
 console.log(host==='127.0.0.1'?'\n当前仅本机测试。要让手机或其他电脑加入，请退出并选择局域网 / 私人组网地址。':values.online?'\n若朋友打不开网址，先确认双方 Tailscale 在线且属于同一个私人网络；再检查本机防火墙是否允许这个服务。不要关闭防火墙或设置路由器公网转发。':'\n若 Windows 提示防火墙访问，请只允许当前可信私人网络；不要关闭防火墙。');
 console.log('\n此程序不会自动打开浏览器。关闭窗口或按 Ctrl+C 结束服务，所有人随即断开。');
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;try{await service.close();}finally{process.exitCode=0;}};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 return service;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 startPrivateRoom().catch(error=>{console.error('\n启动失败：'+error.message+'\n');process.exitCode=1;});
}
