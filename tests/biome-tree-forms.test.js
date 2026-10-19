import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {BIOME_TREE_FORMS,biomeTreeTemplate,installBiomeTreeForms} from '../biome-tree-forms.js';
import {buildWorld,clearAt} from '../world.js';
import {prepareTreeDetail,updateTreeCanopies} from '../tree-scenery.js';
import {disposeCue} from '../ground-cues.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function release(world){world.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();disposeCue(o);if(o.userData.ownedGeometry)o.geometry.dispose();});}
const footprints=w=>w.obstacles.map(o=>[o.x,o.z,o.r,o.tactic,o.hp]);
const clearGrid=w=>Array.from({length:35},(_,x)=>Array.from({length:35},(_,z)=>clearAt(w,x*5-85,z*5-85,.45)));

test('nine regional trees have distinct branch architectures, bounded meshes and three usable LODs',()=>{
 const fingerprints=new Set();
 for(const forms of Object.values(BIOME_TREE_FORMS))for(const form of forms)for(const variant of [0,1]){
  const t=biomeTreeTemplate(form,variant);assert.strictEqual(biomeTreeTemplate(form,variant),t);
  fingerprints.add(hash(t.boughs));assert(t.minLeafY>3.3,form+' branches fall to floor');assert(t.height>5.5&&t.height<9.1);
  const stem=t.boughs[0],curve=new T.CatmullRomCurve3(stem.points.map(p=>new T.Vector3(...p))),pos=t.trunk.attributes.position,norm=t.trunk.attributes.normal;
  // First non-root ring of the continuous trunk must shade outward. Inward
  // winding is invisible to WebGL's default front-face material.
  const sides=form==='snow-spire'||form==='snow-wind'?10:11,steps=form==='snow-spire'||form==='snow-wind'?17:form==='snow-veteran'?15:16,center=curve.getPoint(1/steps);
  for(let i=sides;i<sides*2;i++){const radial=new T.Vector3().fromBufferAttribute(pos,i).sub(center);assert(radial.dot(new T.Vector3().fromBufferAttribute(norm,i))>0,form+' trunk winding faces inward');}
  const counts=[];
  for(const level of [0,1,2]){
   const g=t.makeLOD(level);assert.strictEqual(g,t.lods[level]);assert.strictEqual(t.makeLOD(level),g);
   for(const geometry of [t.trunk,g]){
    assert.equal(geometry.groups.length,0);assert([...geometry.attributes.position.array,...geometry.attributes.normal.array,...geometry.attributes.color.array].every(Number.isFinite));
    assert([...geometry.attributes.color.array].every(n=>n>=0&&n<=1));assert(geometry.boundingBox&&!geometry.boundingBox.isEmpty());
   }
   counts.push((t.trunk.index.count+g.index.count)/3);assert(counts.at(-1)<=3900);
   assert(g.boundingBox.min.y+3.35>3.3,'LOD introduced low leaf surfaces');
  }
  assert(counts[0]>counts[1]&&counts[1]>counts[2],form+' has duplicate detail levels');
 }
 assert.equal(fingerprints.size,18);assert.equal(biomeTreeTemplate('forest'),null);
});

