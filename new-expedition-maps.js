import * as T from './vendor/three.module.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {MAPS,seeded,segmentDistance} from './rules.js?v=228';
import {buildPondsSteps,waterDepth} from './water.js?v=228';
import {naturalRockGeometry,installGroundSurface} from './biome-scenery.js?v=228';
import {stoneSurfaceMaterial} from './environment-props.js?v=228';
import {createAuthoredGrassPatch} from './adventure-ground-detail.js?v=228';
import {addTree} from './tree-scenery.js?v=228';
import {siteSchedule} from './site-discovery.js?v=228';
import {installRoaming} from './roaming-events.js?v=228';

export const NEW_EXPEDITION_MAPS=['bellvale','crystalcave'];
const half=96,extent=104,segments=128,step=extent*2/segments;
const smooth=T.MathUtils.smoothstep;
const materials=new Map();
function material(key,color,roughness=.9,metalness=0,emissive=0){
 if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color,roughness,metalness,emissive,emissiveIntensity:emissive?.26:0,side:T.DoubleSide}));
 return materials.get(key);
}
function mineralMaterial(key,color,vertexColors=false){
 const mat=stoneSurfaceMaterial(material(key,color));mat.vertexColors=vertexColors;
 const before=mat.onBeforeCompile;
 // Metric coordinates keep the same local CC0 rock detail on a 2 m stone,
 // broad cliff and cave ceiling; never stretch a single texture across a wall.
 mat.onBeforeCompile=(shader,renderer)=>{before.call(mat,shader,renderer);shader.vertexShader=shader.vertexShader.replace('propPoint=position;propNormal=normal;','propPoint=(modelMatrix*vec4(position,1.0)).xyz*.38;propNormal=normalize(mat3(modelMatrix)*normal);');};
 mat.customProgramCacheKey=()=>key+'-metric-mineral';return mat;
}
const stone=mineralMaterial('new-stone',0x899282,true),darkStone=mineralMaterial('cave-stone',0x77818d,true),copper=material('bell-bronze',0xb39860,.42,.65),edgeStone=mineralMaterial('bell-edge',0xb4baa7);
const caveFloor=mineralMaterial('cave-floor',0xffffff,true),vaultMaterial=mineralMaterial('cave-vault',0xffffff,true);
const crystals=[material('crystal-blue',0x6c9db3,.31,.16,0x2b6a8a),material('crystal-violet',0x7c78a5,.35,.12,0x514974),material('crystal-pale',0xb2d1d4,.30,.1,0x4d7c8a)];
let gateGeometry;
function addBellGate(world,site,landmark){
 // The northern bell arch is a side passage, not part of the protected main
 // route. Its three solid panels are removed by the existing mechanism choice
 // and the existing room-world removed-obstacle ledger.
 if(!gateGeometry){
  const parts=[],box=(x,y,z,w,h,d)=>parts.push(new T.BoxGeometry(w,h,d).translate(x,y,z));
  for(let i=0;i<7;i++)box((i-3)*.45,1.25,0,.34,2.5,.22);
  box(0,.55,.04,3.35,.18,.28);box(0,2.05,.04,3.35,.18,.28);
  gateGeometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
 }
 site.gates=[];
 for(const offset of[-3.38,0,3.38]){
  const x=landmark.x+offset,z=landmark.z,ground=world.groundHeightAt(x,z),mesh=new T.Mesh(gateGeometry,material('bell-gate-wood',0x555b48));
  mesh.name='SM_Gate_BellCourt';mesh.position.set(x,ground,z);mesh.castShadow=mesh.receiveShadow=true;world.group.add(mesh);
  const gate={x,z,r:1.72,mesh,biome:'bellvale',sceneryHeight:ground+2.5};
  world.obstacles.push(gate);site.gates.push(gate);
 }
}

