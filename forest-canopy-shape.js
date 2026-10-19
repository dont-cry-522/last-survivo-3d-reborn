import * as T from './vendor/three.module.js';

// Build-time shaping of an existing broadleaf tree. Keep every walking-height
// root and stem vertex, collider and wind anchor; only spread the overhead crown
// and carry its already-fitted branches through the same relative transform.
export function shapeForestCanopy(root,{width=1.35,depth=width,height=1.05,minHeadroom=3.2}={}){
 if(!root||root.userData.treeBiome!=='forest'||root.userData.forestCanopyShape)return false;
 if(![width,depth,height,minHeadroom].every(Number.isFinite)||width<1||depth<1||width>1.6||depth>1.6||height<.95||height>1.15||minHeadroom<3.2)return false;
 const trunk=root.getObjectByName('tree-trunk'),crown=root.getObjectByName('tree-canopy'),template=crown?.userData.treeTemplate;
 if(!trunk?.isMesh||!crown?.isMesh||trunk.parent!==root||crown.parent!==root||template?.snow||!template?.trunk||!trunk.visible||!crown.visible)return false;
 const source=trunk.geometry,position=source.attributes.position,original=template.trunk.attributes.position,indices=template.trunk.index;
 const expanded=!source.index&&source.userData.forestBarkUV&&position.count===indices?.count;
 if(!expanded&&(position.count!==original.count||source.index?.count!==indices?.count))return false;
 if(!expanded&&Array.from(indices.array).some((value,index)=>source.index.getX(index)!==value))return false;
 trunk.updateMatrix();crown.updateMatrix();root.updateWorldMatrix(true,false);
 const scale=crown.scale.clone().multiply(new T.Vector3(width,height,depth)),next=new T.Matrix4().compose(crown.position,crown.quaternion,scale);
 if(!crown.geometry.boundingBox)crown.geometry.computeBoundingBox();
 const bounds=crown.geometry.boundingBox.clone().applyMatrix4(root.matrixWorld.clone().multiply(next)),rootY=new T.Vector3().setFromMatrixPosition(root.matrixWorld).y;
 // Allow the same small wind excursion as existing route composition. A low
 // crown is skipped instead of filling a first-person route with foliage.
 if(bounds.min.y-rootY-Math.hypot(bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z)*.024<minHeadroom)return false;
 const delta=trunk.matrix.clone().invert().multiply(next).multiply(crown.matrix.clone().invert()).multiply(trunk.matrix);
 const geometry=source.clone(),target=geometry.attributes.position,point=new T.Vector3();
 for(let i=0;i<target.count;i++){
  const sourceIndex=expanded?indices.getX(i):i;
  // Heights identify the unchanged stem/fork spans; the positions always come
  // from the CURRENT habitat/route mesh, never from its undeformed template.
  // Linear transfer keeps fork bases on the same straight supporting spans.
  const weight=T.MathUtils.clamp((original.getY(sourceIndex)-1.8)/1.5,0,1);if(!weight)continue;
  point.fromBufferAttribute(position,i).applyMatrix4(delta);
  target.setXYZ(i,T.MathUtils.lerp(position.getX(i),point.x,weight),T.MathUtils.lerp(position.getY(i),point.y,weight),T.MathUtils.lerp(position.getZ(i),point.z,weight));
 }
 if(expanded){
  // Bark UV seams duplicate vertices. Accumulate against the original topology
  // so recomputing normals does not turn the curved trunk into flat triangles.
  const normals=new Float64Array(original.count*3),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
  for(let i=0;i<target.count;i+=3){
   a.fromBufferAttribute(target,i);b.fromBufferAttribute(target,i+1);c.fromBufferAttribute(target,i+2);c.sub(b);a.sub(b);c.cross(a);
   for(let j=0;j<3;j++){const n=indices.getX(i+j)*3;normals[n]+=c.x;normals[n+1]+=c.y;normals[n+2]+=c.z;}
  }
  const normal=geometry.attributes.normal;
  for(let i=0;i<target.count;i++){const n=indices.getX(i)*3;point.set(normals[n],normals[n+1],normals[n+2]).normalize();normal.setXYZ(i,point.x,point.y,point.z);}normal.needsUpdate=true;
 }else geometry.computeVertexNormals();
 target.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
 trunk.geometry=geometry;if(trunk.userData.ownedGeometry)source.dispose();trunk.userData.ownedGeometry=true;
 crown.scale.copy(scale);crown.updateMatrix();root.userData.forestCanopyShape={width,depth,height};return true;
}
