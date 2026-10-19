import * as T from './vendor/three.module.js';

// UVs belong to the mesh, expressed in texture tiles. Do not change repeat on
// these shared textures: a rock face and a root can have different physical sizes.
export const FOREST_SURFACES = Object.freeze({
 mossRock: Object.freeze({tileMeters:6,normalStrength:.48,fallback:0x666a50,
  color:'mossRock-color-1k.jpg',normal:'mossRock-normal-1k.jpg',roughness:'mossRock-roughness-1k.jpg'}),
 bark: Object.freeze({tileMeters:1,normalStrength:.62,fallback:0x685c46,
  color:'bark-color-1k.jpg',normal:'bark-normal-1k.jpg',roughness:'bark-roughness-1k.jpg'})
});

const assets=new Map(),materials=new Map();
let loading;
const slots={color:'map',normal:'normalMap',roughness:'roughnessMap'};

function installMaps(material,kind){
 const set=assets.get(kind);if(!set)return;
 for(const[slot,property]of Object.entries(slots))material[property]=set[slot];
 material.color.set(material.userData.forestSurfaceTint);
 material.userData.forestSurfaceReady=true;material.needsUpdate=true;
}

// Textures are application-owned and reused across scene rebuilds. A failed set
// is kept entirely on its neutral fallback, never a mismatched partial PBR set.
export function loadForestSurfaceAssets({loader=new T.TextureLoader()}={}){
 if(loading)return loading;
 loading=Promise.all(Object.entries(FOREST_SURFACES).map(async([kind,definition])=>{
  const results=await Promise.allSettled(Object.keys(slots).map(async slot=>{
   const texture=await loader.loadAsync(new URL('./assets/environment/forest-reborn/'+definition[slot],import.meta.url).href);
   texture.name='T_Forest_'+kind+'_'+slot;
   texture.colorSpace=slot==='color'?T.SRGBColorSpace:T.NoColorSpace;
   texture.wrapS=texture.wrapT=T.RepeatWrapping;
   texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
   texture.anisotropy=4;
   return[slot,texture];
  }));
  if(results.some(result=>result.status==='rejected')){
   for(const result of results)if(result.status==='fulfilled')result.value[1].dispose();
   return;
  }
  assets.set(kind,Object.fromEntries(results.map(result=>result.value)));
  for(const material of materials.get(kind)||[])installMaps(material,kind);
 })).then(()=>({ready:assets.size===Object.keys(FOREST_SURFACES).length,
  loaded:[...assets.keys()],textureCount:assets.size*3}));
 return loading;
}

export function createForestSurfaceMaterial(kind,{tint=0xffffff,normalStrength,roughness=1,envMapIntensity=.65}={}){
 const definition=FOREST_SURFACES[kind];if(!definition)throw new Error('Unknown forest surface: '+kind);
 const material=new T.MeshStandardMaterial({name:'M_Forest_'+kind+'_A',color:definition.fallback,
  roughness,metalness:0,envMapIntensity,normalScale:new T.Vector2().setScalar(normalStrength??definition.normalStrength)});
 material.userData.forestSurface=kind;material.userData.forestSurfaceTint=tint;
 material.userData.forestSurfaceReady=false;
 if(!materials.has(kind))materials.set(kind,new Set());materials.get(kind).add(material);
 material.addEventListener('dispose',()=>materials.get(kind)?.delete(material));
 installMaps(material,kind);
 return material;
}

export function forestSurfaceAssetStatus(){
 return{loading:!!loading,loaded:[...assets.keys()],textureCount:assets.size*3,
  materialCount:[...materials.values()].reduce((sum,set)=>sum+set.size,0)};
}

