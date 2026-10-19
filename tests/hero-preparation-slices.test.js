import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadHeroAssets,heroesReady,createSkinnedHero,disposeHero} from '../skinned-hero.js';
test('incremental hero preparation stays private until complete and concurrent callers share the same work',async()=>{
 const saved=Object.fromEntries(['fetch','self','ProgressEvent','createImageBitmap'].map(k=>[k,globalThis[k]])),requests=[];
 globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
 globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;if(!url.startsWith('file:'))return saved.fetch(input);requests.push(url);return new Response(fs.readFileSync(fileURLToPath(url)));};
 let resume,reached,yields=0;const gate=new Promise(resolve=>{resume=resolve;}),arrived=new Promise(resolve=>{reached=resolve;});
 try{
  const first=loadHeroAssets(()=>{},{yieldWork:async()=>{assert.equal(heroesReady(),false);yields++;if(yields===1){reached();await gate;}else await new Promise(resolve=>setImmediate(resolve));}});
  await arrived;const second=loadHeroAssets();assert.equal(heroesReady(),false);resume();await Promise.all([first,second]);assert(heroesReady());assert(yields>=50);
  const packed=requests.filter(url=>/\.glb\.gz$/.test(url));assert.equal(packed.length,9);assert.equal(new Set(packed).size,9);
  const before=requests.length;await loadHeroAssets(()=>{},{yieldWork:async()=>assert.fail('ready templates rebuilt')});assert.equal(requests.length,before);
  for(const [kind,weapon]of [['scout','rifle'],['silver','crossbow'],['wraith','shade'],['tide','harpoon'],['lingya','slingshot'],['wuling','sporelamp'],['mirage','miasmalamp']]){
   const hero=createSkinnedHero(kind,weapon);assert(hero.userData.skinned,kind+' not using loaded rig');assert(hero.userData.mixer);disposeHero(hero);
  }
 }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});
