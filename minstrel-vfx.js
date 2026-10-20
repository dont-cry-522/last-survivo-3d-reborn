import*as T from'./vendor/three.module.js';

const valid=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);
const vec=p=>new T.Vector3(p.x,p.y,p.z);

export function windArrow(vfx,w){
 const g=new T.Group();g.name='SM_Windbow_FeatherArrow_A';
 const part=(shape,color,scale,z,name)=>{
  const key='wind-arrow-'+color;
  if(!vfx.materials.has(key))vfx.materials.set(key,new T.MeshBasicMaterial({color,side:T.DoubleSide}));
  const m=new T.Mesh(vfx.geometry[shape],vfx.materials.get(key));m.name=name;m.scale.set(...scale);m.position.z=z;g.add(m);return m;
 };
 part('ray',0x687b73,[.018,.018,.77],0,'SM_Windbow_ArrowShaft_A');
 part('crystal',w.pathId==='windbow_pierce'?0xe8e1ac:0xd1e6d6,[.047,.19,.022],.43,'SM_Windbow_ArrowHead_A').rotation.x=Math.PI/2;
 for(let i=0;i<3;i++){
  const a=i*Math.PI*2/3,m=part('crystal',i?0xb9d3b9:0xf1e6c6,[.015,.17,.06],-.31,'SM_Windbow_ArrowFeather_'+i);
  m.rotation.set(Math.PI/2,0,a);m.position.x=Math.cos(a)*.047;m.position.y=Math.sin(a)*.047;
 }
 return g;
}

export function minstrelMuzzle(vfx,w,x,y,z,angle){
 const direction=new T.Vector3(Math.sin(angle),0,Math.cos(angle)),side=new T.Vector3(Math.cos(angle),0,-Math.sin(angle)),source=new T.Vector3(x,y,z);
 for(const s of[-1,1]){
  const a=source.clone().addScaledVector(side,s*.10),b=source.clone().addScaledVector(direction,.36).addScaledVector(side,s*.05);
  vfx.segment(a,b,0xe7dfbd,.012,.10,false,1,.60,{endColor:0x6e9b88});
 }
 const feather=vfx.particle('sweep',0xa3c8ae,x,y,z,{life:.18,size:[.20,.10,1],velocity:[direction.x*.65,.06,direction.z*.65],opacity:.25,additive:false,motion:'lash',roll:1.2,endColor:0x688d78});
 if(feather)feather.rotation.set(-Math.PI/2,0,-angle);
}

export function minstrelWave(vfx,origin,points,{echo=false,angle=0}={}){
 if(!valid(origin)||!Array.isArray(points))return;
 // Disconnected, feathered pressure fronts. Never join across an occlusion
 // gap, and never draw a full circle or an opaque cone over enemies.
 const color=echo?0xb4cee0:0xe6d7a8;
 for(const [a,b]of[[0,1],[2,3],[4,5]]){
  const p=points[a],q=points[b];if(!valid(p)||!valid(q)||p.block||q.block)continue;
  const length=vec(p).distanceTo(q);if(length<.015||length>4)continue;
  vfx.segment(vec(p),vec(q),color,echo?.015:.023,.105,false,1,echo?.40:.55,{endColor:echo?0x738b9c:0x9c9278});
 }
 const center=points[Math.floor(points.length/2)];
 if(valid(center)&&!center.block){
  const m=vfx.particle('vapor',echo?0xa3baca:0xc8bc9e,center.x,center.y,center.z,{life:.14,size:[.31,.12,1],velocity:[Math.sin(angle)*.15,0,Math.cos(angle)*.15],opacity:.12,additive:false,grow:true});
  if(m)m.rotation.y=angle;
 }
}

export function minstrelHit(vfx,id,contact,{angle=0,echo=false}={}){
 if(!valid(contact))return;
 const bow=id==='windbow',p=vec(contact),side=new T.Vector3(Math.cos(angle),0,-Math.sin(angle));
 const color=bow?0xd8e6ba:echo?0xc0dce7:0xe6d2a3;
 for(let i=0;i<3;i++){
  const s=(i-1)*.8,position=p.clone().addScaledVector(side,s*.055),a=side.clone().multiplyScalar(s*.9).add(new T.Vector3(0,.3+i*.1,0));
  vfx.particle(bow?'crystal':'smoke',color,position.x,position.y,position.z,{life:bow?.18:.24,size:bow?[.016,.09,.016]:[.055,.035,.055],velocity:[a.x,a.y,a.z],gravity:bow?2:0,spin:bow?2:0,opacity:bow?.72:.40,additive:false,endColor:bow?0x718762:0x877f75});
 }
 if(bow)vfx.segment(p.clone().addScaledVector(side,-.11),p.clone().addScaledVector(side,.13),0xe5e8d1,.018,.085,false,1,.65);
}

export function minstrelSkill(vfx,kind,x,z,angle=0){
 const y=vfx.groundHeight(x,z),dx=Math.sin(angle),dz=Math.cos(angle);
 if(kind==='minstrelChord'){
  for(let i=0;i<3;i++){
   const px=x+Math.cos(angle)*(i-1)*.16,pz=z-Math.sin(angle)*(i-1)*.16;
   vfx.segment(new T.Vector3(px,y+.55,pz),new T.Vector3(px+dx*.10,y+.95+i*.09,pz+dz*.10),i===1?0xf2e3bb:0xa9cdd0,.018,.22,false,1,.70,{delay:i*.025,endColor:0x6e9390});
  }
 }else{
  for(const s of[-1,1]){
   const guard=kind==='minstrelGuard',m=vfx.groundParticle('sweep',guard?0xdcd4b2:0xb9d2af,x+Math.cos(angle)*s*.26,guard?.70:.24,z-Math.sin(angle)*s*.26,{life:.32,size:[guard?.20:.33,guard?.38:.13,1],opacity:.38,velocity:[-dx*.35,.10,-dz*.35],additive:false,motion:'lash',roll:s*.9,endColor:0x71897a});
   if(m)m.rotation.set(guard?0:-Math.PI/2,angle,s*.2);
  }
 }
}
