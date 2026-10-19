import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadCharacterData} from '../character-loader.js';
import {CHARACTER_ASSETS} from '../character-assets.js';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import * as T from '../vendor/three.module.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fingerprint(data){
 const models={};for(const [name,gltf]of Object.entries(data.models)){
  const parts=[];gltf.scene.traverse(o=>parts.push([o.name,o.type,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray(),o.geometry&&Object.entries(o.geometry.attributes).map(([k,v])=>[k,v.itemSize,Array.from(v.array)]),o.geometry?.index&&Array.from(o.geometry.index.array),o.skeleton?.bones.map(b=>b.name)]));models[name]=hash(parts);
 }
 return{models,clips:hash(data.clips.map(c=>[c.name,c.duration,c.blendMode,c.tracks.map(t=>[t.name,t.ValueTypeName,Array.from(t.times),Array.from(t.values)])]))};
}
async function withPlatform(run){
 const keys=['fetch','self','ProgressEvent','createImageBitmap','DecompressionStream','caches'],saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const parse=GLTFLoader.prototype.parseAsync,clipParse=T.AnimationClip.parse,create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 const state={fetches:[],activeFetch:0,maxFetch:0,activeParse:0,maxParse:0,parses:0,created:[],revoked:[],cacheHits:0,cacheWrites:0},cache=new Map();
 globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
 globalThis.caches={async open(name){assert.equal(name,'forest3d-reborn-character-assets-v1');return{async match(url){const hit=cache.get(url);if(hit)state.cacheHits++;return hit?.clone();},async put(url,response){state.cacheWrites++;cache.set(url,response);}};}};
 globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;if(!url.startsWith('file:'))return saved.fetch(input);state.fetches.push(url);state.maxFetch=Math.max(state.maxFetch,++state.activeFetch);await new Promise(resolve=>setImmediate(resolve));state.activeFetch--;return new Response(fs.readFileSync(fileURLToPath(url)));};
 GLTFLoader.prototype.parseAsync=async function(...args){state.maxParse=Math.max(state.maxParse,++state.activeParse);state.parses++;try{return await parse.apply(this,args);}finally{state.activeParse--;}};
 URL.createObjectURL=blob=>{const url=create(blob);state.created.push(url);return url;};URL.revokeObjectURL=url=>{state.revoked.push(url);revoke(url);};
 try{return await run(state);}finally{GLTFLoader.prototype.parseAsync=parse;T.AnimationClip.parse=clipParse;URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const [k,v]of Object.entries(saved))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
}

test('packed models download in parallel, parse one at a time, retain unique clips and release all blob URLs',()=>withPlatform(async state=>{
 let yields=0;const progress=[];
 const data=await loadCharacterData((n,total)=>progress.push([n,total]),{yieldWork:async()=>{yields++;await new Promise(resolve=>setImmediate(resolve));}});
 assert(state.maxFetch>9);assert.equal(state.maxParse,1);assert.equal(state.parses,9);assert(yields>=11);
 assert.deepEqual(Object.keys(data.models),Object.keys(CHARACTER_ASSETS.models));assert.equal(data.clips.length,12);assert.equal(new Set(data.clips.map(c=>c.uuid)).size,12);assert(data.clips.every(c=>typeof c.uuid==='string'&&c.uuid.length===36));
 assert.deepEqual(progress.map(p=>p[0]),Array.from({length:34},(_,i)=>i+1));assert(progress.every(p=>p[1]===34));assert.deepEqual(state.revoked,state.created);
 const before=fingerprint(data),requests=state.fetches.length;const cached=await loadCharacterData(()=>{},{yieldWork:async()=>{}});assert.equal(state.fetches.length,requests);assert.equal(state.cacheHits,34);assert.deepEqual(fingerprint(cached),before);
 globalThis.DecompressionStream=undefined;const fallback=await loadCharacterData(()=>{},{yieldWork:async()=>{}});assert.deepEqual(fingerprint(fallback),before,'uncompressed fallback changed model buffers, bones or animation tracks');assert.equal(state.maxParse,1);assert.deepEqual(state.revoked,state.created);
}));

test('model parsing waits for the loading task boundary and failed parsing still revokes prepared URLs',()=>withPlatform(async state=>{
 let resume,arrived;const gate=new Promise(resolve=>{resume=resolve;}),reached=new Promise(resolve=>{arrived=resolve;});let first=true;
 const pending=loadCharacterData(()=>{},{yieldWork:async()=>{if(first){first=false;arrived();await gate;}}});
 await reached;assert.equal(state.parses,0);resume();await pending;assert.equal(state.parses,9);
 GLTFLoader.prototype.parseAsync=async()=>{throw Error('test parse failure');};await assert.rejects(loadCharacterData(()=>{},{yieldWork:async()=>{}}),/test parse failure/);assert.deepEqual(state.revoked,state.created);
}));

test('clip preparation yields after its CPU budget without changing source UUID assignment',()=>withPlatform(async()=>{
 const original=T.AnimationClip.parse;let calls=0,yields=0,clipYields=0;
 T.AnimationClip.parse=function(json){calls++;assert(json.uuid);const start=performance.now();while(performance.now()-start<2){}return original.call(this,json);};
 const data=await loadCharacterData(()=>{},{yieldWork:async()=>{yields++;if(calls)clipYields++;}});
 assert.equal(calls,12);assert(clipYields>=2);assert(yields>=13);assert.equal(new Set(data.clips.map(c=>c.uuid)).size,12);
}));
