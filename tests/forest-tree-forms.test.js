import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {FOREST_TREE_FORMS,forestTreeFormTemplate,installForestTreeForms,installForestTreeBackdropVariants} from '../forest-tree-forms.js';
import {addTree,animateTreeCanopy,updateTreeDetail,installForestBackdrop} from '../tree-scenery.js';
import {buildWorld} from '../world.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installExplorationRoutes} from '../exploration-routes.js';
import {installExplorationLandmarks} from '../exploration-landmarks.js';
import {installExplorationComposition} from '../exploration-composition.js';
import {planForestJourney,finishForestJourney} from '../forest-journey.js';

const pose=o=>[o.position.toArray(),o.quaternion.toArray(),o.scale.toArray()];
function fixture(id='forest'){
 const world={group:new T.Group(),obstacles:[],foliage:[],breakables:[],forestJourney:{points:[{x:0,z:0},{x:0,z:120}]}};
 for(let i=0;i<48;i++){
  const root=new T.Group(),x=(i%2?1:-1)*(5+(i%3)*2),z=i*2.5;
  root.position.set(x,.1*(i%3),z);root.scale.y=1+(i%3)*.08;world.group.add(root);
  const crown=addTree(root,id,4+(i%4)*.2,{angle:i*.8}),trunk=root.getObjectByName('tree-trunk');
  trunk.geometry=trunk.geometry.clone();trunk.userData.ownedGeometry=true;
  const obstacle={x,z,r:.65,mesh:root,hp:42,state:'standing'};world.obstacles.push(obstacle);
  world.foliage.push({leaf:crown,x:crown.position.x,z:crown.position.z,phase:i*.7});
 }
 world.breakables.push(world.obstacles[4]);world.obstacles[4].tactic='timber';return world;
}
const release=w=>{w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});w.forestJourney?.dispose?.();};

test('four distinct branch architectures have bounded, prebuilt LODs and valid PBR/wind attributes',()=>{
 const signatures=new Set();
 for(const form of FOREST_TREE_FORMS)for(const variant of[0,1]){
  const t=forestTreeFormTemplate(form,variant);assert.equal(forestTreeFormTemplate(form,variant),t);
  assert.equal(t.lods.length,3);assert.equal(t.canopy,t.lods[2]);assert(t.clusters.length>=15);
  assert(t.minLeafY>3.5,'low leaf sprays intrude into the existing first-person corridor');
  assert(t.triangleCounts[0]<6000&&t.triangleCounts[1]<3500&&t.triangleCounts[2]<2200,'replacement exceeds current tree triangle budget');
  assert(t.triangleCounts[0]>t.triangleCounts[1]&&t.triangleCounts[1]>t.triangleCounts[2]);
  signatures.add(JSON.stringify(t.clusters.map(n=>n.p)));
  for(const [kind,g]of [[0,t.trunk],...[0,1,2].map(i=>[1,t.lods[i]])]){
   for(const name of ['position','normal','uv','color','treeSurface',...(kind?['treeLeafFlex']:[])]){
    assert.equal(g.attributes[name].count,g.attributes.position.count);assert(g.attributes[name].array.every(Number.isFinite));
   }
   assert(g.index.array.every(n=>n<g.attributes.position.count));
   assert(g.attributes.treeSurface.array.every(n=>n===kind));
   const normal=g.attributes.normal;for(let i=0;i<normal.count;i++)assert(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-4);
   assert(g.boundingBox&&g.boundingSphere);
  }
  // Seams have equal position/normals, integer U offset and the same V. This
  // catches normal-map seams without requiring a screenshot-only assertion.
  const p=t.trunk.attributes.position,n=t.trunk.attributes.normal,uv=t.trunk.attributes.uv,groups=new Map();let seams=0;
  for(let i=0;i<p.count;i++){
   const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>x.toFixed(5)).join(',');
   if(groups.has(key)){
    const a=groups.get(key),du=Math.abs(uv.getX(a)-uv.getX(i));
    if(du>.9&&Math.abs(uv.getY(a)-uv.getY(i))<1e-5){
     assert(Math.abs(du-Math.round(du))<1e-5);assert(Math.hypot(n.getX(a)-n.getX(i),n.getY(a)-n.getY(i),n.getZ(a)-n.getZ(i))<1e-4);seams++;
    }
   }else groups.set(key,i);
  }
  assert(seams>50);
 }
 assert.equal(signatures.size,8,'tree families/variants are copies of the same crown points');
 assert.equal(forestTreeFormTemplate('snow'),null);
});

