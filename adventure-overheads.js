import * as T from './vendor/three.module.js';
import {bodyHeight} from './adventure-mobility.js?v=230';

const ceilingOffsets=[[0,0],[.3,0],[-.3,0],[0,.3],[0,-.3]];
// Merged cliffs can span the whole map. Their single bounding box cannot reject
// a nearby camera ray. Keep the original triangles, in bounded CPU-only slices;
// these proxies are never added to a scene or uploaded to the GPU.
function overheadSlices(mesh){
 const source=mesh.geometry,index=source.index,position=source.attributes.position;
 if(!index||index.count<3072||index.isInterleavedBufferAttribute||position.isInterleavedBufferAttribute||mesh.isSkinnedMesh||mesh.isInstancedMesh||Object.keys(source.morphAttributes).length||mesh.raycast!==T.Mesh.prototype.raycast)return null;
 const slices=[],point=new T.Vector3();
 for(let start=0;start<index.count;start+=768){
  const end=Math.min(index.count,start+768),geometry=new T.BufferGeometry();
  geometry.attributes=source.attributes;
  geometry.setIndex(new T.BufferAttribute(index.array.subarray(start,end),1));
  const box=new T.Box3();
  for(let i=start;i<end;i++)box.expandByPoint(point.fromBufferAttribute(position,index.getX(i)));
  box.expandByScalar(1e-6);geometry.boundingBox=box;geometry.boundingSphere=box.getBoundingSphere(new T.Sphere());
  const proxy=new T.Mesh(geometry,mesh.material);proxy.matrixAutoUpdate=false;
  slices.push({proxy,start,end});
 }
 return{source,index,position,indexVersion:index.version,positionVersion:position.version,slices};
}

function intersectOverhead(mesh,raycaster,hits,cache){
 let record=cache.get(mesh),source=mesh.geometry;
 if(record&&(record.source!==source||record.index!==source.index||record.position!==source.attributes.position||record.indexVersion!==source.index.version||record.positionVersion!==source.attributes.position.version)){
  record=overheadSlices(mesh);cache.set(mesh,record);
 }
 // Authored ranges use complete triangles. Preserve Three's unusual partial-
 // triangle range semantics too, by falling back when a range is not aligned.
 if(!record||mesh.morphTargetInfluences?.length||Array.isArray(mesh.material)||mesh.raycast!==T.Mesh.prototype.raycast||source.drawRange.start%3||Number.isFinite(source.drawRange.count)&&source.drawRange.count%3){raycaster.intersectObject(mesh,false,hits);return;}
 if(!mesh.layers.test(raycaster.layers))return;
 for(const {proxy,start,end}of record.slices){
  const low=Math.max(start,source.drawRange.start),high=Math.min(end,source.drawRange.start+source.drawRange.count);
  if(low>=high)continue;
  proxy.matrixWorld.copy(mesh.matrixWorld);proxy.material=mesh.material;
  const geometry=proxy.geometry;geometry.setDrawRange(low-start,high-low);
  const first=hits.length;proxy.raycast(raycaster,hits);
  for(let i=first;i<hits.length;i++){hits[i].object=mesh;hits[i].faceIndex+=start/3;}
 }
}
// Natural soil elevation is not an airborne/platform posture. Avoid raycasting
// every roof on each ordinary step along a shallow hill.
export function needsMobilityCeiling(world,p,crouching=false){
 return (p.y||0)>(world.groundHeightAt?.(p.x,p.z)||0)+.001||Math.abs(p.jumpVelocity||0)>.0001||(p.crouch||0)>0||crouching;
}
// Return a world height, querying above the feet so a raised support is not a roof.
export function mobilityCeiling(world,p,x=p.x,z=p.z){
 if(!world.overhead?.meshes?.length)return Infinity;
 let ceiling=Infinity;
 const feet=p.y||0,top=feet+(p.standHeight||1.8)+1.2;
 for(const [dx,dz]of ceilingOffsets){
  const low={x:x+dx,y:feet+.05,z:z+dz},high={...low,y:top};
  const hit=world.overhead.firstHit(low,high)||world.overhead.firstHit(high,low);
  if(hit)ceiling=Math.min(ceiling,hit.point.y-.08);
 }
 return ceiling;
}

