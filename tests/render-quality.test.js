import test from 'node:test';
import assert from 'node:assert/strict';
import {RENDER_QUALITY_KEY,RENDER_QUALITY_OPTIONS,normalizeRenderQuality,renderQualityProfile,readRenderQuality,saveRenderQuality} from '../render-quality.js';
import {RenderBudget,renderPixelRatio} from '../render-budget.js';
import {CinematicRenderer} from '../cinematic-renderer.js';

test('render preferences survive reload, reject unknown values and stay separate from the original game',()=>{
 const values=new Map([['forest3d-render-quality','high']]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 assert.equal(readRenderQuality(storage),'auto');
 for(const {id} of RENDER_QUALITY_OPTIONS){assert.equal(saveRenderQuality(id,storage),id);assert.equal(readRenderQuality(storage),id);}
 assert.equal(values.get('forest3d-render-quality'),'high');assert.equal(values.size,2);
 for(const value of ['constructor','toString','__proto__',undefined,null,2,{},'ultra']){
  values.set(RENDER_QUALITY_KEY,value);assert.equal(readRenderQuality(storage),'auto');assert.equal(normalizeRenderQuality(value),'auto');
 }
});

test('private mode and unavailable storage do not block rendering preferences',()=>{
 const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};
 assert.equal(readRenderQuality(denied),'auto');assert.equal(saveRenderQuality('balanced',denied),'balanced');
 assert.equal(readRenderQuality(null),'auto');assert.equal(saveRenderQuality('high',null),'high');
});

test('all quality profiles are bounded drawing budgets with separate desktop and phone limits',()=>{
 assert.deepEqual(RENDER_QUALITY_OPTIONS.map(o=>o.id),['auto','high','balanced','mobile']);
 for(const mobile of [false,true]){
  const p=Object.fromEntries(RENDER_QUALITY_OPTIONS.map(({id})=>[id,renderQualityProfile(id,mobile)]));
  assert(p.high.pixels>p.auto.pixels&&p.auto.pixels>p.balanced.pixels&&p.balanced.pixels>p.mobile.pixels);
  for(const profile of Object.values(p)){
   assert(Object.isFrozen(profile));assert(profile.pixels<=4150000&&profile.dpr<=1.75);
   assert(profile.postQuality>=.8&&profile.postQuality<=1,'presets retain the HDR/art pass at nominal load');
   assert(profile.shadowHz>=20&&profile.shadowHz<=30);
   assert.deepEqual(Object.keys(profile).sort(),['dpr','pixels','postQuality','shadowHz','targetFps']);
  }
  assert.equal(p.mobile.targetFps,30);assert.equal(p.mobile.dpr,1);
  assert.equal(p.auto.targetFps,mobile?30:60);
 }
 assert.equal(renderQualityProfile('bad'),renderQualityProfile('auto'));
});

test('automatic mode preserves the previous drawing formula and new modes respect device density',()=>{
 for(const mobile of [false,true])for(const [w,h,dpr]of [[1920,1080,1],[2560,1440,1.5],[3840,2160,2],[844,390,3],[390,844,3]])for(const quality of [1,.9,.65]){
  const legacy=Math.min(Math.max(.1,dpr),mobile?1.35:1.5,Math.sqrt((mobile?1800000:3200000)/(w*h)))*quality;
  assert.equal(renderPixelRatio(w,h,dpr,mobile,quality),legacy);
  for(const {id} of RENDER_QUALITY_OPTIONS){
   const b=new RenderBudget({mobile,mode:id});b.quality=quality;
   const ratio=b.pixelRatio(w,h,dpr);assert(ratio>0&&ratio<=dpr);assert(w*h*ratio*ratio<=b.profile.pixels+1);
   assert(ratio<=b.profile.dpr);assert.equal(b.postQuality,Math.min(quality,b.profile.postQuality));
  }
 }
 for(const input of [[0,0,NaN],[NaN,Infinity,Infinity],[-10,-2,-5]])assert(Number.isFinite(renderPixelRatio(...input)));
});

test('switching render modes resets old frame evidence without changing gameplay or mobile input identity',()=>{
 const b=new RenderBudget();for(let i=0;i<360;i++)b.sample(1/30);assert(b.quality<1);
 assert.equal(b.setMode('high'),true);assert.equal(b.quality,1);assert.equal(b.frames,0);assert.equal(b.elapsed,0);assert.equal(b.slow,0);
 b.quality=.85;assert.equal(b.setMode('high'),false);assert.equal(b.quality,.85,'same preference must not erase measured load');
 b.setMode('mobile');assert.equal(b.mobile,false,'render preference must not change mouse/phone input identity');
 for(let i=0;i<1800;i++)b.sample(1/30);assert.equal(b.quality,1);assert.equal(b.shadowHz,20);assert.equal(b.postQuality,.9);
 for(let i=0;i<240;i++)b.sample(1/20);assert(b.quality<1);
 b.setMode('auto');for(let i=0;i<360;i++)b.sample(1/30);assert(b.quality<1,'desktop target must be restored');
 const q=b.quality;for(let i=0;i<300;i++)b.sample(1/30,false);assert.equal(b.quality,q);
});

test('presets reuse the same cinematic resources, retain normal effects and recover from fallback',()=>{
 for(const mobile of [false,true]){
  const b=new RenderBudget({mobile}),r={extensions:{has:()=>true},capabilities:{maxSamples:4},info:{autoReset:true,reset(){}},width:1,height:1,target:null,passes:0,
   getDrawingBufferSize(v){return v.set(this.width,this.height);},getRenderTarget(){return this.target;},setRenderTarget(v){this.target=v;},render(){this.passes++;}};
  const c=new CinematicRenderer(r,{mobile}),original=[c.sceneTarget,c.glowA,c.glowB];
  try{
   for(const mode of ['high','balanced','mobile','auto','high']){
    b.setMode(mode);const ratio=b.pixelRatio(2560,1440,2);r.width=Math.floor(2560*ratio);r.height=Math.floor(1440*ratio);
    const passes=r.passes;c.render(()=>assert.equal(r.target,c.sceneTarget),b.postQuality);
    assert.equal(r.passes-passes,3);assert(c.sceneTarget.width*c.sceneTarget.height<=b.profile.pixels+1);assert.equal(c.sceneTarget.samples,mobile||['balanced','mobile'].includes(mode)?0:2);
    assert.deepEqual([c.sceneTarget,c.glowA,c.glowB],original);assert.equal(r.target,null);
   }
   b.quality=.7;c.render(()=>assert.equal(r.target,null),b.postQuality);for(const t of original)assert.equal(t.width*t.height,1);
   b.setMode('balanced');c.render(()=>assert.equal(r.target,c.sceneTarget),b.postQuality);assert(c.sceneTarget.width>1);
  }finally{c.dispose();}
 }
});
