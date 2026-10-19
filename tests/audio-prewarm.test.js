import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio} from '../audio.js';
import {WEAPONS} from '../rules.js';
import {runtimeImport} from './runtime-import.js';

const {weaponSample,weaponTakeCount}=await runtimeImport('audio.js','weapon-audio.js');
function fixture(){
 const buffers=[],sources=[],node=()=>({connect(){},disconnect(){}});
 const ctx={currentTime:3,state:'running',sampleRate:22050,
  createBuffer(channels,length,rate){const data=new Float32Array(length),buffer={duration:length/rate,copyToChannel(samples){data.set(samples);},getChannelData:()=>data};buffers.push(buffer);return buffer;},
  createGain:()=>({...node(),gain:{value:0}}),createStereoPanner:()=>({...node(),pan:{value:0}}),
  createBufferSource(){const source={...node(),playbackRate:{value:1},start(...args){this.args=args;},stop(){this.onended?.();}};sources.push(source);return source;}
 };
 const audio=new GameAudio(ctx);audio.ready=true;audio.sfx=node();audio.weaponTone=node();audio.sfxStyle='legacy';
 return{audio,ctx,buffers,sources};
}

test('loading prepares every playable weapon take and combat variant without playing or changing timing',async()=>{
 for(const id of Object.keys(WEAPONS)){
  const f=fixture(),{audio}=f,reports=[];let yields=0;
  audio.weaponTakes.set('existing:shot:0',2);audio.cooldowns.set('shot',5);audio.muted=true;f.ctx.state='suspended';
  await audio.prepareWeapon(id,{yieldWork:async()=>{yields++;},report:(done,total)=>reports.push([done,total])});
  assert.equal(f.sources.length,0);assert.equal(audio.nodes,0);assert.equal(audio.weaponSources.size,0);
  assert.deepEqual([...audio.weaponTakes],[['existing:shot:0',2]]);assert.deepEqual([...audio.cooldowns],[['shot',5]]);
  assert.equal(yields,f.buffers.length);assert.equal(reports.at(-1)[0],reports.at(-1)[1]);
  const allocated=f.buffers.length;
  await audio.prepareWeapon(id,{yieldWork:async()=>assert.fail('resident buffers must not yield again')});
  assert.equal(f.buffers.length,allocated);
  audio.muted=false;f.ctx.state='running';
  const melee=['harpoon','shadowblade'].includes(id),herbal=['mycelialwhip','venomfan'].includes(id);
  const events={shot:melee?[0,1,2]:herbal?[0,1]:[0],impact:melee?[0,1,2]:[0,1],mechanism:['crossbow','shotgun'].includes(id)?[0,1]:[0]};
  if(id==='miasmalantern')events.charge=[0];
  if(id==='sporelantern')Object.assign(events,{move:[0],burst:[0],shield:[0]});
  for(const [event,variants]of Object.entries(events))for(const variant of variants)for(let take=0;take<weaponTakeCount(id);take++){
   const expected=weaponSample(id,event,f.ctx.sampleRate,variant,take);
   assert.equal(audio.weapon(id,event,variant),!!expected,id+' '+event+' '+variant);
   if(expected){assert.deepEqual(f.sources.at(-1).buffer.getChannelData(0),expected,'prepared sound changed');audio.stopWeapons();}
  }
  assert.equal(f.buffers.length,allocated,id+' allocated a sound buffer during combat');
 }
});

test('preparation awaits the existing recording load, preserves recorded playback, and keeps the slingshot synthesis',async()=>{
 const f=fixture(),{audio}=f,atlas={duration:3};let release,prepares=0;
 const pending=new Promise(resolve=>{release=resolve;});audio.sfxStyle='standard';
 audio.materialEffects={buffer:null,count:()=>2,get(){return this.buffer?{buffer:this.buffer,offset:.2,duration:.15,gain:.8}:null;},
  async prepare(){prepares++;this.buffer=await pending;return this.buffer;}};
 let finished=false;const preparing=audio.prepareWeapon('crossbow',{yieldWork:async()=>{}}).then(()=>{finished=true;});
 await Promise.resolve();assert.equal(finished,false);assert.equal(f.buffers.length,0);release(atlas);await preparing;
 assert.equal(prepares,1);assert.equal(f.buffers.length,0);assert.equal(f.sources.length,0);
 assert(audio.weapon('crossbow','shot'));assert.equal(f.sources.at(-1).buffer,atlas);assert.deepEqual(f.sources.at(-1).args,[0,.2,.15]);audio.stopWeapons();
 await audio.prepareWeapon('boomerang',{yieldWork:async()=>{}});const allocated=f.buffers.length;assert(allocated>0);
 assert(audio.weapon('boomerang','shot'));assert.notEqual(f.sources.at(-1).buffer,atlas);assert.equal(f.buffers.length,allocated);audio.stopWeapons();
});

test('unavailable audio stays optional and interrupted offline preparation reuses completed buffers',async()=>{
 assert.equal(await new GameAudio().prepareWeapon('rifle'),false);
 const f=fixture(),{audio}=f;audio.sfxStyle='standard';let loads=0;
 audio.materialEffects={buffer:null,count:()=>0,get:()=>null,async prepare(){loads++;this.error=Error('offline');return null;}};
 await assert.rejects(audio.prepareWeapon('crossbow',{yieldWork:async()=>{throw Error('interrupted');}}),/interrupted/);
 assert.equal(f.buffers.length,1);const first=f.buffers[0];
 await audio.prepareWeapon('crossbow',{yieldWork:async()=>{}});assert.equal(loads,1);assert.equal(audio.weaponBuffers.get('crossbow:shot:0:0'),first);
 const allocated=f.buffers.length;assert(audio.weapon('crossbow','shot'));assert.equal(f.sources.at(-1).buffer,first);assert.equal(f.buffers.length,allocated);audio.stopWeapons();
 audio.sfxStyle='legacy';audio.materialEffects.prepare=()=>assert.fail('legacy audio must not load recordings');
 await audio.prepareWeapon('fire',{yieldWork:async()=>{}});
});
