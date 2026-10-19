import{test}from'node:test';
import assert from'node:assert/strict';
import{FramePacer,advanceFrameSimulation}from'../frame-pacing.js';

function playback(refreshHz,targetFps,seconds=10){
 const pacer=new FramePacer(targetFps),frames=[];
 pacer.reset(0);
 for(let i=1;i<=refreshHz*seconds;i++){
  const now=i*1000/refreshHz,dt=pacer.take(now);
  if(dt!==null)frames.push({now,dt});
 }
 return{pacer,frames};
}

test('30/60 Hz pacing follows the target on common and non-divisible refresh rates',()=>{
 for(const refresh of[60,90,120,144,179])for(const target of[30,60]){
  const{frames}=playback(refresh,target,30);
  assert(Math.abs(frames.length-30*target)<=1,`${refresh} Hz / ${target} FPS: ${frames.length}`);
  const elapsed=frames.reduce((total,frame)=>total+frame.dt,0);
  assert(Math.abs(elapsed-frames.at(-1).now/1000)<1e-9,'real time must be counted exactly once');
  assert(elapsed>29.97&&elapsed<=30.000001);
  for(const frame of frames)assert(frame.dt>0&&frame.dt<=1/target+1/refresh+.0001);
 }
});

test('a slow display draws at most once per callback, without inventing game time',()=>{
 const{frames}=playback(20,30);
 assert.equal(frames.length,200);
 assert(Math.abs(frames.reduce((total,frame)=>total+frame.dt,0)-10)<1e-9);
 assert(frames.every(frame=>Math.abs(frame.dt-.05)<1e-9));
});

test('floating-point deadlines and slightly early RAFs do not halve the frame rate',()=>{
 const pacer=new FramePacer(30);pacer.reset(0);let renders=0,total=0;
 for(let i=1;i<=1800;i++){
  const now=i*1000/60-.04,dt=pacer.take(now);
  if(dt!==null){renders++;total+=dt;}
 }
 assert.equal(renders,900);
 assert(Math.abs(total-29.99996)<1e-9);
});

test('changing quality preserves pending time and does not produce duplicate frames',()=>{
 const pacer=new FramePacer(60);pacer.reset(0);
 assert.equal(pacer.take(17),.017);
 assert.equal(pacer.take(25,30),null);
 assert.equal(pacer.take(51),.034);
 assert.equal(pacer.take(51),null);
 assert.equal(pacer.take(60,60),null);
 assert.equal(pacer.take(68),.017);
 assert.equal(pacer.take(68,30),null);
 assert.equal(pacer.take(102),.034);
});

test('a stall advances the deadline once and does not create a catch-up render storm',()=>{
 const pacer=new FramePacer(30);pacer.reset(0);
 assert.equal(pacer.take(1000),1);
 assert.equal(pacer.take(1000),null);
 for(const now of[1001,1005,1010,1020,1030])assert.equal(pacer.take(now),null);
 assert.equal(pacer.take(1034),.034);
 assert.equal(pacer.take(1035),null);
});

test('loading, pause and hidden-tab resets exclude suspended time',()=>{
 const pacer=new FramePacer(60);pacer.reset(0);assert.equal(pacer.take(17),.017);
 for(const resumedAt of[5000,10000,60000]){
  pacer.reset(resumedAt);
  assert.equal(pacer.take(resumedAt),null);
  assert.equal(pacer.take(resumedAt+16),null);
  assert.equal(pacer.take(resumedAt+17),.017);
 }
 pacer.reset();assert.equal(pacer.take(90000),0);assert.equal(pacer.take(90017),.017);
});

test('invalid or backwards timestamps cannot duplicate elapsed time',()=>{
 const pacer=new FramePacer(60);assert.equal(pacer.take(10),0);
 for(const invalid of[NaN,Infinity,undefined])assert.equal(pacer.take(invalid),null);
 assert.equal(pacer.take(27),.017);
 assert.equal(pacer.take(20),0);assert.equal(pacer.take(20),null);
 assert.equal(pacer.take(37),.017);
});

test('jittered callbacks retain actual elapsed time independently of ideal deadlines',()=>{
 const pacer=new FramePacer(30);pacer.reset(0);let elapsed=0,last=0,renders=0;
 for(let i=1;i<=1200;i++){
  const now=i*1000/120+Math.sin(i*.7)*1.2,dt=pacer.take(now);
  if(dt===null)continue;
  assert(Math.abs(dt-(now-last)/1000)<1e-12);
  elapsed+=dt;last=now;renders++;
 }
 assert(renders>=299&&renders<=300);
 assert(Math.abs(elapsed-last/1000)<1e-9);
});

test('paced simulation preserves elapsed time across display rates without increasing combat step size',()=>{
 for(const refresh of[20,30,60,90,120,144,179])for(const target of[30,60]){
  const{frames}=playback(refresh,target);let gameTime=0,effectTime=0;
  for(const{dt}of frames){
   const advanced=advanceFrameSimulation(dt,step=>{assert(step>0&&step<=.04);gameTime+=step;},step=>effectTime+=step,()=>true);
   assert(Math.abs(advanced-dt)<1e-12);
  }
  assert(Math.abs(gameTime-frames.at(-1).now/1000)<1e-9);
  assert(Math.abs(effectTime-gameTime)<1e-9);
 }
});

test('44–50 ms frames use two bounded steps instead of discarding game time',()=>{
 for(const elapsed of[.044,.05]){
  const updates=[],effects=[];
  const advanced=advanceFrameSimulation(elapsed,dt=>updates.push(dt),dt=>effects.push(dt),()=>true);
  assert.equal(updates.length,2);assert.deepEqual(updates,effects);
  assert.equal(advanced,elapsed);assert(updates.every(dt=>dt<=.04));
 }
});

test('an upgrade or death during a substep finishes its effects once and stops further simulation',()=>{
 const calls=[];let playing=true;
 const advanced=advanceFrameSimulation(.1,dt=>{calls.push(['update',dt]);playing=false;},dt=>calls.push(['effects',dt]),()=>playing);
 assert.deepEqual(calls,[['update',.1/3],['effects',.1/3]]);
 assert.equal(advanced,.1/3);
 assert.equal(advanceFrameSimulation(.1,()=>assert.fail('paused update'),()=>assert.fail('paused effects'),()=>false),0);
});

test('invalid or zero elapsed time performs no simulation or effects work',()=>{
 for(const elapsed of[0,-.02,NaN,Infinity,-Infinity,undefined]){
  assert.equal(advanceFrameSimulation(elapsed,()=>assert.fail('invalid update'),()=>assert.fail('invalid effects'),()=>assert.fail('invalid state check')),0);
 }
});

test('very long stalls are bounded to three substeps and do not leave catch-up debt',()=>{
 for(const elapsed of[.12,.5,10,1e9]){
  const updates=[],effects=[];
  const advanced=advanceFrameSimulation(elapsed,dt=>updates.push(dt),dt=>effects.push(dt),()=>true);
  assert.deepEqual(updates,[.04,.04,.04]);assert.deepEqual(effects,updates);
  assert.equal(advanced,.12);
 }
 let updates=0;
 assert.equal(advanceFrameSimulation(.02,()=>updates++,()=>{},()=>true),.02);
 assert.equal(updates,1);
});
