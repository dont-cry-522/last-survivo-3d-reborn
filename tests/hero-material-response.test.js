import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {finishHeroSurface} from '../hero-finish.js';

test('fabric sheen preserves authored PBR maps and shader hooks without changing geometry or shared sources',()=>{
 for(const kind of ['scout','silver','wraith','tide','lingya','wuling','mirage']){
  const source=new T.MeshStandardMaterial({name:'M_Hero_Body_'+kind,color:0x213143,roughness:.9,normalMap:new T.Texture(),roughnessMap:new T.Texture()});
  const compile=()=>{},key=()=>kind;source.onBeforeCompile=compile;source.customProgramCacheKey=key;
  const mesh=new T.Mesh(new T.BoxGeometry(1,1,1),source);mesh.name='SM_Hero_Body_'+kind;
  const before=mesh.geometry.attributes.position.array.slice();const root=new T.Group();root.add(mesh);finishHeroSurface(root,kind);
  assert(mesh.material.isMeshPhysicalMaterial);assert(mesh.material.sheen>0&&mesh.material.sheen<=.16);
  assert.equal(mesh.material.defines.PHYSICAL,'');
  assert.equal(mesh.material.normalMap,source.normalMap);assert.equal(mesh.material.roughnessMap,source.roughnessMap);
  assert.equal(mesh.material.onBeforeCompile,compile);assert.equal(mesh.material.customProgramCacheKey,key);
  assert.equal(mesh.material.color.getHex(),source.color.getHex());assert.deepEqual(mesh.geometry.attributes.position.array,before);
  assert.equal(source.roughness,.9);assert.equal(source.sheen,undefined);
  const liveClone=mesh.material.clone();assert.equal(liveClone.sheen,mesh.material.sheen);assert.equal(liveClone.sheenRoughness,.85);
 }
});
test('eyes and tied hair have dielectric reflections; mixed skin/shorts never become sheen cloth',()=>{
 const root=new T.Group();
 for(const [name,tag]of [['Eyes',{}],['Hair_Buns',{hairstyle:true}],['Superhero_Female',{wildMistPart:'legs'}]]){
  const m=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({name:name==='Superhero_Female'?'WildMist_lingya_legs':'MAT_Hero_Tide_WovenCloth',roughness:.9,metalness:.035}));m.name=name;m.userData=tag;root.add(m);
 }
 finishHeroSurface(root,'tide');
 assert.equal(root.children[0].material.roughness,.23);assert.equal(root.children[0].material.metalness,0);
 assert.equal(root.children[1].material.roughness,.55);assert.equal(root.children[1].material.metalness,0);
 assert(!root.children[2].material.isMeshPhysicalMaterial);
});
