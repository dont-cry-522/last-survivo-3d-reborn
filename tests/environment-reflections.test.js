import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import {HDRLoader} from '../vendor/HDRLoader.js';
import {EnvironmentReflections,REFLECTION_ASSETS,REFLECTION_STRENGTH,softenReflectionData,reflectionPixels} from '../environment-reflections.js';

test('local HDRs decode as linear, bounded reflection illumination without another sun',()=>{
 for(const file of Object.values(REFLECTION_ASSETS)){
  const b=fs.readFileSync(new URL('../'+file,import.meta.url)),d=new HDRLoader().setDataType(T.FloatType).parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  assert.equal(d.width,1024);assert.equal(d.height,512);assert.equal(d.type,T.FloatType);
  softenReflectionData(d.data);
  let max=0;for(let i=0;i<d.data.length;i+=4){assert.equal(d.data[i+3],1);for(let c=0;c<3;c++){const v=d.data[i+c];assert(Number.isFinite(v)&&v>=0&&v<=12);max=Math.max(max,v);}}
  assert(max>1,'HDR highlights were flattened to display colour');
 }
});
test('biome reflection strengths, day-night and world rotation stay finite and preserve background',()=>{
 const scene=new T.Scene(),bg=scene.background=new T.Color('blue'),r=new EnvironmentReflections({},scene);
 const forest={texture:new T.Texture(),dispose(){}},sky={texture:new T.Texture(),dispose(){}};r.maps={forest,sky};
 for(const id of Object.keys(REFLECTION_STRENGTH)){
  r.update(id,null,1,0);r.update(id,null,1,0);assert.equal(scene.environmentIntensity,REFLECTION_STRENGTH[id]);assert.equal(scene.background,bg);assert.equal(scene.environment,id==='forest'?forest.texture:sky.texture);
 }
 r.update('forest',null,0,0);r.update('forest',null,0,0);assert.equal(scene.environmentIntensity,REFLECTION_STRENGTH.forest*.22);
 r.update('confluence',{forest:.6,snow:.4},1,0);assert.equal(scene.environmentIntensity,.6*.30+.4*.36);
});
test('reflection swaps fade out, world changes keep shared maps, and owned targets dispose only once',()=>{
 const scene=new T.Scene(),r=new EnvironmentReflections({},scene);let freed=0;
 r.maps={forest:{texture:new T.Texture(),dispose(){freed++;}},sky:{texture:new T.Texture(),dispose(){freed++;}}};
 r.update('forest',null,1,0);r.update('snow',null,1,.05);assert.equal(scene.environment,r.maps.forest.texture);assert(scene.environmentIntensity<.36);
 for(let i=0;i<10;i++)r.update('snow',null,1,.05);assert.equal(scene.environment,r.maps.sky.texture);assert.equal(scene.environmentIntensity,.36);
 r.dispose();r.dispose();assert.equal(freed,2);assert.equal(scene.environment,null);r.update('forest',null,1,.1);assert.equal(scene.environment,null);
});

test('mobile reflection filtering quarters pixels and retains linear colour and alpha',()=>{
 const data=new Float32Array(1024*512*4);for(let i=0;i<data.length;i+=4)data.set([2,.5,.25,1],i);
 const image={data,width:1024,height:512},small=reflectionPixels(image,true);assert.equal(reflectionPixels(image,false),image);assert.equal(small.width,512);assert.equal(small.height,256);assert.deepEqual([...small.data.slice(0,4)],[2,.5,.25,1]);assert.equal(small.data.length,data.length/4);assert.equal(image.width,1024);
});