// The existing tree generator has one seven-ring stem, four forks and twenty
// twigs. Give each connected branch its own longitudinal UV frame, after habitat
// and route deformation. Unknown geometry stays on the original material.
// The source and its shared normals are never modified or disposed here.
export function createBarkGeometry(geometry,scale={x:1,y:1,z:1}){
 const position=geometry?.attributes?.position,index=geometry?.index,normal=geometry?.attributes?.normal;
 if(position?.count!==414||index?.count!==2184||normal?.count!==414)return null;
 const size=typeof scale==='number'?new T.Vector3().setScalar(scale):new T.Vector3(scale?.x??1,scale?.y??1,scale?.z??1);
 if(![size.x,size.y,size.z].every(n=>Number.isFinite(n)&&n>0))return null;
 const descriptions=[[16,7],...Array.from({length:4},()=>[6,3]),...Array.from({length:20},()=>[3,3])];
 const owner=new Uint8Array(position.count),ringNumber=new Int8Array(position.count),around=new Int8Array(position.count);
 const coordinates=new Float32Array(position.count*2),caps=new Float32Array(position.count*2),segments=[];
 const point=new T.Vector3(),previous=new T.Vector3(),radial=new T.Vector3(),across=new T.Vector3(),along=new T.Vector3();
 let start=0;
 for(const[segment,[sides,rings]]of descriptions.entries()){
  const centers=[],perimeters=[],arcs=[];
  for(let ring=0;ring<rings;ring++){
   const center=new T.Vector3();for(let side=0;side<sides;side++)center.add(point.fromBufferAttribute(position,start+ring*sides+side).multiply(size));
   center.multiplyScalar(1/sides);centers.push(center);
   const lengths=[0];let perimeter=0;
   for(let side=0;side<sides;side++){
    point.fromBufferAttribute(position,start+ring*sides+side).multiply(size);
    previous.fromBufferAttribute(position,start+ring*sides+(side+1)%sides).multiply(size);
    perimeter+=point.distanceTo(previous);lengths.push(perimeter);
   }
   if(!Number.isFinite(perimeter)||perimeter<1e-6)return null;
   arcs.push(lengths);perimeters.push(perimeter);
  }
  // An integer number of texture tiles closes the bark pattern at the seam.
  // Unequal ring arcs still reflect the root flare; V follows actual branch length.
  const repeats=Math.max(1,Math.round(perimeters.reduce((sum,n)=>sum+n,0)/rings));
  let length=0;
  for(let ring=0;ring<rings;ring++){
   if(ring)length+=centers[ring].distanceTo(centers[ring-1]);
   for(let side=0;side<sides;side++){
    const vertex=start+ring*sides+side;owner[vertex]=segment;ringNumber[vertex]=ring;around[vertex]=side;
    coordinates[vertex*2]=arcs[ring][side]/perimeters[ring]*repeats;coordinates[vertex*2+1]=length;
   }
  }
  for(const end of[0,1]){
   const ring=end?rings-1:0,cap=start+sides*rings+end;owner[cap]=segment;ringNumber[cap]=-1;around[cap]=-1;
   along.copy(centers[end?rings-1:1]).sub(centers[end?rings-2:0]).normalize();
   across.fromBufferAttribute(position,start+ring*sides).multiply(size).sub(centers[ring]);
   across.addScaledVector(along,-across.dot(along)).normalize();radial.crossVectors(along,across).normalize();
   // Planar cap coordinates avoid degenerate UV derivatives at the cut ends.
   for(let side=0;side<sides;side++){
    const vertex=start+ring*sides+side;point.fromBufferAttribute(position,vertex).multiply(size).sub(centers[ring]);
    caps[vertex*2]=point.dot(across);caps[vertex*2+1]=point.dot(radial);
   }
  }
  segments.push({sides,rings,repeats});start+=sides*rings+2;
 }
 const uv=new Float32Array(index.count*2);
 for(let triangle=0;triangle<index.count;triangle+=3){
  const ids=[index.getX(triangle),index.getX(triangle+1),index.getX(triangle+2)];
  if(ids.some(vertex=>!Number.isInteger(vertex)||vertex<0||vertex>=position.count)||ids.some(vertex=>owner[vertex]!==owner[ids[0]]))return null;
  const {sides,rings,repeats}=segments[owner[ids[0]]],hasCap=ids.some(vertex=>ringNumber[vertex]===-1);
  const activeRings=ids.filter(vertex=>ringNumber[vertex]>=0).map(vertex=>ringNumber[vertex]);
  if(hasCap&&(activeRings.length!==2||activeRings[0]!==activeRings[1]||![0,rings-1].includes(activeRings[0])))return null;
  if(!hasCap&&Math.max(...activeRings)-Math.min(...activeRings)!==1)return null;
  const sidesInTriangle=ids.map(vertex=>around[vertex]),wrap=!hasCap&&Math.max(...sidesInTriangle)-Math.min(...sidesInTriangle)>sides/2;
  ids.forEach((vertex,corner)=>{
   const source=hasCap?caps:coordinates;
   uv[(triangle+corner)*2]=source[vertex*2]+(wrap&&around[vertex]<sides/2?repeats:0);
   uv[(triangle+corner)*2+1]=source[vertex*2+1];
  });
 }
 if(!uv.every(Number.isFinite))return null;
 const result=geometry.toNonIndexed();result.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
 result.userData.forestBarkUV={segments:segments.length,tileMeters:1};
 return result;
}
