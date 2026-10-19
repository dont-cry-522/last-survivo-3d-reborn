import * as T from './vendor/three.module.js';
import {createExplorationNavigator} from './exploration-routes.js?v=227';
import {segmentDistance} from './rules.js?v=227';
import {waterDepth} from './water.js?v=227';
import {createForestSurfaceMaterial,createBarkGeometry} from './forest-surface-assets.js?v=227';
import {shapeForestCanopy} from './forest-canopy-shape.js?v=227';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const length=points=>points.reduce((sum,p,i)=>sum+(i?distance(p,points[i-1]):0),0);
export function journeyPoint(points,along){
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=distance(a,b);if(along<=d||i===points.length-1){const t=Math.min(1,along/(d||1));return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};}along-=d;}
 return {...points[0]};
}
function lineDistance(points,x,z){let d=Infinity;for(let i=1;i<points.length;i++)d=Math.min(d,segmentDistance(x,z,points[i-1].x,points[i-1].z,points[i].x,points[i].z));return d;}
function shorePoint(p,angle,extra=3){
 const c=Math.cos(p.angle||0),s=Math.sin(p.angle||0),u=Math.cos(angle)*(p.rx*1.12+extra),v=Math.sin(angle)*(p.rz*1.12+extra);
 return{x:p.x+c*u+s*v,z:p.z-s*u+c*v};
}

