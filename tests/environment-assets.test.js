import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {buildWorld} from '../world.js';
import {installForestVista} from '../forest-vista.js';
import {installForestHabitats} from '../forest-habitats.js';
import {installBiomePlaces} from '../biome-places.js';
import {installEnvironmentClusters} from '../environment-clusters.js';
import {polishEnvironmentModels} from '../environment-props.js';
import {createOverheadQuery} from '../adventure-overheads.js';
import {ENVIRONMENT_MODELS,installEnvironmentAssets,updateEnvironmentAssets,environmentLOD} from '../environment-assets.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const maps=['forest','snow','ash','sand','coast','confluence'];
const create=(id,seed=7)=>{const w=buildWorld(id,seed);polishEnvironmentModels(w);installForestVista(w,id);installForestHabitats(w,id);installBiomePlaces(w,id);installEnvironmentClusters(w,id);w.overhead=createOverheadQuery(w);return w;};
const cleanup=w=>{w.environmentAssets?.dispose();w.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();});};
const snapshot=w=>JSON.stringify({spawn:w.spawn,sites:w.sites.map(s=>[s.x,s.z,s.type,s.event,s.availableAt,s.claimed,s.discovered]),obstacles:w.obstacles.map(o=>[o.x,o.z,o.r,o.sceneryHeight,o.mesh.position.toArray(),o.mesh.rotation.toArray(),o.mesh.scale.toArray()]),patches:w.patches.map(p=>[p.x,p.z,p.rx,p.rz,p.r,p.kind]),breakables:w.breakables.map(p=>[p.x,p.z,p.state]),roads:w.road,places:w.biomePlaces.map(p=>[p.x,p.z,p.angle,p.entrance,p.exit]),clusters:w.environmentClusters.records.map(({obstacle,...r})=>r)});
const assetPath=name=>new URL('../assets/environment/models/'+name,import.meta.url);

function jpegDimensions(bytes){
 assert.equal(bytes.readUInt16BE(0),0xffd8);
 for(let i=2;i<bytes.length;){
  const marker=bytes[i+1],size=bytes.readUInt16BE(i+2);
  if([0xc0,0xc1,0xc2].includes(marker))return[bytes.readUInt16BE(i+7),bytes.readUInt16BE(i+5)];
  i+=size+2;
 }
 throw new Error('JPEG has no frame header');
}

test('shipped scans have three real bounded LODs, 512px PBR textures, identity transforms and verified provenance',()=>{
 const manifest=JSON.parse(readFileSync(assetPath('sources.json')));
 assert.equal(manifest.assets.length,3);
 assert.match(readFileSync(assetPath('CC0-1.0.txt'),'utf8'),/CC0 1\.0 Universal/);
 let total=0;
 for(const asset of manifest.assets){
  const bytes=readFileSync(assetPath(asset.file)),jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength)),binary=bytes.subarray(28+jsonLength);
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
  assert.equal(asset.license,'CC0-1.0');assert.match(asset.source,/^https:\/\/polyhaven\.com\/a\//);assert(asset.authors&&Object.keys(asset.authors).length);
  assert(asset.sourceFiles.some(f=>f.file.endsWith('.bin')),'a texture-only download is not a mesh source');
  assert(asset.sourceFiles.every(f=>f.sha256.length===64&&f.url.startsWith('https://dl.polyhaven.org/')));
  assert.equal(gltf.meshes.length,3);assert.equal(gltf.materials.length,1);assert.equal(gltf.images.length,3);assert.equal(gltf.extensionsRequired,undefined);
  for(const node of gltf.nodes){assert(!node.matrix&&!node.translation&&!node.rotation&&!node.scale);assert.match(node.name,/_LOD[012]$/);}
  for(const [i,mesh]of gltf.meshes.entries()){
   assert.equal(mesh.primitives.length,1);const p=mesh.primitives[0],position=gltf.accessors[p.attributes.POSITION],index=gltf.accessors[p.indices];
   assert(index.count/3<=[1800,700,180][i]);assert(index.count/3>=([1800,700,180][i]-2));
   assert.equal(p.material,0);assert.notEqual(p.attributes.NORMAL,undefined);assert.notEqual(p.attributes.TEXCOORD_0,undefined);assert.equal(p.attributes.COLOR_0,undefined,'unused source colours must not darken the PBR map a second time');
   assert(position.min[1]>-.005&&position.min[1]<.005);assert(position.max[1]>.4&&position.max[1]<.9);
   assert([...position.min,...position.max].every(v=>Number.isFinite(v)&&Math.abs(v)<=1.02));
  }
  const material=gltf.materials[0];assert(material.normalTexture&&material.occlusionTexture&&material.pbrMetallicRoughness.metallicRoughnessTexture);assert.equal(material.pbrMetallicRoughness.metallicFactor,0);
  for(const image of gltf.images){assert.equal(image.uri,undefined);assert.equal(image.mimeType,'image/jpeg');const view=gltf.bufferViews[image.bufferView];assert.deepEqual(jpegDimensions(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength)),[512,512]);}
  total+=bytes.length;
 }
 assert(total<1_000_000,'the environment add-on exceeded its 1 MB delivery budget');
});

