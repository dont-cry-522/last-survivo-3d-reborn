import * as T from './vendor/three.module.js';
import {form,surface,oval,tube} from './creature-forms.js?v=229';

// One continuous coat per articulated part. The existing foot solver and
// shoulder/jaw/ear pivots remain authoritative; geometry is shared by all pets.
function coat(rings,color,{axis='z',steps=24,sides=16,shade,grain=.004}={}){
 const curve=new T.CatmullRomCurve3(rings.map(r=>new T.Vector3(r[0],r[1],r[2]))),sampled=[];
 for(let j=0;j<=steps;j++){
  const t=j/steps,q=curve.getPoint(t),u=t*(rings.length-1),i=Math.min(rings.length-2,Math.floor(u)),center=T.MathUtils.lerp(rings[i][3]||0,rings[i+1][3]||0,u-i);
  sampled.push([q.x,Math.max(0,q.y),Math.max(0,q.z),0,center]);
 }
 const geometry=surface(color,sampled,{axis,sides,shade,deform:(x,y,z,a,j)=>{
  // Fine silhouette break belongs to the skin itself, without alpha cards or
  // individual fur cones. The first and last rings remain sealed.
  const weight=Math.sin(Math.PI*j/steps),r=grain*weight*Math.sin(a*7+Math.sin(j*.65));
  return [x+Math.cos(a)*r,axis==='z'?y+Math.sin(a)*r:y,axis==='y'?z+Math.sin(a)*r:z];
 }});
 geometry.userData.badgerCoat=true;return geometry;
}
export function badgerBody(parent){
 const body=form(parent,'Companion_Badger_Body_A',()=>{const geometry=coat([
  [-.59,0,0,.44],[-.51,.19,.19,.445],[-.36,.30,.255,.455],[-.17,.335,.266,.445],
  [.02,.29,.238,.43],[.20,.30,.232,.425],[.34,.25,.202,.425],[.43,.18,.16,.44],[.48,0,0,.45]
 ],0x747872,{shade:(c,x,y,z)=>{
  const belly=1-T.MathUtils.smoothstep(y,.23,.41),saddle=T.MathUtils.smoothstep(y,.48,.65);
  c.lerp(new T.Color(0x3f4944),belly*.8).lerp(new T.Color(0xa5a699),saddle*.58);
 }});
 // Normalize before batching: preserve smooth shared-ring normals and the
 // original breathing/reach scales, without a per-frame vertex update.
 const p=geometry.attributes.position;
 for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)/.34,(p.getY(i)-.43)/.27,(p.getZ(i)+.05)/.53);
 geometry.computeVertexNormals();return [geometry];
 });
 body.position.set(0,.43,-.05);body.scale.set(.34,.27,.53);return body;
}
export function badgerHead(parent){
 return form(parent,'Companion_Badger_Head_A',()=>[coat([
  [-.27,0,0,.015],[-.19,.15,.155,.025],[-.06,.232,.205,.02],[.08,.213,.168,.004],
  [.19,.142,.11,-.025],[.27,.080,.058,-.032],[.326,.055,.041,-.035],[.342,0,0,-.035]
 ],0xe1dbca,{steps:26,grain:.0025,shade:(c,x,y,z)=>{
  const stripeCenter=.09+.06*(1-T.MathUtils.smoothstep(z,-.1,.20)),stripeWidth=.024+.026*(1-T.MathUtils.smoothstep(z,.04,.23));
  const stripe=(1-T.MathUtils.smoothstep(Math.abs(Math.abs(x)-stripeCenter),stripeWidth,stripeWidth+.016))*T.MathUtils.smoothstep(y,-.14,-.025)*(1-T.MathUtils.smoothstep(z,.25,.31));
  c.lerp(new T.Color(0x29362f),stripe).multiplyScalar(.95+.05*T.MathUtils.smoothstep(y,-.1,.16));
 }})]);
}
export function badgerJaw(parent){
 return form(parent,'Companion_Badger_Jaw_A',()=>[
  coat([[-.015,0,0,-.03],[.025,.095,.047,-.03],[.13,.102,.038,-.03],[.23,.054,.022,-.025],[.27,0,0,-.025]],0xb6b6a1,{steps:12,sides:12,grain:0}),
  oval(0x383e32,0,.011,.14,.079,.009,.098,12,6)
 ]);
}
export function badgerEar(parent){
 return form(parent,'Companion_Badger_Ear_A',()=>[
  coat([[-.055,0,0,0],[-.015,.077,.042,0],[.040,.079,.040,0],[.083,.038,.023,0],[.095,0,0,0]],0x505b4e,{axis:'y',steps:10,sides:12,grain:.002}),
  oval(0xbcb7a1,0,.025,.035,.049,.055,.011,12,6)
 ]);
}
export function badgerLegPart(parent,front,lower=false){
 const width=front?.086:.098,length=lower?.22:.24;
 return form(parent,'Companion_Badger_'+(front?'Fore':'Hind')+(lower?'Shin':'Thigh')+'_A',()=>[
  coat([[.04,0,0,0],[.01,width,width,0],[-length*.3,width*.9,width,0],[-length,width*.4,width*.45,0],[-length-.01,0,0,0]],0x4a5549,{axis:'y',steps:12,sides:12,grain:.002})
 ]);
}
export function badgerPaw(parent,front){
 return form(parent,'Companion_Badger_'+(front?'Fore':'Hind')+'Paw_A',()=>[
  coat([[-.092,0,0,0],[-.05,.075,.044,0],[.012,.097,.053,0],[.075,.098,.039,-.008],[.127,.07,.024,-.014],[.143,0,0,-.017]],0x394737,{steps:12,sides:12,grain:.0015}),
  ...[-2,-1,0,1,2].map(i=>tube(0xb5ad8d,[[i*.034,-.009,.095],[i*.036,-.011,.133],[i*.036,-.021,front?.167:.15]],[.011,.010,.0015],{sides:5,steps:4}))
 ]);
}
export function badgerTail(parent){
 return form(parent,'Companion_Badger_Tail_A',()=>[coat([
  [.06,0,0,0],[.015,.085,.072,.018],[-.08,.102,.089,.052],[-.18,.095,.083,.074],[-.28,.069,.063,.084],[-.36,.027,.029,.072],[-.385,0,0,.061]
 ],0x7b8572,{steps:18,sides:12,grain:.004,shade:(c,x,y,z)=>c.lerp(new T.Color(0xbfc2aa),1-T.MathUtils.smoothstep(z,-.35,-.20))})]);
}