test('route groves reuse tree objects, material, colliders and shared geometry while preserving destructibles',()=>{
 const w=fixture(),old=new Map(),disposed=new Map();
 for(const o of w.obstacles){
  const root=o.mesh,trunk=root.getObjectByName('tree-trunk'),crown=root.getObjectByName('tree-canopy');
  old.set(o,{pose:pose(root),trunk,crown,children:root.children.slice(),geometry:trunk.geometry,material:trunk.material,leafMaterial:crown.material,collider:[o.x,o.z,o.r,o.hp,o.state]});
  disposed.set(trunk.geometry,0);trunk.geometry.addEventListener('dispose',()=>disposed.set(old.get(o).geometry,disposed.get(old.get(o).geometry)+1));
 }
 const totalChildren=[];w.group.traverse(o=>totalChildren.push(o));
 try{
  const result=installForestTreeForms(w);assert(result);assert.equal(result.trees.length,32,'cap is two thirds of existing woodland population');
  assert(Object.values(result.forms).every(n=>n>=5),'route distribution starves a distinct grove');
  assert.equal(installForestTreeForms(w),result);
  const now=[];w.group.traverse(o=>now.push(o));assert.deepEqual(now,totalChildren,'tree replacement added draw meshes');
  for(const o of w.obstacles){
   const a=old.get(o),root=o.mesh;assert.deepEqual(pose(root),a.pose,'caller-owned root transform changed');
   assert.deepEqual([o.x,o.z,o.r,o.hp,o.state],a.collider);assert.deepEqual(root.children,a.children);
   assert.equal(a.trunk.material,a.material);assert.equal(a.crown.material,a.leafMaterial);
   if(!root.userData.forestTreeForm){assert.equal(a.trunk.geometry,a.geometry);assert.equal(disposed.get(a.geometry),0);continue;}
   assert.equal(disposed.get(a.geometry),1,'retired owned trunk not released exactly once');
   assert.equal(a.trunk.userData.ownedGeometry,false);assert.equal(a.crown.userData.ownedGeometry,false);
   const t=a.crown.userData.treeTemplate;assert.equal(a.trunk.geometry,t.trunk);
   const record=w.foliage.find(f=>f.leaf===a.crown);assert(record);assert.equal(record.x,0);assert.equal(record.z,0);
   root.updateWorldMatrix(true,true);const p=a.trunk.geometry.attributes.position;
   for(let i=0;i<p.count;i++){
    const v=a.trunk.localToWorld(new T.Vector3().fromBufferAttribute(p,i));
    if(v.y-root.position.y<2.3)assert(Math.hypot(v.x-root.position.x,v.z-root.position.z)<=o.r+.001,'solid low trunk escaped its existing collider');
   }
   const sharedPositions=t.canopy.attributes.position.array.slice();
   for(const [distance,level]of [[5,0],[20,1],[40,2]]){
    updateTreeDetail(a.crown,root.position.x+distance,root.position.z);assert.equal(a.crown.geometry,t.lods[level]);
    animateTreeCanopy(a.crown,1.9,record);assert(a.crown.rotation.x||a.crown.rotation.z);
    animateTreeCanopy(a.crown,1.9,record);const stable=pose(a.crown);animateTreeCanopy(a.crown,1.9,record);assert.deepEqual(pose(a.crown),stable,'paused game time changed wind');
   }
   assert.deepEqual(t.canopy.attributes.position.array,sharedPositions,'wind mutated shared leaves');
  }
  const protectedTree=w.breakables[0];assert.equal(protectedTree.mesh.userData.forestTreeForm,undefined);
 }finally{release(w);}
 // A second world keeps the eight-template cache; normal disposal must never
 // dispose geometry another world's tree is using.
 const t=forestTreeFormTemplate('oak'),w2=fixture();let sharedDisposals=0;
 for(const g of [t.trunk,...t.lods])g.addEventListener('dispose',()=>sharedDisposals++);
 installForestTreeForms(w2);release(w2);assert.equal(sharedDisposals,0);
});

