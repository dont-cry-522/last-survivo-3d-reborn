import {createExplorationNavigator} from './exploration-routes.js?v=229';
import {journeyPoint} from './forest-journey.js?v=229';

// A continuous walk through existing playable places. This plan owns no meshes,
// rewards, timers or random generator; all connections use the actual navigator.
const TITLES={
 snow:['雪松林隘','风蚀石口','冰谷开口','雪岭旧站'],
 ash:['焦木前庭','熔沟转折','灰谷断层','炉城遗痕'],
 sand:['风沙门径','背风沙脊','沉城开口','残墙远眺'],
 coast:['岸林入口','礁岸转弯','潮湾开口','旧埠林岸']
};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const lengthOf=points=>points.reduce((sum,p,i)=>sum+(i?distance(p,points[i-1]):0),0);
const nearest=(list,p)=>list.reduce((best,q)=>!best||distance(q,p)<distance(best,p)?q:best,null);

function features(world,id){
 if(id==='snow')return [...(world.ice||[]),...(world.climateLandforms?.records||[]).filter(p=>p.biome===id)];
 if(id==='ash')return [...(world.patches||[]).filter(p=>p.kind==='vent'),...(world.climateLandforms?.records||[]).filter(p=>p.biome===id)];
 if(id==='coast')return world.ponds||[];
 return [...(world.biomePlaces||[]).filter(p=>p.biome===id),...(world.climateLandforms?.records||[]).filter(p=>p.biome===id)];
}

export function planBiomeJourney(world,id){
 if(id==='confluence'&&world.regions){
  if(world.biomeJourneys)return world.biomeJourneys;
  return world.biomeJourneys=world.regions.filter(r=>TITLES[r.id]).map(scope=>planJourney(world,scope.id,scope)).filter(Boolean);
 }
 if(!TITLES[id]||world.regions)return null;
 if(world.biomeJourney)return world.biomeJourney;
 return world.biomeJourney=planJourney(world,id);
}
function planJourney(world,id,scope=null){
 const routes=(world.explorationRoutes||[]).filter(r=>r.points?.length>1&&(!scope||r.biome===id)).map(r=>({route:r,length:lengthOf(r.points)}));
 // Favour a real walk-through place and an excursion long enough for a reveal,
 // without choosing the farthest reward merely to manufacture a long route.
 routes.sort((a,b)=>(Math.abs(a.length-78)-(a.route.place?30:0))-(Math.abs(b.length-78)-(b.route.place?30:0)));
 if(!routes.length)return null;
 const chosen=routes[0],points=chosen.route.points.map(p=>({x:p.x,z:p.z})),navigation=createExplorationNavigator(world);
 const sights=features(world,id).filter(p=>!scope||scope.contains(p.x,p.z)),end=points.at(-1),candidates=[];
 // A dry side approach reveals the landscape from a second angle. The old
 // reward route is untouched; neither hazards nor water become passable.
 for(const feature of [...sights].sort((a,b)=>distance(a,end)-distance(b,end)).slice(0,3)){
  const radius=Math.max(feature.rx||0,feature.rz||0,feature.width||0,feature.r||0,6)+5;
  const facing=Math.atan2(end.x-feature.x,end.z-feature.z);
  for(const offset of [.65,-.65,1.2,-1.2]){
   const angle=facing+offset,p={x:feature.x+Math.sin(angle)*radius,z:feature.z+Math.cos(angle)*radius},d=distance(p,end);
   if(d<12||d>38||Math.max(Math.abs(p.x),Math.abs(p.z))>world.half-6||scope&&!scope.contains(p.x,p.z))continue;
   candidates.push({p,feature,d,score:d+Math.abs(offset)*2});
  }
 }
 candidates.sort((a,b)=>a.score-b.score);let extension=null;
 for(const candidate of candidates.slice(0,5)){
  const route=navigation.route(end,candidate.p);
  if(route.length<2||lengthOf(route)>candidate.d*1.55+8||scope&&route.some(p=>!scope.contains(p.x,p.z)))continue;
  points.push(...route.slice(1));extension=candidate;break;
 }
 const length=lengthOf(points),ids=['entry','turn','opening','destination'],fractions=[0,.32,.69,.96];
 const landmarks=fractions.map((fraction,i)=>{
  const p=journeyPoint(points,length*fraction),ahead=journeyPoint(points,Math.min(length,length*fraction+8));
  let lookAt=i<2?ahead:nearest(sights,p)||ahead;
  if(i===3&&extension)lookAt=extension.feature;
  return {...p,id:ids[i],name:TITLES[id][i],biome:id,kind:i===2?'opening':i===3?'overlook':'shelter',lookAt,
   yaw:Math.atan2(lookAt.x-p.x,lookAt.z-p.z),pitch:-.045,canopy:i===0?.75:i===1?.55:.10};
 });
 return {biome:id,points,length,landmarks,source:chosen.route,extended:!!extension};
}