export function newExpeditionLayout(id,seed=1){
 const cave=id==='crystalcave',random=seeded(seed),offset=(random()-.5)*2.2;
 const route=(cave?[[-55,45],[-32,28],[-13,17],[12,2],[31,-22],[10,-46],[-19,-58]]:[[-45,55],[-26,40],[-12,16],[-28,-8],[0,-30],[30,-47],[49,-20]]).map(([x,z])=>({x,z}));
 const sites=(cave?[
  [-38,40,'relic'],[18,-57,'altar','beacons'],[-41,-38,'supply'],[50,30,'supply','ambush'],[52,-62,'altar']
 ]:[
  [-37,33,'relic'],[30,-47,'altar','mechanism'],[-52,-29,'supply'],[53,17,'supply','ambush'],[-27,-70,'altar']
 ]).map(([x,z,type,event],i)=>({x,z,type,event,biome:id,claimed:false,discovered:false,reveal:0,eventAngle:.45+i*.64,availableAt:siteSchedule({type,event},i,random)}));
 const finds=(cave?[[-49,25],[1,14],[36,-12],[-8,-46],[58,49]]:[[-28,48],[-35,3],[5,-40],[49,-1],[-48,-60]]).map(([x,z])=>({x,z}));
 const ponds=(cave?[{x:-16,z:39,rx:11,rz:7,angle:.3},{x:27,z:-38,rx:11,rz:6,angle:-.65}]:[{x:5+offset,z:19,rx:6,rz:16,angle:.13},{x:9+offset,z:-7,rx:6,rz:13,angle:-.2}]);
 return{id,cave,seed,half,spawn:{...route[0]},route,sites,ponds,finds,
  landmarks:cave?[{x:-37,z:7,name:'月隙前厅',kind:'chamber'},{x:27,z:-3,name:'星辉主厅',kind:'chamber'},{x:-14,z:-63,name:'回晶深廊',kind:'chamber'}]:
   [{x:-19,z:31,name:'山口风钟',kind:'bell'},{x:-37,z:-15,name:'折溪古门',kind:'arch'},{x:29,z:-57,name:'回声钟庭',kind:'bell'}]};
}
export function authoredMapHeight(layout,x,z){
 const bell=!layout.cave;
 const ridge=(cx,cz,rx,rz,h)=>h*Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2)*2);
 let height=bell?ridge(-57,-4,28,52,6.5)+ridge(52,32,31,48,5.3)+ridge(40,-68,35,30,4.2):
  ridge(-54,-48,34,36,2.4)+ridge(49,36,29,37,2.1);
 // A broad designed shoulder, not uniform noise. Water and interaction feet
 // stay at the existing zero-height surface; no changes to movement rules.
 let clearance=1;
 for(const p of [layout.spawn,...layout.sites])clearance=Math.min(clearance,smooth(Math.hypot(x-p.x,z-p.z),7,15));
 for(const p of layout.ponds){
  const c=Math.cos(p.angle),s=Math.sin(p.angle),dx=x-p.x,dz=z-p.z,d=Math.hypot((c*dx-s*dz)/(p.rx*1.3),(s*dx+c*dz)/(p.rz*1.3));
  clearance=Math.min(clearance,smooth(d,1,1.7));
 }
 return height*clearance;
}
function buildFloor(world,layout){
 const positions=[],indices=[],colors=[],heights=new Float32Array((segments+1)**2),base=new T.Color(layout.cave?0x7c8189:0x516e44),path=new T.Color(layout.cave?0x97968f:0x8a8364);
 for(let iz=0;iz<=segments;iz++)for(let ix=0;ix<=segments;ix++){
  const x=-extent+ix*step,z=-extent+iz*step,y=authoredMapHeight(layout,x,z),i=iz*(segments+1)+ix;heights[i]=y;
  let routeDistance=Infinity;for(let j=1;j<layout.route.length;j++)routeDistance=Math.min(routeDistance,segmentDistance(x,z,layout.route[j-1].x,layout.route[j-1].z,layout.route[j].x,layout.route[j].z));
  const shade=.92+Math.sin(x*.047+Math.cos(z*.09))*.065+Math.cos(z*.08-x*.04)*.045;
  const color=base.clone().multiplyScalar(shade).lerp(path,(1-smooth(routeDistance,2,5.5))*.36);
  colors.push(color.r,color.g,color.b);positions.push(x,y,z);
  if(ix<segments&&iz<segments){const a=i,b=i+1,c=i+segments+1,d=c+1;indices.push(a,c,b,b,c,d);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
 const mat=layout.cave?caveFloor:material('floor-'+layout.id,0xffffff);mat.vertexColors=true;
 const ground=new T.Mesh(g,mat);ground.name='SM_Terrain_'+layout.id;ground.receiveShadow=true;ground.userData.ownedGeometry=true;world.group.add(ground);world.ground=ground;
 if(!layout.cave)installGroundSurface(ground,'forest');
 // Sample the exact rendered triangles (including the diagonal), in O(1).
 world.groundHeightAt=(x,z)=>{
  const u=T.MathUtils.clamp((x+extent)/step,0,segments-1e-6),v=T.MathUtils.clamp((z+extent)/step,0,segments-1e-6),ix=Math.floor(u),iz=Math.floor(v),fx=u-ix,fz=v-iz,a=iz*(segments+1)+ix,b=a+1,c=a+segments+1,d=c+1;
  return fx+fz<=1?heights[a]+(heights[b]-heights[a])*fx+(heights[c]-heights[a])*fz:heights[d]+(heights[c]-heights[d])*(1-fx)+(heights[b]-heights[d])*(1-fz);
 };
 world.authoredTerrain={heights,segments,extent};
}
function ownedMesh(group,geometry,mat,name){
 const m=new T.Mesh(geometry,mat);m.name=name;m.castShadow=m.receiveShadow=true;m.userData.ownedGeometry=true;group.add(m);return m;
}
function rock(world,x,z,rx,ry,rz,angle=0,cave=false){
 const m=new T.Mesh(naturalRockGeometry,cave?darkStone:stone);m.name='SM_Rock_'+(cave?'Cavern':'Valley');m.position.set(x,world.groundHeightAt(x,z)+ry*.54-.15,z);m.scale.set(rx,ry,rz);m.rotation.y=angle;m.castShadow=m.receiveShadow=true;world.group.add(m);
 // Conservatively cover the visible footprint, independent of camera detail.
 world.obstacles.push({x,z,r:Math.max(rx,rz)*.91,mesh:m,biome:world.weather.kind,sceneryHeight:world.groundHeightAt(x,z)+ry*1.5});
 return m;
}
function landmarkArch(world,p,scale=1,bell=true){
 const g=new T.Group();g.name=bell?'SM_Ruin_WindBell':'SM_Ruin_ValleyArch';g.position.set(p.x,world.groundHeightAt(p.x,p.z),p.z);world.group.add(g);
 const opening=7.8*scale,height=5.3*scale;
 for(const side of[-1,1]){
  const leg=ownedMesh(g,new T.CylinderGeometry(.58*scale,.90*scale,height,9,4),stone,'SM_BellGate_Pier');leg.position.set(side*opening/2,height/2,0);leg.rotation.z=side*.035;
  const base=ownedMesh(g,new T.CylinderGeometry(.94*scale,1.04*scale,.35*scale,8),edgeStone,'SM_BellGate_Foot');base.position.set(side*opening/2,.15*scale,0);
  world.obstacles.push({x:p.x+side*opening/2,z:p.z,r:1.1*scale,mesh:leg,sceneryHeight:g.position.y+height});
 }
 const curve=new T.CatmullRomCurve3([new T.Vector3(-opening/2,height-.25,0),new T.Vector3(-opening*.3,height+1.5*scale,0),new T.Vector3(0,height+2*scale,0),new T.Vector3(opening*.3,height+1.5*scale,0),new T.Vector3(opening/2,height-.25,0)]);
 const cap=ownedMesh(g,new T.TubeGeometry(curve,18,.48*scale,7,false),edgeStone,'SM_BellGate_Arch');cap.userData.placeOverhead=true;
 if(bell){
  const swing=new T.Group();swing.position.y=height+.5*scale;g.add(swing);world.newScenery.bells.push({mesh:swing,phase:p.x*.17});
  const profile=[[.15,.7],[.37,.6],[.46,.28],[.6,-.3],[.88,-.55],[.94,-.62]].map(([x,y])=>new T.Vector2(x*scale,y*scale));
  const shell=ownedMesh(swing,new T.LatheGeometry(profile,20),copper,'SM_Bell_Bronze');shell.userData.placeOverhead=true;
  const clapper=ownedMesh(swing,new T.CylinderGeometry(.08*scale,.14*scale,1.25*scale,8),copper,'SM_Bell_Clapper');clapper.position.y=-.1*scale;clapper.userData.placeOverhead=true;
 }
 return g;
}
function crystal(world,x,z,size,random,matIndex=0){
 const parts=[],dummy=new T.Object3D();
 for(let i=0;i<4;i++){
  const h=size*(i===0?1:.30+random()*.38),g=new T.CylinderGeometry(0,.20*h,h,5,1),angle=i*2.4;
  dummy.position.set(Math.sin(angle)*size*.24,h*.5,Math.cos(angle)*size*.24);dummy.rotation.set(Math.sin(angle)*.17,angle,Math.cos(angle)*.17);dummy.scale.set(1,1,1);dummy.updateMatrix();g.applyMatrix4(dummy.matrix);parts.push(g);
 }
 const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());const g=ownedMesh(world.group,geometry,crystals[matIndex%3],'SM_Crystal_Cluster');g.position.set(x,world.groundHeightAt(x,z),z);
 world.obstacles.push({x,z,r:Math.max(.38,size*.4),mesh:g,biome:'crystalcave',sceneryHeight:g.position.y+size});
 return g;
}
function caveVault(world,cx,cz,rx,rz,height,turn=0){
 const positions=[],indices=[],colors=[],base=new T.Color(0x89909a),rows=8,columns=34;
 // A high, broken barrel vault, open at both ends. Finite overhead collision
 // and wide lateral exits keep the existing movement and camera rules.
 for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
  const a=Math.PI*.08+i/columns*Math.PI*.84,z=(j/rows-.5)*rz*2,x=Math.cos(a)*rx,y=4.8+Math.sin(a)*height+Math.sin(i*1.7+j*.8)*.38;
  const xx=cx+x*Math.cos(turn)+z*Math.sin(turn),zz=cz-x*Math.sin(turn)+z*Math.cos(turn);
  positions.push(xx,world.groundHeightAt(xx,zz)+y,zz);const c=base.clone().multiplyScalar(.82+Math.sin(j*.7+i*.45)*.12+Math.sin(a)*.08);colors.push(c.r,c.g,c.b);
  if(i<columns&&j<rows){const p=j*(columns+1)+i;indices.push(p,p+1,p+columns+1,p+1,p+columns+2,p+columns+1);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
 const mesh=ownedMesh(world.group,g,vaultMaterial,'SM_Cavern_Vault');mesh.userData.placeOverhead=true;return mesh;
}
function caveEnvelope(world){
 // A connected weathered ceiling and continuous perimeter give every legal
 // camera direction a cavern silhouette, including the starting view. Walls
 // lie outside the playable square; no route or reward gains a new collider.
 const p=[],c=[],ix=[],n=40,size=103,shade=new T.Color(0x7f8791),roof=(x,z)=>19+3.1*Math.sin(x*.034+z*.012)+2.4*Math.cos(z*.044-x*.016);
 const vertex=(x,y,z,weight)=>{p.push(x,y,z);const q=shade.clone().multiplyScalar(weight);c.push(q.r,q.g,q.b);};
 for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
  const x=-size+col/n*size*2,z=-size+row/n*size*2,y=roof(x,z)+Math.sin(x*.22+z*.06)*.65+Math.cos(z*.18-x*.09)*.45;
  vertex(x,y,z,.87+.11*Math.sin(x*.057-z*.028));
  if(col<n&&row<n){const a=row*(n+1)+col;ix.push(a,a+1,a+n+1,a+1,a+n+2,a+n+1);}
 }
 const sides=112,rings=5,start=p.length/3;
 for(let j=0;j<=rings;j++)for(let i=0;i<=sides;i++){
  const a=i/sides*Math.PI*2,cs=Math.cos(a),sn=Math.sin(a),t=j/rings,r=(size+(1-t)*(.9+.75*Math.sin(a*11)))/Math.max(Math.abs(cs),Math.abs(sn)),x=cs*r,z=sn*r;
  vertex(x,-.8+(roof(x,z)+.8)*t,.0+z,.68+t*.26+.045*Math.sin(a*19+t*7));
  if(i<sides&&j<rings){const q=start+j*(sides+1)+i;ix.push(q,q+sides+1,q+1,q+1,q+sides+1,q+sides+2);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('color',new T.Float32BufferAttribute(c,3));g.setIndex(ix);g.computeVertexNormals();
 const m=ownedMesh(world.group,g,vaultMaterial,'SM_Cavern_ContinuousShell');m.userData.placeOverhead=true;
 // Broad diffuse cave fill is intentional. The shell need not create a single
 // enormous solid shadow over the whole map; local buttresses still cast.
 m.castShadow=false;return m;
}
function addGroundCover(world,layout,random){
 const grass=layout.cave?null:createAuthoredGrassPatch(),geometry=layout.cave?new T.OctahedronGeometry(1,0):grass.geometry,count=layout.cave?180:560,mat=layout.cave?crystals[0]:grass.material;
 const batch=new T.InstancedMesh(geometry,mat,count),dummy=new T.Object3D();batch.name=layout.cave?'SM_Crystal_Scatter':'SM_Grass_Valley';batch.userData.ownedGeometry=true;batch.receiveShadow=true;
 let used=0;
 for(let i=0;i<count*3&&used<count;i++){
  const x=(random()-.5)*178,z=(random()-.5)*178;
  if(world.obstacles.some(o=>Math.hypot(o.x-x,o.z-z)<o.r+.5)||layout.sites.some(p=>Math.hypot(p.x-x,p.z-z)<6)||world.ponds.some(p=>waterDepth(p,x,z)>0))continue;
  const h=layout.cave?.12+random()*.28:.9+random()*.8;
  dummy.position.set(x,world.groundHeightAt(x,z)+(layout.cave?h*.4:0),z);dummy.rotation.set(layout.cave?random():0,random()*Math.PI*2,layout.cave?random():0);dummy.scale.set(layout.cave?h*.5:h,h,layout.cave?h*.5:h);dummy.updateMatrix();batch.setMatrixAt(used++,dummy.matrix);
  if(!layout.cave)batch.setColorAt(used-1,new T.Color().setHSL(.22+random()*.045,.22,.34+random()*.09));
 }
 batch.count=used;batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();world.group.add(batch);
}
function addFinds(world,layout){
 for(const [i,{x,z}]of layout.finds.entries()){
  const mesh=new T.Group();mesh.position.set(x,world.groundHeightAt(x,z),z);mesh.visible=false;world.group.add(mesh);
  const marker=ownedMesh(mesh,layout.cave?new T.OctahedronGeometry(.27):new T.TorusGeometry(.22,.065,5,12),layout.cave?crystals[2]:copper,'SM_Find_'+layout.id);marker.position.y=.35;
  world.discoveries.push({id:layout.id,variant:'native',preparation:null,x,z,mesh,markers:[marker],nodes:[],availableAt:10+i*35,discovered:false,claimed:false,progress:0,phase:i*1.31});
 }
}
export function* buildNewExpeditionSteps(id,seed,{buildSites,makeWeather,trail}){
 const layout=newExpeditionLayout(id,seed),random=seeded(seed+4711),group=new T.Group();
 group.name='SM_Expedition_'+id;
 const world={half,group,spawn:layout.spawn,theme:MAPS[id],sites:layout.sites,obstacles:[],patches:[],ponds:[],foliage:[],motes:[],breakables:[],ice:[],fords:[],bridges:[],discoveries:[],roaming:[],biomePlaces:[],explorationLandmarks:[],explorationRoutes:[{biome:id,points:layout.route}],newScenery:{layout,bells:[],vaults:[]}};
 world.weather=makeWeather(id,random,group,world.spawn);world.weather.mesh.material=material('motes-'+id,layout.cave?0x8db5d4:0xd9c797,.8,0,layout.cave?0x446981:0x786b40);
 buildFloor(world,layout);yield{stage:'authored-ground'};
 world.ponds=yield* buildPondsSteps(group,id,random,world.spawn,world.sites,layout.ponds);world.patches.push(...world.ponds);
 const safe=(x,z,r)=>Math.abs(x)+r<half-2&&Math.abs(z)+r<half-2&&Math.hypot(x-world.spawn.x,z-world.spawn.z)>r+8&&world.sites.every(s=>Math.hypot(s.x-x,s.z-z)>r+9)&&layout.finds.every(p=>Math.hypot(p.x-x,p.z-z)>r+3.5)&&world.ponds.every(p=>waterDepth({...p,rx:p.rx+r+2,rz:p.rz+r+2,r:p.r+r+4},x,z)===0)&&layout.route.every((p,i)=>!i||segmentDistance(x,z,layout.route[i-1].x,layout.route[i-1].z,p.x,p.z)>r+4);
 if(layout.cave){
  world.newScenery.vaults.push(caveEnvelope(world));
  for(const [cx,cz,rx,rz,h,turn]of[[-37,22,28,21,13,-.35],[29,-8,31,25,18,.4],[-10,-59,29,19,14,-.15]])world.newScenery.vaults.push(caveVault(world,cx,cz,rx,rz,h,turn));
  // Curved, discontinuous buttresses partition three chambers, not a forest
  // recolour. Gaps of at least eight metres allow combat and broad flanking.
  for(let i=0;i<76;i++){
   if(i%8===0)yield{stage:'cavern-buttresses',completed:i,total:76};
   const ring=Math.floor(i/26),center=[[-37,22],[29,-8],[-10,-59]][ring],a=(i%26)/26*Math.PI*2+.12*ring,rx=ring===1?34:31,rz=ring===1?29:25,x=center[0]+Math.cos(a)*rx,z=center[1]+Math.sin(a)*rz,r=2.1+random()*1.4;
   if(safe(x,z,r)&&world.obstacles.every(o=>Math.hypot(x-o.x,z-o.z)>o.r+r*.65))rock(world,x,z,r,5+random()*5,r*.85,a,true);
  }
  for(let i=0;i<54;i++){
   const x=(random()-.5)*174,z=(random()-.5)*174,size=1.1+random()*3.3;
   if(safe(x,z,size*.4)&&world.obstacles.every(o=>Math.hypot(x-o.x,z-o.z)>o.r+size*.45+1))crystal(world,x,z,size,random,i);
   if(i%8===0)yield{stage:'crystal-groves',completed:i,total:54};
  }
 }else{
  // Two unequal broken ridges flank the authored S-shaped valley. The open
  // shoulders are real walkable terrain, with sparse high crowns above them.
  for(let i=0;i<38;i++){
   const side=i%2?-1:1,z=-80+(i>>1)*8.5,x=side*(44+Math.sin(z*.045)*12),r=2.6+random()*2.7;
   if(safe(x,z,r)&&world.obstacles.every(o=>Math.hypot(x-o.x,z-o.z)>o.r+r*.5))rock(world,x,z,r,2.4+random()*4.1,r*.7,side*.4);
   if(i%8===0)yield{stage:'valley-ridges',completed:i,total:38};
  }
  for(let i=0;i<54;i++){
   const x=(random()-.5)*174,z=(random()-.5)*174;
   if(!safe(x,z,1.6)||world.obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.r+3.8))continue;
   const tree=new T.Group();tree.position.set(x,world.groundHeightAt(x,z),z);group.add(tree);addTree(tree,'forest',4+random()*3.1,{bend:(random()-.5)*.16,variation:.8+random()*.35,angle:random()*6.28});world.obstacles.push({x,z,r:.7,mesh:tree,biome:id});
   for(const leaf of tree.children)if(leaf.userData.treeCanopy)world.foliage.push({leaf,x:leaf.position.x,z:leaf.position.z,phase:x*.17+z*.13});
   if(i%8===0)yield{stage:'valley-trees',completed:i,total:54};
  }
 }
 for(const [i,p]of layout.landmarks.entries()){
  const mesh=layout.cave?crystal(world,p.x,p.z,5.7+i*.9,random,i):landmarkArch(world,p,i===2?1.3:1,p.kind==='bell');
  world.explorationLandmarks.push({...p,biome:id,mesh,height:layout.cave?6.7:8.5});
 }
 if(id==='bellvale')addBellGate(world,world.sites.find(s=>s.event==='mechanism'),layout.landmarks[2]);
 buildSites(group,world.sites,world.theme);
 for(const s of world.sites){
  s.mesh.position.y=world.groundHeightAt(s.x,s.z);
  // updateSite reveals a real route cue together with every site. This is the
  // same owned mesh as existing worlds, fitted to the authored surface rather
  // than leaving a zero-height ribbon hidden under a hillside.
  s.trail=trail(group,world.spawn,s,id,random);s.trail.name='SM_SiteTrail_'+id;s.trail.visible=s.type==='relic';
  const p=s.trail.geometry.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,world.groundHeightAt(p.getX(i),p.getZ(i))+.012);
  p.needsUpdate=true;s.trail.geometry.computeVertexNormals();s.trail.geometry.computeBoundingSphere();
 }
 addFinds(world,layout);yield{stage:'expedition-rewards'};
 installRoaming(world,id,random);for(const r of world.roaming)r.mesh.position.y=world.groundHeightAt(r.x,r.z);
 addGroundCover(world,layout,random);yield{stage:'expedition-ground-cover'};
 // Existing campfire polishing expects these fields in every independent map.
 const camp=new T.Group();camp.position.set(world.spawn.x-3,world.groundHeightAt(world.spawn.x-3,world.spawn.z+2),world.spawn.z+2);group.add(camp);world.fire=camp;
 world.light=new T.PointLight(0xffbd7f,3,7,2);world.light.position.copy(camp.position).add(new T.Vector3(0,1.2,0));group.add(world.light);
 world.newScenery.triangles=0;group.traverse(o=>{if(o.isMesh)world.newScenery.triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});
 return world;
}
export function animateNewExpedition(world,time){
 for(const {mesh,phase}of world.newScenery?.bells||[])mesh.rotation.z=Math.sin(time*.58+phase)*.035+Math.sin(time*.93+phase)*.008;
}
