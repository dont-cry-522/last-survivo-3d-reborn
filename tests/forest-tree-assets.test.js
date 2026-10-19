import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {installForestTreeForms} from '../forest-tree-forms.js';
import {addTree,animateTreeCanopy,updateTreeDetail} from '../tree-scenery.js';
const source=readFileSync(new URL('../forest-tree-forms.js',import.meta.url),'utf8');
const runtimePath=source.match(/from ['"](.\/forest-tree-assets\.js[^'"]*)['"]/)[1];
const {FOREST_TREE_ASSETS,loadForestTreeAssets,forestTreeAssetTemplate}=await import(new URL('../'+runtimePath,import.meta.url));

test('startup preload and tree installation share the same versioned module/cache',()=>{
 const main=readFileSync(new URL('../main.js',import.meta.url),'utf8');
 assert.equal(main.match(/from ['"](.\/forest-tree-assets\.js[^'"]*)['"]/)[1],runtimePath);
});

function readGLB(file){
 const data=readFileSync(new URL('../'+file,import.meta.url)),length=data.readUInt32LE(12);
 return{data,json:JSON.parse(data.subarray(20,20+length)),binary:data.subarray(28+length)};
}
function imageSize(bytes){
 if(bytes.readUInt32BE(0)===0x89504e47)return[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 assert.equal(bytes.readUInt16BE(0),0xffd8);
 for(let i=2;i<bytes.length;){
  const marker=bytes[i+1],size=bytes.readUInt16BE(i+2);
  if([0xc0,0xc1,0xc2].includes(marker))return[bytes.readUInt16BE(i+7),bytes.readUInt16BE(i+5)];
  i+=size+2;
 }
 throw Error('Missing image dimensions');
}
const manifest=JSON.parse(readFileSync(new URL('../assets/environment/forest-trees-v222/sources.json',import.meta.url)));

test('actual downloaded source meshes and three delivery LODs have bounded local geometry/textures and CC0 evidence',()=>{
 assert.equal(manifest.license,'CC0-1.0');assert.equal(manifest.edition,'Standard FREE');
 assert.match(manifest.source,/quaternius\.com\/packs\/stylizednaturemegakit/);
 assert.match(readFileSync(new URL('../assets/environment/forest-trees-v222/LICENSE.txt',import.meta.url),'utf8'),/CC0 1\.0 Universal/);
 const signatures=new Set();let total=0;
 for(const asset of manifest.assets){
  const {data,json,binary}=readGLB(FOREST_TREE_ASSETS[asset.id]);total+=data.length;
  assert.equal(createHash('sha256').update(data).digest('hex'),asset.sha256);assert.equal(data.length,asset.bytes);
  assert(asset.sourceFiles.some(p=>p.name.endsWith('.bin')&&p.bytes>100000));
  assert.equal(json.meshes.length,4);assert.equal(json.materials.length,2);assert.equal(json.extensionsRequired,undefined);
  assert(json.buffers.every(b=>!b.uri));assert(json.images.every(i=>!i.uri));
  assert(asset.nodes[0].triangles<=1100);assert(asset.nodes[1].triangles>asset.nodes[2].triangles&&asset.nodes[2].triangles>asset.nodes[3].triangles);
  for(const image of json.images){const v=json.bufferViews[image.bufferView];assert.deepEqual(imageSize(binary.subarray(v.byteOffset,v.byteOffset+v.byteLength)),[512,512]);}
  signatures.add(asset.sourceModel);
  for(const node of json.nodes){assert(!node.matrix&&!node.translation&&!node.rotation&&!node.scale);assert.match(node.name,/^SM_Tree_/);}
 }
 assert.equal(signatures.size,2,'same source with different scale is not model diversity');
 assert(total<1_500_000,'two-tree local delivery exceeded 1.5 MB');
});

// Read real shipped geometry without requiring a DOM image decoder. Materials
// remain real Three.js objects; the game tests and screenshots cover WebGL.
function parseScene(file){
 const {json,binary}=readGLB(file),scene=new T.Group();
 const attribute=index=>{
  const a=json.accessors[index],v=json.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],Type={5126:Float32Array,5125:Uint32Array,5123:Uint16Array,5121:Uint8Array}[a.componentType];
  const start=(v.byteOffset||0)+(a.byteOffset||0),bytes=binary.subarray(start,start+a.count*size*Type.BYTES_PER_ELEMENT);
  return new T.BufferAttribute(new Type(Uint8Array.from(bytes).buffer),size,!!a.normalized);
 };
 const materials=json.materials.map(()=>new T.MeshStandardMaterial({map:new T.Texture(),normalMap:new T.Texture()}));
 for(const node of json.nodes){
  const p=json.meshes[node.mesh].primitives[0],g=new T.BufferGeometry();
  for(const [source,name]of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv']])g.setAttribute(name,attribute(p.attributes[source]));
  g.setIndex(attribute(p.indices));const mesh=new T.Mesh(g,materials[p.material]);mesh.name=node.name;scene.add(mesh);
 }
 return{scene};
}
let loads=0,yields=0;
const loader={loadAsync:async url=>{loads++;return parseScene(Object.values(FOREST_TREE_ASSETS).find(file=>url.endsWith(file)));}};

test('loader keeps exactly two shared assets, valid wind attributes and complete three-level canopies across rebuilds',async()=>{
 const promise=loadForestTreeAssets({loader,yieldWork:async()=>{yields++;}});
 assert.equal(loadForestTreeAssets({loader}),promise);assert.equal((await promise).ready,true);assert.equal(loads,2);assert.equal(yields,2);
 for(const id of Object.keys(FOREST_TREE_ASSETS)){
  const t=forestTreeAssetTemplate(id);assert.equal(forestTreeAssetTemplate(id),t);assert.equal(t.lods.length,3);assert.equal(t.canopy,t.lods[2]);
  assert(t.minLeafY>3.5);assert(t.triangleCounts[0]<4500&&t.triangleCounts[2]<2200);
  for(const g of [t.trunk,...t.lods]){
   assert(g.boundingBox&&g.boundingSphere);assert(g.attributes.position.array.every(Number.isFinite));
   assert(g.attributes.treeSurface.count===g.attributes.position.count);
  }
  for(const g of t.lods)assert(g.attributes.treeLeafFlex.array.every(n=>n>=0&&n<=1));
  assert.equal(t.leafMaterial.map.colorSpace,T.SRGBColorSpace);assert.equal(t.barkMaterial.normalMap.colorSpace,T.NoColorSpace);
  assert.equal(t.leafMaterial.transparent,false);
 }
 assert.equal(forestTreeAssetTemplate('missing'),null);
});

function fixture(){
 const w={group:new T.Group(),obstacles:[],foliage:[],breakables:[],forestJourney:{points:[{x:0,z:0},{x:0,z:120}]}};
 for(let i=0;i<48;i++){
  const root=new T.Group(),x=(i%2?1:-1)*(5+(i%3)*2),z=i*2.5;root.position.set(x,.1*(i%3),z);root.scale.y=1+(i%3)*.08;w.group.add(root);
  const leaf=addTree(root,'forest',4+(i%4)*.2,{angle:i*.8});w.obstacles.push({x,z,r:.65,mesh:root});
  w.foliage.push({leaf,x:leaf.position.x,z:leaf.position.z,phase:i*.7});
 }
 w.breakables.push(w.obstacles[4]);w.obstacles[4].tactic='timber';return w;
}
const anchors=w=>w.obstacles.map(o=>[o.x,o.z,o.r,o.mesh.position.toArray(),o.mesh.scale.toArray(),o.mesh.rotation.toArray()]);

test('source trees visibly replace existing tree slots without new meshes, colliders, disposal or wind clocks',()=>{
 const w=fixture(),before=anchors(w),objects=[];w.group.traverse(o=>objects.push(o));
 const state=installForestTreeForms(w);assert(state.imported['woodland-canopy']>=3&&state.imported['leaning-canopy']>=3);
 assert.deepEqual(anchors(w),before);const after=[];w.group.traverse(o=>after.push(o));assert.deepEqual(after,objects);
 assert.equal(w.breakables[0].mesh.userData.forestTreeForm,undefined);
 assert(state.trees.some(t=>!FOREST_TREE_ASSETS[t.form]),'new assets replaced the entire forest');
 for(const tree of state.trees.filter(t=>FOREST_TREE_ASSETS[t.form])){
  const t=forestTreeAssetTemplate(tree.form),root=tree.root,trunk=root.getObjectByName('tree-trunk'),leaf=root.getObjectByName('tree-canopy');
  assert.equal(trunk.geometry,t.trunk);assert.equal(trunk.material,t.barkMaterial);assert.equal(leaf.material,t.leafMaterial);
  root.updateWorldMatrix(true,true);const pos=trunk.geometry.attributes.position;
  for(let i=0;i<pos.count;i++){
   const v=trunk.localToWorld(new T.Vector3().fromBufferAttribute(pos,i));
   if(v.y-root.position.y<2.3)assert(Math.hypot(v.x-root.position.x,v.z-root.position.z)<=.651,'source stem escaped original collider');
  }
  for(const [distance,level]of [[5,0],[20,1],[40,2]]){updateTreeDetail(leaf,root.position.x+distance,root.position.z);assert.equal(leaf.geometry,t.lods[level]);}
  const record=w.foliage.find(f=>f.leaf===leaf);animateTreeCanopy(leaf,5,record);leaf.updateMatrix();const fixed=leaf.matrix.clone();animateTreeCanopy(leaf,5,record);leaf.updateMatrix();assert(leaf.matrix.equals(fixed));
 }
 const again=fixture(),state2=installForestTreeForms(again);
 assert.deepEqual(state.trees.map(t=>[t.x,t.z,t.form]),state2.trees.map(t=>[t.x,t.z,t.form]));
 assert.equal(loads,2,'scene rebuild loaded the same tree files again');
});

test('failed model processing releases cloned and source geometry plus each shared material/texture exactly once',async()=>{
 const failed=await import('../forest-tree-assets.js?failure-cleanup');const counts=new Map();
 const watch=o=>{counts.set(o,0);o.addEventListener('dispose',()=>counts.set(o,counts.get(o)+1));return o;};
 const loader={loadAsync:async url=>{
  const {scene}=parseScene(Object.values(FOREST_TREE_ASSETS).find(file=>url.endsWith(file))),seen=new Set();
  scene.traverse(o=>{
   if(!o.isMesh)return;watch(o.geometry);const clone=o.geometry.clone.bind(o.geometry);o.geometry.clone=()=>watch(clone());
   if(!seen.has(o.material)){
    seen.add(o.material);watch(o.material);watch(o.material.map);watch(o.material.normalMap);
    o.material.normalScale.setScalar=()=>{throw Error('malformed material test');};
   }
  });return{scene};
 }};
 const old=console.warn;console.warn=()=>{};
 try{assert.equal((await failed.loadForestTreeAssets({loader,yieldWork:async()=>{}})).ready,false);}
 finally{console.warn=old;}
 assert(counts.size>20);assert([...counts.values()].every(n=>n===1),'failure leaked a temporary resource or disposed a shared one repeatedly');
 for(const id of Object.keys(FOREST_TREE_ASSETS))assert.equal(failed.forestTreeAssetTemplate(id),null);
});
