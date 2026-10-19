import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {clone} from '../vendor/SkeletonUtils.js';
import {shareClonedHeroSkeletons} from '../hero-skeleton.js';

function fixture(){
 const root=new T.Group(),hip=new T.Bone(),arm=new T.Bone(),hand=new T.Bone();
 hip.name='hip';arm.name='arm';hand.name='hand';
 root.add(hip);hip.add(arm);arm.position.set(.2,1,0);arm.add(hand);hand.position.set(.6,0,0);root.updateMatrixWorld(true);
 const bones=[hip,arm,hand],inverse=bones.map(b=>b.matrixWorld.clone().invert());
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,.2,1,0,.8,1,0,.35,.65,.1],3));
 geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,0,0,0,1,0,0,0,2,0,0,0,0,1,2,0],4));
 geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0,.2,.5,.3,0],4));
 for(let i=0;i<3;i++){
  const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial());mesh.name='surface-'+i;
  root.add(mesh);mesh.bind(new T.Skeleton(bones,inverse),new T.Matrix4().makeTranslation(i*.013,0,0));
 }
 return root;
}
function surfaces(root){const result=[];root.traverse(o=>{if(o.isSkinnedMesh)result.push(o);});return result;}
function pose(root,t){
 root.getObjectByName('hip').position.x=.04*t;
 root.getObjectByName('arm').rotation.set(.17*t,0,-.3*t);
 root.getObjectByName('hand').rotation.set(0,.24*t,.07*t);root.updateMatrixWorld(true);
 for(const skeleton of new Set(surfaces(root).map(o=>o.skeleton)))skeleton.update();
}
function deformation(root){return surfaces(root).map(mesh=>Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.applyBoneTransform(i,new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)).toArray()));}

test('one cloned actor reuses equivalent palettes without changing bind matrices or deformed vertices',()=>{
 const original=fixture(),actor=clone(original),control=clone(original);
 const matrices=surfaces(actor).map(m=>[m.bindMatrix.elements.slice(),m.bindMatrixInverse.elements.slice()]);
 assert.equal(new Set(surfaces(actor).map(m=>m.skeleton)).size,3);
 assert.equal(shareClonedHeroSkeletons(actor),actor);
 assert.equal(new Set(surfaces(actor).map(m=>m.skeleton)).size,1);
 assert.deepEqual(surfaces(actor).map(m=>[m.bindMatrix.elements,m.bindMatrixInverse.elements]),matrices);
 assert.equal(new Set(surfaces(original).map(m=>m.skeleton)).size,3,'source template was changed');
 for(const time of [0,.3,1,2]){pose(actor,time);pose(control,time);assert.deepEqual(deformation(actor),deformation(control));}
});

test('different inverse binds, bone order, or actual bone references retain separate palettes',()=>{
 const actor=clone(fixture()),[a,b,c]=surfaces(actor);
 b.skeleton.boneInverses=b.skeleton.boneInverses.map(m=>m.clone());b.skeleton.boneInverses[1].elements[12]+=.000001;
 c.skeleton.bones=[c.skeleton.bones[0],c.skeleton.bones[2],c.skeleton.bones[1]];
 const detached=new T.Bone();detached.name=a.skeleton.bones[0].name;
 const d=new T.SkinnedMesh(a.geometry,a.material);d.bind(new T.Skeleton([detached,...a.skeleton.bones.slice(1)],a.skeleton.boneInverses),a.bindMatrix);actor.add(d);
 const before=surfaces(actor).map(m=>m.skeleton);shareClonedHeroSkeletons(actor);
 assert.deepEqual(surfaces(actor).map(m=>m.skeleton),before);
 assert.equal(new Set(surfaces(actor).map(m=>m.skeleton)).size,4);
});

test('two actor rigs and palette disposal stay independent, and live GPU palettes are not replaced',()=>{
 const template=fixture(),a=shareClonedHeroSkeletons(clone(template)),b=shareClonedHeroSkeletons(clone(template));
 const x=surfaces(a)[0].skeleton,y=surfaces(b)[0].skeleton;
 assert.notEqual(x,y);assert.notEqual(x.bones[0],y.bones[0]);
 pose(b,.4);const unchanged=deformation(b);pose(a,2);assert.deepEqual(deformation(b),unchanged);
 x.computeBoneTexture();y.computeBoneTexture();let disposedA=0,disposedB=0;
 x.boneTexture.addEventListener('dispose',()=>disposedA++);y.boneTexture.addEventListener('dispose',()=>disposedB++);
 for(const s of new Set(surfaces(a).map(m=>m.skeleton)))s.dispose();
 assert.equal(disposedA,1);assert.equal(disposedB,0);assert(y.boneTexture);pose(b,.8);
 assert(deformation(b).flat(2).every(Number.isFinite));
 const live=clone(template),first=surfaces(live)[0];first.skeleton.computeBoneTexture();const active=first.skeleton,texture=active.boneTexture;
 shareClonedHeroSkeletons(live);assert.equal(first.skeleton,active);assert.equal(active.boneTexture,texture);
 assert.equal(new Set(surfaces(live).map(m=>m.skeleton)).size,2);
 for(const s of new Set([...surfaces(b),...surfaces(live)].map(m=>m.skeleton)))s.dispose();
});
