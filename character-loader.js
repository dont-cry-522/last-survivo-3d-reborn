import {LoadingManager,AnimationClip,MathUtils} from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {CHARACTER_ASSETS as assets} from './character-assets.js?v=230';

const base=new URL('./assets/characters/',import.meta.url);
// A resolved Promise only yields to more microtasks. Give input and rendering
// an actual task boundary between model parses and expensive fitting stages.
export const yieldCharacterWork=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0));
export async function loadCharacterData(onProgress=()=>{},{yieldWork=yieldCharacterWork}={}){
  let cache;
  try{cache=await globalThis.caches?.open('forest3d-reborn-character-assets-v1');}catch{/* Private mode/storage limits must not block play. */}
  const compressed=typeof DecompressionStream==='function',blobs=[],textures=new Map();
  const modelNames=Object.keys(assets.models),total=assets.textures.length+modelNames.length+1;let completed=0;
  async function fetchAsset(file,report=true){
    const url=new URL(file,base).href;let response;
    try{response=await cache?.match(url);}catch{}
    if(!response){response=await fetch(url);if(!response.ok)throw Error('资源下载失败：'+file);try{await cache?.put(url,response.clone());}catch{}}
    const data=await response.arrayBuffer();if(report)onProgress(++completed,total);return data;
  }
  async function unpack(file){const data=await fetchAsset(file);return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
  const manager=new LoadingManager();
  manager.setURLModifier(url=>textures.get(url)||url);const loader=new GLTFLoader(manager);
  try{
    const [data,motionData,textureData,fallbackBuffers]=await Promise.all([
      Promise.all(modelNames.map(n=>compressed?unpack(assets.models[n].file):fetchAsset(n+'.gltf'))),
      compressed?unpack(assets.motion.file):fetchAsset(assets.motionFallback.file),
      Promise.all(assets.textures.map(file=>fetchAsset(file))),
      compressed?null:Promise.all(modelNames.map(n=>fetchAsset(n+'.bin',false)))
    ]);
    assets.textures.forEach((file,i)=>{const blob=URL.createObjectURL(new Blob([textureData[i]],{type:'image/webp'}));blobs.push(blob);textures.set(new URL(file,base).href,blob);});
    if(fallbackBuffers)modelNames.forEach((name,i)=>{const blob=URL.createObjectURL(new Blob([fallbackBuffers[i]]));blobs.push(blob);textures.set(new URL(name+'.bin',base).href,blob);});
    const models=[];
    for(let i=0;i<modelNames.length;i++){await yieldWork();models.push(await loader.parseAsync(data[i],base.href));}
    if(!compressed)onProgress(total,total);
    // Packed clips omit UUIDs; without restoring them, the mixer aliases every
    // full-body action to the first clip (Idle), including Roll and aiming.
    await yieldWork();
    // JSON decoding remains one bounded operation (currently 2.7 MiB). Avoid
    // combining it with all GLTF and AnimationClip work in one microtask chain.
    const sourceClips=JSON.parse(new TextDecoder().decode(motionData)),clips=[];
    await yieldWork();let sliceStart=performance.now();
    for(const json of sourceClips){
      clips.push(AnimationClip.parse({...json,uuid:json.uuid||MathUtils.generateUUID()}));
      if(performance.now()-sliceStart>=7){await yieldWork();sliceStart=performance.now();}
    }
    return{models:Object.fromEntries(modelNames.map((n,i)=>[n,models[i]])),clips};
  }finally{for(const blob of blobs)URL.revokeObjectURL(blob);}
}
