import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {segmentDistance} from '../rules.js';
import {clearAt,buildWorld} from '../world.js';
import {entryLandscapeYaw} from '../lobby-landscape.js';

// Exercise the production search without starting the renderer or duplicating
// its candidate ordering. These dependencies are the same as main.js uses.
const source=readFileSync(new URL('../main.js',import.meta.url),'utf8'),start=source.indexOf('function roomSpawn('),end=source.indexOf('function makeRoomOwner(',start);
assert(start>0&&end>start);
const makeSpawn=new Function('world','clearAt','entryLandscapeYaw','segmentDistance',source.slice(start,end)+'return roomSpawn;');
function places(world,yaw=null,query=clearAt){
 const spawn=makeSpawn(world,query,yaw===null?entryLandscapeYaw:()=>yaw,segmentDistance);
 return Array.from({length:4},(_,i)=>spawn(i));
}
function assertLanes(points,yaw,label){
 const dx=-Math.sin(yaw)*6-Math.cos(yaw)*.5,dz=-Math.cos(yaw)*6+Math.sin(yaw)*.5;
 for(let i=0;i<points.length;i++)for(let j=0;j<points.length;j++)if(i!==j){
  const a=points[i],b=points[j];
  assert(Math.hypot(a.x-b.x,a.z-b.z)>3,label+' spacing');
  assert(segmentDistance(a.x,a.z,b.x,b.z,b.x+dx,b.z+dz)>1.5,`${label}: player ${i} blocks player ${j}'s initial camera`);
 }
}
test('four-player entry cameras do not intersect other bodies for any entry yaw',()=>{
 const world={spawn:{x:17,z:-29},half:100,obstacles:[]};
 for(let k=0;k<64;k++){
  const yaw=k*Math.PI/32,result=places(world,yaw);
  assert.deepEqual(result,places(world,yaw),'deterministic join/respawn positions');
  assertLanes(result,yaw,'yaw '+yaw);
 }
});
test('two new map entry directions reproduce and resolve the observed large guest foreground head',()=>{
 for(const [spawn,yaw]of[[{x:-45,z:55},2.32],[{x:-55,z:45},2.29]]){
  const world={spawn,half:100,obstacles:[]},legacy=[{x:spawn.x,z:spawn.z+3.5},{x:spawn.x+3.5,z:spawn.z}];
  const dx=-Math.sin(yaw)*6-Math.cos(yaw)*.5,dz=-Math.cos(yaw)*6+Math.sin(yaw)*.5;
  assert(segmentDistance(legacy[0].x,legacy[0].z,legacy[1].x,legacy[1].z,legacy[1].x+dx,legacy[1].z+dz)<1.5);
  assertLanes(places(world,yaw),yaw,'new map entry');
 }
});
test('constrained layouts keep the original clear placement fallback and blocked world spawn fallback',()=>{
 const world={spawn:{x:0,z:0},half:100,obstacles:[]};
 const permitted=[{x:0,z:3.5},{x:3.5,z:0}],query=(_w,x,z,r)=>r===.6&&permitted.some(p=>Math.hypot(p.x-x,p.z-z)<1e-7);
 const spawn=makeSpawn(world,query,()=>2.32,segmentDistance);
 assert.deepEqual(spawn(0),permitted[0]);assert(Math.hypot(spawn(1).x-3.5,spawn(1).z)<1e-7);
 const blocked=makeSpawn(world,()=>false,()=>2.32,segmentDistance);
 assert.deepEqual(blocked(3),world.spawn);assert.notEqual(blocked(3),world.spawn);
});

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
// Search reachable walkable ground in the entry region. Sampling short edges
// guards against stepping through narrow colliders between grid points.
function reachable(world,target){
 const step=.5,limit=19,key=(x,z)=>`${x},${z}`,queue=[[0,0]],seen=new Set(['0,0']),base=world.spawn;
 for(let index=0;index<queue.length;index++){
  const[x,z]=queue[index],px=base.x+x*step,pz=base.z+z*step;
  if(Math.hypot(px-target.x,pz-target.z)<step*.8&&clearEdge(px,pz,target.x,target.z))return true;
  for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){
   const nx=x+dx,nz=z+dz,k=key(nx,nz);if(Math.abs(nx)*step>limit||Math.abs(nz)*step>limit||seen.has(k))continue;
   seen.add(k);if(clearEdge(px,pz,base.x+nx*step,base.z+nz*step))queue.push([nx,nz]);
  }
 }
 return false;
 function clearEdge(ax,az,bx,bz){for(let n=0;n<=4;n++)if(!clearAt(world,ax+(bx-ax)*n/4,az+(bz-az)*n/4,.45))return false;return true;}
}
for(const id of ['forest','snow','ash','sand','coast','bellvale','crystalcave'])test(`four real ${id} spawn points are reachable, collision clear and camera clear across seeds`,()=>{
 for(const seed of[1,13,228]){
  const world=buildWorld(id,seed),result=places(world);
  try{
   assert.deepEqual(result,places(world));assertLanes(result,entryLandscapeYaw(world),id+' '+seed);
   for(const p of result){assert(clearAt(world,p.x,p.z,.6),id+' collides');assert(reachable(world,p),id+' unreachable '+JSON.stringify(p));}
  }finally{world.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});}
 }
});
