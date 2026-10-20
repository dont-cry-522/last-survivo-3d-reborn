import * as T from './vendor/three.module.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {prepareBatchedSurface,batchedSurfaceMaterial} from './environment-props.js?v=229';

const finishes=new Map();
const timberBlock=new T.BoxGeometry(1,1,1,2,2,2),point=new T.Vector3(),core=new T.Vector3();
for(let i=0;i<timberBlock.attributes.position.count;i++){point.fromBufferAttribute(timberBlock.attributes.position,i);core.copy(point).clampScalar(-.46,.46);point.sub(core).normalize().multiplyScalar(.04).add(core);timberBlock.attributes.position.setXYZ(i,point.x,point.y,point.z);}timberBlock.computeVertexNormals();
const masonryBlock=timberBlock.clone();
for(let i=0;i<masonryBlock.attributes.position.count;i++){const p=masonryBlock.attributes.position,x=p.getX(i),y=p.getY(i),z=p.getZ(i);p.setXYZ(i,x*(.97-.07*Math.max(0,z+.1)),y-(y+.5)*(.014+Math.max(0,x+z+.18)*.08),z*(.97-.06*Math.max(0,-x+.1)));}masonryBlock.computeVertexNormals();
function finish(kind){
 if(finishes.has(kind))return finishes.get(kind);
 const source=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:kind==='metal'?.66:.96,metalness:kind==='metal'?.36:0,side:T.DoubleSide});
 const material=batchedSurfaceMaterial(source,kind);if(material!==source)source.dispose();
 finishes.set(kind,material);return material;
}
const stoneColors=new Set([0xa49173,0xae987a,0xd2bc94,0x718c89,0xa2b0a1]);
const metalColors=new Set([0x506568,0x526967]);

// Replace a broad flat roof with individually overlapped cedar courses. Its
// closed underside and bounded courses participate in real ceiling rays.
function roofBoards(w,h,d){
 const pieces=[new T.BoxGeometry(w,h*.22,d).translate(0,-h*.39,0)];
 for(let row=0;row<9;row++)for(let col=0;col<3;col++){
  const width=w/3,depth=d/9,geometry=timberBlock.clone();
  geometry.scale(width*.985,h*.68,depth*1.02);geometry.translate(-w/2+(col+.5)*width,h*.05,-d/2+(row+.5)*depth);
  // Different exposed cedar end tones survive merging without another material.
  const p=geometry.attributes.position,c=[];const tone=.84+.15*(.5+.5*Math.sin(row*4.31+col*2.7));
  for(let i=0;i<p.count;i++)c.push(tone,tone,tone);geometry.setAttribute('color',new T.Float32BufferAttribute(c,3));pieces.push(geometry);
 }
 for(const g of pieces){const p=g.attributes.position;if(!g.attributes.color)g.setAttribute('color',new T.Float32BufferAttribute(Array(p.count*3).fill(.78),3));if(g.attributes.uv)g.deleteAttribute('uv');}
 const geometry=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());const p=geometry.attributes.position;for(let i=0;i<p.count;i++)p.setXYZ(i,T.MathUtils.clamp(p.getX(i),-w/2,w/2),T.MathUtils.clamp(p.getY(i),-h/2,h/2),T.MathUtils.clamp(p.getZ(i),-d/2,d/2));geometry.computeVertexNormals();geometry.name='SM_Harbor_CedarRoof_A';return geometry;
}

// Six existing wreck sections retain their collision circles. Curved strakes
// make the same occupied space read as a broken hull rather than a ladder.
export function wreckSection(width){
 const positions=[],indices=[],colors=[],rows=5,steps=12,half=.47;
 for(const side of[-1,1])for(let row=0;row<rows;row++){
  const start=positions.length/3;
  for(let end=0;end<2;end++)for(let j=0;j<=steps;j++){
   const u=(row+j/steps)/rows,a=u*Math.PI*.46,z=side*Math.sin(a)*width*.69,y=.13+(1-Math.cos(a))*.89;
   positions.push(end?half:-half,y,z);const shade=.82+.10*row/rows+.035*Math.sin(row*2.1);colors.push(shade,shade,shade);
  }
  for(let j=0;j<steps;j++){const a=start+j,b=a+steps+1;indices.push(a,b,a+1,a+1,b,b+1);}
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.name='SM_Harbor_BrokenHull_A';return geometry;
}

// Keep every original collision/fragile root. Static details combine by finish
// inside that root; roof pieces keep their transform and their precise ray hull.
export function finishDistrict(root){
 const batches=new Map(),children=[...root.children],kind=root.userData.district;
 for(const mesh of children){
  if(!mesh.isMesh||mesh.geometry.type==='DodecahedronGeometry')continue;
  const color=mesh.material.color,hex=color.getHex(),roof=!!mesh.userData.districtRoof;
  mesh.updateMatrix();const bounds=new T.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(mesh.matrix),overhead=['warehouse','gate','court'].includes(kind)&&bounds.min.y>(kind==='warehouse'?2.4:2.5);
  const surface=stoneColors.has(hex)?'stone':metalColors.has(hex)?'metal':'wood';
  let geometry;
  if(roof){
   geometry=roofBoards(1,1,1);prepareBatchedSurface(geometry,'wood',{sx:mesh.scale.x,sy:mesh.scale.y,sz:mesh.scale.z});
  }else if(mesh.geometry.type==='BoxGeometry'){
   const {width,height,depth}=mesh.geometry.parameters;geometry=(surface==='stone'?masonryBlock:timberBlock).clone();geometry.scale(width,height,depth);prepareBatchedSurface(geometry,surface,{sx:mesh.scale.x,sy:mesh.scale.y,sz:mesh.scale.z});
  }else{geometry=mesh.geometry.clone();prepareBatchedSurface(geometry,surface,{sx:mesh.scale.x,sy:mesh.scale.y,sz:mesh.scale.z});}
  const p=geometry.attributes.position,c=geometry.attributes.color,colors=[];
  for(let i=0;i<p.count;i++){const shade=c?(c.getX(i)+c.getY(i)+c.getZ(i))/3:1;colors.push(color.r*shade,color.g*shade,color.b*shade);}
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  for(const key of Object.keys(geometry.attributes))if(!['position','normal','color','surfaceCoord','surfaceKind'].includes(key))geometry.deleteAttribute(key);
  if(!geometry.index)geometry.setIndex(Array.from({length:p.count},(_,i)=>i));
  if(overhead){mesh.geometry=geometry;mesh.material=finish(surface);mesh.name=roof?'SM_Harbor_CedarRoof_A':surface==='stone'?'SM_District_StoneCrown_A':'SM_Harbor_RoofFrame_A';mesh.userData.ownedGeometry=true;mesh.userData.environmentFinish=true;continue;}
  mesh.updateMatrix();geometry.applyMatrix4(mesh.matrix);
  if(!batches.has(surface))batches.set(surface,[]);batches.get(surface).push(geometry);root.remove(mesh);
  if(mesh.userData.ownedGeometry)mesh.geometry.dispose();if(mesh.userData.ownedMaterial)mesh.material.dispose();
 }
 for(const [surface,geometries]of batches){
  const geometry=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,finish(surface));mesh.castShadow=mesh.receiveShadow=true;mesh.name='SM_District_'+kind+'_'+surface;mesh.userData.ownedGeometry=true;mesh.userData.environmentFinish=true;root.add(mesh);
 }
}
