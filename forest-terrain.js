import * as T from './vendor/three.module.js';
import {forestMacroLandforms} from './forest-macro-landform.js?v=229';
import {biomeMacroLandforms} from './biome-macro-landform.js?v=229';
import {biomeWeights} from './confluence.js?v=229';

// Refine only triangles near the raised floor. Shared edge midpoints preserve
// the existing colour/alpha falloff; the same mesh and material keep one draw.
function refineOverlay(mesh,bounds,spacing,budget,sample,floorY,clearSpan=4){
 if(!budget)return 0;
 const source=mesh.geometry,attributes=Object.entries(source.attributes).filter(([name])=>name!=='normal');
 const arrays=Object.fromEntries(attributes.map(([name,a])=>[name,Array.from(a.array)])),points=[],indices=[],midpoints=new Map();
 for(let i=0;i<source.attributes.position.count;i++)points.push(new T.Vector3().fromBufferAttribute(source.attributes.position,i).applyMatrix4(mesh.matrixWorld));
 const midpoint=(a,b)=>{
  const key=a<b?a+':'+b:b+':'+a;if(midpoints.has(key))return midpoints.get(key);
  const id=points.length;points.push(points[a].clone().add(points[b]).multiplyScalar(.5));
  for(const [name,attr]of attributes)for(let c=0;c<attr.itemSize;c++)arrays[name].push((arrays[name][a*attr.itemSize+c]+arrays[name][b*attr.itemSize+c])*.5);
  midpoints.set(key,id);return id;
 };
 let added=0;
 const split=(a,b,c,depth)=>{
  const pa=points[a],pb=points[b],pc=points[c],minX=Math.min(pa.x,pb.x,pc.x),maxX=Math.max(pa.x,pb.x,pc.x),minZ=Math.min(pa.z,pb.z,pc.z),maxZ=Math.max(pa.z,pb.z,pc.z),near=maxX>=bounds.minX&&minX<=bounds.maxX&&maxZ>=bounds.minZ&&minZ<=bounds.maxZ&&bounds.raised(minX,maxX,minZ,maxZ);
  const ab=pa.distanceToSquared(pb),bc=pb.distanceToSquared(pc),ca=pc.distanceToSquared(pa);
  if(!near||Math.max(ab,bc,ca)<=spacing*spacing||depth===12||added===budget){indices.push(a,b,c);return;}
  // Most already-draped triangles need no subdivision. Sample their interiors
  // after the long spans have been split, reserving the shared budget for crests.
  if(Math.max(ab,bc,ca)<=clearSpan){
   const ya=pa.y+sample(pa.x,pa.z),yb=pb.y+sample(pb.x,pb.z),yc=pc.y+sample(pc.x,pc.z);
   let clear=true;for(let i=0;i<=4&&clear;i++)for(let j=0;j<=4-i;j++){const u=i/4,v=j/4,w=1-u-v,x=pa.x*u+pb.x*v+pc.x*w,z=pa.z*u+pb.z*v+pc.z*w;if(ya*u+yb*v+yc*w<floorY+sample(x,z)+.010){clear=false;break;}}
   if(clear){indices.push(a,b,c);return;}
  }
  added++;
  if(ab>=bc&&ab>=ca){const m=midpoint(a,b);split(a,m,c,depth+1);split(m,b,c,depth+1);}
  else if(bc>=ca){const m=midpoint(b,c);split(a,b,m,depth+1);split(a,m,c,depth+1);}
  else{const m=midpoint(c,a);split(a,b,m,depth+1);split(m,b,c,depth+1);}
 };
 const count=source.index?.count??points.length;
 for(let i=0;i<count;i+=3)split(source.index?.getX(i)??i,source.index?.getX(i+1)??i+1,source.index?.getX(i+2)??i+2,0);
 if(!added||!points.some(p=>sample(p.x,p.z)>0))return 0;
 const refined=new T.BufferGeometry();for(const [name,a]of attributes)refined.setAttribute(name,new T.BufferAttribute(new a.array.constructor(arrays[name]),a.itemSize,a.normalized));
 refined.setIndex(indices);refined.computeVertexNormals();refined.computeBoundingSphere();mesh.geometry=refined;source.dispose();return added;
}