// Build the scenic route from the existing dry-bank navigation. Rewards, water,
// enemy rules and map seed are not moved to fit a picture.
export function planForestJourney(world,id){
 if(id!=='forest'||world.regions)return null;
 if(world.forestJourney)return world.forestJourney;
 const approach=world.forestHabitats?.approach;if(!approach?.points?.length)return null;
 const navigation=createExplorationNavigator(world),ponds=world.ponds,first=approach.shore;
 const ordered=[...ponds].sort((a,b)=>distance(b,first)-distance(a,first));let extension=[];
 for(const pond of ordered.slice(0,3)){
  const c=Math.cos(pond.angle||0),s=Math.sin(pond.angle||0),dx=first.x-pond.x,dz=first.z-pond.z;
  const facing=Math.atan2((s*dx+c*dz)/pond.rz,(c*dx-s*dz)/pond.rx);
  for(const offset of[0,.55,-.55,1.05,-1.05]){
   const end=shorePoint(pond,facing+offset,3.4),route=navigation.route(first,end);
   if(route.length<2||distance(first,end)<12||length(route)>distance(first,end)*1.65+10)continue;
   extension=route;break;
  }
  if(extension.length)break;
 }
 const points=[...approach.points,...extension.slice(1)],total=length(points),end=points.at(-1);
 const nearest=p=>ponds.reduce((best,q)=>!best||distance(p,q)<distance(p,best)?q:best,null);
 // Put the final scenic opening on the existing walkable bank where both the
 // forward sightline and the third-person boom have room, not against a trunk.
 let overlook=end,bestView=-Infinity;
 for(const back of[0,2,4,6,8,10]){
  const p=journeyPoint(points,Math.max(0,total-back)),q=nearest(p),d=distance(p,q)||1;
  const camera={x:p.x+(p.x-q.x)/d*6.5,z:p.z+(p.z-q.z)/d*6.5};let clearance=6;
  for(const o of world.obstacles)clearance=Math.min(clearance,segmentDistance(o.x,o.z,p.x,p.z,camera.x,camera.z)-o.r,segmentDistance(o.x,o.z,p.x,p.z,q.x,q.z)-o.r);
  if(clearance>bestView){bestView=clearance;overlook=p;}
 }
 const landmark=(kind,name,p,canopy,lookAt)=>({id:kind,kind,name,...p,canopy,lookAt:lookAt||nearest(p)});
 const landmarks=[landmark('entry','林荫门径',points[0],.75,journeyPoint(points,9)),landmark('bend','弯溪石壁',first,.55,approach.pond),landmark('pool','静潭开口',journeyPoint(points,total*.73),.12),landmark('overlook','溪源林岸',overlook,.32)];
 const state={points,landmarks,length:total,ridges:[],trees:[],materials:[],group:null,disposed:false};
 state.dispose=()=>{if(state.disposed)return;state.disposed=true;for(const material of state.materials)material.dispose();};
 world.forestJourney=state;
 // Protect this optional walking route in the same terrain sampler as rewards.
 world.explorationRoutes.push({points,biome:'forest',scenic:true,start:points[0],end});
 const paths=world.explorationRoutes.map(r=>r.points);
 const replaceable=o=>o.mesh.userData.treeBiome==='forest'&&!o.mesh.userData.forestVistaTrunk&&!world.breakables?.includes(o)&&!o.tactic&&o!==world.forestHabitats.elder;
 const protectedPoint=(p,r)=>Math.abs(p.x)>world.half-r-4||Math.abs(p.z)>world.half-r-4||distance(p,world.spawn)<r+6||world.sites.some(s=>distance(p,s)<r+6)||paths.some(path=>lineDistance(path,p.x,p.z)<r+2.0)||world.ponds.some(q=>waterDepth({...q,rx:q.rx+r,rz:q.rz+r,r:q.r+r},p.x,p.z)>0)||world.obstacles.some(o=>!replaceable(o)&&distance(p,o)<o.r+r+.3)||world.biomePlaces?.some(q=>distance(p,q)<r+11);
 // One coherent far-bank outcrop, with gaps wherever existing passages cross it.
 // Its footprint is reserved before terrain/overhead queries are built.
 const centers=[];
 for(const p of ponds){
  let near=points[0],best=Infinity;for(let a=0;a<=total;a+=2){const q=journeyPoint(points,a),d=distance(q,p);if(d<best){best=d;near=q;}}
  const dx=p.x-near.x,dz=p.z-near.z,d=Math.hypot(dx,dz)||1,nx=dx/d,nz=dz/d,c=Math.cos(p.angle||0),s=Math.sin(p.angle||0);
  const radius=1/Math.hypot((c*nx-s*nz)/p.rx,(s*nx+c*nz)/p.rz);
  centers.push({x:p.x+nx*(radius*1.12+5.6),z:p.z+nz*(radius*1.12+5.6)});
 }
 const candidates=[];
 for(let i=1;i<centers.length;i++){const a=centers[i-1],b=centers[i],d=distance(a,b);for(let n=0;n<Math.ceil(d/2.8);n++){const f=n/Math.ceil(d/2.8);candidates.push({x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f});}}
 if(centers.length)candidates.push(centers.at(-1));
 let run=[];const flush=()=>{if(run.length>=2)state.ridges.push(run);run=[];};
 for(const [i,p]of candidates.entries()){
  const r=2.45,height=5.8+1.4*Math.sin(i*.61)+.65*Math.sin(i*1.7);
  if(protectedPoint(p,r)){flush();continue;}
  if(run.length&&distance(p,run.at(-1))>4)flush();run.push({...p,r,height});
 }flush();state.ridges=state.ridges.slice(0,4);
 const retired=new Set(world.obstacles.filter(o=>replaceable(o)&&state.ridges.some(run=>run.some(p=>distance(o,p)<p.r+o.r+1.4))));
 for(const o of retired)o.mesh.visible=false;
 world.obstacles=world.obstacles.filter(o=>!retired.has(o));
 world.foliage=world.foliage.filter(f=>![...retired].some(o=>f.leaf.parent===o.mesh));
 state.retiredTrees=retired.size;
 const group=new T.Group();group.name='SM_Forest_CreekJourney_A';world.group.add(group);state.group=group;
 for(const [i,run]of state.ridges.entries()){
  const material=createForestSurfaceMaterial('mossRock',{normalStrength:.36});material.vertexColors=true;
  const mesh=new T.Mesh(ridgeGeometry(run),material);
  mesh.name='SM_Cliff_CreekBank_'+i;mesh.userData.ownedGeometry=true;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);state.materials.push(mesh.material);
  for(const p of run)world.obstacles.push({x:p.x,z:p.z,r:p.r,mesh,sceneryHeight:Math.max(...run.map(q=>q.height)),forestJourney:true});
 }
 return state;
}

