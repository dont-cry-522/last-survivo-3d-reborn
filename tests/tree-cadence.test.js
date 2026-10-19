import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {addTree,updateTreeDetail,animateTreeCanopy,updateTreeCanopies,prepareTreeDetail} from '../tree-scenery.js';

const pose=leaf=>[...leaf.position,...leaf.quaternion];
function make(biome,distance,phase=0){const root=new T.Group();root.position.x=distance;const leaf=addTree(root,biome,4);return {leaf,x:leaf.position.x,z:leaf.position.z,phase};}
test('close trees preserve exact old poses and LOD bands on every frame',async()=>{
 for(const biome of ['forest','snow']){
  const current=make(biome,0,.37),original=make(biome,0,.37);await prepareTreeDetail({foliage:[current,original]});
  for(let i=0;i<600;i++){
   const time=i/60,focus=20+18*Math.sin(time*.75);
   updateTreeCanopies([current],time,focus,0);updateTreeDetail(original.leaf,focus,0);animateTreeCanopy(original.leaf,time,original);
   assert.deepEqual(pose(current.leaf),pose(original.leaf));assert.strictEqual(current.leaf.geometry,original.leaf.geometry);
  }
 }
});
test('far crown transforms update at 15/8 Hz, while all leaf shaders keep the live game clock',()=>{
 const mid=make('forest',55,.31),far=make('forest',100,.47),all=[mid,far];
 const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};far.leaf.material.onBeforeCompile(shader);
 const counts=[0,0];let last=all.map(r=>pose(r.leaf));
 for(let frame=0;frame<600;frame++){
  const time=frame/60;updateTreeCanopies(all,time,0,0);assert.equal(shader.uniforms.treeBreezeTime.value,time);
  all.forEach((r,i)=>{const now=pose(r.leaf);if(JSON.stringify(now)!==JSON.stringify(last[i]))counts[i]++;last[i]=now;});
 }
 assert(counts[0]>=149&&counts[0]<=151);assert(counts[1]>=79&&counts[1]<=81);
 const paused=all.map(r=>pose(r.leaf));for(let i=0;i<120;i++)updateTreeCanopies(all,599/60,0,0);assert.deepEqual(all.map(r=>pose(r.leaf)),paused);
 updateTreeCanopies(all,0,0,0);assert.equal(shader.uniforms.treeBreezeTime.value,0);assert(all.every(r=>r.canopyTime===0));
});
test('teleporting near a distant tree immediately restores its full cadence and detailed crown',async()=>{
 const record=make('forest',100,.2),expected=make('forest',100,.2);await prepareTreeDetail({foliage:[record,expected]});
 updateTreeCanopies([record],2,0,0);const farPose=pose(record.leaf);
 updateTreeCanopies([record],2.001,96,0);animateTreeCanopy(expected.leaf,2.001,expected);updateTreeDetail(expected.leaf,96,0);
 assert.notDeepEqual(pose(record.leaf),farPose);assert.deepEqual(pose(record.leaf),pose(expected.leaf));assert.strictEqual(record.leaf.geometry,expected.leaf.geometry);assert.equal(record.leaf.userData.treeLOD,0);
 updateTreeCanopies([record],2.002,0,0);assert.equal(record.leaf.userData.treeLOD,2);
 const fixed=pose(record.leaf);record.leaf.removeFromParent();updateTreeCanopies([record],8,100,0);assert.deepEqual(pose(record.leaf),fixed);
});
