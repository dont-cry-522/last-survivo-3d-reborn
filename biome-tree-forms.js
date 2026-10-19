import * as T from './vendor/three.module.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {treeSceneryMaterials,createConiferSpray} from './tree-scenery.js?v=227';

// Original authored geometry. Shared bark/leaf surfaces keep this set offline,
// bounded and compatible with the existing tree prewarm, wind and LOD loop.
export const BIOME_TREE_FORMS={snow:['snow-spire','snow-wind','snow-veteran'],ash:['ash-fork','ash-snag'],sand:['sand-acacia','sand-juniper'],coast:['coast-pine','coast-tamarisk']};
const cache=new Map(),CROWN_BASE=3.35,vec=p=>new T.Vector3(...p),mix=(a,b,t)=>a.map((v,i)=>T.MathUtils.lerp(v,b[i],t));
const tri=g=>g.index.count/3;

function branch(points,radii,color,sides=7,steps=9){
 const curve=new T.CatmullRomCurve3(points.map(vec)),position=[],indices=[],colors=[],up=new T.Vector3(0,1,0),q=new T.Quaternion(),p=new T.Vector3(),c=new T.Color(color);
 for(let i=0;i<=steps;i++){
  const t=i/steps,k=t*(radii.length-1),n=Math.min(radii.length-2,Math.floor(k)),r=T.MathUtils.lerp(radii[n],radii[n+1],k-n),center=curve.getPoint(t);
  q.setFromUnitVectors(up,curve.getTangent(t));
  for(let j=0;j<sides;j++){
   const a=j/sides*Math.PI*2,root=points[0][1]<.01?Math.max(0,1-t*8):0;
   const radius=r*(1+.055*Math.sin(a*3+t*5))+.12*root*Math.max(0,Math.cos(a*3+.2))**6;
   p.set(Math.cos(a)*radius,0,Math.sin(a)*radius).applyQuaternion(q).add(center);if(root===1)p.y=-.04;
   position.push(...p);const shade=.82+.11*Math.sin(a*2.1+t*1.8)**2;colors.push(c.r*shade,c.g*shade,c.b*shade);
  }
 }
 for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides;indices.push(a,a+sides,b,b,a+sides,b+sides);}
 for(const [ring,flip] of [[0,false],[steps,true]]){
  const center=curve.getPoint(ring/steps),at=position.length/3;position.push(center.x,!ring&&points[0][1]<.01?-.04:center.y,center.z);colors.push(c.r*.9,c.g*.9,c.b*.9);
  for(let j=0;j<sides;j++){const a=ring*sides+j,b=ring*sides+(j+1)%sides;indices.push(...(flip?[at,b,a]:[at,a,b]));}
 }
 return geometry(position,indices,colors,0);
}
function geometry(position,indices,colors,kind){
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(position,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('treeSurface',new T.Float32BufferAttribute(new Float32Array(position.length/3).fill(kind),1));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}
function merge(parts){const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();g.computeBoundingBox();g.computeBoundingSphere();return g;}

function architecture(form,variant){
 const biome=form.split('-')[0],wood=[],boughs=[],clusters=[],tips=[],snow=biome==='snow',bare=biome==='ash',color=snow?0x68716e:bare?0x4f4646:biome==='sand'?0x807465:0x69786c;
 const limb=(p,r,sides=7,steps=8)=>{wood.push(branch(p,r,color,sides,steps));boughs.push({points:p,radii:r});};
 const crown=(p,w,d,angle,kind='leaf')=>clusters.push({p,w,d,angle,kind});
 const lean=variant?.14:-.12;
 if(form==='snow-spire'){
  limb([[0,0,0],[.02,.8,0],[.06,3.5,-.04],[lean,6.3,.05],[.05,8.9,.07]],[.35,.25,.18,.09,.01],10,17);
  for(let tier=0;tier<7;tier++)for(let arm=0;arm<4;arm++){
   const a=arm*Math.PI/2+tier*.81+variant*.27,y=4.15+tier*.56,r=1.60-tier*.18+(arm%2)*.09,base=[.03,y,0],end=[Math.cos(a)*r,y-.12,Math.sin(a)*r];
   limb([base,mix(base,end,.55),end],[.075-tier*.006,.040,.009],4,3);crown(mix(base,end,.53),r*.55,.37-tier*.025,a,'needle');
  }
  crown([.05,8.45,.05],.35,.18,.3,'needle');
 }else if(form==='snow-wind'){
  limb([[0,0,0],[-.06,1.2,.01],[.10,3.35,0],[.55,5.0,.12],[1.28+lean,6.55,.15],[1.8,7.65,.22]],[.37,.27,.21,.15,.08,.01],10,17);
  for(let tier=0;tier<6;tier++){
   const y=3.9+tier*.49,base=[.18+tier*.23,y,.08],a=(tier%2?.76:-.68)+variant*.12,r=1.45-tier*.12;
   const end=[base[0]+Math.cos(a)*r,y+.22,base[2]+Math.sin(a)*r];limb([base,mix(base,end,.45),end],[.10-tier*.010,.05,.01],5,4);
   crown(mix(base,end,.72),r*.63,.38,a,'needle');crown(mix(base,end,.38),r*.50,.32,a+.9,'needle');
  }
  limb([[.35,4.25,.08],[-.60,4.18,.18],[-.96,4.39,.21]],[.085,.035,.005],5,5);crown([1.7,7.3,.20],.52,.25,.1,'needle');
 }else if(form==='snow-veteran'){
  limb([[0,0,0],[.01,.8,0],[-.10,2.9,.05],[.10,4.5,.08],[.36,6.0,.18]],[.43,.31,.27,.18,.025],11,15);
  for(let arm=0;arm<3;arm++){
   const a=arm*2.24+variant*.31,base=[.03,3.7+arm*.35,.07],end=[Math.cos(a)*(1.4+arm*.12),6.2+arm*.65,Math.sin(a)*1.1];
   limb([base,[end[0]*.55,4.9+arm*.35,end[2]*.6],end],[.19-arm*.025,.10,.015],7,8);
   for(let tier=0;tier<3;tier++)for(const side of[-1,1]){const p=mix(base,end,.46+tier*.23),h=a+side*.9;const tip=[p[0]+Math.cos(h)*(.9-tier*.16),p[1]+.05,p[2]+Math.sin(h)*(.9-tier*.16)];limb([p,tip],[.055,.008],4,2);crown(mix(p,tip,.6),.66-tier*.10,.33,h,'needle');}
  }
  limb([[.07,3.50,.04],[-1.25,3.64,-.6],[-1.58,3.95,-.72]],[.14,.06,.008],6,6);
 }else if(bare){
  const fork=form==='ash-fork',top=fork?6.6:5.8;
  limb([[0,0,0],[.03,.7,.02],[.08,2.9,-.08],[-.16,4.0,.08],[fork?-.40:.17,top,.06]],[.45,.32,.25,.18,fork?.035:.09],11,16);
  const arms=fork?4:3;
  for(let i=0;i<arms;i++){
   const a=i*2.15+variant*.35,y=3.45+i*.43,r=(fork?1.65:1.14)-i*.14,base=[-.04,y,.04],end=[Math.cos(a)*r,y+(fork?1.55:.62),Math.sin(a)*r];
   const middle=mix(base,end,.62);middle[1]-=.32;
   limb([base,middle,end],[.18-i*.018,.10,.025],7,7);
   tips.push({p:[middle,end,[end[0]+Math.cos(a+.45)*.35,end[1]+.49,end[2]+Math.sin(a+.45)*.35]],r:[.07,.035,.004]});
   if(fork&&i<2)tips.push({p:[middle,[end[0]-.35,end[1]+.20,end[2]+.20],[end[0]-.55,end[1]+.65,end[2]+.28]],r:[.065,.027,.004]});
  }
  if(!fork)for(let i=0;i<3;i++)tips.push({p:[[.17,top-.2,.06],[.17+Math.cos(i*2.1)*.09,top+.22+(i%2)*.19,.06+Math.sin(i*2.1)*.08]],r:[.055,.003]});
 }else{
  const acacia=form==='sand-acacia',juniper=form==='sand-juniper',pine=form==='coast-pine',swept=pine||juniper;
  const stem=swept?[[0,0,0],[.03,.8,0],[.1,3.2,.08],[.65,4.5,.06],[1.3,5.9,.1]]:[[0,0,0],[.01,.8,.03],[-.07,2.9,.06],[.18,4.35,0],[.05,5.9,.12]];
  limb(stem,[.40,.27,.22,.17,.025],11,16);
  const count=acacia?5:pine?5:4;
  for(let i=0;i<count;i++){
   const a=swept?[-.9,.55,-.25,1.1,-1.3][i]+variant*.12:i*2.39+variant*.31,y=3.55+i*.26,base=[swept?.1+i*.12:.02,y,.04];
   const radius=acacia?2.2-i*.12:pine?1.7:1.5-i*.10,end=[base[0]+Math.cos(a)*radius,y+(acacia?1.4:1.0)+(i%2)*.25,Math.sin(a)*radius];
   const elbow=mix(base,end,.53);elbow[1]-=.12;
   limb([base,elbow,end],[.17-i*.015,.10,.028],7,7);
   for(let j=0;j<3;j++){
    const h=a+(j-1)*.64,p=mix(elbow,end,j===0?.35:1);p[0]+=Math.cos(h)*.34;p[1]+=.18+(j%2)*.20;p[2]+=Math.sin(h)*.34;
    limb([elbow,p],[.048,.006],4,3);crown(p,acacia?.88:pine?.72:.67,acacia?.62:.54,h,pine?'needle':'leaf');
   }
  }
  if(pine||juniper)limb([[.28,3.55,.04],[-.48,3.70,-.35],[-.68,4.02,-.52]],[.11,.045,.009],5,5);
 }
 return {biome,wood,boughs,clusters,tips,color,bare,snow};
}

function foliage(clusters,level){
 const positions=[],indices=[],colors=[],uv=[],flex=[],p=new T.Vector3(),c=new T.Color();
 const push=(point,color,u=0,v=0,weight=0)=>{positions.push(...point);colors.push(color.r,color.g,color.b);uv.push(u,v);flex.push(weight);};
 for(const node of clusters){
  const sprays=[4,3,2][level];
  for(let j=0;j<sprays;j++){
   const angle=node.angle+(j-(sprays-1)/2)*1.43,across=new T.Vector3(Math.cos(angle),0,Math.sin(angle));
   const normal=new T.Vector3(-across.z,.55,across.x).normalize(),along=new T.Vector3().crossVectors(normal,across).normalize(),center=vec(node.p);
   const first=positions.length/3,steps=level===0?3:2,rx=node.w*.88,ry=node.d*1.04;
   center.addScaledVector(across,(j%2?-.17:.17)*node.w);center.y-=CROWN_BASE;
   for(let iy=0;iy<=steps;iy++)for(let ix=0;ix<=steps;ix++){
    const x=ix/steps*2-1,y=iy/steps*2-1;
    p.copy(center).addScaledVector(across,x*rx).addScaledVector(along,y*ry).addScaledVector(normal,(.14-.12*x*x-.12*y*y)*ry);c.setRGB(.82,.87,.76).multiplyScalar(.93+.06*Math.sin(j*2.3+node.angle));
    push(p,c,(x+1)/2,(y+1)/2,Math.min(1,Math.hypot(x,y-.8)*.7));
   }
   const row=steps+1;for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){const a=first+y*row+x;indices.push(a,a+1,a+row,a+1,a+row+1,a+row);}
  }
 }
 const g=geometry(positions,indices,colors,1);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('treeLeafFlex',new T.Float32BufferAttribute(flex,1));return g;
}

