// Keep the display deadline separate from the real simulation clock. Moving
// the deadline to an ideal 30/60 Hz grid must never invent or discard game time.
const DEADLINE_EPSILON_MS=.1;

export class FramePacer{
 constructor(targetFps=60){this.targetFps=0;this.lastFrame=null;this.setTarget(targetFps);this.reset();}
 setTarget(targetFps){
  targetFps=targetFps===30?30:60;
  if(this.targetFps===targetFps)return;
  this.targetFps=targetFps;this.interval=1000/targetFps;
  this.nextFrame=this.lastFrame===null?null:this.lastFrame+this.interval;
 }
 // Reset at loading, visibility and pause/resume boundaries. Suspended wall
 // time is intentionally excluded; an ordinary skipped RAF is not a reset.
 reset(now){
  this.lastFrame=Number.isFinite(now)?now:null;
  this.nextFrame=this.lastFrame===null?null:this.lastFrame+this.interval;
 }
 // null: skip this RAF; a number: draw once and consume these real seconds.
 // The caller retains its existing small simulation steps for long frames.
 take(now,targetFps=this.targetFps){
  if(!Number.isFinite(now))return null;
  this.setTarget(targetFps);
  if(this.lastFrame===null||now<this.lastFrame){this.reset(now);return 0;}
  if(now<=this.lastFrame||now+DEADLINE_EPSILON_MS<this.nextFrame)return null;
  const seconds=(now-this.lastFrame)/1000;this.lastFrame=now;
  // Skip missed deadlines in O(1), rather than accumulating catch-up renders.
  const passed=Math.max(1,Math.floor((now-this.nextFrame+DEADLINE_EPSILON_MS)/this.interval)+1);
  this.nextFrame+=passed*this.interval;
  return seconds;
 }
}

// Preserve the existing <=40 ms combat step, including the old update/effects
// order. A 44–50 ms display interval now advances its full time in two steps.
// Explicit reset handles suspension; this bound is only a stall safety net.
export function advanceFrameSimulation(elapsed,update,updateEffects,isPlaying){
 if(!Number.isFinite(elapsed)||elapsed<=0)return 0;
 const duration=Math.min(elapsed,.12),steps=Math.ceil(duration/.04),dt=duration/steps;
 let advanced=0;
 for(let i=0;i<steps&&isPlaying();i++){
  update(dt);
  // Keep one effects update even if this step opens an upgrade/death dialog,
  // matching the previous single-step loop; no subsequent step runs paused.
  updateEffects(dt);advanced+=dt;
 }
 return advanced;
}
