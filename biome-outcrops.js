import * as T from './vendor/three.module.js';
import {ridgeGeometry} from './forest-journey.js?v=229';
import {createExplorationNavigator} from './exploration-routes.js?v=229';
import {segmentDistance} from './rules.js?v=229';
import {waterDepth} from './water.js?v=229';
import {bridgeContains} from './coast.js?v=229';
import {batchedSurfaceMaterial,prepareBatchedSurface} from './environment-props.js?v=229';

let stone;
const rim=Array.from({length:12},(_,i)=>({x:Math.sin(i*Math.PI/6),z:Math.cos(i*Math.PI/6)}));
function collisionSamples(points){
 const samples=[];for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.75);
  for(let n=0;n<steps;n++){const t=n/steps;samples.push({x:T.MathUtils.lerp(a.x,b.x,t),z:T.MathUtils.lerp(a.z,b.z,t),r:T.MathUtils.lerp(a.r,b.r,t)});}
 }samples.push({...points.at(-1)});return samples;
}
function shoreShoulders(points,safe){
 const chain=points.map(p=>({...p}));
 // Follow available dry ground instead of forcing a straight cliff through
 // the narrow shore. Both ends taper into the bank; no isolated tall column.
 for(const reverse of [false,true]){
  if(reverse)chain.reverse();
  for(let i=0;i<5;i++){
   const a=chain.at(-2),b=chain.at(-1),heading=Math.atan2(b.x-a.x,b.z-a.z),r=Math.max(.72,b.r-.07);
   let next=null;
   for(const turn of [0,-.22,.22,-.44,.44,-.68,.68]){
    const angle=heading+turn,p={x:b.x+Math.sin(angle)*1.3,z:b.z+Math.cos(angle)*1.3,r,height:2.8};
    if(!safe(p)||chain.slice(0,-2).some(q=>Math.hypot(p.x-q.x,p.z-q.z)<1.4))continue;
    if([.25,.5,.75].every(t=>safe({x:T.MathUtils.lerp(b.x,p.x,t),z:T.MathUtils.lerp(b.z,p.z,t),r:T.MathUtils.lerp(b.r,r,t)}))){next=p;break;}
   }
   if(!next)break;chain.push(next);
  }
  if(reverse)chain.reverse();
 }
 for(let i=0;i<chain.length;i++){
  const t=i/(chain.length-1);
  chain[i].height=1.45+1.5*Math.pow(Math.sin(t*Math.PI),.8)+.45*Math.sin(t*Math.PI*5+.3);
 }
 return chain;
}
// A reachable shoreline shoulder frames the open bay. Closed rock geometry,
// existing collision queries, shared material: no backdrop masquerading as land.
export function installBiomeOutcrops(world,id){
 const steps=installBiomeOutcropsSteps(world,id);let next;do{next=steps.next();}while(!next.done);return next.value;
}
export function* installBiomeOutcropsSteps(world,id){
 if(id!=='coast'&&id!=='confluence')return null;
 if(world.biomeOutcrops)return world.biomeOutcrops;
 const journey=world.biomeJourney||world.biomeJourneys?.find(p=>p.biome==='coast');if(!journey)return null;
 const scope=world.regions?.find(p=>p.id==='coast'),nodes=journey.landmarks.filter(p=>p.kind==='opening'||p.kind==='overlook');
 const paths=[...world.explorationRoutes||[],journey].flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b})));
 const records=[],solids=[],clearings=[{...world.spawn,r:7},...world.sites.map(p=>({...p,r:p.event?10:6})),...(world.discoveries||[]).flatMap(p=>[{...p,r:6},...(p.nodes||[]).map(q=>({...q,r:3}))]),...(world.roaming||[]).map(p=>({...p,r:7})),...(world.biomePlaces||[]).map(p=>({...p,r:13}))];
 // Test the actual high-tide shoreline at the whole footprint, rather than
 // inflating both ellipse axes by the full cliff radius plus another metre.
 // That old double reserve removed the narrow dry bank beside the long bridge.
 const water=world.ponds.map(p=>({...p,rx:(p.baseRx??p.rx)*(p.baseRx===undefined?1:1.19),rz:(p.baseRz??p.rz)*(p.baseRz===undefined?1:1.19)}));
 const replaceable=new Set(world.obstacles.filter(o=>o.r<=.81&&o.mesh.parent===world.group&&!o.tactic&&!o.place&&!o.environmentCluster&&!o.climateLandform&&o.sceneryHeight===undefined&&!world.breakables?.includes(o)&&!['district','fragile','explorationLandmark','forestVistaTrunk','coastPropKind'].some(k=>o.mesh.userData[k])));
 const dry=p=>water.every(q=>waterDepth(q,p.x,p.z)===0);
 const dryFootprint=p=>{
  if(!dry(p))return false;
  for(const d of rim){const q={x:p.x+d.x*(p.r+.18),z:p.z+d.z*(p.r+.18)};if(scope&&!scope.contains(q.x,q.z)||!dry(q))return false;}
  return true;
 };
 const safe=p=>Math.max(Math.abs(p.x),Math.abs(p.z))<world.half-p.r-4&&(!scope||scope.contains(p.x,p.z))
  &&clearings.every(q=>Math.hypot(q.x-p.x,q.z-p.z)>q.r+p.r)
  &&paths.every(s=>segmentDistance(p.x,p.z,s.a.x,s.a.z,s.b.x,s.b.z)>p.r+2.2)
  &&(world.bridges||[]).every(b=>!bridgeContains(b,p.x,p.z,p.r+1.2))
  &&world.obstacles.every(o=>replaceable.has(o)||Math.hypot(o.x-p.x,o.z-p.z)>o.r+p.r+.3)&&dryFootprint(p);
 const candidates=[];
 let prepared=0;
 const profiles=[{count:5,r:1.8,step:2.2,height:5.8},{count:3,r:1.15,step:1.65,height:5.0}];
 for(const node of nodes)for(const distance of [18,22,24,26,28,30,34,38,42,48,54,62,72,82])for(const offset of [-.72,-.60,-.48,-.36,-.30,-.24,-.18,-.12,.12,.18,.24,.30,.36,.48,.60,.72])for(const profile of profiles){
  if(++prepared%64===0)yield;
  const direction=node.yaw+offset,x=node.x+Math.sin(direction)*distance,z=node.z+Math.cos(direction)*distance;
  // A side-on face, with irregular shoulders falling away at both ends.
  const angle=direction+Math.PI/2,points=[];
  for(let i=0;i<profile.count;i++){const along=(i-(profile.count-1)/2)*profile.step;points.push({x:x+Math.sin(angle)*along,z:z+Math.cos(angle)*along,r:profile.r,height:profile.height+.5*Math.sin(i*.9+x*.03)});}
  if(points.some(p=>!safe(p)))continue;
  // Also check the continuous space between the collision circles. A cliff
  // never bridges a concave bit of water or clips a protected route halfway.
  let continuous=true;for(let i=1;i<points.length&&continuous;i++)for(const t of [.25,.5,.75]){const a=points[i-1],b=points[i];if(!safe({...a,x:T.MathUtils.lerp(a.x,b.x,t),z:T.MathUtils.lerp(a.z,b.z,t)})){continuous=false;break;}}
  if(!continuous)continue;
  candidates.push({biome:'coast',x,z,points,collisionPoints:collisionSamples(points),angle,view:node.id,node,score:distance*.22+Math.abs(offset)*4+(profile.count===3?.8:0)+(node.kind==='opening'?0:100)});
 }
 candidates.sort((a,b)=>a.score-b.score);
 for(const candidate of candidates.slice(0,24)){
  yield;
  candidate.points=shoreShoulders(candidate.points,safe);candidate.collisionPoints=collisionSamples(candidate.points);
  const covered=o=>candidate.collisionPoints.some(p=>Math.hypot(p.x-o.x,p.z-o.z)<p.r+o.r+.3),obstacles=world.obstacles.filter(o=>!replaceable.has(o)||!covered(o));
  const navigation=createExplorationNavigator({...world,obstacles:[...obstacles,...candidate.collisionPoints]}),direction=Math.atan2(candidate.node.x-candidate.x,candidate.node.z-candidate.z);
  yield;
  for(const offset of [0,-.65,.65,Math.PI]){
   const visit={x:candidate.x+Math.sin(direction+offset)*4.5,z:candidate.z+Math.cos(direction+offset)*4.5},access=navigation.route(journey.points[0],visit);
   yield;
   if(access.length<2)continue;candidate.access=access;candidate.visit=visit;break;
  }
  if(!candidate.access)continue;delete candidate.node;records.push(candidate);break;
 }
 yield;
 const group=new T.Group();group.name='SM_Coast_ShoreEscarpment_A';world.group.add(group);
 const retired=new Set([...replaceable].filter(o=>records.some(r=>r.collisionPoints.some(p=>Math.hypot(p.x-o.x,p.z-o.z)<p.r+o.r+.3))));
 for(const o of retired)o.mesh.visible=false;
 world.obstacles=world.obstacles.filter(o=>!retired.has(o));if(scope)scope.obstacles=scope.obstacles.filter(o=>!retired.has(o));
 const retiredRoots=new Set([...retired].map(o=>o.mesh));world.foliage=world.foliage.filter(f=>!retiredRoots.has(f.leaf.parent));
 if(scope)scope.foliage=scope.foliage.filter(f=>!retiredRoots.has(f.leaf.parent));
 if(records.length&&!stone){const source=new T.MeshStandardMaterial({color:0x788e91,vertexColors:true,roughness:.94});stone=batchedSurfaceMaterial(source,'stone');if(stone!==source)source.dispose();}
 for(const record of records){
  const geometry=ridgeGeometry(record.points);prepareBatchedSurface(geometry,'stone');const mesh=new T.Mesh(geometry,stone);mesh.name='SM_Coast_ShoreEscarpment_Face';mesh.userData.ownedGeometry=true;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);record.mesh=mesh;record.solids=[];
  for(const point of record.collisionPoints){
   let top=.15;const p=geometry.attributes.position;for(let i=0;i<p.count;i++)if(Math.hypot(p.getX(i)-point.x,p.getZ(i)-point.z)<=point.r+.08)top=Math.max(top,p.getY(i));
   const marker=new T.Object3D();marker.position.set(point.x,0,point.z);group.add(marker);const obstacle={x:point.x,z:point.z,r:point.r,mesh:marker,biome:'coast',sceneryHeight:top,biomeOutcrop:true};world.obstacles.push(obstacle);if(scope)scope.obstacles.push(obstacle);solids.push(obstacle);record.solids.push(obstacle);
  }
 }
 return world.biomeOutcrops={group,records,solids,retired:[...retired],draws:records.length};
}