function coniferFoliage(clusters,level,snow){
 const parts=[],green=new T.Color(0x657c69);
 for(const [i,node] of clusters.entries()){
  const reach=node.w*1.65,g=createConiferSpray(node.angle,node.p[1]-CROWN_BASE,reach,node.d*.95,i%3,level===0?1:2,level===1?8:5);
  g.translate(node.p[0]-Math.cos(node.angle)*reach*.50,0,node.p[2]-Math.sin(node.angle)*reach*.50);
  if(!snow){const colors=g.attributes.color;for(let v=0;v<colors.count;v++){const shade=.68+.32*(colors.getX(v)+colors.getY(v)+colors.getZ(v))/3;colors.setXYZ(v,green.r*shade,green.g*shade,green.b*shade);}}
  g.setAttribute('treeSurface',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(2),1));parts.push(g);
 }
 return merge(parts);
}

export function biomeTreeTemplate(form,variant=0){
 if(!Object.values(BIOME_TREE_FORMS).flat().includes(form))return null;
 variant=variant===1?1:0;const key=form+variant;if(cache.has(key))return cache.get(key);
 const data=architecture(form,variant),trunk=merge(data.wood),lods=[null,null,null];data.wood.length=0;
 const makeLOD=level=>{
  if(lods[level])return lods[level];
  const g=data.bare?merge(data.tips.map(t=>branch(t.p,t.r,data.color,level===0?6:level===1?5:4,level===0?6:3))):data.clusters[0]?.kind==='needle'?coniferFoliage(data.clusters,level,data.snow):foliage(data.clusters,level);
  if(data.bare)g.translate(0,-CROWN_BASE,0);
  if(level!==2&&lods[2]){
   const p=g.attributes.position,b=lods[2].boundingBox;
   for(let i=0;i<p.count;i++)p.setXYZ(i,T.MathUtils.clamp(p.getX(i),b.min.x,b.max.x),T.MathUtils.clamp(p.getY(i),b.min.y,b.max.y),T.MathUtils.clamp(p.getZ(i),b.min.z,b.max.z));
  }
  g.computeBoundingBox();g.computeBoundingSphere();g.name='SM_Tree_'+form+'_'+variant+'_LOD'+level;return lods[level]=g;
 };
 const canopy=makeLOD(2),height=Math.max(trunk.boundingBox.max.y,canopy.boundingBox.max.y+CROWN_BASE),template={form,variant,trunk,canopy,lods,makeLOD,boughs:data.boughs,clusters:data.clusters,biome:data.biome,bare:data.bare,
  bottom:CROWN_BASE,height,minLeafY:canopy.boundingBox.min.y+CROWN_BASE,material:data.bare?treeSceneryMaterials.bark:(data.snow||form==='coast-pine')?treeSceneryMaterials.snow:treeSceneryMaterials.leaves};
 trunk.name='SM_Tree_'+form+'_'+variant+'_Bark';cache.set(key,template);return template;
}

