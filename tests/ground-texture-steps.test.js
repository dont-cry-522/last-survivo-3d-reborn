import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildWorldSteps} from '../world.js';
globalThis.document={createElement:()=>{
 const canvas={},context={fillRect(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>{canvas.pixels=image.data;}};
 canvas.getContext=()=>context;return canvas;
}};
// Pixel digests from the frozen pre-v221 builder with its real 512x512 noise loop.
const expected={forest:'280a227598b762820cfa78181f4d10389cf59bcbe028f4602e01b6830f8f6581',snow:'ab587a5f8fa24f9dd3a57693d88632d39cc7c01f22ed8fdce9e19db61a03e554',ash:'65ed658d1595278f4c48085555e3e2e070b0a90db210051cfaa419548586135e',sand:'ea729d8c71705b1c0c3a0529e0fcf92830bea2bfda5b8b93a02180c487f5be99',coast:'63815ca0b04a3d995ce1ccf111d0d1084901d94fa24083155c1b9138de65783b'};
for(const [id,digest]of Object.entries(expected))test(`${id}: texture yields between rows and preserves every original pixel`,()=>{
 const steps=buildWorldSteps(id,7),rows=[];let step;
 do{step=steps.next();if(!step.done&&step.value.stage==='ground-texture')rows.push(step.value.completed);}while(!step.done);
 assert.deepEqual(rows,Array.from({length:32},(_,i)=>i*16));
 const texture=step.value.ground.material.map;assert.equal(createHash('sha256').update(texture.image.pixels).digest('hex'),digest);
 const second=buildWorldSteps(id,522);let cached;do{cached=second.next();if(!cached.done)assert.notEqual(cached.value.stage,'ground-texture');}while(!cached.done);
 assert.strictEqual(cached.value.ground.material.map,texture,'cached texture was rebuilt on map restart');
});
