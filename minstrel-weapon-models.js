import * as T from './vendor/three.module.js';
import {weaponGesture} from './weapon-performance.js?v=230';

const shared=new Map(),mats=new Map(),up=new T.Vector3(0,1,0);
function mat(name,color,metal=0){if(!mats.has(name))mats.set(name,new T.MeshStandardMaterial({name:'MAT_Minstrel_'+name,color,metalness:metal,roughness:metal?.32:.72}));return mats.get(name);}
function mesh(parent,name,key,make,material){if(!shared.has(key))shared.set(key,make());const m=new T.Mesh(shared.get(key),material);m.name=name;m.castShadow=m.receiveShadow=true;m.userData.identityDetail=true;parent.add(m);return m;}
function curved(parent,name,points,radius,material){return mesh(parent,name,name,()=>new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),24,radius,8,false),material);}
function rod(parent,name,radius,material){return mesh(parent,name,name,()=>new T.CylinderGeometry(radius,radius,1,8),material);}
function span(object,a,b){const delta=new T.Vector3().subVectors(b,a);object.position.copy(a).addScaledVector(delta,.5);object.scale.y=delta.length();object.quaternion.setFromUnitVectors(up,delta.normalize());}
export const isMinstrelWeapon=id=>id==='windbow'||id==='resonator';
export function makeMinstrelWeapon(id){
 const root=new T.Group();root.name='SM_Weapon_'+(id==='windbow'?'Windbow':'Resonator');root.userData.weaponId=id;
 if(id==='windbow'){
  const wood=mat('BowLaminate',0x775437),metal=mat('BowBinding',0xb8a579,.55),string=mat('BowString',0xe7ddbd);
  const limbs=[];
  for(const side of[-1,1]){
   const limb=new T.Group();limb.name='SM_Windbow_FlexibleLimb_'+side;root.add(limb);limbs.push(limb);
   curved(limb,'SM_Windbow_Limb_'+side,[[0,0,.018],[0,side*.20,.07],[0,side*.43,.15],[0,side*.65,.10],[0,side*.76,-.035]],.025,wood);
   curved(limb,'SM_Windbow_OuterLaminate_'+side,[[-.017,side*.11,.048],[-.019,side*.31,.126],[-.017,side*.53,.144],[-.012,side*.69,.063]],.007,metal);
  }
  mesh(root,'SM_Windbow_WrappedGrip','windbow-grip',()=>new T.CylinderGeometry(.031,.031,.17,12),mat('WrappedGrip',0x3a4849));
  const strings=[-1,1].map(s=>rod(root,'SM_Windbow_String_'+s,.0023,string));
  const arrow=new T.Group();arrow.name='SM_Windbow_NockedArrow';root.add(arrow);
  const shaft=rod(arrow,'SM_Windbow_ArrowShaft',.004,mat('ArrowWood',0xc1ad7c));shaft.rotation.x=Math.PI/2;shaft.scale.y=.76;shaft.position.z=.19;
  const head=mesh(arrow,'SM_Windbow_Arrowhead','windbow-head',()=>new T.ConeGeometry(.016,.075,4),metal);head.rotation.x=Math.PI/2;head.position.z=.60;
  for(const a of[0,Math.PI*2/3,Math.PI*4/3]){const feather=mesh(arrow,'SM_Windbow_Fletching_'+a,'windbow-feather',()=>new T.PlaneGeometry(.024,.09),mat('Fletching',0x91b1ad));feather.rotation.set(Math.PI/2,a,0);feather.position.set(Math.sin(a)*.008,Math.cos(a)*.008,-.13);}
  root.userData.minstrelBow={strings,arrow,limbs};poseMinstrelWeapon(root,id,10,1);
 }else{
  const bronze=mat('BellBronze',0xc2a66c,.72),dark=mat('BellInterior',0x615340,.45);
  mesh(root,'SM_Resonator_WrappedHandle','bell-handle',()=>new T.CylinderGeometry(.031,.038,.25,12),mat('WrappedGrip',0x3a4849)).position.y=.01;
  for(const side of[-1,1])curved(root,'SM_Resonator_Fork_'+side,[[side*.028,.12,0],[side*.10,.25,0],[side*.13,.47,0],[side*.10,.57,0]],.018,bronze);
  const bell=new T.Group();bell.name='SM_Resonator_SwingingBell';bell.position.y=.40;root.add(bell);
  const shell=mesh(bell,'SM_Resonator_HollowBell','bell-shell',()=>new T.LatheGeometry([[.018,.06],[.046,.048],[.065,.010],[.086,-.062],[.112,-.10],[.112,-.118],[.095,-.118],[.078,-.072],[.052,-.010],[.035,.028],[.018,.038]].map(p=>new T.Vector2(...p)),24),bronze);
  const clapper=mesh(bell,'SM_Resonator_Clapper','bell-clapper',()=>new T.SphereGeometry(.022,10,8),dark);clapper.position.y=-.098;
  curved(root,'SM_Resonator_Suspension',[[0,.49,0],[.028,.455,0],[.022,.405,0],[0,.397,0]],.008,bronze);
  root.userData.minstrelBell={bell,clapper};poseMinstrelWeapon(root,id,10,1);
 }
 return root;
}
export function poseMinstrelWeapon(root,id,age,period=1,time=0){
 const pose=weaponGesture(id,age,1,period),d=root.userData;
 if(d.minstrelBow){
  const nock=new T.Vector3(0,.06,-.08-.33*pose.pull);
  d.minstrelBow.strings.forEach((s,i)=>{const side=i?1:-1,angle=-side*.055*pose.pull;d.minstrelBow.limbs[i].rotation.x=angle;span(s,new T.Vector3(0,side*.76,-.035).applyAxisAngle(new T.Vector3(1,0,0),angle),nock);});
  d.minstrelBow.arrow.position.set(0,.06,-.33*pose.pull);d.minstrelBow.arrow.visible=pose.arrowVisible;
 }
 if(d.minstrelBell){d.minstrelBell.bell.rotation.z=pose.swing*.58+Math.sin(time*2.1)*.015;d.minstrelBell.clapper.rotation.z=-pose.swing*.35;}
 return pose;
}