function templates(){
 const shared=new T.MeshStandardMaterial({color:0x888177,roughness:.8});
 const geometry=new T.BoxGeometry(1,.8,1).translate(0,.4,0);geometry.computeBoundingBox();
 return new Map(Object.keys(ENVIRONMENT_MODELS).map(id=>[id,{height:.8,lods:[0,1,2].map(()=>({geometry,material:shared}))}]));
}

test('all five biomes and the combined map retain placement, collision, rewards and roads when scans replace only stone surfaces',()=>{
 const models=templates();
 for(const id of maps){
  const world=create(id),before=snapshot(world),obstacles=world.obstacles.slice(),oldChildren=world.group.children.slice(),state=installEnvironmentAssets(world,models);
  assert.equal(snapshot(world),before,id+' gameplay layout changed');assert.deepEqual(world.obstacles,obstacles);
  assert.strictEqual(installEnvironmentAssets(world,models),state,'repeat installation duplicated scenery');
  assert(state.records.length>0,id+' has no scanned environment geometry');assert.strictEqual(state.group.parent,world.group);
  for(const biome of id==='confluence'?maps.slice(0,5):[id])assert(state.records.some(r=>r.biome===biome),biome+' is missing from '+id);
  assert(state.hidden.length>0,id+' did not replace old geometry');
  for(const entry of state.hidden){assert.equal(entry.mesh.visible,false);assert(!world.overhead.meshes.includes(entry.mesh),'hiding an overhead collider changes projectile/ceiling queries');if(entry.mesh.isInstancedMesh)assert(['stone','snow'].includes(entry.mesh.userData.clusterSurface));}
  assert(oldChildren.every(child=>child.parent===world.group),'an unrelated scene group was removed');
  assert(state.batches.length<=39,'replacement lost batch sharing');assert.equal(state.batches.reduce((n,b)=>n+b.mesh.count,0),state.records.length,'one object was rendered in more than one LOD');
  for(const batch of state.batches){assert.equal(batch.mesh.visible,batch.mesh.count>0);assert(batch.mesh.castShadow&&batch.mesh.receiveShadow);assert.strictEqual(batch.mesh.geometry,models.get(batch.records[0].id).lods[batch.level].geometry);}
  cleanup(world);
 }
});

test('LOD boundaries are exact, mobile changes only distances, and distant scenery stays visible past 80m',()=>{
 for(const mobile of[false,true]){
  const factor=mobile?.75:1;
  for(const[d,expected]of[[0,0],[9.999,0],[10,1],[29.999,1],[30,2],[79.999,2],[80,2],[500,2]])assert.equal(environmentLOD(d*factor,mobile),expected,'distance '+d+' mobile '+mobile);
 }
 const world=create('forest'),state=installEnvironmentAssets(world,templates()),focus=new T.Vector3();
 for(const mobile of[false,true])for(const distance of[0,15,45,1000]){
  const first=state.records[0];focus.set(first.x+distance,first.y,first.z);updateEnvironmentAssets(world,focus,mobile,true);
  assert.equal(state.levels.reduce((n,v)=>n+v,0),state.records.length);
  for(const record of state.records)assert.equal(record.level,environmentLOD(focus.distanceTo(new T.Vector3(record.x,record.y,record.z)),mobile));
  assert.equal(state.batches.reduce((n,b)=>n+b.mesh.count,0),state.records.length);
  for(const batch of state.batches){
   assert.equal(batch.mesh.count,batch.records.filter(r=>r.level===batch.level).length);assert.equal(batch.mesh.visible,batch.mesh.count>0);
   const expected=batch.records.filter(r=>r.level===batch.level),matrix=new T.Matrix4();
   for(let i=0;i<batch.mesh.count;i++){batch.mesh.getMatrixAt(i,matrix);assert(matrix.elements.every((v,j)=>Math.abs(v-expected[i].matrix.elements[j])<.00002),'LOD matrix moved the object');}
  }
  if(distance===1000)assert.deepEqual(state.levels,[0,0,state.records.length]);
 }
 const versions=state.batches.map(b=>b.mesh.instanceMatrix.version);updateEnvironmentAssets(world,focus,true);assert.deepEqual(state.batches.map(b=>b.mesh.instanceMatrix.version),versions,'stationary camera rewrote every instance buffer');
 cleanup(world);
});

