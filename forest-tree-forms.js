import * as T from './vendor/three.module.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {forestTreeAssetTemplate,fitForestTreeAssetMaterials} from './forest-tree-assets.js?v=229';

// Four branch architectures, two bounded variants each. These are application-
// owned templates like tree-scenery's original trees: no per-tree textures,
// materials, draw calls, clocks or first-approach geometry generation.
export const FOREST_TREE_FORMS=Object.freeze(['oak','alder','wind','highcanopy']);
const templates=new Map(),UP=new T.Vector3(0,1,0),CROWN_BASE=3.6;
const vec=p=>new T.Vector3(...p);
const mix=(a,b,t)=>a.map((n,i)=>T.MathUtils.lerp(n,b[i],t));
const turn=(r,a,y)=>[Math.cos(a)*r,y,Math.sin(a)*r];
const triangles=g=>g.index.count/3;

// The trunk and each branch have their own lengthwise UV strip. Duplicate only
// the seam, then average its normals: normal maps cannot expose a hard seam.
function branchGeometry(points,radii,{sides=7,steps=7,root=false}={}){
 const curve=new T.CatmullRomCurve3(points.map(vec)),frames=curve.computeFrenetFrames(steps,false);
 const positions=[],uv=[],colors=[],indices=[],v=new T.Vector3(),c=new T.Color(0x665b43);
 const repeats=Math.max(1,Math.round(Math.max(...radii)*Math.PI*2));let length=0,previous;
 for(let ring=0;ring<=steps;ring++){
  const t=ring/steps,center=curve.getPoint(t),at=t*(radii.length-1),k=Math.min(radii.length-2,Math.floor(at));
  const radius=T.MathUtils.lerp(radii[k],radii[k+1],at-k);
  if(previous)length+=center.distanceTo(previous);previous=center;
  for(let side=0;side<=sides;side++){
   const a=side/sides*Math.PI*2,flare=root?Math.max(0,1-t*5):0;
   const r=radius*(1+.035*Math.cos(a*3+t*4))+.09*flare*Math.max(0,Math.cos(a*4+.4))**6;
   v.copy(center).addScaledVector(frames.normals[ring],Math.cos(a)*r).addScaledVector(frames.binormals[ring],Math.sin(a)*r);
   if(root&&ring===0)v.y=-.055;
   positions.push(v.x,v.y,v.z);uv.push(side/sides*repeats,length);
   const shade=.79+.06*Math.sin(a*3+t*2)+.07*T.MathUtils.smoothstep(v.y,.1,1.5);
   colors.push(c.r*shade,c.g*shade,c.b*shade);
  }
 }
 const row=sides+1;
 for(let ring=0;ring<steps;ring++)for(let side=0;side<sides;side++){
  const a=ring*row+side,b=a+row;indices.push(a,a+1,b,a+1,b+1,b);
 }
 for(const end of[0,steps]){
  const p=curve.getPoint(end/steps),base=positions.length/3;
  positions.push(p.x,root&&end===0?-.055:p.y,p.z);uv.push(.5,.5);colors.push(c.r*.8,c.g*.8,c.b*.8);
  for(let side=0;side<sides;side++){
   const a=end*row+side;indices.push(...(end?[base,a,a+1]:[base,a+1,a]));
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 g.setAttribute('treeSurface',new T.Float32BufferAttribute(new Float32Array(positions.length/3),1));g.setIndex(indices);g.computeVertexNormals();
 const normal=g.attributes.normal;
 for(let ring=0;ring<=steps;ring++){
  const first=ring*row,last=first+sides;
  v.fromBufferAttribute(normal,first).add(new T.Vector3().fromBufferAttribute(normal,last)).normalize();
  normal.setXYZ(first,v.x,v.y,v.z);normal.setXYZ(last,v.x,v.y,v.z);
 }
 return g;
}

function architecture(form,variant){
 const wood=[],branches=[],clusters=[],lean=variant?-.18:.14;
 const limb=(points,radii,detail)=>{branches.push({points,radii,detail});wood.push(branchGeometry(points,radii,detail));};
 const leaves=(p,width,depth,phase)=>clusters.push({p,width,depth,phase});
 const twig=(base,end,width,phase,depth=width*.73)=>{
  const middle=mix(base,end,.54);middle[1]+=.08+.09*Math.sin(phase);middle[0]+=.055*Math.sin(phase*1.3);middle[2]+=.055*Math.cos(phase*.8);
  limb([base,middle,end],[.065,.032,.006],{sides:4,steps:3});leaves(end,width,depth,phase);
 };
 if(form==='oak'){
  // A forked, heavy oak. Two unequal leaders carry separate crowns, with a
  // real saddle and a lower side branch instead of a centered umbrella cap.
  limb([[0,0,0],[.04,.6,0],[lean,2.3,.08],[.16,3.8,-.06],[.25,5.6,.18],[.35,7.8,.1]],[.46,.34,.30,.23,.15,.04],{sides:14,steps:17,root:true});
  const forks=[{base:[.12,3.55,.02],end:[-1.9,5.7,.65],angle:2.8},{base:[.21,4.1,.05],end:[1.75,6.45,-.4],angle:-.3},{base:[.22,4.9,.12],end:[-.25,6.55,-1.55],angle:4.65}];
  for(const [i,f]of forks.entries()){
   const middle=mix(f.base,f.end,.45);middle[1]-=.13;middle[2]+=(i%2?1:-1)*.20;
   const shoulder=mix(f.base,f.end,.78);shoulder[1]+=.09;shoulder[0]+=(i%2?-.12:.12);
   limb([f.base,middle,shoulder,f.end],[.24-i*.035,.17-i*.025,.105,.055],{sides:7,steps:7});
   // Part of the same leaf budget grows halfway along each bough. Broad inner
   // shoulders overlap long and short outer twigs; crowns are not five balls
   // sitting on five equal bare forks. The lowest shoulder keeps eye clearance.
   const along=[.59,.86,1,1,.67],reach=[.20,.37,.78,.45,.28],sides=[.1,-.75,-.22,.74,.26],rise=[.83,.66,.65,1.15,1.46];
   for(let j=0;j<5;j++){
    const a=f.angle+variant*.12,c=Math.cos(a),s=Math.sin(a),end=mix(f.base,f.end,along[j]);
    end[0]+=c*reach[j]-s*sides[j];end[1]+=rise[j]+(variant?Math.sin(j*1.8+i)*.16:0);end[2]+=s*reach[j]+c*sides[j];
    const widths=[1.22,1.29,1.10,1.14,1.08],depths=[.92,.98,.81,1.02,.94];
    twig(mix(middle,shoulder,j<2?.2:.72),end,widths[j],a+j*.67,depths[j]);
   }
  }
  const tops=[[-.65,7.45,.33],[.33,7.95,-.13],[1.08,7.42,.62]];
  for(let j=0;j<3;j++){const p=tops[j].slice();p[0]+=lean;twig([.30,6.75,.10],p,[1.16,.92,1.05][j],j*2.25,.88);}
 }else if(form==='alder'){
  // A single slender S-stem with alternating ascending branch tiers. The
  // vertical gaps and smaller sprays are intrinsic, not a narrow oak scale.
  const stem=[[0,0,0],[.02,.7,0],[-.12,2.8,.05],[.28+lean,5.1,-.08],[-.14,7.6,.12],[.10,9.7,0]];
  limb(stem,[.34,.27,.22,.15,.085,.015],{sides:12,steps:19,root:true});
  for(let tier=0;tier<7;tier++){
   const y=3.85+tier*.72,a=tier*2.4+variant*.42,reach=1.48+Math.sin(tier*.72)*.38-tier*.055;
   const base=[tier%2?.15:-.04,y,.03],end=turn(reach,a,y+.83),middle=mix(base,end,.55);middle[1]-=.07;
   limb([base,middle,end],[.13-tier*.009,.07,.015],{sides:6,steps:5});
   for(const side of[-1,1]){
    const p=mix(base,end,side<0?.70:1.08);p[0]+=Math.cos(a+side*.75)*.20;p[1]+=.50+(side>0?.05:0);p[2]+=Math.sin(a+side*.75)*.20;
    twig(side<0?mix(base,middle,.8):middle,p,side<0?.85:.73,a+side*.75,side<0?.72:.64);
   }
  }
  leaves([.12,9.65,0],.65,.52,.4+variant);
 }else if(form==='wind'){
  // Wind-pruned limbs lean toward one side; the opposite side has sparse,
  // tapering old branches. A bent leader and fan canopy read even in silhouette.
  limb([[0,0,0],[.03,.7,0],[.12,3.15,.05],[.62,4.8,.12],[1.5+lean,6.8,.22],[2.10,8.2,.05]],[.42,.31,.25,.20,.105,.015],{sides:12,steps:18,root:true});
  for(let tier=0;tier<6;tier++){
   const y=[3.9,4.65,5.05,5.85,6.1,6.7][tier],base=[.28+tier*.20,y,.12],a=[.18,-.70,.8,-.32,.48,-.12][tier]+variant*.13,reach=1.72+(tier%3)*.22;
   const end=[base[0]+Math.cos(a)*reach,y+.96,Math.sin(a)*reach],middle=mix(base,end,.40);middle[1]-=.06;middle[2]+=.14*Math.sin(tier+variant);
   const shoulder=mix(base,end,.78);shoulder[1]-=.20;shoulder[2]-=.12*Math.cos(tier);
   limb([base,middle,shoulder,end],[.18-tier*.015,.125-tier*.008,.07,.022],{sides:7,steps:5});
   for(let j=0;j<3;j++){
    const heading=a+(j-1)*.56,p=mix(base,end,[.53,.89,1.10][j]),reach=[.08,.20,.39][j];
    p[0]+=Math.cos(heading)*reach;p[1]+=[.72,.58,.44][j]+.08*Math.sin(tier*1.4+j);p[2]+=Math.sin(heading)*reach+(j===1?.22:-.13);
    twig(mix(middle,shoulder,j*.35),p,[1.10,1.14,.88][j],heading,[.85,.9,.72][j]);
   }
  }
  limb([[.32,3.95,.08],[-.22,4.08,.3],[-.50,4.40,.43]],[.13,.065,.022],{sides:6,steps:5});
  limb([[.72,5.05,.12],[.13,5.39,-.35],[-.12,5.66,-.55]],[.10,.048,.012],{sides:5,steps:5});
  leaves([2.10,8.2,.05],.86,.64,.6);
 }else{
  // A high-canopy valley beech: long clear stem and three lifted crown tiers.
  // Its sparse lower bough leaves views toward the creek open at eye level.
  limb([[0,0,0],[.03,.7,0],[lean,3.3,.05],[-.07,5.65,-.1],[.22,8.4,.06],[.07,10.8,.2]],[.43,.31,.25,.21,.12,.015],{sides:14,steps:21,root:true});
  for(let arm=0;arm<4;arm++){
   const a=arm*2.35+variant*.25,y=5.9+arm*.70,reach=2.3-arm*.16,base=[.02,y,-.03],end=turn(reach,a,y+1.22),middle=mix(base,end,.43);middle[1]+=.27;middle[2]+=.16*Math.sin(a);
   const shoulder=mix(base,end,.79);shoulder[0]+=.10*Math.cos(a+.7);shoulder[1]+=.10;
   limb([base,middle,shoulder,end],[.19-arm*.022,.13,.072,.025],{sides:7,steps:7});
   for(let j=0;j<4;j++){
    const heading=a+(j-1.5)*.53,p=mix(base,end,[.55,.85,1.10,.72][j]),reach=[.15,.42,.55,.21][j];
    p[0]+=Math.cos(heading)*reach;p[1]+=[.69,.47,.46,1.02][j];p[2]+=Math.sin(heading)*reach;
    twig(j===0?mix(base,middle,.8):middle,p,[1.30,1.22,1.05,1.13][j]-arm*.035,heading,[.91,.82,.77,.94][j]);
   }
  }
  for(let j=0;j<3;j++)twig([.17,9.8,.14],turn(.65,j*2.3+variant,10.65+(j%2)*.20),.79,j*2.3);
 }
 return{wood,branches,clusters};
}

// Curved scanned leaf sprays and a few close folded leaves, on the SAME branch
// anchors at all distances. LOD adds inner surfaces, never an unrelated crown.
function crownGeometry(clusters,level){
 const positions=[],normals=[],uv=[],colors=[],flex=[],indices=[];
 const point=new T.Vector3(),normal=new T.Vector3(),sprayCount=[5,4,3][level],segments=level===0?3:2;
 const push=(p,n,u,v,f,shade)=>{
  positions.push(p.x,p.y-CROWN_BASE,p.z);normals.push(n.x,n.y,n.z);uv.push(u,v);flex.push(f);
  colors.push(shade*.98,shade,shade*.91);
 };
 for(const [cluster,node]of clusters.entries())for(let spray=0;spray<sprayCount;spray++){
  const angle=node.phase+[0,2.32,4.57,1.12,3.62][spray],side=new T.Vector3(Math.cos(angle),0,Math.sin(angle));
  const facing=new T.Vector3(-side.z,[.38,-.12,.66,.28,.8][spray],side.x).normalize();
  const along=new T.Vector3().crossVectors(facing,side).normalize();
  const size=spray<3?1:.62,rx=node.width*size,ry=node.depth*size;
  // The atlas's stem lies near v=.86. Keep it supported at the actual twig.
  const center=vec(node.p).addScaledVector(along,-.64*ry).addScaledVector(side,(spray%2?-.12:.12)*rx);
  const first=positions.length/3;
  for(let iy=0;iy<=segments;iy++)for(let ix=0;ix<=segments;ix++){
   const x=ix/segments*2-1,y=iy/segments*2-1,bow=(.18-.12*x*x-.09*y*y)*ry;
   point.copy(center).addScaledVector(side,x*rx).addScaledVector(along,y*ry).addScaledVector(facing,bow);
   normal.copy(facing).addScaledVector(side,.24*x*ry/rx).addScaledVector(along,.18*y).normalize();
   push(point,normal,(x+1)*.5,(y+1)*.5,Math.min(1,Math.hypot(x,y-.72)*.64),.88+.06*Math.sin(cluster*2.7+spray));
  }
  const row=segments+1;
  for(let y=0;y<segments;y++)for(let x=0;x<segments;x++){
   const a=first+y*row+x;indices.push(a,a+1,a+row,a+1,a+row+1,a+row);
  }
  // Individual folded leaves use the atlas's opaque sample. They remain small,
  // within the spray, and cost no extra draw or material.
  for(let leaf=0;leaf<[4,2,0][level];leaf++){
   const a=leaf*2.399+node.phase,r=.3+.12*(leaf%2),x=Math.cos(a)*r,y=Math.sin(a)*r;
   const p=center.clone().addScaledVector(side,x*rx).addScaledVector(along,y*ry).addScaledVector(facing,(.18-.12*x*x-.09*y*y)*ry);
   const length=.09+.035*(.5+.5*Math.sin(cluster+leaf*3)),width=length*.38,base=positions.length/3;
   for(const [j,[dx,dy,bow]]of [[0,-length,.005],[-width,0,0],[0,0,.022],[width,0,0],[0,length,.004]].entries()){
    point.copy(p).addScaledVector(side,dx*Math.cos(a)-dy*Math.sin(a)).addScaledVector(along,dx*Math.sin(a)+dy*Math.cos(a)).addScaledVector(facing,bow);
    push(point,facing,.5,.5,j===0?0:.85,j===2?.98:.84);
   }
   indices.push(base,base+2,base+1,base,base+3,base+2,base+1,base+2,base+4,base+2,base+3,base+4);
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
 g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 g.setAttribute('treeLeafFlex',new T.Float32BufferAttribute(flex,1));g.setAttribute('treeSurface',new T.Float32BufferAttribute(new Float32Array(positions.length/3).fill(1),1));
 g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();return g;
}

export function forestTreeFormTemplate(form,variant=0){
 if(!FOREST_TREE_FORMS.includes(form))return null;
 variant=variant===1?1:0;const key=form+variant;if(templates.has(key))return templates.get(key);
 const {wood,branches,clusters}=architecture(form,variant),trunk=mergeGeometries(wood,false);
 for(const part of wood)part.dispose();trunk.computeBoundingBox();trunk.computeBoundingSphere();
 const lods=[0,1,2].map(level=>crownGeometry(clusters,level)),canopy=lods[2];
 const template={form,variant,trunk,canopy,lods,branches,clusters,snow:false,shared:true,bottom:CROWN_BASE,
  height:Math.max(trunk.boundingBox.max.y,...lods.map(g=>g.boundingBox.max.y+CROWN_BASE)),
  minLeafY:Math.min(...lods.map(g=>g.boundingBox.min.y+CROWN_BASE)),
  triangleCounts:lods.map(g=>triangles(trunk)+triangles(g))};
 for(const [i,g]of [trunk,...lods].entries())g.name='SM_Tree_'+form+'_'+variant+(i?'_LOD'+(i-1):'_Bark');
 templates.set(key,template);return template;
}

function routeLocation(points,x,z){
 let best=Infinity,at=0,walked=0,side=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),t=T.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(length*length||1),0,1);
  const distance=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);if(distance<best){best=distance;at=walked+length*t;side=(dx*(z-a.z)-dz*(x-a.x))/(length||1);}walked+=length;
 }
 return{distance:best,fraction:walked?at/walked:0,side};
}