const BIOMES=['forest','snow','ash','sand','coast'];
const fade=T.MathUtils.smoothstep;
// Wider relief needs more of the existing decals draped at crests. This is a
// hard build-time cap (no extra draws), not an unbounded terrain subdivision.
const HEIGHT=1.2,AXIS_GRADE=.12,OVERLAY_BUDGET=8192;

function regionalShoulderPoints(points){
 if(points.length<2)return points;
 const length=points.reduce((sum,p,i)=>sum+(i?Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z):0),0);
 if(length>=48)return points;
 // Short regional links often start on a pier or end at a protected supply.
 // Continue only their terrain shoulders along the endpoint tangents, so dry
 // banks beyond those flat footprints can enter the middle of a 48m candidate.
 // The actual route, its walking lane and all protection masks stay unchanged.
 const a=points[0],b=points[1],d=points.at(-1),c=points.at(-2),first=Math.hypot(a.x-b.x,a.z-b.z),last=Math.hypot(d.x-c.x,d.z-c.z);
 if(first<.001||last<.001)return points;
 return[{x:a.x+(a.x-b.x)*16/first,z:a.z+(a.z-b.z)*16/first},...points,{x:d.x+(d.x-c.x)*16/last,z:d.z+(d.z-c.z)*16/last}];
}

function corridor(points,biome,from=0,extent=48){
 const segments=[];let walked=0,length=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz),lo=Math.max(0,from-walked),hi=Math.min(l,from+extent-walked);walked+=l;
  if(l<.001||hi-lo<.001)continue;
  const start={x:a.x+dx*lo/l,z:a.z+dz*lo/l},end={x:a.x+dx*hi/l,z:a.z+dz*hi/l};
  segments.push({a:start,dx:end.x-start.x,dz:end.z-start.z,l:hi-lo,start:length});length+=hi-lo;
 }
 if(length<8)return null;
 const middle=segments.find(s=>s.start+s.l>=length/2),t=(length/2-middle.start)/middle.l;
 return{biome,segments,length,x:middle.a.x+middle.dx*t,z:middle.a.z+middle.dz*t};
}
function corridorWeight(route,x,z){
 let distance=Infinity,progress=0,across=0;
 for(const s of route.segments){const t=T.MathUtils.clamp(((x-s.a.x)*s.dx+(z-s.a.z)*s.dz)/(s.l*s.l),0,1),d=Math.hypot(x-s.a.x-s.dx*t,z-s.a.z-s.dz*t);if(d<distance){distance=d;progress=(s.start+t*s.l)/route.length;across=((x-s.a.x)*s.dz-(z-s.a.z)*s.dx)/s.l;}}
 if(distance>=18||progress<=0||progress>=1)return 0;
 // Leave the walking lane low. Broad, unequal shoulders give the route a
 // valley silhouette rather than putting a speed bump under the player.
 const side=Math.abs(across),envelope=fade(side,2.8,6.5)*(1-fade(side,10,18))*Math.sin(Math.PI*progress)**2;
 // Broad, static climate shapes. Valleys remain at the old datum, so water,
 // projectile floors and jump/platform rules keep their existing semantics.
 const shape=route.biome==='sand'?.78+.22*Math.cos(across*.22+progress*1.8)**2:route.biome==='snow'?.82+.18*Math.sin(across*.18-progress*2.2)**2:route.biome==='ash'?.80+.20*Math.cos(progress*Math.PI*2.0)**2:route.biome==='coast'?.86+.14*Math.sin(progress*Math.PI*.5):1;
 return envelope*shape*(across<0?1:.82);
}

