import * as T from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

export const FOREST_TREE_ASSETS=Object.freeze({
 'woodland-canopy':'assets/environment/forest-trees-v222/woodland-canopy.glb',
 'leaning-canopy':'assets/environment/forest-trees-v222/leaning-canopy.glb'
});
const templates=new Map();let loading;
const count=g=>g.index?g.index.count/3:g.attributes.position.count/3;
function releaseSource(scene,clones=[],keep=[]){
 const geometries=new Set(clones),materials=new Set(),retainedTextures=new Set(),textures=new Set();
 for(const material of keep)for(const value of Object.values(material))if(value?.isTexture)retainedTextures.add(value);
 scene?.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(!keep.includes(m))materials.add(m);}});
 for(const material of materials)for(const value of Object.values(material))if(value?.isTexture&&!retainedTextures.has(value))textures.add(value);
 for(const geometry of geometries)geometry.dispose();for(const texture of textures)texture.dispose();for(const material of materials)material.dispose();
}

// App-owned and bounded to two templates: world disposal must not retire a
// buffer still used by another scene. A missing asset leaves the old tree.
export function loadForestTreeAssets({loader=new GLTFLoader(),yieldWork=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 if(loading)return loading;
 loading=(async()=>{
  for(const [id,file]of Object.entries(FOREST_TREE_ASSETS)){
   let gltf;const created=[];
   try{
    gltf=await loader.loadAsync(new URL(file,import.meta.url).href);gltf.scene.updateMatrixWorld(true);
    const prefix='SM_Tree_'+id.replaceAll('-','_'),bark=gltf.scene.getObjectByName(prefix+'_Bark');
    const leaves=[0,1,2].map(level=>gltf.scene.getObjectByName(prefix+'_Leaves_LOD'+level));
    if(!bark?.isMesh||leaves.some(m=>!m?.isMesh))throw Error('Incomplete forest tree LODs: '+id);
    const meshes=[bark,...leaves],geometries=meshes.map((mesh,i)=>{
     const g=mesh.geometry.clone();created.push(g);g.applyMatrix4(mesh.matrixWorld);const p=g.attributes.position,n=p.count;
     g.setAttribute('treeSurface',new T.Float32BufferAttribute(new Float32Array(n).fill(i?1:0),1));
     if(i){
      const flex=new Float32Array(n),uv=g.attributes.uv;
      for(let j=0;j<n;j++)flex[j]=uv?Math.min(1,Math.abs(uv.getY(j)-.5)*2):.5;
      g.setAttribute('treeLeafFlex',new T.Float32BufferAttribute(flex,1));
     }
     g.computeBoundingBox();g.computeBoundingSphere();return g;
    });
    const [trunk,...lods]=geometries,leafMaterial=leaves[0].material,barkMaterial=bark.material;
    for(const material of [barkMaterial,leafMaterial]){
     material.vertexColors=false;material.metalness=0;material.roughness=.94;
     material.envMapIntensity=.65;material.normalScale?.setScalar(.48);
     if(material.map){material.map.colorSpace=T.SRGBColorSpace;material.map.anisotropy=4;}
     if(material.normalMap)material.normalMap.colorSpace=T.NoColorSpace;
    }
    barkMaterial.alphaTest=0;barkMaterial.side=T.FrontSide;
    leafMaterial.side=T.DoubleSide;leafMaterial.alphaTest=.35;leafMaterial.transparent=false;
    const template={form:id,sourceAsset:true,variant:0,trunk,lods,canopy:lods[2],bottom:3.6,shared:true,snow:false,
     barkMaterial,leafMaterial,height:Math.max(trunk.boundingBox.max.y,...lods.map(g=>g.boundingBox.max.y+3.6)),
     minLeafY:Math.min(...lods.map(g=>g.boundingBox.min.y+3.6)),triangleCounts:lods.map(g=>count(trunk)+count(g))};
    templates.set(id,template);
    releaseSource(gltf.scene,[],[barkMaterial,leafMaterial]);
   }catch(error){
    releaseSource(gltf?.scene,created);
    console.warn('Forest tree unavailable; retaining procedural tree:',id,error.message);
   }
   await yieldWork();
  }
  return{ready:templates.size===Object.keys(FOREST_TREE_ASSETS).length,loaded:[...templates.keys()]};
 })();return loading;
}

export function forestTreeAssetTemplate(id){return templates.get(id)||null;}

// Reuse the original canopy shader's game-time wind/transmission closure. No
// new clocks, per-tree shader instances or independent frame updates.
export function fitForestTreeAssetMaterials(template,existingLeaves){
 if(!template?.sourceAsset||template.windReady)return;
 template.leafMaterial.onBeforeCompile=existingLeaves.onBeforeCompile;
 template.leafMaterial.customProgramCacheKey=existingLeaves.customProgramCacheKey;
 template.leafMaterial.needsUpdate=true;template.windReady=true;
}
