import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {createOverheadQuery} from '../adventure-overheads.js';

function fixture(){
 const geometry=new T.BoxGeometry(160,.4,4,400,1,4),material=new T.MeshBasicMaterial({side:T.DoubleSide}),roof=new T.Mesh(geometry,material),group=new T.Group();
 roof.userData.placeOverhead=true;roof.position.y=3;roof.rotation.y=.31;group.add(roof);
 const query=createOverheadQuery({group}),ray=new T.Raycaster();
 const original=(a,b,clearance=0)=>{
  group.updateMatrixWorld(true);const direction=new T.Vector3().subVectors(b,a),length=direction.length();
  ray.set(a,direction.normalize());ray.near=0;ray.far=length;
  const hit=ray.intersectObject(roof,false)[0];if(!hit)return null;
  const distance=Math.max(0,hit.distance-Math.max(0,clearance)),point=ray.ray.at(distance,new T.Vector3()),normal=hit.face.normal.clone().transformDirection(roof.matrixWorld);
  if(normal.dot(ray.ray.direction)>0)normal.negate();
  return{point:{x:point.x,y:point.y,z:point.z},distance,normal,object:roof};
 };
 return{roof,geometry,material,group,query,original};
}

test('large overhead slices preserve every native hit, miss, normal and clearance',()=>{
 const f=fixture(),{roof,geometry,query,original}=f,position=geometry.attributes.position,index=geometry.index,groups=geometry.groups.map(g=>({...g}));
 try{
  let seed=42;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  for(let i=0;i<180;i++){
   const x=(random()-.5)*180,z=(random()-.5)*8;
   const a=new T.Vector3(x,i%2?6:0,z).applyMatrix4(roof.matrixWorld),b=new T.Vector3(x+(random()-.5)*6,i%2?-4:5,z+(random()-.5)*4).applyMatrix4(roof.matrixWorld),clearance=i%3?.25:0;
   assert.deepEqual(query.firstHit(a,b,clearance),original(a,b,clearance));
  }
  assert.equal(roof.geometry,geometry);assert.equal(geometry.attributes.position,position);assert.equal(geometry.index,index);assert.deepEqual(geometry.groups,groups);assert.deepEqual(geometry.drawRange,{start:0,count:Infinity});assert.equal(f.group.children.length,1,'no render meshes added');
 }finally{geometry.dispose();f.material.dispose();}
});

test('overhead broad phase removes distant triangle tests without reducing visible geometry',()=>{
 const f=fixture(),a=new T.Vector3(0,6,0),b=new T.Vector3(0,0,0),intersect=T.Ray.prototype.intersectTriangle;let count=0;
 T.Ray.prototype.intersectTriangle=function(...args){count++;return intersect.apply(this,args);};
 try{
  const expected=f.original(a,b);assert(expected);const before=count;count=0;
  assert.deepEqual(f.query.firstHit(a,b),expected);assert(count<before*.5,`${count} / ${before} triangle tests`);
 }finally{T.Ray.prototype.intersectTriangle=intersect;f.geometry.dispose();f.material.dispose();}
});

test('sliced overheads keep transforms, draw ranges, material sides and edited buffers current',()=>{
 const f=fixture(),a=new T.Vector3(0,8,0),b=new T.Vector3(0,-2,0),compare=()=>assert.deepEqual(f.query.firstHit(a,b,.1),f.original(a,b,.1));
 try{
  compare();f.group.position.set(.3,.6,-.2);f.roof.scale.set(1.2,.7,.8);compare();
  f.geometry.setDrawRange(300,900);compare();f.geometry.setDrawRange(1,901);compare();f.geometry.setDrawRange(0,Infinity);
  f.material.side=T.FrontSide;compare();f.material.side=T.BackSide;compare();
  const p=f.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+.8);p.needsUpdate=true;f.geometry.computeBoundingBox();f.geometry.computeBoundingSphere();compare();
  f.roof.geometry=new T.BoxGeometry(3,.2,3);compare();f.roof.geometry.dispose();
 }finally{f.geometry.dispose();f.material.dispose();}
});

test('interleaved vertex edits retain native collision rather than stale slice bounds',()=>{
 const f=fixture(),source=f.geometry.attributes.position,data=new T.InterleavedBuffer(new Float32Array(source.array),3);
 f.geometry.setAttribute('position',new T.InterleavedBufferAttribute(data,3,0));
 const query=createOverheadQuery({group:f.group}),a=new T.Vector3(0,10,0),b=new T.Vector3(0,-2,0);
 try{
  assert.deepEqual(query.firstHit(a,b),f.original(a,b));
  for(let i=1;i<data.array.length;i+=3)data.array[i]+=4;data.needsUpdate=true;f.geometry.computeBoundingBox();f.geometry.computeBoundingSphere();
  assert.deepEqual(query.firstHit(a,b),f.original(a,b));assert(query.firstHit(a,b).point.y>6);
 }finally{f.geometry.dispose();f.material.dispose();}
});

test('adding a morph after query creation falls back to the animated native mesh',()=>{
 const f=fixture(),source=f.geometry.attributes.position,morph=source.clone(),a=new T.Vector3(0,10,0),b=new T.Vector3(0,-2,0);
 try{
  for(let i=0;i<morph.count;i++)morph.setY(i,morph.getY(i)+4);
  f.geometry.morphAttributes.position=[morph];f.roof.updateMorphTargets();f.roof.morphTargetInfluences[0]=1;
  f.geometry.computeBoundingBox();f.geometry.computeBoundingSphere();
  assert.deepEqual(f.query.firstHit(a,b),f.original(a,b));assert(f.query.firstHit(a,b).point.y>6);
 }finally{f.geometry.dispose();f.material.dispose();}
});