// Closed continuous outcrop: uneven shoulders and fracture planes, never rows of
// stretched spheres. UVs follow metre-scale distances, shared normal/roughness maps.
export function ridgeGeometry(points){
 // Sample the long bank at sub-metre spacing. Fracture relief belongs to the
 // actual silhouette and lighting normals, not just the photographed colour.
 const sections=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],steps=Math.ceil(distance(a,b)/.65);
  for(let n=0;n<steps;n++){const t=n/steps;sections.push({x:T.MathUtils.lerp(a.x,b.x,t),z:T.MathUtils.lerp(a.z,b.z,t),r:T.MathUtils.lerp(a.r,b.r,t),height:T.MathUtils.lerp(a.height,b.height,t)});}
 }sections.push(points.at(-1));points=sections;
 const pos=[],uv=[],colors=[],indices=[],levels=[0,.04,.10,.18,.28,.40,.52,.64,.76,.86,.94,1],widths=[.82,.88,.91,.88,.82,.80,.65,.62,.47,.38,.27,.18];let walked=0;
 const layers=levels.length*2;
 for(let i=0;i<points.length;i++){
  const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=distance(a,b)||1,nx=-(b.z-a.z)/d,nz=(b.x-a.x)/d;
  if(i)walked+=distance(p,points[i-1]);
  const edge=Math.min(i,points.length-1-i),cap=Math.min(1,.40+edge*.15);
  // A short exposed shoulder and a long receding shoulder frame a continuous
  // rock ledge. The old symmetric dome read as one boulder detached from shore.
  // Stay inside the existing solid radius and height; no new wall or passage.
  const t=i/(points.length-1),envelope=.22+.78*Math.min(T.MathUtils.smoothstep(t,0,.17),T.MathUtils.smoothstep(1-t,0,.34));
  const height=p.height*envelope*(.92+.08*Math.sin(walked*.61));
  for(let side=0;side<2;side++)for(let j=0;j<levels.length;j++){
   const f=levels[j],sign=side?-1:1,rag=.86+.10*Math.sin(i*.89+j*1.31+side*2.8)+.04*Math.sin(i*2.17-j*.72),w=widths[j]*p.r*cap*rag;
   const lean=Math.sin(walked*.53)*p.r*.10*f;
   pos.push(p.x+nx*(sign*w+lean),-.14+height*f,p.z+nz*(sign*w+lean));uv.push(walked/4,(f*height+(side?0:1))/4);
   const shade=.71+.29*T.MathUtils.smoothstep(f,0,.23);colors.push(shade*.93,shade*.96,shade*.88);
  }
 }
 for(let i=0;i<points.length-1;i++)for(let side=0;side<2;side++)for(let j=0;j<levels.length-1;j++){
  const a=i*layers+side*levels.length+j,b=a+layers;if(side)indices.push(a,a+1,b,b,a+1,b+1);else indices.push(a,b,a+1,b,b+1,a+1);
 }
 for(let i=0;i<points.length-1;i++)for(const j of[0,levels.length-1]){
  const a=i*layers+j,b=a+levels.length,c=a+layers,d=b+layers;if(j)indices.push(a,c,b,c,d,b);else indices.push(a,b,c,c,b,d);
 }
 for(const i of[0,points.length-1])for(let j=0;j<levels.length-1;j++){
  const a=i*layers+j,b=a+levels.length;if(i)indices.push(a,b,a+1,b,b+1,a+1);else indices.push(a,a+1,b,b,a+1,b+1);
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}

export function finishForestJourney(world){
 const state=world.forestJourney;if(!state||state.finished)return state;state.finished=true;
 const end=state.landmarks.at(-1),trees=world.obstacles.filter(o=>o.mesh.userData.treeBiome==='forest'&&!o.mesh.userData.forestVistaTrunk&&!world.breakables?.includes(o));
 // Recompose existing foliage: no doubled tree population or new colliders.
 const elderChoices=trees.filter(o=>distance(o,end)>9&&distance(o,end)<21&&lineDistance(state.points,o.x,o.z)<13).sort((a,b)=>distance(a,end)-distance(b,end)).slice(0,2);
 let bark;
 for(const o of trees){
  const near=lineDistance(state.points,o.x,o.z);if(near>13)continue;
  const trunk=o.mesh.getObjectByName('tree-trunk'),crown=o.mesh.getObjectByName('tree-canopy');if(!trunk||!crown)continue;
  const elder=elderChoices.includes(o),phase=Math.sin(o.x*.31+o.z*.57),stretch=elder?1.34:1.05+phase*.09;
  // Stretch the complete tree so fitted twig tips and leaf sprays remain attached.
  // XZ is untouched: existing roots, trunk radius and collision retain their size.
  o.mesh.scale.y*=stretch;
  // Reuse a few existing crowns as a shaded entrance frame. The pool stays
  // open; carrying the fitted branches with the crown avoids detached leaves.
  if((near<9&&distance(o,world.spawn)<22)||elder){
   if(shapeForestCanopy(o.mesh,{width:elder?1.25:1.45,depth:elder?1.2:1.35,height:1.05}))state.framedTrees=(state.framedTrees||0)+1;
  }
  if(near<9||elder){
   const geometry=createBarkGeometry(trunk.geometry,trunk.scale);
   if(geometry){if(trunk.userData.ownedGeometry)trunk.geometry.dispose();trunk.geometry=geometry;trunk.userData.ownedGeometry=true;
    if(!bark){bark=createForestSurfaceMaterial('bark');state.materials.push(bark);}trunk.material=bark;
   }
  }
  state.trees.push({x:o.x,z:o.z,elder});
 }
 // No arbitrary alpha plane over the route: bake its worn earth into the existing
 // ground mask (environment-grounding), after real terrain heights are installed.
 return state;
}