test('moving LODs retain the full-rebuild output while only changed material/level buffers upload',t=>{
 const models=templates(),create=()=>({group:new T.Group(),obstacles:[],spawn:{x:0,z:0},environmentClusters:{records:[
  {biome:'forest',variant:0,x:0,z:0,angle:.2,scale:1},{biome:'forest',variant:1,x:14,z:2,angle:-.3,scale:1},
  {biome:'snow',variant:0,x:72,z:45,angle:.7,scale:1}
 ]}}),world=create(),reference=create(),state=installEnvironmentAssets(world,models),before=installEnvironmentAssets(reference,models),focus=new T.Vector3();
 function legacy(focus,mobile,force){
  if(!force&&before.mobile===mobile&&before.focus.distanceToSquared(focus)<.25)return;
  before.focus.copy(focus);before.mobile=mobile;let changed=force;before.levels.fill(0);
  for(const r of before.records){const level=environmentLOD(Math.hypot(focus.x-r.x,focus.y-r.y,focus.z-r.z),mobile);changed ||= level!==r.level;r.level=level;before.levels[level]++;}
  if(!changed)return;
  for(const batch of before.batches){let count=0;for(const r of batch.records)if(r.level===batch.level)batch.mesh.setMatrixAt(count++,r.matrix);batch.mesh.count=count;batch.mesh.visible=count>0;batch.mesh.instanceMatrix.needsUpdate=true;}
 }
 let uploads=0,legacyUploads=0,writes=0,legacyWrites=0,unchanged=0;
 for(const [s,record]of[[state,()=>writes++],[before,()=>legacyWrites++]])for(const b of s.batches){const set=b.mesh.setMatrixAt;b.mesh.setMatrixAt=function(...args){record();return set.apply(this,args);};}
 const run=(x,z,mobile=false,force=false)=>{
  focus.set(x,1.7,z);const levels=state.records.map(r=>r.level),versions=state.batches.map(b=>b.mesh.instanceMatrix.version),oldVersions=before.batches.map(b=>b.mesh.instanceMatrix.version);
  legacy(focus,mobile,force);updateEnvironmentAssets(world,focus,mobile,force);
  assert.deepEqual(state.levels,before.levels);assert.deepEqual(state.records.map(r=>r.level),before.records.map(r=>r.level));
  for(const [i,batch]of state.batches.entries()){
   const expected=before.batches[i],changed=force||batch.records.some(r=>{const previous=levels[state.records.indexOf(r)];return previous!==r.level&&(previous===batch.level||r.level===batch.level);});
   assert.equal(batch.mesh.instanceMatrix.version-versions[i],Number(changed),'unrelated material/LOD buffer uploaded');unchanged+=Number(!changed);
   assert.equal(batch.mesh.count,expected.mesh.count);assert.equal(batch.mesh.visible,expected.mesh.visible);assert.deepEqual(batch.mesh.instanceMatrix.array,expected.mesh.instanceMatrix.array,'batch record order or transform changed');
   uploads+=batch.mesh.instanceMatrix.version-versions[i];legacyUploads+=expected.mesh.instanceMatrix.version-oldVersions[i];
  }
 };
 try{
  for(let i=0;i<75;i++)run(i*.6,0);run(44.5,0);run(44.5,0,true);run(44.5,0,true,true);
  for(let i=0;i<75;i++)run(44.5-i*.6,0,true);run(0,0,false);run(0,0,false,true);
  assert(unchanged>0);assert(uploads<legacyUploads*.6,'single crossings still upload most unrelated LOD buffers');assert(writes<legacyWrites*.6,'unchanged instances are still rewritten');
  t.diagnostic(`LOD path: buffer uploads ${legacyUploads} -> ${uploads}; matrix writes ${legacyWrites} -> ${writes}; identical rendered records and transforms.`);
 }finally{cleanup(world);cleanup(reference);}
});

test('disposing one map releases its buffers and material clones once, restores fallbacks and preserves shared models and another map',()=>{
 const models=templates(),world=create('forest'),other=create('snow'),state=installEnvironmentAssets(world,models),otherState=installEnvironmentAssets(other,models);
 let sharedGeometry=0,sharedMaterial=0,buffers=0,materials=0;
 for(const geometry of new Set([...models.values()].flatMap(m=>m.lods.map(l=>l.geometry))))geometry.addEventListener('dispose',()=>sharedGeometry++);
 for(const material of new Set([...models.values()].flatMap(m=>m.lods.map(l=>l.material))))material.addEventListener('dispose',()=>sharedMaterial++);
 for(const batch of state.batches)batch.mesh.addEventListener('dispose',()=>buffers++);
 for(const material of state.materials.values())material.addEventListener('dispose',()=>materials++);
 state.dispose();state.dispose();updateEnvironmentAssets(world,new T.Vector3(20,2,0),false,true);
 assert(state.disposed);assert.equal(state.group.parent,null);assert.equal(buffers,state.batches.length);assert.equal(materials,state.materials.size);
 assert.equal(sharedGeometry,0);assert.equal(sharedMaterial,0);for(const h of state.hidden)assert.equal(h.mesh.visible,h.visible);
 assert.strictEqual(otherState.group.parent,other.group);assert(otherState.batches.some(b=>b.mesh.visible));assert(!otherState.disposed);
 cleanup(world);cleanup(other);assert.equal(sharedGeometry,0);assert.equal(sharedMaterial,0);
});