test('other climates, joined map, missing route and nonpositive limit leave the scene untouched',()=>{
 for(const id of ['snow','ash','sand','coast']){const w=fixture(id);assert.equal(installForestTreeForms(w,id),null);release(w);}
 const w=fixture();w.regions=[];assert.equal(installForestTreeForms(w),null);delete w.regions;
 assert.equal(installForestTreeForms(w,'forest',{limit:0}),null);delete w.forestJourney;
 assert.equal(installForestTreeForms(w),null);assert.equal(w.forestTreeForms,undefined);release(w);
});

test('real seeded forest pipeline retains every gameplay anchor and produces several tree architectures',()=>{
 globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
 for(const seed of [1,522]){
  const w=buildWorld('forest',seed);
  try{
   installForestVista(w,'forest');installForestHabitats(w,'forest');installExplorationRoutes(w,'forest');
   planForestJourney(w,'forest');installExplorationLandmarks(w,'forest');installExplorationComposition(w,'forest');finishForestJourney(w);
   const snapshot=()=>JSON.stringify({roots:w.obstacles.map(o=>[o.x,o.z,o.r,pose(o.mesh)]),routes:w.explorationRoutes.map(r=>r.points),spawn:w.spawn,sites:w.sites.map(s=>[s.x,s.z,s.type]),breakables:w.breakables.map(o=>[o.x,o.z,o.hp,o.state])});
   const before=snapshot(),result=installForestTreeForms(w,'forest');assert.equal(snapshot(),before);
   assert(result.trees.length>=24&&result.trees.length<=36);assert(Object.values(result.forms).every(n=>n>0));
   for(const tree of result.trees){const leaf=tree.root.getObjectByName('tree-canopy');assert(w.foliage.some(f=>f.leaf===leaf));}
  }finally{release(w);}
 }
});

test('distant grove variants reuse the six batches, 240 anchors and instance buffers without extra objects',()=>{
 const w=fixture();w.half=110;installForestTreeForms(w);const group=installForestBackdrop(w,'forest');
 const objects=group.children.slice(),before=JSON.stringify(group.userData.records),state=objects.map(o=>({o,buffer:o.instanceMatrix,colors:o.instanceColor,material:o.material}));
 const originalGeometry=objects.map(o=>o.geometry);let disposed=0;const onDispose=()=>disposed++;
 for(const g of originalGeometry)g.addEventListener('dispose',onDispose);
 try{
  for(const id of ['snow','ash','sand','coast','confluence'])assert.equal(installForestTreeBackdropVariants(w,id),null);
  const result=installForestTreeBackdropVariants(w,'forest');assert(result);assert.equal(result.length,3);
  assert.deepEqual(group.children,objects);assert.equal(JSON.stringify(group.userData.records),before);
  assert(result.every(r=>r.count===80&&r.triangles<=528),'distant grove exceeds existing per-tree triangle allowance');
  assert.equal(installForestTreeBackdropVariants(w),result);assert.equal(disposed,0,'shared original tree disposed');
  for(const s of state){assert.equal(s.o.instanceMatrix,s.buffer);assert.equal(s.o.instanceColor,s.colors);assert.equal(s.o.material,s.material);assert.equal(s.o.count,80);assert(s.o.boundingSphere&&s.o.boundingBox);}
  const trunks=objects.filter(o=>o.name==='tree-trunk-backdrop'),crowns=objects.filter(o=>o.name==='tree-canopy-backdrop');
  const matrix=new T.Matrix4(),position=new T.Vector3(),scale=new T.Vector3(),rotation=new T.Quaternion();
  for(let family=0;family<3;family++){
   const records=group.userData.records.filter((_,i)=>Math.floor(i/20)%3===family);
   for(const [i,r]of records.entries()){
    trunks[family].getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
    assert(position.distanceTo(new T.Vector3(r.x,r.y,r.z))<2e-5,'distant roots lost sampled terrain elevation');
    const rootScale=scale.y;crowns[family].getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
    assert(Math.abs(position.y-r.y-3.6*rootScale)<2e-5,'canopy became detached from its own trunk');
   }
  }
  assert.equal(new Set(trunks.map(o=>o.geometry)).size,3);assert.equal(new Set(crowns.map(o=>o.geometry)).size,3);
 }finally{for(const g of originalGeometry)g.removeEventListener('dispose',onDispose);release(w);}
});
