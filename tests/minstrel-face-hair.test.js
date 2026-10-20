import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as T from '../vendor/three.module.js';
import {createMinstrelHair,animateMinstrelDetails} from '../minstrel-appearance.js';
import {restSurface} from '../hero-rest-surface.js';

test('minstrel flowing hair stays within the previous mesh budget and has attached roots',()=>{
 const hair=createMinstrelHair(),meshes=hair.children;
 assert(meshes.length<=7);
 assert(meshes.reduce((sum,m)=>sum+m.geometry.index.count/3,0)<=6200);
 const rest=meshes.map(m=>m.geometry.attributes.position.array.slice());
 for(let frame=0;frame<240;frame++)animateMinstrelDetails(meshes,frame/60,2.5,Math.sin(frame/50)*2);
 for(let k=0;k<meshes.length;k++){
  const mesh=meshes[k],d=mesh.userData.minstrelHair,p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
  assert(p.array.every(Number.isFinite));assert(n.array.every(Number.isFinite));
  for(let i=0;i<p.count;i++){
   if(d.weight[i]===0)for(let c=0;c<3;c++)assert.equal(p.array[i*3+c],rest[k][i*3+c],'roots must stay attached');
   assert(Math.abs(p.getY(i)-rest[k][i*3+1])<1e-7);
   assert(Math.hypot(p.getX(i)-rest[k][i*3],p.getZ(i)-rest[k][i*3+2])<.063);
   assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-4);
  }
 }
 for(const m of meshes){m.geometry.dispose();m.material.dispose();}
});

test('moving hair normals remain perpendicular to the deformed surface',()=>{
 const hair=createMinstrelHair(),mesh=hair.getObjectByName('SM_Hero_Minstrel_SweptPonytail'),d=mesh.userData.minstrelHair;
 const time=.7,run=1.2,turn=.8;
 animateMinstrelDetails(hair.children,time,run,turn);
 const n=mesh.geometry.attributes.normal,original=new T.Vector3(),tangent=new T.Vector3(),mapped=new T.Vector3(),normal=new T.Vector3();
 for(let i=0;i<n.count;i+=9){
  if(d.weight[i]===0)continue;
  const y=d.rest[i*3+1],epsilon=1e-5;
  const move=height=>{
   const w=T.MathUtils.clamp((d.anchor-height)/.30,0,1)**2*d.flex;
   return[w*(Math.sin(time*2.3+height*5)*.006-turn*.008),-w*(run*.021+Math.sin(time*2.1+height*8)*.004)];
  };
  const a=move(y-epsilon),b=move(y+epsilon),dx=(b[0]-a[0])/(epsilon*2),dz=(b[1]-a[1])/(epsilon*2);
  original.fromArray(d.normal,i*3);tangent.set(1,0,0).cross(original);
  if(tangent.lengthSq()<1e-8)tangent.set(0,0,1).cross(original);
  mapped.set(tangent.x+dx*tangent.y,tangent.y,tangent.z+dz*tangent.y).normalize();
  normal.fromBufferAttribute(n,i);
  assert(Math.abs(mapped.dot(normal))<2e-4,'specular highlight must follow the animated surface');
 }
 for(const m of hair.children){m.geometry.dispose();m.material.dispose();}
});

test('face refinement preserves the original rig and fits one smooth brow to the skin',async()=>{
 const original=Object.fromEntries(['fetch','self','ProgressEvent','createImageBitmap'].map(k=>[k,globalThis[k]]));
 try{
  globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};
  globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
  globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):original.fetch(input);};
  const worldURL=new URL('../world.js',import.meta.url),ref=fs.readFileSync(worldURL,'utf8').match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1];
  const {loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import(new URL(ref,worldURL));
  await loadHeroAssets();
  const silver=createSkinnedHero('silver','crossbow'),oldFace=silver.getObjectByName('Superhero_Female'),oldPositions=oldFace.geometry.attributes.position.array.slice();
  const hero=createSkinnedHero('minstrel','windbow'),face=hero.getObjectByName('Superhero_Female'),brows=hero.getObjectByName('Eyebrows');
  assert(face.isSkinnedMesh&&brows.isSkinnedMesh);
  assert.notEqual(face.geometry,oldFace.geometry);assert.notEqual(face.material,oldFace.material);
  assert.deepEqual(face.geometry.index.array,oldFace.geometry.index.array);
  assert.deepEqual(face.geometry.attributes.skinIndex.array,oldFace.geometry.attributes.skinIndex.array);
  assert.deepEqual(face.geometry.attributes.skinWeight.array,oldFace.geometry.attributes.skinWeight.array);
  assert.equal(face.material.normalMap,null);assert.equal(face.material.aoMap,null);
  assert(brows.userData.minstrelBrowsRefined);assert.equal(brows.geometry.index.count/3,384);
  const sample=restSurface(face.geometry),p=brows.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
   const hit=sample(p.getX(i),p.getY(i));assert(hit);
   assert(p.getZ(i)>hit.point.z+.0005&&p.getZ(i)<hit.point.z+.0011,'brow sits on the face without stepped gaps');
  }
  const crown=hero.getObjectByName('SM_Hero_Minstrel_Crown').geometry,cp=crown.attributes.position,uv=crown.attributes.uv;
  for(let i=0;i<cp.count;i++){
   if(uv.getY(i)<=.82||Math.cos(uv.getX(i)*Math.PI*2)<=.15)continue;
   const hit=sample(cp.getX(i),cp.getY(i));
   if(hit)assert(cp.getZ(i)>hit.point.z+.001,'hairline must not expose a triangle of forehead through the scalp');
  }
  for(let i=0;i<120;i++){hero.userData.aimActive=true;hero.userData.reloadPhase=(i%90)/90;hero.userData.reloadDuration=1.5;animateSkinnedHero(hero,i/60,3.5,.2,0);hero.updateMatrixWorld(true);}
  assert.deepEqual(oldFace.geometry.attributes.position.array,oldPositions,'other heroes keep their original face');
  hero.traverse(o=>assert(o.matrixWorld.elements.every(Number.isFinite),o.name));
  disposeHero(hero);disposeHero(silver);
 }finally{for(const[k,v]of Object.entries(original))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});
