import * as T from './vendor/three.module.js';

// Frame the equipped hero inside the selected map, leaving room for preparation UI.
export class HeroPreview {
 constructor(renderer,element){
  this.renderer=renderer;this.element=element;
  this.compileScene=new T.Scene();
  this.camera=new T.PerspectiveCamera(35,1,.1,70);
  this.fill=new T.PointLight(0xe7edf1,3,4.5,2);
  this.edge=new T.PointLight(0xd6e4f1,2.4,4,2);
  this.fill.name='Light_HeroPreview_SoftFill';this.edge.name='Light_HeroPreview_Rim';
  this.yaw=0;this.landscapeYaw=.66;this.portrait=false;this.clipFrustum=new T.Frustum();this.renderer.localClippingEnabled=true;
  this.full=document.querySelector('#preview-full');this.detail=document.querySelector('#preview-detail');
  this.full.onclick=()=>this.setPortrait(false);this.detail.onclick=()=>this.setPortrait(true);
  element.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.pointer={id:e.pointerId,x:e.clientX};element.setPointerCapture(e.pointerId);});
  element.addEventListener('pointermove',e=>{if(this.pointer?.id!==e.pointerId)return;this.yaw+=(e.clientX-this.pointer.x)*.009;this.pointer.x=e.clientX;this.needsFit=true;});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(type,()=>{this.pointer=null;});
  element.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();this.yaw=e.key==='Home'?0:this.yaw+(e.key==='ArrowLeft'?-.18:.18);this.needsFit=true;});
 }
 setPortrait(value){this.portrait=value;this.full.setAttribute('aria-pressed',String(!value));this.detail.setAttribute('aria-pressed',String(value));}
 async compileSceneAsync(scene,hero,pet){
  await this.render(scene,hero,pet,(scene,camera)=>{
   const r=this.renderer,autoClear=r.autoClear;
   const actors=[hero,pet].filter(o=>o?.parent).map(object=>({object,parent:object.parent,index:object.parent.children.indexOf(object)}));
   try{
    // Environment materials have no local preview planes. Compiling the whole
    // scene with the last actor's four-plane state creates unused programs and
    // makes the first real forest draw compile again synchronously.
    for(const {object}of actors)object.removeFromParent();
    r.autoClear=false;r.render(this.compileScene,camera);
    return r.compileAsync(scene,camera);
   }finally{
    r.autoClear=autoClear;
    for(const {object,parent,index}of actors){parent.add(object);parent.children.splice(index,0,parent.children.pop());}
   }
  });
  await this.compileAsync(scene,hero,pet);
  if(pet)await this.compileAsync(scene,hero,pet,pet);
 }
 compileAsync(scene,hero,pet,subject=hero){
  return this.render(scene,hero,pet,(scene,camera)=>{
   const r=this.renderer,planes=r.clippingPlanes,autoClear=r.autoClear;
   try{
    // compileAsync reads the last render's clipping counts. An empty draw sets
    // the same four union planes as the portrait, without drawing or clearing.
    r.clippingPlanes=[...planes,...this.clipFrustum.planes.slice(0,4)];
    r.autoClear=false;r.render(this.compileScene,camera);
    // A subject may contain several pending heroes. Plane positions are uniforms;
    // all portrait materials need the same four-plane variant primed above.
    // The target scene supplies the real lights, fog and environment.
    return r.compileAsync(subject,camera,scene);
   }finally{r.clippingPlanes=planes;r.autoClear=autoClear;}
  });
 }
 render(scene,hero,pet,draw=(scene,camera)=>this.renderer.render(scene,camera)){
  const rect=this.element.getBoundingClientRect(),width=innerWidth,height=innerHeight;
  if(rect.width<=0||rect.height<=0)return;
  const petPosition=pet?.position.clone(),petVisible=pet?.visible,fogDensity=scene.fog?.density,clippedMaterials=new Map(),autoMatrix=scene.matrixWorldAutoUpdate;
  try{
   // Soft distant haze frames the nearby landmark and bounds menu draw distance.
   if(scene.fog?.isFogExp2)scene.fog.density=Math.max(fogDensity,.028);
   if(pet)pet.position.set(hero.position.x+Math.cos(this.landscapeYaw)*1.25,hero.position.y,hero.position.z-Math.sin(this.landscapeYaw)*1.25);
   scene.updateMatrixWorld(true);
   if(this.hero!==hero||this.needsFit){
    this.needsFit=false;
    this.hero=hero;this.bounds=new T.Box3().setFromObject(hero,true);
    if(pet)this.bounds.union(new T.Box3().setFromObject(pet,true));
   }
   let bounds=this.bounds;
   if(this.portrait){const head=(hero.userData.swimHead||hero.userData.head).getWorldPosition(new T.Vector3()),top=this.bounds.max.y;bounds=new T.Box3(new T.Vector3(head.x-.35,top-.83,head.z-.30),new T.Vector3(head.x+.35,top+.025,head.z+.30));}
   const center=bounds.getCenter(new T.Vector3()),direction=new T.Vector3(Math.sin(this.landscapeYaw),this.portrait?.22:.48,Math.cos(this.landscapeYaw)).normalize();
   this.camera.clearViewOffset();this.camera.aspect=rect.width/rect.height;
   this.camera.position.copy(center).add(direction);this.camera.lookAt(center);this.camera.updateMatrixWorld(true);
   const right=new T.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new T.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);
   const tanV=Math.tan(T.MathUtils.degToRad(this.camera.fov/2)),tanH=tanV*this.camera.aspect;
   let distance=0;
   for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z]){
    const p=new T.Vector3(x,y,z).sub(center),depth=p.dot(direction);
    distance=Math.max(distance,Math.abs(p.dot(right))*1.14/tanH+depth,Math.abs(p.dot(up))*1.14/tanV+depth);
   }
   this.camera.position.copy(center).addScaledVector(direction,distance);
   {
    // Both views share this four-plane program. Fullbody framing already has
    // 14% breathing room, so this only bounds the actor to its preview area.
    this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);this.clipFrustum.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse));
    const planes=this.clipFrustum.planes.slice(0,4);
    for(const root of [hero,pet])root?.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!clippedMaterials.has(m))clippedMaterials.set(m,m.clippingPlanes);m.clippingPlanes=planes;}});
    if(this.portrait&&pet)pet.visible=false;
   }
   // Extend the portrait's view over the whole page: one continuous landscape,
   // with the hero still centered in the reserved area (including mobile scroll).
   this.camera.setViewOffset(rect.width,rect.height,-rect.left,-rect.top,width,height);
   this.camera.updateMatrixWorld(true);
   // The map's sun remains the key. Two local, unshadowed lights preserve facial
   // planes and separate dark hair/cloth from the real landscape behind it.
   const kind=hero.userData.kind,cold=kind==='silver'||kind==='wraith',warm=kind==='lingya';
   this.fill.color.set(warm?0xffe8d1:cold?0xe4e9f5:0xe7edf1);
   this.fill.intensity=kind==='wraith'?3.0:cold?3.15:warm?3.0:3.2;
   this.fill.position.copy(center).addScaledVector(direction,cold?1.65:1.8).addScaledVector(right,cold?1.05:warm?.42:.6);this.fill.position.y+=cold?.75:warm?.46:.55;scene.add(this.fill);
   this.edge.color.set(cold?0xcbdcf0:warm?0xffdec0:0xdce6e8);
   this.edge.position.copy(center).addScaledVector(direction,-.9).addScaledVector(right,-1.05);this.edge.position.y+=.9;
   scene.add(this.edge);
   // Update only the new lights; do not repeat the full world matrix traversal.
   this.fill.updateMatrixWorld();this.edge.updateMatrixWorld();scene.matrixWorldAutoUpdate=false;
   return draw(scene,this.camera);
  }finally{
   scene.matrixWorldAutoUpdate=autoMatrix;
   if(fogDensity!==undefined)scene.fog.density=fogDensity;
   this.fill.removeFromParent();this.edge.removeFromParent();
   for(const [material,planes] of clippedMaterials)material.clippingPlanes=planes;
   if(pet){pet.visible=petVisible;pet.position.copy(petPosition);pet.updateMatrixWorld(true);}
  }
 }
}
