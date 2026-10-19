import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {prepareProgramInterfaces,warmScene} from '../render-prewarm.js';

// Exercise the actual bundled lazy diagnostics/reflection methods. The GL
// boundary is stubbed; this is not a GPU or driver timing test.
const vendor=readFileSync(new URL('../vendor/three.module.js',import.meta.url),'utf8');
const start=vendor.indexOf('function onFirstUse( self )'),end=vendor.indexOf('// indicate when the program is ready',start);
assert(start>=0&&end>start,'bundled Three.js lazy program implementation changed');
function fixture({linked=true,checkShaderErrors=true,throwDiagnostics=false}={}){
 const events=[],debug={checkShaderErrors,onShaderError(){events.push('shader error');if(throwDiagnostics)throw Error('original shader error');}};
 const gl={LINK_STATUS:1,getProgramInfoLog(){events.push('program log');return linked?'':'link failed';},getShaderInfoLog(){events.push('shader log');return '';},getProgramParameter(){return linked;},deleteShader(){events.push('delete shader');}};
 const create=vm.runInNewContext(`(function(renderer,gl){
  const program={},glVertexShader={},glFragmentShader={},prefixVertex='',prefixFragment='';
  ${vendor.slice(start,end)}
  this.name='test program';return this;
 })`,{WebGLUniforms:class{constructor(){events.push('uniforms');}},fetchAttributeLocations(){events.push('attributes');return{position:{location:0}};}});
 const program=new create({debug},gl);program.isReady=()=>true;
 return{program,events,debug};
}

test('loading performs actual Three.js first-use diagnostics and reflection once without changing debug policy',async()=>{
 for(const checkShaderErrors of [true,false]){
  const f=fixture({checkShaderErrors}),renderer={info:{programs:[f.program]},debug:f.debug},debug={...f.debug};
  await prepareProgramInterfaces(renderer,async()=>{});
  assert.equal(f.events.filter(e=>e==='program log').length,checkShaderErrors?1:0);
  assert.equal(f.events.filter(e=>e==='uniforms').length,1);assert.equal(f.events.filter(e=>e==='attributes').length,1);
  const events=[...f.events];f.program.getUniforms();f.program.getAttributes();await prepareProgramInterfaces(renderer,async()=>assert.fail('already prepared'));
  assert.deepEqual(f.events,events);assert.deepEqual(f.debug,debug);
 }
});

test('reflection waits for asynchronous linkage, yields within its budget and never repeats resident programs',async context=>{
 let clock=0,reflected=0;context.mock.method(performance,'now',()=>clock);
 const programs=Array.from({length:5},()=>({isReady:()=>true,getUniforms(){clock+=3;reflected++;},getAttributes(){}}));
 let ready=false;programs[0].isReady=()=>ready;const yields=[];
 await prepareProgramInterfaces({info:{programs}},async()=>{yields.push(reflected);ready=true;});
 assert.deepEqual(yields,[0,3]);assert.equal(reflected,5);
 await prepareProgramInterfaces({info:{programs}},async()=>assert.fail('resident reflection yielded'));
 assert.equal(reflected,5);
 const additional={getUniforms(){reflected++;},getAttributes(){}};programs.push(additional);
 await prepareProgramInterfaces({info:{programs}},async()=>{});assert.equal(reflected,6);
 const fast=Array.from({length:35},()=>({getUniforms(){},getAttributes(){}}));let batches=0;
 await prepareProgramInterfaces({info:{programs:fast}},async()=>batches++);assert.equal(batches,2);
});

test('warmup reflects programs compiled outside the visible view and ones added by the real draw',async()=>{
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),events=[],programs=[];camera.layers.set(5);
 const program=name=>({getUniforms(){events.push(name+':uniforms');},getAttributes(){events.push(name+':attributes');}});
 const renderer={info:{programs},initTexture(){},async compileAsync(){programs.push(program('compiled'));}};
 await warmScene({scene,camera,renderer,passes:1,yieldWork:async()=>{assert.equal(camera.layers.mask,32);},render(){
  assert.deepEqual(events,['compiled:uniforms','compiled:attributes']);programs.push(program('shadow'));events.push('draw');
 }});
 assert.deepEqual(events,['compiled:uniforms','compiled:attributes','draw','shadow:uniforms','shadow:attributes']);
 assert.equal(camera.layers.mask,32);
});

test('link diagnostics and reflection failures abort preparation, preserve original errors and remain retryable',async()=>{
 for(const stage of ['uniforms','attributes','diagnostics','invalid','yield']){
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(),error=Error(stage),reports=[];camera.layers.set(6);let failed=true,uniformCalls=0,compiled=false;
  const program={isReady:()=>stage!=='yield'||!failed,getUniforms(){uniformCalls++;if(failed&&stage==='uniforms')throw error;},getAttributes(){if(failed&&stage==='attributes')throw error;}};
  if(stage==='diagnostics')program.diagnostics={runnable:false};
  if(stage==='invalid')program.getAttributes=null;
  const renderer={info:{programs:[program]},initTexture(){},async compileAsync(){compiled=true;}};
  const run=()=>warmScene({scene,camera,renderer,passes:1,report:(...args)=>reports.push(args),yieldWork:async()=>{if(stage==='yield'&&failed&&compiled)throw error;},render(){if(failed)assert.fail('cannot draw after reflection failure');}});
  await assert.rejects(run(),e=>stage==='diagnostics'?/Shader preparation failed/.test(e.message):stage==='invalid'?/Unsupported Three/.test(e.message):e===error);
  assert.equal(camera.layers.mask,64);assert(!reports.some(r=>r[0]==='compile'&&r[1]===1));assert(!reports.some(r=>r[0]==='render'));
  failed=false;program.getAttributes=()=>{};delete program.diagnostics;await run();assert(uniformCalls>0);
 }
 const f=fixture({linked:false,throwDiagnostics:true});
 await assert.rejects(prepareProgramInterfaces({info:{programs:[f.program]}},async()=>{}),/original shader error/);
 assert.deepEqual(f.events,['program log','shader log','shader log','shader error']);
});
