import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.js';
import {FOREST_SURFACES,createBarkGeometry} from '../forest-surface-assets.js';
import {addTree} from '../tree-scenery.js';

test('forest PBR assets have local provenance, bounded dimensions and exact file hashes',()=>{
 const root=new URL('../assets/environment/forest-reborn/',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('sources.json',root)));
 assert.equal(manifest.license,'CC0-1.0');assert.equal(manifest.files.length,6);
 let total=0;
 for(const file of manifest.files){
  const bytes=readFileSync(new URL(file.file,root));total+=bytes.length;
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
  assert.equal(bytes.length,file.bytes);assert.equal(file.width,1024);assert.equal(file.height,1024);
  assert.equal(FOREST_SURFACES[file.kind][file.slot],file.file);
  assert(file.sourceURL.startsWith('https://dl.polyhaven.org/'));
  assert.match(file.sourceMD5,/^[a-f0-9]{32}$/);assert.match(file.sourceSHA256,/^[a-f0-9]{64}$/);
 }
 assert(total<3.2*1024*1024,'Two local 1K PBR sets exceed the agreed download budget');
});

test('late shared loading upgrades live materials only and distinguishes colour from data maps',async()=>{
 const {loadForestSurfaceAssets,createForestSurfaceMaterial,forestSurfaceAssetStatus}=await import('../forest-surface-assets.js?success');
 const early=createForestSurfaceMaterial('bark'),gone=createForestSurfaceMaterial('bark');gone.dispose();
 assert.equal(early.map,null);assert.equal(early.userData.forestSurfaceReady,false);
 const calls=[],textures=[],loader={loadAsync:async url=>{calls.push(url);const t=new T.Texture();textures.push(t);return t;}};
 const promise=loadForestSurfaceAssets({loader});assert.strictEqual(loadForestSurfaceAssets({loader}),promise);
 assert.deepEqual(await promise,{ready:true,loaded:['mossRock','bark'],textureCount:6});
 assert.equal(calls.length,6);assert(calls.every(url=>url.includes('/assets/environment/forest-reborn/')&&!url.includes('polyhaven')));
 assert.equal(early.userData.forestSurfaceReady,true);assert.equal(gone.userData.forestSurfaceReady,false);
 assert.equal(early.map.colorSpace,T.SRGBColorSpace);assert.equal(early.normalMap.colorSpace,T.NoColorSpace);
 assert.equal(early.roughnessMap.colorSpace,T.NoColorSpace);assert.equal(early.map.wrapS,T.RepeatWrapping);
 assert.equal(early.color.getHex(),0xffffff);assert.equal(early.metalness,0);assert.equal(early.roughness,1);
 assert.equal(early.normalScale.x,.62);
 const later=createForestSurfaceMaterial('bark',{tint:0xeeeedc,normalStrength:.3});
 assert.strictEqual(later.map,early.map);assert.strictEqual(later.normalMap,early.normalMap);
 assert.notStrictEqual(later,early);assert.equal(later.normalScale.x,.3);
 assert.equal(early.map.repeat.x,1);assert.equal(later.color.getHex(),0xeeeedc);
 let disposed=0;for(const texture of textures)texture.addEventListener('dispose',()=>disposed++);
 early.dispose();later.dispose();assert.equal(forestSurfaceAssetStatus().materialCount,0);
 assert.equal(disposed,0,'Scene material disposal must not invalidate textures used by another scene');
});

test('one corrupt or unavailable texture leaves only that whole material set on fallback and frees partial maps',async()=>{
 const {loadForestSurfaceAssets,createForestSurfaceMaterial,forestSurfaceAssetStatus}=await import('../forest-surface-assets.js?failure');
 const rock=createForestSurfaceMaterial('mossRock'),bark=createForestSurfaceMaterial('bark');
 let disposed=0;
 const loader={loadAsync:async url=>{if(url.includes('mossRock-normal'))throw Error('offline cache miss');const t=new T.Texture();t.addEventListener('dispose',()=>disposed++);return t;}};
 const result=await loadForestSurfaceAssets({loader});assert.deepEqual(result,{ready:false,loaded:['bark'],textureCount:3});
 assert.equal(rock.map,null);assert.equal(rock.normalMap,null);assert.equal(rock.roughnessMap,null);
 assert.equal(rock.color.getHex(),FOREST_SURFACES.mossRock.fallback);assert.equal(bark.userData.forestSurfaceReady,true);
 assert.equal(disposed,2);rock.dispose();bark.dispose();assert.equal(forestSurfaceAssetStatus().materialCount,0);
});

test('bark UVs follow every branch without seam-spanning triangles or modifying source geometry and smooth normals',()=>{
 for(const angle of[0,1,1.5]){
  const root=new T.Group();addTree(root,'forest',4,{angle});
  const trunk=root.getObjectByName('tree-trunk'),source=trunk.geometry;
  const originalPosition=Array.from(source.attributes.position.array),originalNormal=Array.from(source.attributes.normal.array);
  let disposed=0;source.addEventListener('dispose',()=>disposed++);
  const converted=createBarkGeometry(source,trunk.scale);assert(converted);assert.equal(converted.index,null);
  assert.equal(converted.attributes.position.count,source.index.count);assert.equal(converted.userData.forestBarkUV.segments,25);
  const out=converted.attributes.position,n=converted.attributes.normal,uv=converted.attributes.uv;
  const described=[[16,7],...Array.from({length:4},()=>[6,3]),...Array.from({length:20},()=>[3,3])];
  let start=0,triangles=0;
  for(const[sides,rings]of described){
   const count=(rings-1)*sides*6+sides*6,sideCount=(rings-1)*sides*6;
   let minV=Infinity,maxV=-Infinity;
   for(let i=triangles;i<triangles+count;i+=3){
    const originalIds=[0,1,2].map(c=>source.index.getX(i+c));
    for(let corner=0;corner<3;corner++){
     const j=i+corner,old=originalIds[corner];
     assert.equal(out.getX(j),source.attributes.position.getX(old));assert.equal(out.getY(j),source.attributes.position.getY(old));assert.equal(out.getZ(j),source.attributes.position.getZ(old));
     assert.equal(n.getX(j),source.attributes.normal.getX(old));assert.equal(n.getY(j),source.attributes.normal.getY(old));assert.equal(n.getZ(j),source.attributes.normal.getZ(old));
     assert(Number.isFinite(uv.getX(j))&&Number.isFinite(uv.getY(j)));
    }
    if(i<triangles+sideCount){
     const us=[0,1,2].map(c=>uv.getX(i+c));
     assert(Math.max(...us)-Math.min(...us)<.8,'triangle stretched across a full bark seam');
     for(let c=0;c<3;c++){minV=Math.min(minV,uv.getY(i+c));maxV=Math.max(maxV,uv.getY(i+c));}
    }
   }
   assert(maxV-minV>.1,'branch lost its longitudinal texture length');
   start+=sides*rings+2;triangles+=count;
  }
  assert.equal(start,414);assert.equal(triangles,2184);
  assert.equal(source.attributes.uv,undefined);assert.deepEqual(Array.from(source.attributes.position.array),originalPosition);assert.deepEqual(Array.from(source.attributes.normal.array),originalNormal);
  converted.dispose();assert.equal(disposed,0,'conversion owns neither source geometry nor shared templates');
 }
 const unknown=new T.CylinderGeometry(.3,.4,3,8);assert.equal(createBarkGeometry(unknown),null);unknown.dispose();
});
