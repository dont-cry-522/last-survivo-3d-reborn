import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {MirageVFX} from '../mirage-vfx.js';
import {prepareCombatSamples} from '../combat-prewarm.js';
import {SkillVFX} from '../skill-vfx.js';

function fixture(){
 const scene=new T.Scene(),vfx=new SkillVFX(scene),visual=new MirageVFX(scene,vfx),hero=new T.Group();
 const geometry=new T.BoxGeometry(.4,1.5,.3),material=new T.MeshStandardMaterial({color:0x45375b}),body=new T.Mesh(geometry,material);
 hero.position.set(4,2,-6);hero.rotation.y=.4;body.position.y=.85;hero.add(body);scene.add(hero);visual.group.visible=false;
 return{scene,vfx,visual,hero,body,geometry,material};
}

test('loading draws the actual ghost material, restores its scene state and retains buffers for the first live pose',()=>{
 const {scene,visual,hero,body,geometry}=fixture(),parent=new T.Group();scene.add(parent);
 const children=[...visual.group.children],decoy=visual.decoy;decoy.position.set(2,1,3);decoy.rotation.y=.3;decoy.scale.set(2,2,2);
 const transform=[...decoy.position.toArray(),...decoy.quaternion.toArray(),...decoy.scale.toArray()],uniforms=visual.ghostMaterial.uniforms;
 uniforms.opacity.value=.23;uniforms.clock.value=7;uniforms.hit.value=.1;
 const source=Array.from(geometry.attributes.position.array),cleanup=visual.prepareSnapshotSample(hero,parent),snapshot=visual.snapshot.get(body.uuid),cached=snapshot.geometry;
 assert.equal(decoy.parent,parent);assert(decoy.visible);assert.equal(snapshot.material,visual.ghostMaterial);assert.equal(uniforms.opacity.value,.7);
 assert.equal(visual.decoyId,null);assert.equal(visual.hitAt,-100);assert.equal(visual.group.visible,false);assert.equal(visual.snapshot.size,1);
 let disposed=0;cached.addEventListener('dispose',()=>disposed++);const initial=Array.from(cached.attributes.position.array);
 cleanup();cleanup();assert.equal(disposed,0);assert.deepEqual(visual.group.children,children);assert(!decoy.visible);
 assert.deepEqual([...decoy.position.toArray(),...decoy.quaternion.toArray(),...decoy.scale.toArray()],transform);
 assert.deepEqual(Object.values(uniforms).map(u=>u.value),[.23,7,.1]);assert.equal(visual.sourceHero,hero);
 body.rotation.x=.6;hero.position.x=8;
 visual.update({now:1,clouds:[],decoy:{id:1,x:8,z:-6,hp:70,born:1,expires:2.5}}, {x:8,z:-6},hero);
 assert.equal(visual.snapshot.get(body.uuid).geometry,cached);assert.notDeepEqual(Array.from(cached.attributes.position.array),initial);
 assert.deepEqual(Array.from(geometry.attributes.position.array),source);assert.equal(visual.decoyId,1);
 assert.throws(()=>visual.prepareSnapshotSample(hero,parent),/inactive decoy/);
 visual.clear();assert.equal(disposed,1);assert.equal(visual.snapshot.size,0);assert.equal(visual.captureSkeletons.size,0);visual.dispose();assert.equal(disposed,1);
});

test('snapshot setup and later preparation failures restore visibility, uniforms and parent order without losing reusable resources',async()=>{
 const {scene,visual,hero,vfx,body}=fixture(),children=[...visual.group.children],original=Object.values(visual.ghostMaterial.uniforms).map(u=>u.value);
 assert.throws(()=>visual.prepareSnapshotSample(hero,{add(){throw Error('sample add failure');}}),/sample add failure/);
 const geometry=visual.snapshot.get(body.uuid).geometry;let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
 assert.deepEqual(visual.group.children,children);assert(!visual.decoy.visible);assert.equal(visual.decoyId,null);assert.deepEqual(Object.values(visual.ghostMaterial.uniforms).map(u=>u.value),original);
 const options={scene,vfx,hero,mirageVFX:visual,mapId:'forest',player:{x:4,y:2,z:-6,angle:.4},yieldWork:async()=>{}};
 await assert.rejects(prepareCombatSamples({...options,report(done,total){if(done===total)throw Error('after capture');}}),/after capture/);
 assert.deepEqual(visual.group.children,children);assert.equal(visual.snapshot.get(body.uuid).geometry,geometry);assert.equal(disposed,0);assert.equal(scene.getObjectByName('Combat_Prewarm_Samples'),undefined);assert.equal(vfx.active.length,0);
 const cleanup=await prepareCombatSamples(options);assert.equal(visual.decoy.parent.name,'Combat_Prewarm_Samples');cleanup();
 assert.deepEqual(visual.group.children,children);assert.equal(visual.snapshot.get(body.uuid).geometry,geometry);assert.equal(disposed,0);assert.equal(visual.decoyId,null);
 visual.dispose();assert.equal(disposed,1);
});

test('each capture updates a shared actor skeleton once while still baking every mesh in the current pose',()=>{
 const scene=new T.Scene(),visual=new MirageVFX(scene),hero=new T.Group(),bone=new T.Bone();hero.add(bone);scene.add(hero);
 const skeleton=new T.Skeleton([bone]),material=new T.MeshBasicMaterial();let updates=0;const update=skeleton.update.bind(skeleton);skeleton.update=()=>{updates++;update();};
 const meshes=[];
 for(let part=0;part<2;part++){
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-.1,0,0,.1,0,0,0,1,0],3));g.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(12),4));g.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));g.setIndex([0,1,2]);g.computeVertexNormals();
  const mesh=new T.SkinnedMesh(g,material);hero.add(mesh);mesh.bind(skeleton);meshes.push(mesh);
 }
 bone.position.y=.25;visual.capture(hero);assert.equal(updates,1);assert.equal(visual.snapshot.size,2);
 for(const mesh of meshes)assert(Math.abs(visual.snapshot.get(mesh.uuid).geometry.attributes.position.getY(2)-1.25)<1e-6);
 const snapshots=meshes.map(mesh=>visual.snapshot.get(mesh.uuid));bone.position.y=.5;visual.capture(hero);assert.equal(updates,2);
 for(const [i,mesh]of meshes.entries()){assert.equal(visual.snapshot.get(mesh.uuid),snapshots[i]);assert(Math.abs(snapshots[i].geometry.attributes.position.getY(2)-1.5)<1e-6);}
 visual.dispose();assert.equal(visual.captureSkeletons.size,0);skeleton.dispose();
});
