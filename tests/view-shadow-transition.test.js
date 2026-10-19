import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {primeWorldShadowLights} from '../render-prewarm.js';

const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const setView=source.slice(source.indexOf('function setView('),source.indexOf('function rotateView('));

test('changing a live or paused view primes only the requested shadow light state, without another scene draw',()=>{
 for(const state of ['playing','paused']){
  const camera=new T.PerspectiveCamera(),scene=new T.Scene(),calls=[],events=[];camera.layers.set(4);
  const context=vm.createContext({state,preparing:false,player:{},camera,scene,primeWorldShadowLights,mouseLockRequest:{manual:false},
   adventureCamera:{mode:'third',setMode(mode){this.mode=mode;}},clearAttack(){events.push('attack');},updateCamera(){events.push('camera');},syncViewUI(){events.push('ui');},localStorage:{setItem(key,value){events.push(value);}},
   renderer:{compile(subject,c,target){assert.equal(subject.children.length,0);assert.equal(c,camera);assert.equal(target,scene);calls.push(c.layers.mask);return new Set();},render(){throw Error('mode selection must not redraw the forest');}}
  });vm.runInContext(setView,context);
  for(const mode of ['first','first','third','third','first'])vm.runInContext(`setView('${mode}')`,context);
  assert.deepEqual(calls,[2,1,2]);assert.equal(camera.layers.mask,16);assert(context.mouseLockRequest.cancelled);assert.equal(events.filter(e=>e==='camera').length,5);
  context.preparing=true;vm.runInContext("setView('third')",context);assert.deepEqual(calls,[2,1,2]);
  context.preparing=false;context.state='menu';vm.runInContext("setView('first')",context);assert.deepEqual(calls,[2,1,2]);
 }
});

test('a failed view-light prime restores camera layers and does not issue an extra render',()=>{
 const camera=new T.PerspectiveCamera(),scene=new T.Scene(),error=Error('light snapshot');camera.layers.set(5);
 const context=vm.createContext({state:'playing',preparing:false,player:{},camera,scene,primeWorldShadowLights,mouseLockRequest:null,
  adventureCamera:{mode:'first',setMode(mode){this.mode=mode;}},clearAttack(){},updateCamera(){},syncViewUI(){},localStorage:{setItem(){}},renderer:{compile(){throw error;}}
 });vm.runInContext(setView,context);assert.throws(()=>vm.runInContext("setView('third')",context),e=>e===error);assert.equal(camera.layers.mask,32);
});
