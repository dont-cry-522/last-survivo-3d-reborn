// Export the actual loaded hero meshes for offline DCC work. No animation pose
// or actor-scale transforms are baked into vertex/skin data.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';

const root=new URL('../',import.meta.url);
const destination=process.argv[2]||fileURLToPath(new URL('../../../outputs/character-v215/rest/',import.meta.url));
// Once the replacement loader is installed, this exporter sees the replacement
// surfaces. Never silently overwrite the v214 rest reference used by Blender.
try{await fs.access(path.join(destination,'summary.json'));throw Error('Rest reference already exists. Pass an explicit new output directory to export another version.');}
catch(error){if(error.code!=='ENOENT')throw error;}
const net=globalThis.fetch;
globalThis.self=globalThis;
globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};
globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return url.startsWith('file:')?new Response(await fs.readFile(fileURLToPath(url))):net(input);};
const world=await fs.readFile(new URL('world.js',root),'utf8');
const entry=world.match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1];
const {loadHeroAssets,createSkinnedHero,disposeHero}=await import(new URL(entry,root));
const {HERO_LOADOUTS}=await import(new URL('rules.js',root));
await loadHeroAssets();
await fs.mkdir(destination,{recursive:true});

function marks(data){return Object.fromEntries(Object.entries(data).filter(([,v])=>v===null||['string','number','boolean'].includes(typeof v)));}
function material(m){return {name:m.name,color:m.color?.getHex(),linearColor:m.color?.toArray(),roughness:m.roughness,metalness:m.metalness,vertexColors:m.vertexColors,side:m.side};}
function transform(object){return {position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()};}
function visible(object){for(let o=object;o;o=o.parent)if(!o.visible)return false;return true;}
const summary=[];
for(const [kind,weapons]of Object.entries(HERO_LOADOUTS)){
 const hero=createSkinnedHero(kind,weapons[0]),model=hero.userData.model;
 // Needed only for the companion inventory's attachment positions. Exported
 // geometry always remains the authored rest-space attribute data itself.
 model.skeleton.pose();hero.updateMatrixWorld(true);
 const meshes=[],accessories=[],inverse=model.matrixWorld.clone().invert();
 const boneRecords=model.skeleton.bones.map((bone,i)=>({name:bone.name,parent:bone.parent?.isBone?bone.parent.name:null,...transform(bone),inverse:model.skeleton.boneInverses[i].toArray()}));
 model.traverse(object=>{
  if(!object.isMesh)return;
  const geometry=object.geometry,base={name:object.name,geometryName:geometry.name,visible:visible(object),parent:object.parent.name,transform:transform(object),userData:marks(object.userData),material:Array.isArray(object.material)?object.material.map(material):material(object.material)};
  if(object.isSkinnedMesh){
   const attributes={};
   for(const name of ['position','normal','uv','color','skinIndex','skinWeight']){const a=geometry.attributes[name];if(a)attributes[name]={itemSize:a.itemSize,type:a.array.constructor.name,normalized:a.normalized,array:Array.from(a.array)};}
   assert(attributes.position&&attributes.skinIndex&&attributes.skinWeight,kind+': unskinned export '+object.name);
   for(let i=0;i<attributes.skinWeight.array.length;i+=4){const sum=attributes.skinWeight.array.slice(i,i+4).reduce((a,b)=>a+b,0);assert(Math.abs(sum-1)<.002,object.name+': invalid weight sum '+sum);}
   meshes.push({...base,attributes,index:geometry.index?Array.from(geometry.index.array):null,groups:geometry.groups,boneNames:object.skeleton.bones.map(b=>b.name),boneInverses:object.skeleton.boneInverses.map(m=>m.toArray()),bindMatrix:object.bindMatrix.toArray(),bindMatrixInverse:object.bindMatrixInverse.toArray(),bindMode:object.bindMode,morphAttributes:Object.fromEntries(Object.entries(geometry.morphAttributes).map(([name,values])=>[name,values.map(a=>({itemSize:a.itemSize,array:Array.from(a.array)}))])),morphTargetsRelative:geometry.morphTargetsRelative});
  }else{
   geometry.computeBoundingBox();
   const matrix=inverse.clone().multiply(object.matrixWorld),bounds=geometry.boundingBox.clone().applyMatrix4(matrix),center=bounds.getCenter(new T.Vector3());
   const attach=[];for(let p=object.parent;p&&p!==model;p=p.parent)if(p.isBone)attach.push(p.name);
   const attributes={};
   if(/mask|veil/i.test(object.name))for(const name of ['position','normal','uv','color']){const a=geometry.attributes[name];if(a)attributes[name]={itemSize:a.itemSize,type:a.array.constructor.name,normalized:a.normalized,array:Array.from(a.array)};}
   accessories.push({...base,...(Object.keys(attributes).length?{attributes,index:geometry.index?Array.from(geometry.index.array):null}:{}),triangles:(geometry.index?.count||geometry.attributes.position.count)/3,attachmentBones:attach,modelRestMatrix:matrix.toArray(),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},viewRegions:{front:center.z>=-.025,back:center.z<=.025,left:bounds.min.x<-.08,right:bounds.max.x>.08}});
  }
 });
 const data={kind,weapon:weapons[0],coordinateSystem:'Three.js rest space; Y up; +Z front. Actor rig scale is not baked.',rigTransform:transform(hero.userData.rig),modelTransform:transform(model),bones:boneRecords,meshes};
 await fs.writeFile(path.join(destination,kind+'.json'),JSON.stringify(data));
 await fs.writeFile(path.join(destination,kind+'-accessories.json'),JSON.stringify({kind,description:'Static attachments in skeleton rest pose; projected front, side and back inventory, not screenshots.',accessories},null,2));
 summary.push({kind,meshes:meshes.length,bones:boneRecords.length,accessories:accessories.length,visibleSlots:meshes.filter(m=>m.visible).map(m=>({name:m.name,triangles:(m.index?.length||m.attributes.position.array.length/3)/3,tag:m.userData.wildMistPart||m.userData.rebuiltPart||m.userData.rebuildSourceName||null}))});
 disposeHero(hero);
}
await fs.writeFile(path.join(destination,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({destination,heroes:summary.map(({kind,meshes,bones,accessories})=>({kind,meshes,bones,accessories}))},null,2));
