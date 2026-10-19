import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {addTree,prepareTreeDetail,updateTreeDetail} from '../tree-scenery.js';
import {forestTreeFormTemplate} from '../forest-tree-forms.js';

test('loading builds only the six used shared tree templates and leaves live tree state intact',async()=>{
 const world={group:new T.Group(),foliage:[],regions:[{foliage:[]},{foliage:[]}]},before=[];
 for(const [region,biome]of ['forest','snow'].entries())for(let copy=0;copy<10;copy++)for(const angle of[0,1,1.5]){
  const root=new T.Group();root.position.set(copy*8,0,region*80);world.group.add(root);
  const leaf=addTree(root,biome,4,{angle}),record={leaf,x:leaf.position.x,z:leaf.position.z,phase:copy*.3};
  world.foliage.push(record);world.regions[region].foliage.push(record);
  before.push({leaf,root,geometry:leaf.geometry,material:leaf.material,position:leaf.position.clone(),rotation:leaf.quaternion.clone(),scale:leaf.scale.clone()});
 }
 const templates=new Set(world.foliage.map(({leaf})=>leaf.userData.treeTemplate));assert.equal(templates.size,6);
 for(const template of templates)assert.deepEqual(template.lods,[null,null,template.canopy]);
 let yields=0;const reports=[];
 const resources=await prepareTreeDetail(world,{yieldWork:async()=>{yields++;},report:(done,total)=>reports.push([done,total])});
 assert.equal(yields,12);assert.equal(resources.length,18);assert.equal(new Set(resources.map(r=>r.geometry)).size,18);
 assert.deepEqual(reports,Array.from({length:19},(_,i)=>[i,18]));assert.equal(world.group.children.length,60);
 for(const {leaf,root,geometry,material,position,rotation,scale}of before){
  assert.equal(leaf.parent,root);assert.equal(root.children.length,2);assert.equal(leaf.geometry,geometry);assert.equal(leaf.material,material);assert.equal(leaf.userData.treeLOD,2);
  assert(leaf.position.equals(position)&&leaf.quaternion.equals(rotation)&&leaf.scale.equals(scale));
  const template=leaf.userData.treeTemplate;assert.equal(template.lods.length,3);
  for(const [distance,level]of [[5,0],[20,1],[40,2]]){
   updateTreeDetail(leaf,root.position.x+distance,root.position.z);
   const resource=resources.find(r=>r.geometry===leaf.geometry);assert(resource);assert.equal(resource.geometry,template.lods[level]);assert.equal(resource.level,level);assert.equal(resource.material,material);
  }
 }
 assert.deepEqual(await prepareTreeDetail(world,{yieldWork:async()=>assert.fail('cached LODs were rebuilt')}),resources);
});

test('authored forest forms expose existing LOD buffers and unused or detached templates are excluded',async()=>{
 const template=forestTreeFormTemplate('oak',1),lods=template.lods.slice(),root=new T.Group(),leaf=addTree(root,'forest',4),unused=addTree(new T.Group(),'snow',4);
 leaf.userData.treeTemplate=template;leaf.geometry=template.canopy;unused.removeFromParent();
 const resources=await prepareTreeDetail({foliage:[{leaf},{leaf:unused}]},{yieldWork:async()=>assert.fail('authored LODs already exist')});
 assert.deepEqual(resources.map(r=>r.geometry),lods);assert(resources.every(r=>r.material===leaf.material));assert.equal(root.children.length,2);assert.equal(leaf.geometry,template.canopy);
 assert.deepEqual(template.lods,lods);assert.deepEqual(await prepareTreeDetail({foliage:[]}),[]);
});