// Small spatial groves blend source trees with existing woodland, rather than
// alternating species at a regular interval or changing tree collision slots.
function assetForGrove(route,x,z){
 const patch=Math.sin(x*.13+z*.077)+Math.cos(x*.064-z*.12);
 if(route.fraction<.24)return route.side>0||patch>.3?'woodland-canopy':null;
 if(route.fraction<.49)return route.side<0&&patch>.15?'leaning-canopy':null;
 if(route.fraction<.78)return route.side<0||patch>.5?'leaning-canopy':null;
 return patch>.15?'woodland-canopy':null;
}

// Run AFTER the old habitat/route branch fitting, BEFORE terrain grounding.
// Keep roots, colliders, mesh identities and foliage records intact. Destructible
// trees, ruins and the forest-vista landmark have their own geometry/gameplay.
export function installForestTreeForms(world,id='forest',{limit=36,routeRadius=24}={}){
 if(id!=='forest'||world.regions||!world.forestJourney?.points?.length)return null;
 if(world.forestTreeForms)return world.forestTreeForms;
 const state={trees:[],forms:{oak:0,alder:0,wind:0,highcanopy:0},imported:{'woodland-canopy':0,'leaning-canopy':0},sharedTemplates:0};
 const eligible=world.obstacles.filter(o=>o.mesh?.userData.treeBiome==='forest'&&!o.mesh.userData.forestVistaTrunk&&!o.tactic&&!world.breakables?.includes(o)&&o.mesh.visible);
 const buckets=FOREST_TREE_FORMS.map(()=>[]);
 for(const obstacle of eligible){
  const root=obstacle.mesh,trunk=root.getObjectByName('tree-trunk'),crown=root.getObjectByName('tree-canopy');
  if(!trunk?.isMesh||!crown?.isMesh||trunk.parent!==root||crown.parent!==root||!trunk.visible||!crown.visible||root.userData.forestTreeForm)continue;
  const route=routeLocation(world.forestJourney.points,obstacle.x,obstacle.z);if(route.distance>routeRadius)continue;
  // Grove bands along the route, not alternating randomized tree colours.
  const form=route.fraction<.24?'oak':route.fraction<.49?'wind':route.fraction<.69?'alder':'highcanopy';
  buckets[FOREST_TREE_FORMS.indexOf(form)].push({obstacle,trunk,crown,form,route});
 }
 for(const bucket of buckets)bucket.sort((a,b)=>a.route.distance-b.route.distance);
 const maximum=Math.min(Math.max(0,Math.floor(limit)),Math.ceil(eligible.length*2/3)),selected=[];
 // Visit each grove in turn so one dense entry grove cannot consume the budget.
 for(let i=0;selected.length<maximum;i++){
  let added=false;for(const bucket of buckets)if(bucket[i]&&selected.length<maximum){selected.push(bucket[i]);added=true;}if(!added)break;
 }
 if(!selected.length)return null;
 for(const form of FOREST_TREE_FORMS)for(const variant of[0,1])forestTreeFormTemplate(form,variant);
 const used=new Set();
 for(const {obstacle,trunk,crown,form:plannedForm,route}of selected){
  const root=obstacle.mesh,variant=Math.sin(obstacle.x*.47+obstacle.z*.61)>0?1:0;
  const imported=forestTreeAssetTemplate(assetForGrove(route,obstacle.x,obstacle.z));
  const template=imported||forestTreeFormTemplate(plannedForm,variant),form=template.form;
  trunk.updateMatrix();crown.updateMatrix();
  const box=new T.Box3();
  for(const object of[trunk,crown]){if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrix));}
  const maxScale=Math.max(Math.abs(root.scale.x),Math.abs(root.scale.z)),width=Math.min(1,(obstacle.r-.035)/(.57*maxScale));
  if(!Number.isFinite(width)||width<.45||root.scale.y<=0)continue;
  // Headroom includes the established canopy sway; the root stays exactly at
  // the caller's height and the low stem stays inside its existing collider.
  const height=Math.max(3.55/(template.minLeafY*root.scale.y),T.MathUtils.clamp(box.max.y/template.height,.90,1.24));
  for(const mesh of[trunk,crown]){
   if(mesh.userData.ownedGeometry)mesh.geometry.dispose();mesh.userData.ownedGeometry=false;
   mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(width,height,width);
  }
  trunk.geometry=template.trunk;crown.geometry=template.canopy;crown.position.y=CROWN_BASE*height;
  if(imported){fitForestTreeAssetMaterials(template,crown.material);trunk.material=template.barkMaterial;crown.material=template.leafMaterial;state.imported[form]++;}
  crown.userData.treeTemplate=template;crown.userData.treeLOD=2;
  for(const record of world.foliage||[])if(record.leaf===crown){record.x=0;record.z=0;}
  root.userData.forestTreeForm=form;root.userData.forestTreeVariant=variant;
  trunk.updateMatrix();crown.updateMatrix();
  state.trees.push({x:obstacle.x,z:obstacle.z,form,variant,root});state.forms[form]=(state.forms[form]||0)+1;used.add(template);
 }
 state.sharedTemplates=used.size;world.forestTreeForms=state;return state;
}

