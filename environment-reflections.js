import * as T from './vendor/three.module.js';
import {HDRLoader} from './vendor/HDRLoader.js';

export const REFLECTION_ASSETS={forest:'assets/environment/lighting/forest-1k.hdr',sky:'assets/environment/lighting/sky-1k.hdr'};
export const REFLECTION_STRENGTH={forest:.30,snow:.36,ash:.17,sand:.29,coast:.38,bellvale:.28,crystalcave:.17};

// Keep the photographed sky broad and soft. The existing directional sun owns
// the sharp lighting and the only shadow map, rather than a second HDR sun.
export function softenReflectionData(data){
 const values=[];
 for(let i=0;i<data.length;i+=64){const y=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;if(Number.isFinite(y))values.push(y);}
 values.sort((a,b)=>a-b);
 const middle=values.slice(Math.floor(values.length*.1),Math.ceil(values.length*.9));
 const mean=middle.reduce((n,v)=>n+v,0)/Math.max(1,middle.length),scale=.65/Math.max(.02,mean);
 for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){const v=Math.max(0,Number.isFinite(data[i+c])?data[i+c]*scale:0);data[i+c]=v/(1+v/12);}
 return data;
}

export function reflectionPixels(image,mobile=false){
 if(!mobile||image.width<=512)return image;
 const width=image.width/2,height=image.height/2,data=new Float32Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){
  const a=((y*2)*image.width+x*2)*4+c,b=a+image.width*4;
  data[(y*width+x)*4+c]=(image.data[a]+image.data[a+4]+image.data[b]+image.data[b+4])*.25;
 }
 return{width,height,data};
}

export class EnvironmentReflections{
 constructor(renderer,scene,{mobile=false}={}){this.renderer=renderer;this.scene=scene;this.mobile=mobile;this.maps={};this.current=null;this.disposed=false;this.fade=0;scene.environmentIntensity=0;}
 async load(){
  const generator=new T.PMREMGenerator(this.renderer),loader=new HDRLoader().setDataType(T.FloatType);
  try{
   // One GPU conversion at a time; retain only the small, filtered cube maps.
   for(const [key,path]of Object.entries(REFLECTION_ASSETS)){
    let source;
    try{source=await loader.loadAsync(new URL(path,import.meta.url).href);if(this.disposed)break;source.image=reflectionPixels(source.image,this.mobile);softenReflectionData(source.image.data);source.image.data=Uint16Array.from(source.image.data,T.DataUtils.toHalfFloat);source.type=T.HalfFloatType;source.needsUpdate=true;this.maps[key]=generator.fromEquirectangular(source);}
    catch(error){console.warn('Local environment reflection unavailable:',key,error.message);}
    finally{source?.dispose();}
   }
   return Object.keys(this.maps).length>0;
  }finally{generator.dispose();}
 }
 update(id,weights,day=1,dt=0){
  if(this.disposed)return;
  const forest=weights?.forest??(id==='forest'||id==='confluence'?1:0);
  const preferred=forest>.5?'forest':'sky',target=this.maps[preferred]?preferred:Object.keys(this.maps)[0];
  if(!target)return;
  let intensity=0;
  for(const [biome,value]of Object.entries(REFLECTION_STRENGTH))intensity+=value*(weights?.[biome]??(biome===(id==='confluence'?'forest':id)?1:0));
  intensity*=.22+.78*day;
  const step=dt>0?Math.min(1,dt*4):1;
  // Map builds/prewarm use dt=0 and need the final shader variant immediately.
  if(dt<=0||!this.current){this.current=target;this.scene.environment=this.maps[target].texture;this.fade=1;}
  else if(this.current!==target&&this.fade>.001){this.fade=Math.max(0,this.fade-step);}
  else{if(this.current!==target){this.current=target;this.scene.environment=this.maps[target].texture;}this.fade=Math.min(1,this.fade+step);}
  this.scene.environmentIntensity=intensity*this.fade;
  // Reflections remain world-fixed as the player turns. Both cameras use this scene.
  this.scene.environmentRotation.y=this.current==='forest'?.42:-.65;
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.scene.environment=null;for(const target of Object.values(this.maps))target.dispose();this.maps={};}
}