test('empty and partial asset sets retain original scenery without touching world gameplay',()=>{
 for(const models of[new Map(),new Map([['weathered-rock-a',templates().get('weathered-rock-a')]])]){
  const world=create('forest'),before=snapshot(world),batches=world.environmentClusters.group.children.map(mesh=>({mesh,visible:mesh.visible}));
  const state=installEnvironmentAssets(world,models);assert.equal(snapshot(world),before);assert.equal(state.records.length,0);assert.equal(state.hidden.length,0);
  for(const entry of batches)assert.equal(entry.mesh.visible,entry.visible);cleanup(world);
 }
});

test('model loading is a single cached request, bakes node transforms and tolerates one unavailable asset',async()=>{
 const module=await import('../environment-assets.js?asset-load-regression'),calls=[],sourceGeometries=[];
 const loader={loadAsync:async url=>{
  calls.push(url);const entry=Object.entries(ENVIRONMENT_MODELS).find(([,asset])=>url.endsWith(asset.file));assert(entry);
  if(entry[0]==='old-stump')throw new Error('intentional missing asset');
  const scene=new T.Group();scene.position.y=.1;
  for(let i=0;i<3;i++){const geometry=new T.BoxGeometry(1,.8,1).translate(0,.4,0),mesh=new T.Mesh(geometry,new T.MeshStandardMaterial());mesh.name=entry[1].node+'_LOD'+i;scene.add(mesh);sourceGeometries.push(geometry);}
  return{scene};
 }};
 const oldWarn=console.warn,warnings=[];console.warn=(...args)=>warnings.push(args.join(' '));
 try{
  const first=module.loadEnvironmentAssets({loader}),second=module.loadEnvironmentAssets({loader});assert.strictEqual(first,second);
  const models=await first;assert.equal(calls.length,3);assert.equal(models.size,2);assert(!models.has('old-stump'));assert.equal(warnings.length,1);
  for(const model of models.values()){assert.equal(model.lods.length,3);assert(Math.abs(model.height-.9)<1e-6);for(const lod of model.lods){assert(!sourceGeometries.includes(lod.geometry));assert(Math.abs(lod.geometry.boundingBox.min.y-.1)<1e-6);}}
  assert.strictEqual(await module.loadEnvironmentAssets({loader}),models);assert.equal(calls.length,3);
 }finally{console.warn=oldWarn;}
});

test('real decimated scan vertices remain within the established cluster collision and height envelopes',()=>{
 const models=new Map(),material=new T.MeshStandardMaterial(),point=new T.Vector3();
 for(const[id,asset]of Object.entries(ENVIRONMENT_MODELS)){
  const bytes=readFileSync(new URL('../'+asset.file,import.meta.url)),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length)),binary=bytes.subarray(28+length);
  const lods=json.meshes.map(mesh=>{
   const accessor=json.accessors[mesh.primitives[0].attributes.POSITION],view=json.bufferViews[accessor.bufferView],start=(view.byteOffset||0)+(accessor.byteOffset||0),stride=view.byteStride||12,values=[];
   for(let i=0;i<accessor.count;i++)for(let k=0;k<3;k++)values.push(binary.readFloatLE(start+i*stride+k*4));
   const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(values,3));geometry.computeBoundingBox();return{geometry,material};
  });models.set(id,{lods,height:lods[0].geometry.boundingBox.max.y});
 }
 for(const id of maps.slice(0,4)){
  const world=create(id),state=installEnvironmentAssets(world,models);
  for(const record of state.records){
   const source=world.environmentClusters.records.find(r=>r.biome===record.biome&&Math.hypot(record.x-r.x,record.z-r.z)<=r.footprint);assert(source);
   for(const lod of record.model.lods){const positions=lod.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(record.matrix);assert(Math.hypot(point.x-source.x,point.z-source.z)<=source.footprint+.001,id+' scan extends beyond collision cylinder');assert(point.y<=source.height+.001,id+' scan extends above collision height');}
   }
  }
  cleanup(world);
 }
 for(const model of models.values())for(const lod of model.lods)lod.geometry.dispose();material.dispose();
});