// Airborne movement must meet a roof's side before the next vertical update.
// Ground movement keeps its existing footprint collision and crouch behaviour.
export function canMoveBelowOverhead(world,p,x,z){
 if(!world.overhead?.meshes?.length||!needsMobilityCeiling(world,p))return true;
 const dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz);
 if(d<1e-8)return true;
 const height=bodyHeight(p),radius=p.size||.45,nx=-dz/d,nz=dx/d;
 if(mobilityCeiling(world,p,x,z)<p.y+height-.02)return false;
 for(const fraction of[.5,.8,1])for(const side of[-radius,0,radius]){
  const y=p.y+height*fraction-.02;
  const start={x:p.x+nx*side,y,z:p.z+nz*side};
  const end={x:x+nx*side+dx/d*radius,y,z:z+nz*side+dz/d*radius};
  // Either winding is valid for single-sided sheets as well as closed roofs.
  if(world.overhead.firstHit(start,end)||world.overhead.firstHit(end,start))return false;
 }
 return true;
}

/** Static overhead geometry stays separate from the walkable ground footprints.
 * Build once after scenery installation; query only this small mesh collection.
 */
export function createOverheadQuery(world){
 world.group.updateMatrixWorld(true);
 const meshes=[],bounds=new T.Box3(),stone=world.forestVista?.group.getObjectByName('forest-vista-stone');
 world.group.traverse(mesh=>{
  if(!mesh.isMesh)return;
  if(mesh===stone||mesh.userData.placeOverhead){meshes.push(mesh);return;}
  let parent=mesh,district;
  while(parent&&parent!==world.group){if(parent.userData.explorationLandmark){meshes.push(mesh);return;}if(parent.userData.district){district=parent.userData.district;break;}parent=parent.parent;}
  if(district!=='warehouse'&&district!=='gate'&&district!=='court')return;
  bounds.setFromObject(mesh);
  if(bounds.min.y>(district==='warehouse'?2.4:2.5))meshes.push(mesh);
 });
 // Geometry is final here. Native raycasting can reject local bounds before
 // testing every triangle; world transforms still update on each query.
 for(const mesh of meshes)if(mesh.geometry.boundingBox===null)mesh.geometry.computeBoundingBox();
 const raycaster=new T.Raycaster(),direction=new T.Vector3(),hits=[],slices=new Map(meshes.map(mesh=>[mesh,overheadSlices(mesh)]));
 return{meshes,firstHit(start,end,clearance=0){
  direction.set(end.x-start.x,end.y-start.y,end.z-start.z);
  const length=direction.length();
  if(length<1e-8||!Number.isFinite(length))return null;
  raycaster.ray.origin.set(start.x,start.y,start.z);raycaster.ray.direction.copy(direction).divideScalar(length);
  raycaster.near=0;raycaster.far=length;hits.length=0;
  for(const mesh of meshes){
   let parent=mesh;
   // Three's raycaster ignores visibility. Hidden/removed scenery is no longer
   // solid, but hiding the whole world for another render pass changes nothing.
   while(parent&&parent!==world.group&&parent.visible)parent=parent.parent;
   if(parent!==world.group)continue;
   mesh.updateWorldMatrix(true,false);intersectOverhead(mesh,raycaster,hits,slices);
  }
  hits.sort((a,b)=>a.distance-b.distance);
  if(!hits.length)return null;
  // Clearance retracts along the segment; it does not expand a roof's footprint.
  const distance=Math.max(0,hits[0].distance-Math.max(0,clearance));
  const point=raycaster.ray.at(distance,direction);
  const normal=hits[0].face?.normal.clone().transformDirection(hits[0].object.matrixWorld);if(normal?.dot(raycaster.ray.direction)>0)normal.negate();
  return{point:{x:point.x,y:point.y,z:point.z},distance,normal,object:hits[0].object};
 }};
}
