import * as T from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {boulderRockGeometry} from './biome-scenery.js?v=230';

export const ENVIRONMENT_MODELS={
 'weathered-rock-a':{file:'assets/environment/models/weathered-rock-a.glb',node:'SM_Rock_Weathered_A'},
 'weathered-rock-b':{file:'assets/environment/models/weathered-rock-b.glb',node:'SM_Rock_Weathered_B'},
 'old-stump':{file:'assets/environment/models/old-stump.glb',node:'SM_Stump_Old_A'}
};
const loadedModels=new Map();let loading;
export function loadEnvironmentAssets({loader=new GLTFLoader()}={}){
 if(loading)return loading;
 loading=Promise.all(Object.entries(ENVIRONMENT_MODELS).map(async([id,asset])=>{
  try{
   const gltf=await loader.loadAsync(new URL(asset.file,import.meta.url).href);gltf.scene.updateMatrixWorld(true);
   const meshes=[0,1,2].map(i=>gltf.scene.getObjectByName(asset.node+'_LOD'+i));
   if(meshes.some(m=>!m?.isMesh))throw Error('Missing environment LOD: '+id);
   // Bake any exporter transforms once. Every scene then shares these buffers.
   const lods=meshes.map(m=>{const geometry=m.geometry.clone().applyMatrix4(m.matrixWorld);geometry.computeBoundingBox();geometry.computeBoundingSphere();return{geometry,material:m.material};});
   for(const geometry of new Set(meshes.map(m=>m.geometry)))geometry.dispose();
   loadedModels.set(id,{lods,height:lods[0].geometry.boundingBox.max.y});
  }catch(error){console.warn('Environment model unavailable; keeping original scenery:',id,error.message);}
 })).then(()=>loadedModels);
 return loading;
}

// Three levels keep distant silhouettes. 80m is not a disappearance threshold.
export function environmentLOD(distance,mobile=false){const scale=mobile?.75:1;return distance<10*scale?0:distance<30*scale?1:2;}
const palettes={forest:0xf1f2df,snow:0xdde8ee,ash:0xb5a5a0,sand:0xffe3bf,coast:0xd6e6e9};
function biomeMaterial(source,biome){
 // Scanned albedo already contains its pigment; a dark procedural-prop tint
 // would multiply it twice. A restrained pale tint keeps it in our palette.
 const material=source.clone();material.vertexColors=false;material.color.multiply(new T.Color(palettes[biome]||0xffffff)).multiplyScalar(1.25);material.roughness=biome==='coast'?.80:1;material.metalness=0;material.aoMapIntensity=.65;material.normalScale?.setScalar(.7);
 if(biome==='snow'){
  material.onBeforeCompile=shader=>{
   shader.vertexShader='varying float envSnowUp;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nenvSnowUp = normal.y;');
   shader.fragmentShader='varying float envSnowUp;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat snowCover = smoothstep(0.30, 0.80, envSnowUp);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75,0.83,0.86), snowCover * 0.91);');
  };material.customProgramCacheKey=()=> 'scanned-snow-v1';
 }
 return material;
}
// Slots replace existing stones, not whole habitats. The authored collision
// envelope, seeded placement and surrounding foliage remain exactly as before.
function clusterSlots(r){
 const a='weathered-rock-a',b='weathered-rock-b';
 if(r.biome==='forest')return[[a,-.42,.27,.73,.48,.65,.3],[r.variant?'old-stump':b,.65,-.24,.56,.35,.48,-.4]];
 if(r.biome==='snow')return[[a,-.65,.45,.63,.76,.58,.3],[b,.55,-.31,.70,.80,.65,-.4],[a,0,.61,.38,.47,.37,.7]];
 if(r.biome==='ash')return[[a,-.51,.05,.79,1.13,.73,.2],[b,.49,-.30,.61,.84,.58,.7],[a,.53,.60,.44,.65,.42,-.3]];
 if(r.biome==='sand')return[[a,-.1,-.08,1.08,1.45,.73,.09],[b,.94,.35,.48,.40,.53,.6],[b,-.67,.68,.48,.35,.43,.3]];
 return[];
}

