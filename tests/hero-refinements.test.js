import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {HERO_REFINEMENTS} from '../hero-refinement-assets.js';

const base=new URL('../',import.meta.url);
const snapshot=JSON.parse(fs.readFileSync(new URL('./fixtures/hero-v214-bindings.json',import.meta.url),'utf8')).heroes;
// The rest snapshot captured the weighted face, but not its original static
// brows. Bind this one newly refined slot to the unchanged source glTF instead
// of accepting arbitrary new target names or rewriting the old snapshot.
const faceSource=JSON.parse(fs.readFileSync(new URL('assets/characters/lingya-face.gltf',base),'utf8'));
const browIndex=faceSource.meshes.findIndex(mesh=>mesh.name==='Lingya-eyebrows'),browNode=faceSource.nodes.find(node=>node.mesh===browIndex),browPrimitive=faceSource.meshes[browIndex].primitives[0];
assert.equal(browNode.skin,undefined);assert.equal(browPrimitive.targets?.length||0,0);
const browPosition=faceSource.accessors[browPrimitive.attributes.POSITION];
const staticBrow={skinned:false,morphTargets:0,bounds:{min:browPosition.min,max:browPosition.max}};
const files=[...new Set([
 ...HERO_REFINEMENTS.files.map(entry=>entry.file.replace(/-[a-f0-9]{12}(?=\.glb$)/,'')),
 ...HERO_REFINEMENTS.files.map(entry=>entry.file)
])];
const loader=new GLTFLoader();
const results=[];

for(const file of files)test('authored hero asset retains usable rest geometry: '+file,async()=>{
 const data=fs.readFileSync(new URL(file,base));
 assert(data.length<2_000_000,'one hero surface file exceeds its local download budget');
 const jsonLength=data.readUInt32LE(12),json=JSON.parse(data.subarray(20,20+jsonLength).toString());
 assert.equal(json.buffers.length,1);assert(!json.buffers[0].uri,'binary geometry must be embedded');
 assert(!json.extensionsRequired?.some(name=>/draco|meshopt/i.test(name)),'offline geometry must not require another decoder');
 assert(!(json.images||[]).some(image=>image.uri),'replacement surfaces must not introduce external textures');
 const gltf=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 let count=0,triangles=0;
 gltf.scene.traverse(mesh=>{
  if(!mesh.isMesh)return;count++;
  const {kind,targetName,materialMode}=mesh.userData,hero=snapshot[kind];
  assert(hero,file+': unknown hero');assert(targetName,file+': unnamed replacement');
  const original=hero.slots[targetName]||(kind==='lingya'&&targetName==='Lingya-eyebrows'?staticBrow:null);assert(original,file+': target absent from original hero sources: '+targetName);
  assert(['preserve','replace'].includes(materialMode),file+': material ownership unspecified');
  const a=mesh.geometry.attributes,p=a.position,n=a.normal;
  assert(p?.count>0&&n?.count===p.count,'position/normal cardinality mismatch');
  for(const [name,attribute]of Object.entries(a)){
   assert.equal(attribute.count,p.count,targetName+': '+name+' count');
   assert(Array.from(attribute.array).every(Number.isFinite),targetName+': '+name+' contains nonfinite data');
  }
  if(a.color)for(const value of a.color.array)assert(value>=0&&value<=1.00001,targetName+': normalized source colour was exported as an unbounded float');
  assert.equal(mesh.geometry.index.count%3,0);
  for(const index of mesh.geometry.index.array)assert(index>=0&&index<p.count,'triangle index out of range');
  triangles+=mesh.geometry.index.count/3;
  if(original.skinned){
   assert(a._skinindex&&a._skinweight,targetName+': lost authored skinning');
   assert.equal(a._skinindex.itemSize,4);assert.equal(a._skinweight.itemSize,4);
   const sourceNames=mesh.userData.boneNames||original.boneNames||hero.bones;
   assert(sourceNames.every(name=>hero.bones.includes(name)),targetName+': unknown bone name');
   for(let i=0;i<p.count;i++){
    let total=0;
    for(let k=0;k<4;k++){
     const joint=a._skinindex.array[i*4+k],weight=a._skinweight.array[i*4+k];
     assert(Number.isInteger(joint)&&joint>=0&&joint<sourceNames.length,targetName+': invalid joint');
     assert(weight>=0&&weight<=1.00001,targetName+': invalid influence');total+=weight;
    }
    assert(Math.abs(total-1)<1e-5,targetName+': skin weights not normalized');
   }
  }else assert(!a._skinindex&&!a._skinweight,targetName+': static fitting changed rig semantics');
  const morphs=mesh.geometry.morphAttributes.position||[];
  assert.equal(morphs.length,original.morphTargets||0,targetName+': facial morph count changed');
  for(const morphs of Object.values(mesh.geometry.morphAttributes))for(const morph of morphs){
   assert.equal(morph.count,p.count,targetName+': invalid morph correspondence');
   assert(Array.from(morph.array).every(Number.isFinite),targetName+': nonfinite morph deltas');
  }
  mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox;
  // Altered fabric/hair may extend the silhouette, but an axis conversion,
  // baked hero-scale or weapon-space export must not silently shift the part.
  for(const [axis,i]of [['x',0],['y',1],['z',2]]){
   assert(bounds.min[axis]>=original.bounds.min[i]-.24,targetName+': rest-space lower bound changed excessively');
   assert(bounds.max[axis]<=original.bounds.max[i]+.24,targetName+': rest-space upper bound changed excessively');
  }
  for(const name of mesh.userData.hideTargets||[])assert(hero.slots[name],targetName+': hiding unknown source '+name);
 });
 assert(count>0);results.push({file,count,triangles});
});

