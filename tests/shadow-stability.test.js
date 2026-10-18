import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {snapShadowFocus} from '../shadow-stability.js';

const close=(a,b,message)=>assert(Math.abs(a-b)<1e-9,message||`${a} != ${b}`);
const sun=new T.Vector3(-18,30,14).normalize();
const axes=camera=>{
 const right=new T.Vector3().crossVectors(camera.up,sun).normalize();
 return {right,up:new T.Vector3().crossVectors(sun,right).normalize()};
};

test('existing lobby/combat shadow frusta snap in texels without changing light depth or bounds',()=>{
 for(const span of [18,28])for(const resolution of [768,1024,1536,2048]){
  const camera=new T.OrthographicCamera(-span,span,span,-span,.5,80),size=new T.Vector2(resolution,resolution),basis=axes(camera),step=span*2/resolution;
  const frustum=[camera.left,camera.right,camera.top,camera.bottom,camera.near,camera.far];
  for(const focus of [new T.Vector3(),new T.Vector3(12.34,0,-56.78),new T.Vector3(-132.7,4.3,118.9)]){
   const saved=focus.clone(),out=snapShadowFocus(focus,sun,camera,size,new T.Vector3());
   close(out.dot(basis.right)/step,Math.round(out.dot(basis.right)/step));
   close(out.dot(basis.up)/step,Math.round(out.dot(basis.up)/step));
   close(out.dot(sun),focus.dot(sun),'snapping changed the depth coordinate');
   assert(out.distanceTo(focus)<=Math.SQRT2*step*.5+1e-9);
   close(out.clone().addScaledVector(sun,38).distanceTo(out),38);
   assert.deepEqual(focus,saved,'out parameter unexpectedly mutated the input');
  }
  assert.deepEqual([camera.left,camera.right,camera.top,camera.bottom,camera.near,camera.far],frustum);
 }
});

test('subtexel lateral travel keeps the shadow projection fixed until a texel boundary',()=>{
 const camera=new T.OrthographicCamera(-28,28,28,-28,.5,80),size=new T.Vector2(1536,1536),basis=axes(camera),step=56/1536;
 for(const distance of [-.49,-.25,0,.25,.49]){
  const focus=basis.right.clone().multiplyScalar(step*distance).addScaledVector(basis.up,step*distance);
  const returned=snapShadowFocus(focus,sun,camera,size);
  assert.equal(returned,focus);assert(focus.length()<1e-9);
 }
 const moved=snapShadowFocus(basis.right.clone().multiplyScalar(step*.51),sun,camera,size);
 close(moved.dot(basis.right),step);
});

test('independent axes, overhead sun and invalid map sizes remain bounded',()=>{
 const camera=new T.OrthographicCamera(-18,18,12,-12,.5,80),size=new T.Vector2(1024,768),focus=new T.Vector3(4.123,1.52,-2.768),basis=axes(camera);
 const result=snapShadowFocus(focus,sun,camera,size,new T.Vector3());
 close(result.dot(basis.right)/(36/1024),Math.round(result.dot(basis.right)/(36/1024)));
 close(result.dot(basis.up)/(24/768),Math.round(result.dot(basis.up)/(24/768)));
 const overhead=snapShadowFocus(focus,new T.Vector3(0,1,0),camera,size,new T.Vector3());
 assert(overhead.toArray().every(Number.isFinite));close(overhead.y,focus.y);
 assert.deepEqual(snapShadowFocus(focus,sun,camera,new T.Vector2(0,0),new T.Vector3()),focus);
});
