import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildWorld,buildWorldSteps,clearAt} from '../world.js';
import {disposeCue} from '../ground-cues.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const baseline=JSON.parse(readFileSync(new URL('./fixtures/world-v220.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function snapshot(w){
 const shapes=new WeakMap(),nodes=[];
 w.group.traverse(o=>{
  let geometry=null;
  if(o.geometry){
   if(!shapes.has(o.geometry))shapes.set(o.geometry,hash([Object.entries(o.geometry.attributes).map(([key,a])=>[key,a.itemSize,Array.from(a.array)]),o.geometry.index&&Array.from(o.geometry.index.array)]));
   geometry=shapes.get(o.geometry);
  }
  nodes.push([o.type,o.name,o.children.length,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray(),o.visible,geometry,o.isInstancedMesh?Array.from(o.instanceMatrix.array):null]);
 });
 const data={spawn:w.spawn,half:w.half,obstacles:w.obstacles.map(o=>[o.x,o.z,o.r,o.hp,o.tactic]),patches:w.patches.map(p=>[p.x,p.z,p.r,p.kind,p.rx,p.rz,p.angle,p.phase]),sites:w.sites.map(s=>[s.x,s.z,s.type,s.event,s.availableAt,s.eventAngle]),discoveries:w.discoveries?.map(d=>[d.x,d.z,d.kind]),roaming:w.roaming?.map(d=>[d.x,d.z,d.kind]),weather:(w.regions||[w]).map(r=>r.weather.particles)};
 const clear=[];for(let x=-w.half;x<=w.half;x+=6.5)for(let z=-w.half;z<=w.half;z+=6.5)clear.push(clearAt(w,x,z,.45));
 return {gameplay:hash(data),scene:hash(nodes),passability:hash(clear),nodes:nodes.length,obstacles:w.obstacles.length,foliage:w.foliage.length};
}

function release(w){w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();disposeCue(o);if(o.userData.ownedGeometry)o.geometry.dispose();});}
// Frozen before v221. Includes every mesh transform and geometry buffer, all
// rewards/obstacles/weather seeds, and a grid of collision queries on six maps.
for(const [key,expected]of Object.entries(baseline))test(`${key}: stepped and sync builders preserve the v220 world`,async()=>{
 const [id,seedText]=key.split(':'),seed=Number(seedText),steps=buildWorldSteps(id,seed),events=[];let step;
 do{step=steps.next();if(!step.done){events.push(step.value);if(events.length%7===0)await new Promise(resolve=>setImmediate(resolve));}}while(!step.done);
 assert(events.length>40,'construction never yielded enough smaller chunks');
 const trees=events.filter(e=>e.stage==='trees');assert.equal(trees[0].completed,0);assert(trees.every((e,i)=>i===0||e.completed-trees[i-1].completed===8));
 const w=step.value;assert.deepEqual(snapshot(w),expected);release(w);
 const sync=buildWorld(id,seed);assert.deepEqual(snapshot(sync),expected);release(sync);
});
test('independent builders can be interleaved without sharing seeded placement state',()=>{
 const a=buildWorldSteps('forest',7),b=buildWorldSteps('snow',522);let ra,rb;
 while(!ra?.done||!rb?.done){if(!ra?.done)ra=a.next();if(!rb?.done)rb=b.next();}
 assert.deepEqual(snapshot(ra.value),baseline['forest:7']);assert.deepEqual(snapshot(rb.value),baseline['snow:522']);release(ra.value);release(rb.value);
});
