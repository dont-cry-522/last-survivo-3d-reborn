import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio} from '../audio.js';
import {runtimeImport} from './runtime-import.js';
const {creatureSample,creatureFoleySample,CREATURE_FOLEY,ENEMY_VOICES}=await runtimeImport('audio.js','enemy-audio.js');
const events=['step','wind','attack','impact','hurt','death'];

function fixture(style='standard',recorded=true){
 const buffers=[],sources=[],node=()=>({connect(){},disconnect(){}}),rate=22050;
 const ctx={currentTime:1,state:'running',sampleRate:rate,
  createBuffer(channels,length,sampleRate){const pcm=new Float32Array(length),buffer={sampleRate,duration:length/sampleRate,getChannelData:()=>pcm,copyToChannel:samples=>pcm.set(samples)};buffers.push(buffer);return buffer;},
  createGain:()=>({...node(),gain:{value:0}}),createStereoPanner:()=>({...node(),pan:{value:0}}),
  createBufferSource(){const source={...node(),playbackRate:{value:1},start(...args){this.args=args;},stop(){this.onended?.();}};sources.push(source);return source;}
 };
 const audio=new GameAudio(ctx);audio.ready=true;audio.sfx=node();audio.weaponTone=node();audio.sfxStyle=style;
 const pcm=Float32Array.from({length:rate},(_,i)=>Math.sin(i*.07)*.1),atlas={sampleRate:rate,duration:1,getChannelData:()=>pcm};
 const cue=take=>({buffer:atlas,offset:take?.4:.05,duration:.22,gain:.8});
 audio.materialEffects={buffer:recorded?atlas:null,error:recorded?null:Error('offline'),count:key=>['material:wood:impact','material:stone:impact'].includes(key)?2:0,
  get(key,take=0){return this.buffer&&['material:wood:impact','material:stone:impact'].includes(key)?cue(take%2):null;}};
 return {audio,ctx,buffers,sources,cue,end(){audio.stopCreatures();audio.stopWeapons();ctx.currentTime+=1;}};
}

test('map encounter preparation preserves audio identity and never plays or advances combat sound state',async()=>{
 for(const style of ['standard','legacy'])for(const recorded of [false,true]){
  const f=fixture(style,recorded),{audio}=f,roster=['wolf','golem','shaman'];let yields=0;
  audio.cooldowns.set('existing',9);audio.weaponTakes.set('existing',1);audio.muted=true;f.ctx.state='suspended';
  await audio.prepareEncounters([...roster,'wolf'],{yieldWork:async()=>{yields++;}});
  assert.equal(f.sources.length,0);assert.equal(audio.nodes,0);assert.equal(audio.creatureSources.size,0);
  assert.deepEqual([...audio.cooldowns],[['existing',9]]);assert.deepEqual([...audio.weaponTakes],[['existing',1]]);
  assert.equal(yields,f.buffers.length);const allocated=f.buffers.length;
  await audio.prepareEncounters(roster,{yieldWork:async()=>assert.fail('resident audio must not allocate or yield')});
  audio.muted=false;f.ctx.state='running';
  for(const kind of roster)for(const event of events)for(let take=0;take<2;take++){
   assert(audio.creature(kind,event));const last=f.sources.at(-1),material=['impact','hurt'].includes(event)?audio.materialCue('material:'+ENEMY_VOICES[kind].texture+':impact',take):null;
   if(style==='standard'&&!CREATURE_FOLEY[kind]&&material){
    assert.equal(last.buffer,material.buffer);assert.deepEqual(last.args,[0,material.offset,material.duration]);
   }else{
    const expected=style==='standard'&&CREATURE_FOLEY[kind]?creatureFoleySample(kind,event,f.ctx.sampleRate,take,material):creatureSample(kind,event,f.ctx.sampleRate);
    assert.deepEqual(last.buffer.getChannelData(0),expected,kind+'/'+event+' changed');
   }
   f.end();
  }
  for(const kind of roster){assert(audio.contact('crossbow',kind));f.end();}
  audio.terrain('wood');f.end();audio.terrain('stone');f.end();
  assert.equal(f.buffers.length,allocated,'first real encounter generated audio');
  audio.reset('forest');assert.equal(audio.nodes,0);assert.equal(audio.creatureSources.size,0);assert.equal(audio.weaponSources.size,0);
  await audio.prepareEncounters(roster,{yieldWork:async()=>assert.fail('restart discarded prepared audio')});
 }
});

test('preparation waits for recordings and can resume after interruption without retaining duplicate buffers',async()=>{
 const f=fixture(),{audio}=f,atlas=audio.materialEffects.buffer;let resolve;
 audio.materialEffects.buffer=null;audio.materialEffects.prepare=async()=>{audio.materialEffects.buffer=await new Promise(done=>{resolve=done;});};
 const preparing=audio.prepareEncounters(['golem'],{yieldWork:async()=>{throw Error('interrupted');}});
 await Promise.resolve();assert.equal(f.buffers.length,0);resolve(atlas);await assert.rejects(preparing,/interrupted/);
 const first=f.buffers[0];assert.equal(f.buffers.length,1);
 await audio.prepareEncounters(['golem'],{yieldWork:async()=>{}});
 assert.equal([...audio.creatureBuffers.values()][0],first);assert.equal(f.sources.length,0);
 const count=f.buffers.length;await audio.prepareEncounters(['golem'],{yieldWork:async()=>assert.fail('unnecessary yield')});assert.equal(f.buffers.length,count);
 assert.equal(await new GameAudio().prepareEncounters(['wolf']),false);
});

test('encounter preparation is limited to the supplied roster and adds only distinct target surfaces',async()=>{
 const {audio}=fixture('legacy',false),progress=[];
 await audio.prepareEncounters(['mushroom','wolf','mushroom'],{yieldWork:async()=>{},report:(done,total)=>progress.push([done,total])});
 assert.equal(audio.creatureBuffers.size,12);assert([...audio.creatureBuffers.keys()].every(key=>/^(mushroom|wolf):/.test(key)));
 assert.deepEqual([...audio.weaponBuffers.keys()].sort(),['material:stone:impact:0:0','material:wood:impact:0:0','surface:flesh:impact:0:0','surface:fur:impact:0:0']);
 assert.deepEqual(progress.at(-1),[16,16]);
});

test('airborne creatures share voices without losing their distinct contact material',async()=>{
 const f=fixture('legacy',false),{audio}=f;
 await audio.prepareEncounters(['snowtotem','frostwing'],{voiceKinds:['snowtotem','snowtotem'],yieldWork:async()=>{}});
 assert.equal(audio.creatureBuffers.size,6);const count=f.buffers.length;
 assert(audio.contact('crossbow','frostwing'));f.end();assert(audio.creature('snowtotem','wind'));f.end();
 assert.equal(f.buffers.length,count);assert(audio.weaponBuffers.has('surface:flesh:impact:0:0'));assert(audio.weaponBuffers.has('surface:rock:impact:0:0'));
});