// Broad dry-land shoulders use the existing floor, not separate mound meshes.
// Select a few genuinely open areas once; buildings, streams and paths remain
// at their old datum. No new random calls can shift the generated game layout.
function terrainMasses(world,mapId,protection,pad){
 if(!world.half)return {masses:[],weight:()=>0};
 const lines=[];
 const paths=[...(world.explorationRoutes||[]).map(r=>r.points),...(world.road?.length?[[...world.road,world.road[0]]]:[])];
 for(const points of paths)for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;if(l2>.001)lines.push({x:a.x,z:a.z,dx,dz,l2});
 }
 const lane=(x,z)=>{
  let distance=Infinity;for(const s of lines){const t=T.MathUtils.clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/s.l2,0,1);distance=Math.min(distance,Math.hypot(x-s.x-s.dx*t,z-s.z-s.dz*t));}
  return fade(distance,2.8+pad,6.5+pad);
 };
 const masses=[],shapes={forest:[26,20,1.15],snow:[29,19,1.10],ash:[28,17,1.05],sand:[32,18,1.2],coast:[25,19,.85]};
 for(const scope of world.regions||[{id:mapId,...world.spawn}]){
  const shape=shapes[scope.id];if(!shape)continue;const [rx,rz,height]=shape,candidates=[];
  for(let z=-world.half+22;z<=world.half-22;z+=16)for(let x=-world.half+22;x<=world.half-22;x+=16){
   if(scope.contains&&!scope.contains(x,z)||Math.hypot(x-world.spawn.x,z-world.spawn.z)<10)continue;
   const angle=scope.id==='sand'?.28:.45+Math.sin(x*.024+z*.017)*.6,c=Math.cos(angle),s=Math.sin(angle);let score=0;
   for(const u of[-.65,0,.65])for(const v of[-.65,0,.65]){
    const px=x+c*u*rx-s*v*rz,pz=z+s*u*rx+c*v*rz;
    if(Math.max(Math.abs(px),Math.abs(pz))>world.half-8||scope.contains&&!scope.contains(px,pz))continue;
    score+=protection(px,pz)*lane(px,pz)*(u===0&&v===0?2:1);
   }
   if(score>2.2)candidates.push({x,z,rx,rz,height,c,s,biome:scope.id,score:score-.006*Math.hypot(x-scope.x,z-scope.z)});
  }
  candidates.sort((a,b)=>b.score-a.score);let count=0;
  for(const p of candidates){if(count>=(world.regions?4:8))break;if(masses.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<29))continue;masses.push(p);count++;}
 }
 return{masses,weight(x,z){
  let height=0;for(const p of masses){const dx=x-p.x,dz=z-p.z,u=(p.c*dx+p.s*dz)/p.rx,v=(-p.s*dx+p.c*dz)/p.rz;if(Math.abs(u)>=1||Math.abs(v)>=1)continue;
   // Unequal flanks and a shallow curved crest avoid identical round bumps.
   const crest=(1-u*u)**2*(1-v*v)**2*(.88+.12*Math.cos(u*2.4+v*1.1));height=Math.max(height,crest*p.height);
  }
  return height?height*lane(x,z):0;
 }};
}