function routeDistance(points,x,z){
 let best=Infinity;for(let i=1;i<(points?.length||0);i++){
  const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,t=T.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);best=Math.min(best,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
 }return best;
}
function eligible(world,o,id,context){
 const r=o.mesh;if(!r||!r.visible||r.parent!==world.group&&!(world.regional&&r.parent===world.group.parent)||o.tactic||o.place||o.forestJourney||context.breakables?.includes(o)||o.sceneryHeight!==undefined)return false;
 if(['district','fragile','explorationLandmark','forestVistaTrunk','coastPropKind'].some(k=>r.userData[k]))return false;
 if((context.sites||[]).some(p=>Math.hypot(o.x-p.x,o.z-p.z)<(p.event?12:9))||(context.biomePlaces||[]).some(p=>Math.hypot(o.x-p.x,o.z-p.z)<14))return false;
 if(id==='snow')return r.userData.treeBiome==='snow'&&!!r.getObjectByName('tree-canopy');
 if(o.r<.60||o.r>.81||r.children.length>2||!r.children.every(c=>c.isMesh))return false;
 // A remaining natural rock group has no cargo, ruins or gameplay attachment.
 return r.children.some(c=>/Dodecahedron|Sphere/.test(c.geometry?.type||''))&&!r.children.some(c=>/Box|Cylinder/.test(c.geometry?.type||''));
}

