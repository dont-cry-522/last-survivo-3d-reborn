import test from'node:test';
import assert from'node:assert/strict';
import{hostAddressChoices,startPrivateRoom,tailscaleHostAddress,onlineHostAddress}from'../packaging/rooms/start-room.mjs';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{mkdtemp,writeFile,copyFile,rm,chmod}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join,resolve,dirname}from'node:path';

const onlineInterfaces={WiFi:[{address:'192.168.20.2',family:'IPv4'}],Tailscale:[{address:'100.90.80.70',family:'IPv4'}]};
const onlineStatus={BackendState:'Running',Self:{Online:true,TailscaleIPs:['fd7a:115c:a1e0::1','100.90.80.70']}};

test('packaged host suggests only assigned private IPv4, with Tailscale first and explicit localhost test',()=>{
 const fixture={'Public':[ {address:'8.8.8.8',family:'IPv4'} ],'Loopback':[ {address:'127.0.0.1',family:'IPv4',internal:true} ],'Wi-Fi':[ {address:'192.168.20.2',family:'IPv4'}, {address:'fe80::12',family:'IPv6'} ],'Tailscale':[ {address:'100.90.80.70',family:'IPv4'} ],'Duplicate':[ {address:'192.168.20.2',family:'IPv4'} ],'Invalid':[ {address:'0.0.0.0',family:'IPv4'} ]};
 const result=hostAddressChoices(fixture);assert.deepEqual(result.map(item=>item.address),['127.0.0.1','100.90.80.70','192.168.20.2']);assert.equal(result[1].tailscale,true);assert.equal(result[2].tailscale,false);
 assert.deepEqual(hostAddressChoices({}).map(item=>item.address),['127.0.0.1']);
});

test('noninteractive host selection cannot request public or all-interface binding',async()=>{
 await assert.rejects(startPrivateRoom(['--host','0.0.0.0']),/不允许公网/);
 await assert.rejects(startPrivateRoom(['--host','8.8.8.8']),/不允许公网/);
 await assert.rejects(startPrivateRoom(['--host','127.0.0.1','--port','0']),/端口/);
});

test('online host requires CLI-authenticated online state and its IPv4 assigned locally',()=>{
 assert.equal(tailscaleHostAddress(onlineStatus,onlineInterfaces),'100.90.80.70');
 for(const[state,message]of[['NeedsLogin',/本人.*登录/],['NeedsMachineAuth',/管理员.*批准/],['Stopped',/点击连接/],['Starting',/尚未就绪/]]){
  assert.throws(()=>tailscaleHostAddress({...onlineStatus,BackendState:state},onlineInterfaces),message);
 }
 assert.throws(()=>tailscaleHostAddress({...onlineStatus,Self:{...onlineStatus.Self,Online:false}},onlineInterfaces),/尚未在线/);
 for(const ips of[[],['100.90.80.99'],['8.8.8.8'],['127.0.0.1'],[null,123]]){
  assert.throws(()=>tailscaleHostAddress({...onlineStatus,Self:{Online:true,TailscaleIPs:ips}},onlineInterfaces),/不会回退/);
 }
 assert.throws(()=>tailscaleHostAddress(onlineStatus,{WiFi:onlineInterfaces.WiFi}),/不会回退/);
 assert.throws(()=>tailscaleHostAddress(null,onlineInterfaces),/无法读取/);
});

test('online CLI discovery tries installed paths only on not-found and never infers a LAN fallback',async()=>{
 const calls=[];
 const address=await onlineHostAddress({candidates:['missing.exe','installed with spaces.exe'],interfaces:onlineInterfaces,run:async(file,args,options)=>{
  calls.push(file);assert.deepEqual(args,['status','--json']);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.timeout,8000);
  if(file==='missing.exe')throw Object.assign(Error('missing'),{code:'ENOENT'});
  return{stdout:JSON.stringify(onlineStatus)};
 }});
 assert.equal(address,'100.90.80.70');assert.deepEqual(calls,['missing.exe','installed with spaces.exe']);
 await assert.rejects(onlineHostAddress({candidates:['missing.exe'],interfaces:onlineInterfaces,run:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}}),/没有找到已安装的 Tailscale/);
});

test('online CLI errors give setup steps without leaking command output or trying another network',async()=>{
 let calls=0;
 await assert.rejects(onlineHostAddress({candidates:['service.exe','fallback.exe'],interfaces:onlineInterfaces,run:async()=>{calls++;throw Object.assign(Error('private diagnostic'),{code:1,stderr:'private diagnostic'});}}),error=>/后台服务/.test(error.message)&&!error.message.includes('private diagnostic'));
 assert.equal(calls,1);
 await assert.rejects(onlineHostAddress({candidates:['service.exe'],interfaces:onlineInterfaces,run:async()=>({stdout:'not JSON'})}),/状态无法识别/);
 await assert.rejects(onlineHostAddress({candidates:['service.exe'],interfaces:onlineInterfaces,run:async()=>{throw Object.assign(Error('logged out'),{code:1,stdout:JSON.stringify({BackendState:'NeedsLogin'})});}}),/本人.*登录/);
});

test('fake CLI executes a spaced executable path without a shell and parses actual JSON stdout',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'reborn online cli '));
 try{
  const file=join(directory,process.platform==='win32'?'fake tailscale.exe':'fake tailscale');
  const script=join(directory,'fake cli.cjs');
  await copyFile(process.execPath,file);if(process.platform!=='win32')await chmod(file,0o755);
  await writeFile(script,`if(process.argv[2]!=='status'||process.argv[3]!=='--json')process.exit(2);process.stdout.write(${JSON.stringify(JSON.stringify(onlineStatus))});`);
  const run=promisify(execFile);
  assert.equal(await onlineHostAddress({candidates:[file],interfaces:onlineInterfaces,run:(executable,args,options)=>run(executable,[script,...args],options)}),'100.90.80.70');
 }finally{const cleanupPath=resolve(directory);assert.equal(dirname(cleanupPath),resolve(tmpdir()));await rm(cleanupPath,{recursive:true,force:true});}
});