test('published hero surface manifest covers all seven existing heroes and local files',{
 skip:HERO_REFINEMENTS.files.length===0?'Asset assembly is not yet published in the local manifest':false
},()=>{
 assert.deepEqual(new Set(HERO_REFINEMENTS.files.map(entry=>entry.kind)),new Set(Object.keys(snapshot)));
 const selected=new Set();
 for(const entry of HERO_REFINEMENTS.files){
  assert(snapshot[entry.kind]);
  const path=new URL('../'+entry.file,import.meta.url);
  assert.equal(path.protocol,'file:');assert(fs.existsSync(path),entry.file+' missing');
  assert(!/^https?:/.test(entry.file),'runtime file must be local');
  const key=entry.kind+':'+entry.part;assert(!selected.has(key),'duplicate kind/part '+key);selected.add(key);
  const data=fs.readFileSync(path);assert.equal(data.length,entry.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),entry.sha256);
  assert(data.equals(fs.readFileSync(new URL(entry.file.replace(/-[a-f0-9]{12}(?=\.glb$)/,''),base))),'published hash differs from selected editable source');
 }
 assert.deepEqual(selected,new Set(Object.keys(snapshot).flatMap(kind=>['attire','head'].map(part=>kind+':'+part))));
 for(const file of HERO_REFINEMENTS.provenance)assert(fs.existsSync(new URL(file,base)),'missing attribution '+file);
});

test('v217 selectively retains all delivered v216 surfaces outside its explicit replacement list',{
 skip:HERO_REFINEMENTS.version<217?'No v217 selection has been published':false
},()=>{
 const previous=JSON.parse(fs.readFileSync(new URL('assets/characters/rebuilt-v216/sources.json',base),'utf8'));
 const current=JSON.parse(fs.readFileSync(new URL('assets/characters/rebuilt-v217/sources.json',base),'utf8'));
 const replacements=new Set(current.adaptations.approvedParts);
 const delivered=new Map(HERO_REFINEMENTS.files.map(entry=>[entry.kind+':'+entry.part,entry]));
 assert(replacements.size>0,'new revision has no explicitly authored work');
 for(const before of previous.files){
  const key=before.kind+':'+before.part,after=delivered.get(key);assert(after,'previous surface disappeared: '+key);
  if(!replacements.has(key))assert.deepEqual(after,before,'unselected surface was silently changed: '+key);
  else {
   assert(after.file.startsWith('assets/characters/rebuilt-v217/'),'approved change did not select its new file: '+key);
   assert.notEqual(after.sha256,before.sha256,'declared geometry upgrade has identical bytes: '+key);
  }
 }
 for(const version of [215,216,217])for(const name of ['sources.json','LICENSE.txt'])
  assert(HERO_REFINEMENTS.provenance.includes('assets/characters/rebuilt-v'+version+'/'+name),'prior source provenance was dropped');
});

test('Tide v217 has a distinct facial surface while retaining eye and neck registration',{
 skip:!HERO_REFINEMENTS.files.some(e=>e.kind==='tide'&&e.part==='head'&&e.file.includes('/rebuilt-v217/'))?'Tide candidate has not been selected':false
},async()=>{
 const previous=JSON.parse(fs.readFileSync(new URL('assets/characters/rebuilt-v216/sources.json',base),'utf8'));
 const position=async entry=>{
  const data=fs.readFileSync(new URL(entry.file,base)),gltf=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
  let mesh;gltf.scene.traverse(item=>{if(item.userData.targetName==='Superhero_Female')mesh=item;});
  assert(mesh,'missing original female face target');return mesh.geometry.attributes.position;
 };
 const [before,after,silver]=await Promise.all([
  position(previous.files.find(e=>e.kind==='tide'&&e.part==='head')),
  position(HERO_REFINEMENTS.files.find(e=>e.kind==='tide'&&e.part==='head')),
  position(HERO_REFINEMENTS.files.find(e=>e.kind==='silver'&&e.part==='head'))
 ]);
 const digest=a=>createHash('sha256').update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength)).digest('hex');
 assert.notEqual(digest(after),digest(before),'Tide face has not changed from its shared source');
 assert.notEqual(digest(after),digest(silver),'Tide still has Silver\'s identical face surface');
 const key=(x,y,z)=>[x,y,z].map(n=>n.toFixed(5)).join(','),points=new Set();
 for(let i=0;i<after.count;i++)points.add(key(after.getX(i),after.getY(i),after.getZ(i)));
 let frozen=0,matched=0;
 for(let i=0;i<before.count;i++){
  const x=before.getX(i),y=before.getY(i),z=before.getZ(i);
  const ocular=Math.abs(x)>.012&&Math.abs(x)<.061&&y>1.633&&y<1.681&&z>.020;
  if(!ocular&&y>=1.515&&y<=1.718&&z>=.005)continue;
  frozen++;if(points.has(key(x,y,z)))matched++;
 }
 assert(frozen>500,'insufficient eye/neck/hair anchors checked');
 assert.equal(matched,frozen,'the face sculpt moved protected eye/neck/hair registration');
});