function backdropTemplate(form){
 const template=forestTreeFormTemplate(form);if(template.backdrop)return template.backdrop;
 const main=template.branches[0],forks=template.branches.slice(1).filter(b=>b.radii[0]>=.10&&vec(b.points.at(-1)).distanceTo(vec(b.points[0]))>1.8);
 const parts=[branchGeometry(main.points,main.radii,{sides:6,steps:5,root:true})];
 // Three large forks hold the distant silhouette; subpixel twigs remain only
 // in the gameplay models. Sample across the real branch heights, not a new tree.
 for(const i of [...new Set([0,Math.floor((forks.length-1)/2),forks.length-1])]){
  const b=forks[i];if(b)parts.push(branchGeometry(b.points,b.radii,{sides:4,steps:2}));
 }
 const trunk=mergeGeometries(parts,false);for(const part of parts)part.dispose();trunk.computeBoundingBox();trunk.computeBoundingSphere();
 const clusters=Array.from({length:Math.min(15,template.clusters.length)},(_,i)=>template.clusters[Math.floor(i*(template.clusters.length-1)/14)]);
 const canopy=crownGeometry(clusters,2);
 trunk.name='SM_Tree_'+form+'_Backdrop_Bark';canopy.name='SM_Tree_'+form+'_Backdrop_Leaves';
 return template.backdrop={trunk,canopy,triangles:triangles(trunk)+triangles(canopy)};
}

