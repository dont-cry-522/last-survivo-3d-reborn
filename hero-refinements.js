import * as T from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {HERO_REFINEMENTS} from './hero-refinement-assets.js?v=228';

// DCC meshes are in the original rest space. The original game owns the rig,
// animation mixer, hitbox and weapon sockets; these assets replace only surfaces.
const parts=new Map();
export async function loadHeroRefinements(){
 const loader=new GLTFLoader();
 await Promise.all(HERO_REFINEMENTS.files.map(async entry=>{
  try{
   const gltf=await loader.loadAsync(new URL(entry.file,import.meta.url).href),list=[];
   gltf.scene.traverse(mesh=>{if(mesh.isMesh)list.push(mesh);});
   for(const mesh of list){
    const g=mesh.geometry,p=g.attributes.position;
    if(!p||p.itemSize!==3||!Array.from(p.array).every(Number.isFinite)||!mesh.userData.targetName)throw Error('Invalid rest mesh');
    for(const name of ['normal','uv','color','_skinindex','_skinweight']){const a=g.attributes[name];if(a&&(a.count!==p.count||!Array.from(a.array).every(Number.isFinite)))throw Error('Invalid '+name);}
    if(g.index&&(g.index.count%3||!Array.from(g.index.array).every(i=>Number.isInteger(i)&&i>=0&&i<p.count)))throw Error('Invalid triangles');
    for(const name of ['_skinindex','_skinweight'])if(g.attributes[name]&&g.attributes[name].itemSize!==4)throw Error('Invalid skin components');
    if(g.attributes.color&&!Array.from(g.attributes.color.array).every(v=>v>=0&&v<=1.00001))throw Error('Invalid colour range');
    for(const morphs of Object.values(g.morphAttributes))for(const a of morphs)if(a.count!==p.count||a.itemSize!==3||!Array.from(a.array).every(Number.isFinite))throw Error('Invalid morph deltas');
   }
   const record=parts.get(entry.kind)||new Map();
   for(const mesh of list)record.set(mesh.userData.targetName,mesh);
   parts.set(entry.kind,record);
  }catch(error){
   // An optional replacement must never turn an already playable hero into a
   // loading failure. Keep that file's original clothing/face intact.
   console.warn('Character refinement fallback:',entry.kind,entry.file,error.message);
  }
 }));
}
export function refineHeroPart(target,kind,{owned=false}={}){
 const source=parts.get(kind)?.get(target.name);if(!source)return false;
 const g=source.geometry.clone(),indices=g.attributes._skinindex,weights=g.attributes._skinweight;
 if((g.morphAttributes.position?.length||0)!==(target.geometry.morphAttributes.position?.length||0)){g.dispose();return false;}
 if(target.isSkinnedMesh){
  if(!indices||!weights){g.dispose();return false;}
  const names=source.userData.boneNames,remap=names?.map(name=>target.skeleton.bones.findIndex(b=>b.name===name));
  const out=new Uint16Array(indices.array.length);
  for(let i=0;i<indices.count;i++){
   let sum=0;
   for(let j=0;j<4;j++){const n=indices.array[i*4+j],bone=remap?remap[n]:n,w=weights.array[i*4+j];if(!Number.isInteger(bone)||bone<0||bone>=target.skeleton.bones.length||w<0){g.dispose();return false;}out[i*4+j]=bone;sum+=w;}
   if(Math.abs(sum-1)>.002){g.dispose();return false;}
  }
  g.setAttribute('skinIndex',new T.Uint16BufferAttribute(out,4));g.setAttribute('skinWeight',weights.clone());
 }
 g.deleteAttribute('_skinindex');g.deleteAttribute('_skinweight');
 g.name=target.geometry.name||source.name;g.computeBoundingBox();g.computeBoundingSphere();
 const old=target.geometry,oldMaterial=target.material,oldMorphNames=target.morphTargetDictionary,oldMorphValues=target.morphTargetInfluences;
 target.geometry=g;if(owned)old.dispose();
 if(g.morphAttributes.position?.length){
  target.updateMorphTargets();
  // Geometry-only GLBs retain the deltas; the original face owns named
  // expressions such as Blink and each live actor owns its own influences.
  if(oldMorphNames&&oldMorphValues?.length===target.morphTargetInfluences.length){target.morphTargetDictionary={...oldMorphNames};target.morphTargetInfluences=oldMorphValues.slice();}
 }
 const material=source.userData.materialMode==='replace'?source.material:target.material;
 // Preserve material callbacks: the coat, face and weapon-specific palettes
 // are deliberately different and are not encoded in a generic glTF shader.
 target.material=material.clone();target.material.onBeforeCompile=material.onBeforeCompile;target.material.customProgramCacheKey=material.customProgramCacheKey;
 target.material.vertexColors=!!g.attributes.color;
 if(owned)oldMaterial.dispose();
 target.userData.refinedAsset=source.userData.assetName||source.name;
 target.userData.refinedSource=source.userData.targetName;
 return true;
}
export function refineHeroTemplate(root,kind){
 const record=parts.get(kind);if(!record)return;
 const applied=[];
 root.traverse(mesh=>{if(mesh.isMesh&&refineHeroPart(mesh,kind))applied.push(record.get(mesh.name));});
 for(const source of applied)for(const name of source.userData.hideTargets||[]){const old=root.getObjectByName(name);if(old)old.visible=false;}
}
