import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {buildWorld} from '../world.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installExplorationRoutes} from '../exploration-routes.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {installExplorationComposition} from '../exploration-composition.js';
import {createBarkGeometry} from '../forest-surface-assets.js';
import {shapeForestCanopy} from '../forest-canopy-shape.js';
import {addTree,updateTreeDetail} from '../tree-scenery.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const release=world=>world.group.traverse(object=>{if(object.isInstancedMesh)object.dispose();if(object.userData.ownedGeometry)object.geometry.dispose();});
const pose=object=>[object.position.toArray(),object.scale.toArray(),object.quaternion.toArray()];
function prepare(){
 const world=buildWorld('forest',522);installForestVista(world,'forest');installForestHabitats(world,'forest');installExplorationRoutes(world,'forest');installExplorationLandmarks(world,'forest');installExplorationComposition(world,'forest');return world;
}

for(const expanded of[false,true])test('spread existing '+(expanded?'UV-expanded':'indexed')+' crowns keeps all terminal sprays attached and roots unchanged',()=>{
 const world=prepare(),shared=new Map(),changed=[];let tips=0,roots=0;
 try{
  for(const obstacle of world.obstacles){
   const root=obstacle.mesh,trunk=root.getObjectByName('tree-trunk'),crown=root.getObjectByName('tree-canopy'),template=crown?.userData.treeTemplate;
   if(root.userData.treeBiome!=='forest'||!template||!trunk?.userData.ownedGeometry||root.userData.forestVistaTrunk)continue;
   if(!shared.has(template.trunk))shared.set(template.trunk,template.trunk.attributes.position.array.slice());
   if(expanded){const g=createBarkGeometry(trunk.geometry,trunk.scale);assert(g);trunk.geometry.dispose();trunk.geometry=g;}
   const source=trunk.geometry,sourcePositions=source.attributes.position.array.slice(),sourceNormals=source.attributes.normal.array.slice(),sourceUV=source.attributes.uv?.array.slice();let disposed=0;
   const sourceDispose=()=>disposed++;source.addEventListener('dispose',sourceDispose);
   const state={root:pose(root),trunk:pose(trunk),collider:[obstacle.x,obstacle.z,obstacle.r],crownPosition:crown.position.toArray(),materials:[trunk.material,crown.material],children:root.children.slice()};
   if(!shapeForestCanopy(root,{width:1.4,depth:1.3,height:1.05})){source.removeEventListener('dispose',sourceDispose);continue;}
   assert.equal(disposed,1,'replaced owned geometry was not released exactly once');assert.notEqual(trunk.geometry,source);
   assert.deepEqual(source.attributes.position.array,sourcePositions);assert.deepEqual(source.attributes.normal.array,sourceNormals,'old owned mesh was modified before disposal');
   assert.deepEqual(pose(root),state.root);assert.deepEqual(pose(trunk),state.trunk);assert.deepEqual([obstacle.x,obstacle.z,obstacle.r],state.collider);
   assert.deepEqual(crown.position.toArray(),state.crownPosition);assert.deepEqual([trunk.material,crown.material],state.materials);assert.deepEqual(root.children,state.children);
   const current=trunk.geometry,position=current.attributes.position,normal=current.attributes.normal,index=template.trunk.index,original=template.trunk.attributes.position;
   if(sourceUV)assert.deepEqual(current.attributes.uv.array,sourceUV,'shaping changed established UV seams');
   for(let i=0;i<position.count;i++){
    const sourceIndex=expanded?index.getX(i):i;
    if(original.getY(sourceIndex)<=1.8){for(let axis=0;axis<3;axis++)assert.equal(position.array[i*3+axis],sourcePositions[i*3+axis]);roots++;}
    assert(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-5);
   }
   root.updateWorldMatrix(true,true);const start=original.count-template.sprays.length*11;
   for(const[i,[x,y,z,,,height]]of template.sprays.entries()){
    const sourceIndex=start+i*11+10,vertex=expanded?Array.from(index.array).indexOf(sourceIndex):sourceIndex;assert(vertex>=0);
    const tip=trunk.localToWorld(new T.Vector3().fromBufferAttribute(position,vertex)),target=crown.localToWorld(new T.Vector3(x,y+height*.24-template.bottom,z));
    assert(tip.distanceTo(target)<1e-5,'existing twig no longer fits leaf spray after widening');tips++;
   }
   if(expanded){
    const normals=new Map();for(let i=0;i<position.count;i++){const key=index.getX(i),n=[normal.getX(i),normal.getY(i),normal.getZ(i)];if(normals.has(key))assert.deepEqual(n,normals.get(key),'bark UV seam has split normals');else normals.set(key,n);}
   }
   const scale=crown.scale.clone();for(const d of[5,20,40]){updateTreeDetail(crown,root.position.x+d,root.position.z);assert(crown.scale.equals(scale));}
   assert.equal(shapeForestCanopy(root),false);assert.equal(trunk.geometry,current);assert.equal(disposed,1);
   let released=0;current.addEventListener('dispose',()=>released++);changed.push(()=>released);
   if(changed.length===9)break;
  }
  assert(changed.length>=6&&tips>=120&&roots>100,'fixture did not cover several actual fitted woodland crowns');
  for(const[geometry,positions]of shared)assert.deepEqual(geometry.attributes.position.array,positions,'shared tree template was modified');
 }finally{release(world);}
 assert(changed.every(releases=>releases()===1),'new owned trunk is not released exactly once by normal world cleanup');
});

test('invalid parameters, other climates and low crowns are left intact',()=>{
 assert.equal(shapeForestCanopy(null),false);
 for(const climate of['snow','ash','sand','coast']){const root=new T.Group();addTree(root,climate,5);const trunk=root.getObjectByName('tree-trunk'),original=trunk.geometry;assert.equal(shapeForestCanopy(root),false);assert.equal(trunk.geometry,original);}
 const world=prepare();
 try{
  const root=world.obstacles.find(o=>o.mesh.userData.forestHabitat==='thicket').mesh,trunk=root.getObjectByName('tree-trunk'),crown=root.getObjectByName('tree-canopy');
  crown.position.y=-2;const original=trunk.geometry,state=pose(crown),materials=[trunk.material,crown.material];
  for(const options of[{}, {width:NaN},{width:2},{height:.5}])assert.equal(shapeForestCanopy(root,options),false);
  assert.equal(trunk.geometry,original);assert.deepEqual(pose(crown),state);assert.deepEqual([trunk.material,crown.material],materials);assert.equal(root.userData.forestCanopyShape,undefined);
 }finally{release(world);}
});

test('an unowned shared tree template is cloned and never disposed by shaping or world cleanup',()=>{
 const first=new T.Group(),second=new T.Group();addTree(first,'forest',5);addTree(second,'forest',5);
 const trunk=first.getObjectByName('tree-trunk'),shared=trunk.geometry,other=second.getObjectByName('tree-trunk'),positions=shared.attributes.position.array.slice();let sharedDisposed=0,ownedDisposed=0;
 const listener=()=>sharedDisposed++;shared.addEventListener('dispose',listener);
 try{
  assert.equal(trunk.geometry,other.geometry);assert.equal(shapeForestCanopy(first),true);
  assert.notEqual(trunk.geometry,shared);assert.equal(other.geometry,shared);assert.deepEqual(shared.attributes.position.array,positions);assert.equal(sharedDisposed,0);
  trunk.geometry.addEventListener('dispose',()=>ownedDisposed++);release({group:first});assert.equal(ownedDisposed,1);assert.equal(sharedDisposed,0);
 }finally{shared.removeEventListener('dispose',listener);}
});
