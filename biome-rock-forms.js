import * as T from './vendor/three.module.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// Fracture profiles, not stretched copies of the old spherical ash pillar.
// Six shared closed meshes keep the occupied footprint and existing stone
// shader. Low shelves, tall split faces and eroded stacks have different mass.
export const ASH_ROCK_FORMS=['split-basalt','fractured-slab','eroded-stack'];
const templates=new Map();
function strata(rings,{sides=8,x=0,z=0,phase=0,cut=0}={}){
 const positions=[],colors=[],indices=[];
 for(let row=0;row<rings.length;row++){
  const [y,r,cx=0,cz=0]=rings[row];
  for(let i=0;i<sides;i++){
   const a=i*Math.PI*2/sides+phase,edge=1+.075*Math.sin(i*3.7+phase)+.035*Math.cos(i*2.1-row*.7);
   const px=x+cx+Math.cos(a)*r*edge,pz=z+cz+Math.sin(a)*r*edge,top=row===rings.length-1;
   const py=row===0?-.035:y+(top?Math.cos(a+.5)*cut:Math.sin(i*1.8+phase)*.035);
   positions.push(px,py,pz);const light=.78+.12*Math.cos(a*2.1+phase)**2+(top?.12:0),seam=row%3===1?.93:1;
   colors.push(light*seam,light*.97*seam,light*.96*seam);
  }
 }
 for(let row=0;row<rings.length-1;row++)for(let i=0;i<sides;i++){const a=row*sides+i,b=row*sides+(i+1)%sides;indices.push(a,a+sides,b,b,a+sides,b+sides);}
 for(const row of [0,rings.length-1]){
  const [y,,cx=0,cz=0]=rings[row],at=positions.length/3;positions.push(x+cx,row?y:-.035,z+cz);colors.push(.92,.89,.88);
  for(let i=0;i<sides;i++){const a=row*sides+i,b=row*sides+(i+1)%sides;indices.push(...(row?[at,b,a]:[at,a,b]));}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
export function biomeRockTemplate(form,variant=0){
 if(!ASH_ROCK_FORMS.includes(form))return null;variant=variant===1?1:0;const key=form+variant;if(templates.has(key))return templates.get(key);
 const v=variant*.35,parts=[];
 if(form==='split-basalt'){
  parts.push(strata([[0,.26],[.5,.29],[1.6,.25,.02,-.01],[2.8,.23,.05,-.02],[3.15,.20,.04,.0]],{sides:7,x:-.19,z:-.07,phase:v,cut:.16}));
  parts.push(strata([[0,.25],[.9,.24],[1.5,.22,-.01,0],[2.3,.19,-.04,.01]],{sides:6,x:.24,z:.10,phase:.48+v,cut:.12}));
  parts.push(strata([[0,.19],[.4,.19],[.83,.16,.01,0],[1.05,.12,.03,0]],{sides:7,x:-.11,z:.32,phase:.7+v,cut:.1}));
 }else if(form==='fractured-slab'){
  parts.push(strata([[0,.49],[.23,.53],[.52,.46,.035,-.02],[.80,.39,.07,-.025]],{sides:9,phase:.24+v,cut:.15}));
  parts.push(strata([[0,.20],[.20,.23],[.39,.20,.03,.02],[.47,.15,.02,.03]],{sides:6,x:-.28,z:.22,phase:v,cut:.08}));
 }else{
  parts.push(strata([[0,.43],[.36,.50],[.64,.43,-.03,.01],[.78,.34,-.04,0],[1.06,.43,-.02,-.02],[1.35,.35,.04,-.04],[1.55,.26,.07,-.06],[1.96,.19,.08,-.04]],{sides:9,phase:v+.1,cut:.18}));
  parts.push(strata([[0,.18],[.32,.20],[.64,.13,.01,0]],{sides:6,x:-.29,z:.26,phase:.6+v,cut:.08}));
 }
 const geometry=mergeGeometries(parts,false);for(const part of parts)part.dispose();
 geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.name='SM_Rock_'+form+'_'+variant;
 const template={form,variant,geometry,height:geometry.boundingBox.max.y,triangles:geometry.index.count/3};templates.set(key,template);return template;
}

function segmentDistance(a,b,x,z){const dx=b.x-a.x,dz=b.z-a.z,t=T.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);}

export function installBiomeRockForms(world,id,{context=world}={}){
 if(world.biomeRockForms)return world.biomeRockForms;
 if(world.regions){const regions=[];for(const r of world.regions){const state=installBiomeRockForms(r,r.id,{context:world});if(state)regions.push(state);}return world.biomeRockForms={regions,rocks:regions.flatMap(r=>r.rocks)};}
 if(id!=='ash')return null;
 const candidates=[],points=world.biomeJourney?.points||context.explorationRoutes?.find(r=>r.biome==='ash')?.points||[];
 for(const o of world.obstacles||[]){
  const root=o.mesh;
  if(!root?.visible||root.parent!==world.group&&!(world.regional&&root.parent===world.group.parent)||o.tactic||o.place||o.forestJourney||o.sceneryHeight!==undefined||context.breakables?.includes(o)||o.r<.6||o.r>.81)continue;
  if(['treeBiome','district','fragile','explorationLandmark','forestVistaTrunk'].some(k=>root.userData[k])||root.children.length>2||!root.children.every(c=>c.isMesh))continue;
  const source=root.children.find(c=>/Sphere|Dodecahedron/.test(c.geometry?.type||'')||c.geometry?.name.startsWith('SM_Rock_AshColumn_'));
  if(!source||root.children.some(c=>/Cylinder|Box/.test(c.geometry?.type||'')))continue;
  if((context.sites||[]).some(s=>Math.hypot(s.x-o.x,s.z-o.z)<(s.event?11:8)))continue;
  let distance=Infinity;for(let i=1;i<points.length;i++)distance=Math.min(distance,segmentDistance(points[i-1],points[i],o.x,o.z));
  candidates.push({o,source,distance});
 }
 candidates.sort((a,b)=>a.distance-b.distance||a.o.x-b.o.x);
 const state={biome:id,rocks:[],forms:{},triangles:0};
 for(const {o,source} of candidates.slice(0,96)){
  const root=o.mesh,patch=Math.sin(o.x*.081+o.z*.033)+Math.cos(o.z*.067-o.x*.021),form=patch<-.35?'split-basalt':patch>.55?'fractured-slab':'eroded-stack';
  const variant=Math.sin(o.x*.31-o.z*.41)>0?1:0,template=biomeRockTemplate(form,variant),material=source.material;
  for(const child of [...root.children]){if(child.userData.ownedGeometry)child.geometry?.dispose();root.remove(child);}
  const mesh=new T.Mesh(template.geometry,material);mesh.name=template.geometry.name;mesh.castShadow=mesh.receiveShadow=true;
  // Maximum authored radial extent .57m, inside even the smallest old .65m
  // obstacle. New visible top is read by the normal collision-height pass.
  mesh.scale.setScalar(Math.min(1,(o.r-.035)/.60));root.rotation.y=Math.sin(o.x*.13+o.z*.17)*Math.PI;root.add(mesh);root.userData.biomeRockForm=form;
  state.forms[form]=(state.forms[form]||0)+1;state.triangles+=template.triangles;state.rocks.push({x:o.x,z:o.z,form,variant,root,height:template.height*mesh.scale.y});
 }
 if(!state.rocks.length)return null;world.biomeRockForms=state;return state;
}