export function installEnvironmentAssets(world,models=loadedModels){
 if(world.environmentAssets)return world.environmentAssets;
 const group=new T.Group();group.name='SM_Environment_Scanned_A';
 const state={group,records:[],batches:[],hidden:[],disposed:false,levels:[0,0,0],materials:new Map(),focus:new T.Vector3(Infinity,Infinity,Infinity)};
 const transform=new T.Object3D(),base=new T.Matrix4(),local=new T.Matrix4();
 const add=(id,biome,matrix)=>{const model=models.get(id);if(!model)return;const point=new T.Vector3().setFromMatrixPosition(matrix);state.records.push({id,biome,model,matrix:matrix.clone(),x:point.x,y:point.y,z:point.z,level:-1});};
 const replaced=new Set();
 for(const r of world.environmentClusters?.records||[]){
  const slots=clusterSlots(r);if(!slots.length||slots.some(s=>!models.has(s[0])))continue;
  replaced.add(r.biome+':'+r.variant);
  transform.position.set(r.x,world.groundHeightAt?.(r.x,r.z)||0,r.z);transform.rotation.set(0,r.angle,0);transform.scale.setScalar(r.scale);transform.updateMatrix();base.copy(transform.matrix);
  for(const[id,x,z,sx,height,sz,angle]of slots){
   const model=models.get(id);model.lods[0].geometry.computeBoundingBox();const naturalHeight=model.height||model.lods[0].geometry.boundingBox.max.y;
   transform.position.set(x,-.025,z);transform.rotation.set(0,angle,0);transform.scale.set(sx,height/Math.max(.01,naturalHeight),sz);transform.updateMatrix();local.multiplyMatrices(base,transform.matrix);add(id,r.biome,local);
  }
 }
 for(const mesh of world.environmentClusters?.group?.children||[]){
  const d=mesh.userData;if(!mesh.isInstancedMesh||!replaced.has(d.clusterBiome+':'+d.clusterVariant)||!['stone','snow'].includes(d.clusterSurface))continue;
  state.hidden.push({mesh,visible:mesh.visible});mesh.visible=false;
 }
 // Existing coast boulders already have collision and grounding. Replace their
 // visual mesh in its original world box; cargo, posts and boats stay untouched.
 world.group.updateMatrixWorld(true);
 for(const obstacle of world.obstacles||[]){
  const biome=obstacle.biome||world.regions?.find(r=>r.contains(obstacle.x,obstacle.z))?.id||world.weather?.kind||world.id;
  if(biome!=='coast'||Math.abs(obstacle.r-.7)>.001)continue;
  let i=0;obstacle.mesh.traverse(mesh=>{
   if(!mesh.isMesh||mesh.geometry!==boulderRockGeometry)return;
   const id=i++%2?'weathered-rock-b':'weathered-rock-a',model=models.get(id);if(!model)return;
   mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
   model.lods[0].geometry.computeBoundingBox();const bounds=model.lods[0].geometry.boundingBox,extent=bounds.getSize(new T.Vector3());
   const ground=world.groundHeightAt?.(center.x,center.z)||0,bottom=Math.min(box.min.y,ground)-.025;
   transform.position.set(center.x,bottom,center.z);transform.rotation.set(0,0,0);transform.scale.set(size.x/extent.x,(box.max.y-bottom)/extent.y,size.z/extent.z);transform.updateMatrix();add(id,biome,transform.matrix);state.hidden.push({mesh,visible:mesh.visible});mesh.visible=false;
  });
 }
 const lists=new Map();for(const r of state.records){const key=r.biome+':'+r.id;if(!lists.has(key))lists.set(key,[]);lists.get(key).push(r);}
 for(const[key,records]of lists){
  const sample=records[0],material=biomeMaterial(sample.model.lods[0].material,sample.biome);state.materials.set(key,material);
  const dirtyLevels=[false,false,false];for(const r of records)r.dirtyLevels=dirtyLevels;
  for(let level=0;level<3;level++){
   const mesh=new T.InstancedMesh(sample.model.lods[level].geometry,material,records.length);mesh.name='SM_Scanned_'+key.replace(':','_')+'_LOD'+level;mesh.castShadow=mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
   records.forEach((r,i)=>mesh.setMatrixAt(i,r.matrix));mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.count=0;mesh.visible=false;group.add(mesh);state.batches.push({mesh,records,level,dirtyLevels});
  }
 }
 state.dispose=()=>{if(state.disposed)return;state.disposed=true;for(const b of state.batches)b.mesh.dispose();for(const material of state.materials.values())material.dispose();for(const h of state.hidden)h.mesh.visible=h.visible;group.removeFromParent();};
 world.group.add(group);world.environmentAssets=state;updateEnvironmentAssets(world,{x:world.spawn.x,y:1.7,z:world.spawn.z},false,true);return state;
}

export function updateEnvironmentAssets(world,focus,mobile=false,force=false){
 const state=world?.environmentAssets;if(!state||state.disposed)return;
 if(!force&&state.mobile===mobile&&state.focus.distanceToSquared(focus)<.25)return;
 state.focus.copy(focus);state.mobile=mobile;state.levels.fill(0);
 for(const r of state.records){
  const level=environmentLOD(Math.hypot(focus.x-r.x,focus.y-r.y,focus.z-r.z),mobile);
  if(level!==r.level){if(r.level>=0)r.dirtyLevels[r.level]=true;r.dirtyLevels[level]=true;r.level=level;}
  state.levels[level]++;
 }
 // A crossing changes only the old/new LOD of this material group. Preserve
 // record order, while leaving every other instance buffer untouched.
 for(const batch of state.batches){if(!force&&!batch.dirtyLevels[batch.level])continue;let count=0;for(const r of batch.records)if(r.level===batch.level)batch.mesh.setMatrixAt(count++,r.matrix);batch.mesh.count=count;batch.mesh.visible=count>0;batch.mesh.instanceMatrix.needsUpdate=true;batch.dirtyLevels[batch.level]=false;}
}