test('regional selection replaces only natural shapes, keeps obstacle footprints, rewards and walkable routes exact',async()=>{
 for(const id of ['snow','ash','sand','coast'])for(const seed of [7,522]){
  const w=buildWorld(id,seed),before=footprints(w),clear=clearGrid(w),rewards=hash(w.sites.map(s=>[s.x,s.z,s.type,s.event,s.availableAt]));
  const protectedRoots=w.obstacles.filter(o=>o.tactic||o.place||w.breakables?.includes(o)||o.mesh.userData.coastPropKind).map(o=>[o.mesh,[...o.mesh.children]]);
  const state=installBiomeTreeForms(w,id);assert(state&&state.trees.length>2);assert(state.trees.length<=(id==='snow'?36:8));assert(Object.keys(state.forms).length>=2);
  assert.strictEqual(installBiomeTreeForms(w,id),state);assert.deepEqual(footprints(w),before);assert.deepEqual(clearGrid(w),clear);assert.equal(hash(w.sites.map(s=>[s.x,s.z,s.type,s.event,s.availableAt])),rewards);
  for(const [root,children] of protectedRoots)assert.deepEqual(root.children,children);
  const resources=await prepareTreeDetail(w,{yieldWork:async()=>{}});w.group.updateMatrixWorld(true);
  for(const record of state.trees){
   const {root}=record,o=w.obstacles.find(o=>o.mesh===root),trunk=root.getObjectByName('tree-trunk'),crown=root.getObjectByName('tree-canopy');assert.equal(root.children.length,2);
   const template=crown.userData.treeTemplate,p=trunk.geometry.attributes.position;
   for(let i=0;i<p.count;i++)if(p.getY(i)*trunk.scale.y<2.7)assert(Math.hypot(p.getX(i)*trunk.scale.x,p.getZ(i)*trunk.scale.z)<o.r,'solid trunk exceeds old occupied footprint');
   const bounds=new T.Box3().setFromObject(crown);assert(bounds.min.y>=3.39,'canopy blocks human height');assert(resources.some(r=>r.geometry===template.lods[0]));
   for(const mesh of root.children){assert(!mesh.userData.ownedGeometry);assert(!mesh.material.transparent);assert(mesh.castShadow&&mesh.receiveShadow);}
  }
  const snapshot=state.trees.map(t=>[t.x,t.z,t.form,t.variant]),copy=buildWorld(id,seed);assert.deepEqual(installBiomeTreeForms(copy,id).trees.map(t=>[t.x,t.z,t.form,t.variant]),snapshot);release(copy);release(w);
 }
});

test('regional trees reuse animated-tree resources, pause at game time and retain shared buffers after restart',async()=>{
 const w=buildWorld('snow',19),state=installBiomeTreeForms(w,'snow'),leaf=state.trees[0].root.getObjectByName('tree-canopy'),record=w.foliage.find(r=>r.leaf===leaf);
 assert(record);await prepareTreeDetail(w,{yieldWork:async()=>{}});const cached=leaf.userData.treeTemplate;
 updateTreeCanopies([record],3,record.leaf.parent.position.x,record.leaf.parent.position.z);const pose=[...leaf.position,...leaf.quaternion];
 updateTreeCanopies([record],3,record.leaf.parent.position.x,record.leaf.parent.position.z);assert.deepEqual([...leaf.position,...leaf.quaternion],pose);assert.equal(leaf.userData.treeLOD,0);
 const geometry=leaf.geometry;release(w);const w2=buildWorld('snow',19),state2=installBiomeTreeForms(w2,'snow'),leaf2=state2.trees[0].root.getObjectByName('tree-canopy');
 assert.strictEqual(leaf2.userData.treeTemplate,cached);assert(geometry.attributes.position.count>0);release(w2);
});

test('forest is unchanged and confluence modifies only nonforest trees in their existing regions',()=>{
 const forest=buildWorld('forest',7),nodes=[];forest.group.traverse(o=>nodes.push([o.uuid,o.geometry?.uuid,o.material?.uuid]));
 assert.equal(installBiomeTreeForms(forest,'forest'),null);const after=[];forest.group.traverse(o=>after.push([o.uuid,o.geometry?.uuid,o.material?.uuid]));assert.deepEqual(after,nodes);release(forest);
 const w=buildWorld('confluence',7),before=footprints(w),forestMeshes=w.obstacles.filter(o=>o.biome==='forest').map(o=>[o.mesh,[...o.mesh.children]]),state=installBiomeTreeForms(w,'confluence');
 assert(state.trees.length>10);assert(state.regions.length>=3);assert.deepEqual(footprints(w),before);
 for(const [root,children] of forestMeshes)assert.deepEqual(root.children,children);
 for(const region of w.regions)for(const t of region.biomeTreeForms?.trees||[]){const leaf=t.root.getObjectByName('tree-canopy');assert(region.foliage.some(f=>f.leaf===leaf),'joined map animation registry missing');}
 release(w);
});