// Call after installForestBackdrop, when its existing terrain samples are final.
// Reuse all six batches/buffers, all 240 anchors and the original leaf material.
// Adjacent trees in each existing grove share a family, rather than a checkerboard.
export function installForestTreeBackdropVariants(world,id='forest'){
 const group=world.forestBackdrop,records=group?.userData.records;
 if(id!=='forest'||world.regions||!world.forestTreeForms||group?.userData.disposed||!records||records.length!==240)return null;
 if(group.userData.forestTreeVariants)return group.userData.forestTreeVariants;
 const trunks=group.children.filter(o=>o.isInstancedMesh&&o.name==='tree-trunk-backdrop');
 const crowns=group.children.filter(o=>o.isInstancedMesh&&o.name==='tree-canopy-backdrop');
 if(trunks.length!==3||crowns.length!==3||[...trunks,...crowns].some(o=>o.count!==80))return null;
 const forms=['oak','wind','highcanopy'],dummy=new T.Object3D(),part=new T.Matrix4(),matrix=new T.Matrix4(),color=new T.Color(),result=[];
 for(const [variant,form]of forms.entries()){
  const selected=records.filter((_,i)=>Math.floor(i/20)%3===variant),template=backdropTemplate(form);
  for(const [batch,geometry,offset]of [[trunks[variant],template.trunk,0],[crowns[variant],template.canopy,CROWN_BASE]]){
   batch.geometry=geometry;part.makeTranslation(0,offset,0);
   for(const [i,p]of selected.entries()){
    dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.angle,0);dummy.scale.setScalar(p.scale*(form==='highcanopy'?.86:1));dummy.updateMatrix();
    matrix.multiplyMatrices(dummy.matrix,part);batch.setMatrixAt(i,matrix);batch.setColorAt(i,color.setHex(0xb8c9b8).multiplyScalar(.88+.12*Math.sin(p.angle*5)**2));
   }
   batch.instanceMatrix.needsUpdate=true;batch.instanceColor.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();
  }
  result.push({form,count:selected.length,triangles:template.triangles});
 }
 group.userData.forestTreeVariants=result;return result;
}
