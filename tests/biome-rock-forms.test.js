import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {ASH_ROCK_FORMS,biomeRockTemplate,installBiomeRockForms} from '../biome-rock-forms.js';
import {installBiomeTreeForms} from '../biome-tree-forms.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {buildWorld,clearAt} from '../world.js';
import {disposeCue} from '../ground-cues.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
function release(world){world.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();disposeCue(o);if(o.userData.ownedGeometry)o.geometry.dispose();});}

test('three ash masses are closed small meshes with different heights and shared local stone materials',()=>{
 const heights=[];
 for(const form of ASH_ROCK_FORMS)for(const variant of [0,1]){
  const t=biomeRockTemplate(form,variant),g=t.geometry,p=g.attributes.position,edges=new Map();assert.strictEqual(biomeRockTemplate(form,variant),t);assert(t.triangles<=180);heights.push(t.height);
  assert([...p.array,...g.attributes.normal.array,...g.attributes.color.array].every(Number.isFinite));
  for(let i=0;i<p.count;i++)assert(Math.hypot(p.getX(i),p.getZ(i))<.615,'rock exceeds minimum collider');
  for(let i=0;i<g.index.count;i+=3)for(const [a,b]of [[0,1],[1,2],[2,0]]){const x=g.index.getX(i+a),y=g.index.getX(i+b),key=Math.min(x,y)+':'+Math.max(x,y);edges.set(key,(edges.get(key)||0)+1);}
  assert([...edges.values()].every(count=>count===2),'a fractured mass is an open sheet');assert(g.boundingBox.min.y<0,'base cannot sit into ground');
 }
 assert(Math.max(...heights)-Math.min(...heights)>2);assert.equal(biomeRockTemplate('forest-rock'),null);
});

test('ash replacement changes visible height and silhouette while retaining all walkability and reward positions',()=>{
 for(const id of ['ash','confluence']){
  const w=buildWorld(id,522);polishEnvironmentModels(w);installBiomeTreeForms(w,id);
  const footprints=w.obstacles.map(o=>[o.x,o.z,o.r]),sites=w.sites.map(s=>[s.x,s.z,s.event,s.type]),clear=[];for(let x=-90;x<90;x+=5)for(let z=-90;z<90;z+=5)clear.push(clearAt(w,x,z,.45));
  const trees=w.obstacles.filter(o=>o.mesh.userData.treeBiome).map(o=>[o.mesh,[...o.mesh.children]]),oldMaterials=new Set();w.group.traverse(o=>{if(o.isMesh)oldMaterials.add(o.material);});
  const state=installBiomeRockForms(w,id);assert(state?.rocks.length>10);assert.strictEqual(installBiomeRockForms(w,id),state);
  assert.deepEqual(w.obstacles.map(o=>[o.x,o.z,o.r]),footprints);assert.deepEqual(w.sites.map(s=>[s.x,s.z,s.event,s.type]),sites);
  let i=0;for(let x=-90;x<90;x+=5)for(let z=-90;z<90;z+=5)assert.equal(clearAt(w,x,z,.45),clear[i++]);
  for(const [root,children]of trees)assert.deepEqual(root.children,children);
  const forms=new Set();w.group.updateMatrixWorld(true);
  for(const record of state.rocks){
   forms.add(record.form);assert.equal(record.root.children.length,1);const mesh=record.root.children[0],height=new T.Box3().setFromObject(mesh).max.y-record.root.position.y;
   assert(Math.abs(height-record.height)<1e-6);assert(oldMaterials.has(mesh.material));assert(!mesh.userData.ownedGeometry);assert(mesh.castShadow&&mesh.receiveShadow);assert(!mesh.material.transparent);
  }
  assert.equal(forms.size,3);assert(state.rocks.length<=96);release(w);
 }
 for(const id of ['forest','snow','sand','coast']){const w=buildWorld(id,1);assert.equal(installBiomeRockForms(w,id),null);release(w);}
});
