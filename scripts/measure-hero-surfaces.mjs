// Real actor construction, no renderer: these are surface budgets, not FPS.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import path from 'node:path';

const {values:options}=parseArgs({options:{worker:{type:'boolean'},output:{type:'string'},baseline:{type:'string'}}});
if(!options.worker){
 const baselines={215:'character-v215/hero-surface-metrics.json',216:'character-v216/hero-surface-metrics-final.json'};
 if(!baselines[options.baseline]||!options.output)throw Error('Use --baseline=215|216 --output=<new report path>. Earlier after snapshots are read only.');
 const revision=Number(options.baseline);
 const dest=path.resolve(options.output);
 if(fs.existsSync(dest))throw Error('Refusing to overwrite an existing report: '+dest);
 const baselineFile=fileURLToPath(new URL('../../../outputs/'+baselines[revision],import.meta.url));
 const baselineData=fs.readFileSync(baselineFile),baseline=JSON.parse(baselineData),hash=data=>createHash('sha256').update(data).digest('hex');
 if(!Array.isArray(baseline.after)||baseline.after.length!==7)throw Error('Incomplete frozen v'+revision+' after snapshot');
 const output=execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--worker'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
 const current=JSON.parse(output.trim()),before=baseline.after,after=current.heroes;
 const fields=['meshes','skinnedMeshes','triangles','materials','textures','bones'];
 const totals=rows=>Object.fromEntries(fields.map(field=>[field,rows.reduce((sum,row)=>sum+row[field],0)]));
 const deltas=after.map(row=>{const old=before.find(entry=>entry.kind===row.kind);if(!old||old.weapon!==row.weapon)throw Error('Default weapon mismatch: '+row.kind);return{kind:row.kind,...Object.fromEntries(fields.map(field=>[field,row[field]-old[field]])),trianglePercent:Math.round((row.triangles/old.triangles-1)*10000)/100};});
 const measurements={
  scope:'Default weapons; visible hero meshes only. No environment/shadow passes. Texture count is unique standard-material texture objects. CPU surface and animation-data checks, not FPS or visual animation quality.',
  baseline:{revision,file:baselineFile,sha256:hash(baselineData),field:'after',unrecordedFields:revision===215?['animations','weaponAttachment']:[]},
  currentAssets:current.assets,before,after,deltas,totals:{before:totals(before),after:totals(after)},
  validation:'Every current default weapon remains parented to hand_r on its original 65-bone rig; 90 idle/move/attack frames have finite transforms. Animation entries are available clip data, not a claim that every clip was visually played.'
 };
 if(hash(fs.readFileSync(baselineFile))!==measurements.baseline.sha256)throw Error('Frozen baseline changed during measurement');
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(measurements,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output:dest,heroes:after.length,baseline:revision,revision:current.assets.version,totals:measurements.totals,deltas}));
}else{
 const network=globalThis.fetch;
 globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};
 globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
 globalThis.fetch=async input=>{
  const url=typeof input==='string'?input:input.url;
  return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):network(input);
 };
 const root=new URL('../',import.meta.url),source=fs.readFileSync(new URL('world.js',root),'utf8');
 const entry=source.match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1];
 const {loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import(new URL(entry,root));
 const {HERO_REFINEMENTS}=await import(new URL('hero-refinement-assets.js',root));
 const {GRIP_POINTS}=await import(new URL('weapon-grips.js',root));
 await loadHeroAssets();const results=[];
 for(const [kind,weapon]of [['scout','rifle'],['silver','crossbow'],['wraith','shade'],['tide','harpoon'],['lingya','boomerang'],['wuling','sporelantern'],['mirage','miasmalantern']]){
  const hero=createSkinnedHero(kind,weapon);animateSkinnedHero(hero,0,0,0,0);
  const materials=new Set(),textures=new Set(),bones=new Set();let meshes=0,skinnedMeshes=0,triangles=0,refinedMeshes=0;
  hero.traverseVisible(mesh=>{
   if(!mesh.isMesh)return;meshes++;triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3;
   if(mesh.userData.refinedAsset)refinedMeshes++;
   if(mesh.isSkinnedMesh){skinnedMeshes++;for(const bone of mesh.skeleton.bones)bones.add(bone);}
   for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
   }
  });
  const d=hero.userData,animations=Object.entries(d.actions).map(([name,action])=>{
   const clip=action.getClip(),finite=Number.isFinite(clip.duration)&&clip.duration>0&&clip.tracks.length>0&&clip.tracks.every(track=>Array.from(track.times).every(Number.isFinite)&&Array.from(track.values).every(Number.isFinite));
   if(!finite)throw Error(kind+': invalid animation '+name);
   return{name,duration:clip.duration,tracks:clip.tracks.length};
  });
  const gun=d.gun,boneNames=d.model.skeleton.bones.map(bone=>bone.name);
  if(gun.parent?.name!=='hand_r'||!d.model.skeleton.bones.includes(gun.parent))throw Error(kind+': weapon lost its original hand attachment');
  const weaponAttachment={parent:gun.parent.name,parentIsRigBone:true,weaponName:gun.name||null,gripPoint:GRIP_POINTS[weapon],localPosition:gun.position.toArray(),localQuaternion:gun.quaternion.toArray(),scale:gun.scale.toArray(),leftSupportBone:d.support?.hand?.name||null};
  for(let frame=0;frame<90;frame++){
   animateSkinnedHero(hero,frame/60,frame<30?0:3,frame>=60?.2:0,0);hero.updateMatrixWorld(true);
   hero.traverse(object=>{if(!object.matrixWorld.elements.every(Number.isFinite))throw Error(kind+': nonfinite transform in '+object.name);});
  }
  results.push({kind,weapon,meshes,skinnedMeshes,triangles,materials:materials.size,textures:textures.size,bones:bones.size,boneNames,refinedMeshes,animations,weaponAttachment,finiteAnimationFrames:90});disposeHero(hero);
 }
 console.log(JSON.stringify({assets:{version:HERO_REFINEMENTS.version,files:HERO_REFINEMENTS.files.map(({kind,part,sha256})=>({kind,part,sha256}))},heroes:results}));
}