test('Lingya continuous v217 shirt has valid triangles and no non-manifold shoulder seams',{
 skip:!HERO_REFINEMENTS.files.some(e=>e.kind==='lingya'&&e.part==='attire'&&e.file.includes('/rebuilt-v217/'))?'Continuous shirt has not been selected':false
},async()=>{
 const entry=HERO_REFINEMENTS.files.find(e=>e.kind==='lingya'&&e.part==='attire');
 const data=fs.readFileSync(new URL(entry.file,base)),gltf=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 let body;gltf.scene.traverse(mesh=>{if(mesh.userData.targetName==='Female_Ranger_Body')body=mesh;});
 assert(body,'continuous shirt target missing');
 const p=body.geometry.attributes.position,indices=body.geometry.index.array,edges=new Map(),points=[];
 for(let i=0;i<p.count;i++)points.push([p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e6)).join(','));
 for(let i=0;i<indices.length;i+=3){
  const [a,b,c]=indices.slice(i,i+3),ax=p.getX(b)-p.getX(a),ay=p.getY(b)-p.getY(a),az=p.getZ(b)-p.getZ(a),
   bx=p.getX(c)-p.getX(a),by=p.getY(c)-p.getY(a),bz=p.getZ(c)-p.getZ(a),
   cross=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
  assert(cross.reduce((sum,n)=>sum+n*n,0)>1e-20,'degenerate cloth triangle '+i/3);
  for(const [u,v]of [[a,b],[b,c],[c,a]]){
   assert.notEqual(points[u],points[v],'zero-length cloth edge');
   const key=[points[u],points[v]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);
  }
 }
 // Open collar, sleeve, hem and separate raised straps are intentional. A
 // shoulder junction with three faces is not a legitimate garment opening.
 assert([...edges.values()].every(count=>count<=2),'shirt has a non-manifold edge after joining shared positions');
});

for(const mode of ['missing-all','broken-scout-attire'])test('seven heroes remain playable with optional asset failure: '+mode,{
 skip:HERO_REFINEMENTS.files.length===0?'No published optional surface assets to fault-inject':false
},()=>{
 // Isolate module caches and loader state so a successful earlier test cannot
 // conceal a missing-file fallback behind previously loaded surfaces.
 const code=`
  import fs from 'node:fs';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
  const mode=${JSON.stringify(mode)},network=globalThis.fetch;
  globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};
  globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
  globalThis.fetch=async input=>{
   const url=typeof input==='string'?input:input.url;
   if(new URL(url).pathname.includes('/assets/characters/rebuilt-v')&&(mode==='missing-all'||url.includes('/scout-attire-')))
    return mode==='missing-all'?new Response('missing optional model',{status:404}):new Response(new Uint8Array([0,1,2,3]));
   return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):network(input);
  };
  const {loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import('./skinned-hero.js?fallback-check');
  await loadHeroAssets();let checked=0;
  for(const [kind,weapon]of [['scout','rifle'],['silver','crossbow'],['wraith','shade'],['tide','harpoon'],['lingya','boomerang'],['wuling','sporelantern'],['mirage','miasmalantern']]){
   const hero=createSkinnedHero(kind,weapon);assert(hero.userData.skinned);assert.equal(hero.userData.model.skeleton.bones.length,65);
   let replacements=0;
   for(let frame=0;frame<30;frame++)animateSkinnedHero(hero,frame/60,3,.1,0);
   hero.updateMatrixWorld(true);hero.traverse(o=>{assert(o.matrixWorld.elements.every(Number.isFinite));if(o.userData.refinedAsset)replacements++;});
   if(mode==='missing-all')assert.equal(replacements,0);
   else if(kind==='scout'){assert(!hero.getObjectByName('SM_Hero_Body_scout').userData.refinedAsset);assert(hero.getObjectByName('SM_Hero_Hair_scout').userData.refinedAsset);}
   else {assert(replacements>0,'unrelated hero lost valid replacement: '+kind);if(kind==='lingya')assert(hero.getObjectByName('Lingya-eyebrows').userData.refinedAsset,'original static brow replacement was not applied');}
   disposeHero(hero);checked++;
  }
  console.log(JSON.stringify({checked,mode}));
 `;
 const output=execFileSync(process.execPath,['--input-type=module','-e',code],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000
 });
 assert.equal(JSON.parse(output.trim()).checked,7);
});