// Install after routes/places and before collision-height extraction and terrain
// grounding. Forest remains untouched; joined-map regions retain their identity.
export function installBiomeTreeForms(world,id,{context=world}={}){
 if(world.biomeTreeForms)return world.biomeTreeForms;
 if(world.regions){
  const regions=[];for(const region of world.regions){const state=installBiomeTreeForms(region,region.id,{context:world});if(state)regions.push(state);}
  return world.biomeTreeForms={regions,trees:regions.flatMap(s=>s.trees)};
 }
 const forms=BIOME_TREE_FORMS[id];if(!forms)return null;
 const limit=id==='snow'?36:8,points=world.biomeJourney?.points||context.explorationRoutes?.find(r=>r.biome===id)?.points||[],buckets=forms.map(()=>[]),state={biome:id,trees:[],forms:{},limit,trianglesFar:0};
 for(const o of world.obstacles||[]){
  if(!eligible(world,o,id,context))continue;
  const distance=routeDistance(points,o.x,o.z);if(distance<3.6)continue;
  const grove=Math.sin(o.x*.061+o.z*.025)+Math.cos(o.z*.073-o.x*.018),band=grove<-.35?0:grove>.65?forms.length-1:Math.min(1,forms.length-1);
  // A few coherent groves frame the route; they do not form an alternating row.
  const score=(Number.isFinite(distance)?Math.abs(distance-10):Math.hypot(o.x-world.spawn.x,o.z-world.spawn.z)*.25)+Math.abs(grove)*2;
  buckets[band].push({o,form:forms[band],score});
 }
 for(const b of buckets)b.sort((a,b)=>a.score-b.score);
 const selected=[];for(let i=0;selected.length<limit;i++){let found=false;for(const b of buckets)if(b[i]&&selected.length<limit){selected.push(b[i]);found=true;}if(!found)break;}
 world.foliage??=[];
 for(const {o,form} of selected){
  const root=o.mesh,variant=Math.sin(o.x*.31+o.z*.49)>0?1:0,template=biomeTreeTemplate(form,variant),oldTrunk=root.getObjectByName('tree-trunk'),oldCrown=root.getObjectByName('tree-canopy');
  const scale=Math.min(1,(o.r-.04)/.59),height=id==='snow'?7.0+(Math.sin(o.x*.13+o.z*.11)+1)*.50:form==='sand-acacia'?5.9:form==='coast-pine'?6.8:6.2;
  // Under head height every stem fits inside its unchanged occupied footprint.
  // Upper crowns are deliberately different silhouettes, not scaled copies.
  const sy=Math.max(height/template.height,3.4/template.minLeafY);
  for(const child of [...root.children]){if(child.userData.ownedGeometry)child.geometry?.dispose();root.remove(child);}
  const trunk=new T.Mesh(template.trunk,treeSceneryMaterials.bark),crown=new T.Mesh(template.canopy,template.material);
  trunk.name='tree-trunk';crown.name='tree-canopy';trunk.scale.set(scale,sy,scale);crown.scale.copy(trunk.scale);crown.position.y=CROWN_BASE*sy;
  Object.assign(crown.userData,{treeCanopy:true,treeTemplate:template,treeLOD:2,biomeTreeForm:form,biomeTreeBreeze:id==='ash'?.22:id==='snow'?.55:1});
  for(const mesh of [trunk,crown]){mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);}
  root.userData.treeBiome=id;root.userData.biomeTreeForm=form;root.userData.biomeTreeVariant=variant;
  if(!oldTrunk)root.rotation.y=Math.sin(o.x*.051-o.z*.081)*.55+(id==='coast'?.45:0);
  const record=world.foliage.find(r=>r.leaf===oldCrown);if(record){record.leaf=crown;record.x=record.z=0;delete record.canopyTick;}else world.foliage.push({leaf:crown,x:0,z:0,phase:o.x*.17+o.z*.13});
  const trianglesFar=tri(template.trunk)+tri(template.canopy),item={x:o.x,z:o.z,form,variant,root,trianglesFar};
  state.trees.push(item);state.forms[form]=(state.forms[form]||0)+1;state.trianglesFar+=trianglesFar;
 }
 if(!state.trees.length)return null;
 world.biomeTreeForms=state;return state;
}
