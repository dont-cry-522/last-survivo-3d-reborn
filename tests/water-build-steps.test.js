import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {buildPondsSteps} from '../water.js';
import {seeded} from '../rules.js';
test('cold gravel generation yields in small row groups, matches v220 pixels and is shared on rebuild',()=>{
 const make=()=>buildPondsSteps(new T.Group(),'forest',seeded(7),{x:0,z:0},[],[{x:10,z:10,rx:5,rz:6,angle:.4}]);
 const steps=make(),rows=[];let step;
 do{step=steps.next();if(!step.done&&step.value.stage==='water-bed')rows.push(step.value.completed);}while(!step.done);
 assert.deepEqual(rows,Array.from({length:32},(_,i)=>i*8));
 const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};step.value[0].mesh.material.onBeforeCompile(shader);
 assert.equal(createHash('sha256').update(shader.uniforms.waterBed.value.image.data).digest('hex'),'067cb438ffc52ad14432f1f84af1221a74a57dc558d778d1072fb5c1f6c65894');
 const second=make();do{step=second.next();if(!step.done)assert.notEqual(step.value.stage,'water-bed');}while(!step.done);
 const after={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};step.value[0].mesh.material.onBeforeCompile(after);assert.strictEqual(after.uniforms.waterBed.value,shader.uniforms.waterBed.value);
});