// A bounded set of real, walkable route shoulders on the existing ground mesh.
// Heights always sample rendered triangles, with no extra per-frame searches.
export function* installForestTerrainSteps(world,mapId){
 if(!BIOMES.includes(mapId)&&mapId!=='confluence')return null;
 if(world.forestTerrain)return world.forestTerrain;
 const ground=world.ground,old=ground?.geometry,original=old?.parameters,approach=world.forestHabitats?.approach;
 if(!original?.widthSegments||!ground.userData.ownedGeometry||!approach?.points?.length&&!world.explorationRoutes?.length)return null;
 const cols=world.regions?160:144,rows=cols,{width,height}=original,dx=width/cols,dz=height/rows,pad=Math.hypot(dx,dz);
 const macroEnabled=mapId==='forest'&&!world.regions&&world.forestJourney?.points?.length>1;
 const biomeMacroEnabled=mapId!=='forest'&&(world.regions?world.biomeJourneys?.some(j=>j.points?.length>1):world.biomeJourney?.points?.length>1);
 const protectedRoots=new Set([...(world.explorationLandmarks||[]).flatMap(p=>[p.mesh,p.obstacle?.mesh]),...(world.regions||[]).map(r=>r.beacon?.parent)]);
 const movableScenery=new Set(macroEnabled||biomeMacroEnabled?(world.obstacles||[]).filter(o=>{
  const root=o.mesh,biome=world.regions?o.biome:mapId,regional=world.regions?biome!=='forest'&&biomeWeights(o.x,o.z)[biome]>.99:true,tree=regional&&root?.userData.treeBiome===biome,naturalRock=regional&&biomeMacroEnabled&&['ash','sand'].includes(biome)&&Math.abs(o.r-(world.regions?.7:.65))<.0001;
  // Loose sacks, net rolls and small barrels stand on the bank, rather than
  // flattening a five-metre moat around every .35m decorative footprint.
  // Boats, piers, districts and every interactive object remain fixed below.
  const coastDressing=regional&&biomeMacroEnabled&&biome==='coast'&&o.r<=.4&&['mooring','cask','net-roll','cargo-sack'].includes(root?.userData.coastPropKind)&&!o.environmentCluster;
  return root?.parent===world.group&&root.visible&&(tree||naturalRock||coastDressing)&&!root.userData.forestVistaTrunk&&!root.userData.district&&!root.userData.fragile&&!o.tactic&&!o.place&&!o.forestJourney&&!world.breakables?.includes(o)&&!protectedRoots.has(root)&&root.getObjectByName('tree-trunk')?.visible!==false;
 }):[]);
 const clearings=[{...world.spawn,r:4.6},...(world.regions||[]).map(q=>({x:q.x,z:q.z,r:6})),...(world.sites||[]).map(s=>({...s,r:s.event?8:4.5})),
  ...(world.discoveries||[]).flatMap(s=>[{...s,r:3.8},...(s.nodes||[]).map(n=>({...n,r:2}))]),
  ...(world.roaming||[]).map(s=>({...s,r:s.kind==='camp'?6:4})),
  ...(world.explorationLandmarks||[]).map(s=>({...s,r:4.8})),
  ...(world.obstacles||[]).filter(o=>!movableScenery.has(o)&&!(macroEnabled&&o.forestJourney)&&!(biomeMacroEnabled&&o.biomeOutcrop)).map(o=>({...o,r:o.tactic==='timber'?4.8:o.r+.15})),
  ...(world.patches||[]).filter(q=>q.kind==='vent').map(q=>({...q,r:q.r+1})),
  ...[...(world.districts||[]),...(world.regions||[]).flatMap(r=>r.districts||[])].map(q=>({...q,r:11}))].map(q=>({x:q.x,z:q.z,r:q.r+pad,outer:q.r+pad+3}));
 const boxes=[...(world.biomePlaces||[]).map(q=>({...q,hx:10,hz:10})),...(world.bridges||[]).map(q=>({...q,hx:q.width/2+1,hz:q.length/2+1})),...(world.fords||[]).map(q=>({...q,hx:q.half+1,hz:q.width/2+1}))].map(q=>({...q,c:Math.cos(q.angle||0),s:Math.sin(q.angle||0)}));
 const waters=[...(world.ponds||[]).map(q=>{const k=q.baseRx===undefined?1:1.19;return{...q,rx:(q.baseRx??q.rx)*k*1.12*1.115,rz:(q.baseRz??q.rz)*k*1.12*1.115};}),...(world.ice||[]).map(q=>({...q,rx:q.rx*1.16,rz:q.rz*1.16}))].map(q=>({...q,c:Math.cos(q.angle||0),s:Math.sin(q.angle||0)}));
 const protection=(x,z)=>{
  let weight=1;
  for(const q of clearings){const ax=x-q.x,az=z-q.z;if(Math.abs(ax)>q.outer||Math.abs(az)>q.outer)continue;weight=Math.min(weight,fade(Math.hypot(ax,az),q.r,q.outer));if(weight<.0001)return 0;}
  for(const q of boxes){const ax=x-q.x,az=z-q.z,u=q.c*ax-q.s*az,v=q.s*ax+q.c*az;weight=Math.min(weight,fade(Math.max(Math.abs(u)-q.hx,Math.abs(v)-q.hz),pad,pad+3));if(weight<.0001)return 0;}
  for(const q of waters){const ax=x-q.x,az=z-q.z,u=q.c*ax-q.s*az,v=q.s*ax+q.c*az,d=(Math.hypot(u/q.rx,v/q.rz)-1)*Math.min(q.rx,q.rz);weight=Math.min(weight,fade(d,macroEnabled?pad:pad+1,macroEnabled?pad+2:pad+4));if(weight<.0001)return 0;}
  return weight;
 };
 // In the joined map retain the old lowland plan exactly, including broad
 // shoulders which cross climate borders. Only the new regional field may
 // rise under its movable scenery; otherwise changing a snow-tree mask could
 // relocate an old hill whose outer flank is still visible in the forest.
 const oldScenery=world.regions&&biomeMacroEnabled?[...movableScenery].map(o=>({x:o.x,z:o.z,r:o.r+.15+pad})):[];
 const baseProtection=oldScenery.length?(x,z)=>{let value=protection(x,z);for(const q of oldScenery){if(!value)break;if(Math.abs(x-q.x)>q.r+3||Math.abs(z-q.z)>q.r+3)continue;value=Math.min(value,fade(Math.hypot(x-q.x,z-q.z),q.r,q.r+3));}return value;}:protection;
 const corridors=[];
 for(const biome of world.regions?BIOMES:[mapId]){
  const region=world.regions?.find(r=>r.id===biome),candidates=[];
  if(biome==='forest'&&!world.regions&&approach?.points?.length){const first=corridor(approach.points,biome,0,Infinity);if(first)corridors.push(first);}
  for(const route of world.explorationRoutes||[]){
   if((route.biome||mapId)!==biome||route.points.length<2)continue;
   const points=region?regionalShoulderPoints(route.points):route.points;
   const length=points.reduce((n,p,i)=>n+(i?Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z):0),0);
   for(const start of new Set([0,Math.max(0,length*.5-24),Math.max(0,length-48)])){
    const candidate=corridor(points,biome,start);if(!candidate||region&&!region.contains(candidate.x,candidate.z))continue;
    let score=0;for(const s of candidate.segments)for(const t of[.25,.75])for(const side of[-6,0,6]){const x=s.a.x+s.dx*t+s.dz/s.l*side,z=s.a.z+s.dz*t-s.dx/s.l*side;if(!region||region.contains(x,z))score+=baseProtection(x,z)*corridorWeight(candidate,x,z)*s.l;}
    if(score>.01)candidates.push({...candidate,score});
   }
  }
  candidates.sort((a,b)=>b.score-a.score);
  for(const candidate of candidates){const selected=corridors.filter(q=>q.biome===biome);if(selected.length===2)break;if(selected.some(q=>Math.hypot(q.x-candidate.x,q.z-candidate.z)<18))continue;corridors.push(candidate);}
 }
 if(!corridors.length&&!world.climateLandforms?.records.some(r=>r.kind==='dune'))return null;
 const broad=terrainMasses(world,mapId,baseProtection,pad);
 const macro=macroEnabled?forestMacroLandforms(world,protection):biomeMacroEnabled?biomeMacroLandforms(world,mapId,protection):null;
 // A rock face grows out of its backing earth instead of sitting in a flat
 // moat. Keep only its lower foot embedded: the original mesh and solid XZ /
 // top bounds stay intact. Water, route grades and other solids still win.
 const outcrops=(world.obstacles||[]).filter(o=>macroEnabled&&o.forestJourney||biomeMacroEnabled&&o.biomeOutcrop);
 yield {stage:'terrain-plan'};
 // Refine the existing surface once; interpolate its original colour triangles
 // so the denser grid does not change the established forest palette.
 const geometry=new T.PlaneGeometry(width,height,cols,rows),p=geometry.attributes.position,sourceColor=old.attributes.color;
 if(sourceColor){const colors=new Float32Array(p.count*sourceColor.itemSize);
  for(let z=0;z<=rows;z++){
   if(z%16===0)yield {stage:'terrain-colour',completed:z,total:rows};
   for(let x=0;x<=cols;x++){
   const gx=Math.min(x*original.widthSegments/cols,original.widthSegments-1e-7),gz=Math.min(z*original.heightSegments/rows,original.heightSegments-1e-7),ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz,a=iz*(original.widthSegments+1)+ix,b=a+original.widthSegments+1;
   const ids=tx+tz<=1?[a,b,a+1]:[b,b+1,a+1],weights=tx+tz<=1?[1-tx-tz,tz,tx]:[1-tx,tx+tz-1,1-tz];
   for(let c=0;c<sourceColor.itemSize;c++)colors[(z*(cols+1)+x)*sourceColor.itemSize+c]=ids.reduce((v,id,i)=>v+sourceColor.array[id*sourceColor.itemSize+c]*weights[i],0);
  }}geometry.setAttribute('color',new T.BufferAttribute(colors,sourceColor.itemSize));
 }
 ground.geometry=geometry;old.dispose();
 const heights=new Float32Array(p.count);
 // Protected footprints include one cell diagonal. Any triangle underneath an
 // existing solid, interactive clearing or water edge therefore stays flat.
 for(let i=0;i<p.count;i++){
  if(i%((cols+1)*8)===0)yield {stage:'terrain-height',completed:i,total:p.count};
  const x=p.getX(i)+ground.position.x,z=-p.getY(i)+ground.position.z;
  let weight=0;for(const route of corridors)weight=Math.max(weight,corridorWeight(route,x,z));
  const dune=world.climateLandforms?.heightAt(x,z)||0,mass=broad.weight(x,z),rise=macro?macro.heightAt(x,z)*(1-fade(Math.max(Math.abs(x),Math.abs(z)),world.half-16,world.half-5)):0;
  if(weight>0||dune>0||mass>0||rise>0){const mask=baseProtection(x,z);heights[i]=Math.max(HEIGHT*Math.min(weight,mask),dune*mask,mass*mask,rise*protection(x,z));}
  for(const rock of outcrops){if(Math.abs(x-rock.x)>rock.r+6||Math.abs(z-rock.z)>rock.r+6)continue;const distance=Math.hypot(x-rock.x,z-rock.z);if(distance>rock.r+6)continue;heights[i]=Math.min(heights[i],1.15+4.65*fade(distance,rock.r,rock.r+6));}
 }
 // Bound both triangle gradients. Only lower peaks; protected zeroes never rise.
 const axisGrade=macro?.records.length&&!world.regions ? .22 : AXIS_GRADE,stepX=dx*axisGrade,stepZ=dz*axisGrade;
 for(let pass=0;pass<2;pass++){
  yield {stage:'terrain-grade',completed:pass,total:2};
  for(let z=0;z<=rows;z++)for(let x=0;x<=cols;x++){const i=z*(cols+1)+x;if(x)heights[i]=Math.min(heights[i],heights[i-1]+stepX);if(z)heights[i]=Math.min(heights[i],heights[i-cols-1]+stepZ);}
  for(let z=rows;z>=0;z--)for(let x=cols;x>=0;x--){const i=z*(cols+1)+x;if(x<cols)heights[i]=Math.min(heights[i],heights[i+1]+stepX);if(z<rows)heights[i]=Math.min(heights[i],heights[i+cols+1]+stepZ);}
 }
 const sample=(x,z)=>{
  if(!Number.isFinite(x+z))return 0;
  const gx=(x-ground.position.x+width*.5)/dx,gz=(z-ground.position.z+height*.5)/dz;
  if(gx<0||gz<0||gx>=cols||gz>=rows)return 0;
  const ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz,a=iz*(cols+1)+ix,b=a+cols+1;
  return tx+tz<=1?heights[a]*(1-tx-tz)+heights[b]*tz+heights[a+1]*tx:heights[b]*(1-tx)+heights[b+1]*(tx+tz-1)+heights[a+1]*(1-tz);
 };
 const color=geometry.attributes.color,crestTint={forest:[.11,.045,-.025],snow:[.055,.045,.025],ash:[.075,.055,.035],sand:[.07,.045,.015],coast:[.06,.035,.015]};
 for(let i=0;i<p.count;i++){
  if(i%((cols+1)*16)===0)yield {stage:'terrain-surface',completed:i,total:p.count};
  p.setZ(i,heights[i]);
  if(color&&heights[i]>.001){
   const x=p.getX(i)+ground.position.x,z=-p.getY(i)+ground.position.z,biome=world.regions?.find(r=>r.contains(x,z))?.id||mapId,tint=crestTint[biome];
   if(tint){const dry=fade(heights[i],.05,1.2);color.setXYZ(i,color.getX(i)*(1+tint[0]*dry),color.getY(i)*(1+tint[1]*dry),color.getZ(i)*(1+tint[2]*dry));}
  }
 }
 if(color)color.needsUpdate=true;
 p.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 const state={heights,cols,rows,width,height,sample,corridors,masses:broad.masses,macro:macro?.records||[],axisGrade,groundedObstacles:[],disposed:false,maxHeight:Math.max(...heights),instances:0,draped:0,overlayTrianglesAdded:0};
 world.forestTerrain=state;world.groundHeightAt=sample;
 const matrix=new T.Matrix4(),point=new T.Vector3();world.group.updateMatrixWorld(true);
 // Permanent, non-interactive trees may stand on the new broad slopes. Seat
 // the lowest root ring under the actual triangles so downhill roots cannot
 // float. The collider's XZ footprint is unchanged; its base and height use the
 // same y + local-height convention as camera/projectile obstacle queries.
 const rootBounds=new T.Box3();
 let treeIndex=0;
 for(const obstacle of movableScenery){
  if(treeIndex++%16===0)yield {stage:'terrain-roots',completed:treeIndex,total:movableScenery.size};
  const center=sample(obstacle.x,obstacle.z);if(center<.001)continue;
  const root=obstacle.mesh,trunk=root.getObjectByName('tree-trunk'),vertices=trunk?.geometry.attributes.position;
  rootBounds.setFromObject(root);const oldBase=obstacle.y||0,bodyHeight=rootBounds.max.y-oldBase;
  let lift=Infinity;
  if(vertices){
   let lowest=Infinity;for(let i=0;i<vertices.count;i++){point.fromBufferAttribute(vertices,i).applyMatrix4(trunk.matrixWorld);lowest=Math.min(lowest,point.y);}
   for(let i=0;i<vertices.count;i++){point.fromBufferAttribute(vertices,i).applyMatrix4(trunk.matrixWorld);if(point.y<=lowest+.08)lift=Math.min(lift,sample(point.x,point.z)-point.y-.015);}
  }else{
   // Ordinary ash stones and buried sand columns retain their existing buried
   // base. Seat the complete footprint, including its downhill side, rather
   // than moving only its centre onto the slope and leaving the edge floating.
   for(const x of[rootBounds.min.x,obstacle.x,rootBounds.max.x])for(const z of[rootBounds.min.z,obstacle.z,rootBounds.max.z])lift=Math.min(lift,sample(x,z));
  }
  if(!Number.isFinite(lift)||lift<=.001)continue;
  root.position.y+=lift;root.updateWorldMatrix(false,true);obstacle.y=oldBase+lift;obstacle.height=bodyHeight;
  state.groundedObstacles.push({obstacle,lift,ground:center});
 }
 // Existing plants retain their placement, shared geometry and buried roots.
 // All height attachment happens at build time, with no per-frame instance work.
 const batches=[...(world.scenery?.batches||[]),...(world.adventureGroundDetail?.children||[]),...(world.habitatDetail?.children||[]),...(macro?world.environmentClusters?.group?.children||[]:[])];
 for(const mesh of batches){yield {stage:'terrain-plants'};let changed=false;if(!mesh.isInstancedMesh)continue;
  for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);const h=sample(point.x,point.z);if(h<=0)continue;matrix.elements[13]+=h;mesh.setMatrixAt(i,matrix);state.instances++;changed=true;}
  if(changed){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();}
 }
 // These are the existing owned flat soil/route overlays, not new decals.
 // Keep their worn edges on the changed surface. Water is protected above.
 const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
 for(let i=0;i<heights.length;i++)if(heights[i]>0){const x=p.getX(i)+ground.position.x,z=-p.getY(i)+ground.position.z;bounds.minX=Math.min(bounds.minX,x-dx);bounds.maxX=Math.max(bounds.maxX,x+dx);bounds.minZ=Math.min(bounds.minZ,z-dz);bounds.maxZ=Math.max(bounds.maxZ,z+dz);}
 bounds.raised=(minX,maxX,minZ,maxZ)=>{
  const x0=Math.max(0,Math.floor((minX-ground.position.x+width/2)/dx)),x1=Math.min(cols,Math.ceil((maxX-ground.position.x+width/2)/dx)),z0=Math.max(0,Math.floor((minZ-ground.position.z+height/2)/dz)),z1=Math.min(rows,Math.ceil((maxZ-ground.position.z+height/2)/dz));
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)if(heights[z*(cols+1)+x]>0)return true;return false;
 };
 const overlays=[];world.group.traverse(mesh=>{if(mesh.isMesh&&!mesh.isInstancedMesh&&mesh!==ground&&mesh.userData.ownedGeometry&&!mesh.userData.groundCue)overlays.push(mesh);});
 for(const mesh of overlays){
  yield {stage:'terrain-overlay'};
  if(!mesh.isMesh||mesh===ground||mesh.isInstancedMesh||!mesh.userData.ownedGeometry)continue;
  let attr=mesh.geometry.attributes.position;if(!attr)continue;
  let flat=true;for(let i=0;i<attr.count;i++){point.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);if(point.y<-.06||point.y>.08){flat=false;break;}}
  if(!flat)continue;let changed=false;
  // Tighter edges at crests keep worn soil above the steeper rendered surface;
  // most interiors pass unchanged. No extra meshes or per-frame subdivision.
  state.overlayTrianglesAdded+=refineOverlay(mesh,bounds,Math.min(.25,dx*.4,dz*.4),OVERLAY_BUDGET-state.overlayTrianglesAdded,sample,ground.position.y,biomeMacroEnabled?16:4);attr=mesh.geometry.attributes.position;
  for(let i=0;i<attr.count;i++){point.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);const h=sample(point.x,point.z);if(h<=0)continue;point.y+=h;mesh.worldToLocal(point);attr.setXYZ(i,point.x,point.y,point.z);changed=true;}
  if(changed){attr.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();state.draped++;}
 }
 const release=()=>{state.disposed=true;if(world.groundHeightAt===sample)delete world.groundHeightAt;geometry.removeEventListener('dispose',release);};
 geometry.addEventListener('dispose',release);return state;
}

// Synchronous tools/tests use the very same construction path. The game's
// existing preparation scheduler consumes the generator in bounded slices.
export function installForestTerrain(world,mapId){
 const steps=installForestTerrainSteps(world,mapId);let result;
 do{result=steps.next();}while(!result.done);
 return result.value;
}
