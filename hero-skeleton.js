// SkeletonUtils clones a Skeleton for every mesh, including garments bound to
// the same rig. Before the new actor is rendered, reuse its equivalent bone
// palette. Mesh bind matrices stay untouched and no state crosses actors.
export function shareClonedHeroSkeletons(model){
 const families=new Map(),resolved=new Map();
 model.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  const source=mesh.skeleton;
  // Never repurpose a live GPU palette or dispose a template-owned resource.
  if(!source?.bones.length||source.boneTexture!==null)return;
  if(resolved.has(source)){mesh.skeleton=resolved.get(source);return;}
  const first=source.bones[0];
  let candidates=families.get(first);
  if(!candidates){candidates=[];families.set(first,candidates);}
  const matching=candidates.find(other=>
   other.bones.length===source.bones.length&&
   other.boneInverses.length===source.boneInverses.length&&
   source.bones.every((bone,i)=>bone===other.bones[i])&&
   source.boneInverses.every((inverse,i)=>inverse.equals(other.boneInverses[i])));
  const shared=matching||source;
  if(!matching)candidates.push(source);
  resolved.set(source,shared);mesh.skeleton=shared;
 });
 return model;
}
