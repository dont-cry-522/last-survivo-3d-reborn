import {normalizeRenderQuality,renderQualityProfile} from './render-quality.js';

// The drawing buffer is independent of CSS pixels: HUD text remains native-resolution.
export function renderPixelRatio(width,height,dpr=1,mobile=false,quality=1,mode='auto'){
 const area=Math.max(1,Number.isFinite(width)?width:1)*Math.max(1,Number.isFinite(height)?height:1),profile=renderQualityProfile(mode,mobile);
 return Math.min(Math.max(.1,Number.isFinite(dpr)?dpr:1),profile.dpr,Math.sqrt(profile.pixels/area))*Math.max(.65,Math.min(1,Number.isFinite(quality)?quality:1));
}

export class RenderBudget{
 constructor({mobile=false,mode='auto'}={}){this.mobile=mobile;this.mode=null;this.setMode(mode);}
 setMode(mode){
  mode=normalizeRenderQuality(mode);if(this.mode===mode)return false;
  this.mode=mode;this.profile=renderQualityProfile(mode,this.mobile);this.quality=1;
  const mobileTarget=this.profile.targetFps===30;this.slowLimit=mobileTarget?.038:.0205;this.fastLimit=mobileTarget?.035:.0184;
  this.reset();return true;
 }
 pixelRatio(width,height,dpr=1){return renderPixelRatio(width,height,dpr,this.mobile,this.quality,this.mode);}
 get postQuality(){return Math.min(this.quality,this.profile.postQuality);}
 get shadowHz(){return this.quality<.8?20:this.profile.shadowHz;}
 reset(){this.warmup=1.5;this.elapsed=0;this.frames=0;this.slow=0;this.fast=0;}
 sample(dt,active=true){
  // Paused/hidden rendering has a different cadence from play. Keep the last
  // useful quality, but do not treat a 30 Hz pause screen as a slow desktop.
  if(!active||!Number.isFinite(dt)||dt<=0){this.reset();return false;}
  // Limit isolated suspension gaps without discarding sustained low-frame-rate samples.
  dt=Math.min(dt,.25);
  if(this.warmup>0){this.warmup-=dt;return false;}
  this.elapsed+=dt;this.frames++;if(this.elapsed<1)return false;
  const average=this.elapsed/this.frames;this.elapsed=0;this.frames=0;
  this.slow=average>this.slowLimit?this.slow+1:0;this.fast=average<this.fastLimit?this.fast+1:0;
  let next=this.quality;
  if(this.slow>=2)next=Math.max(.65,this.quality-.1);
  else if(this.fast>=10)next=Math.min(1,this.quality+.05);
  if(Math.abs(next-this.quality)<.001)return false;
  this.quality=Number(next.toFixed(2));this.reset();return true;
 }
}
