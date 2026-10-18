// Drawing budgets only. No profile changes actors, combat, scenery placement,
// animation timing, input, rewards, or the number of gameplay effects.
export const RENDER_QUALITY_KEY='forest3d-reborn-render-quality';
export const RENDER_QUALITY_OPTIONS=Object.freeze([
 Object.freeze({id:'auto',label:'自动',description:'根据设备与帧率调整清晰度，推荐首次使用。'}),
 Object.freeze({id:'high',label:'高画质',description:'提高轮廓与材质清晰度，负载过高时仍会自动稳帧。'}),
 Object.freeze({id:'balanced',label:'均衡',description:'兼顾清晰度与流畅度，保留光影、角色和战斗内容。'}),
 Object.freeze({id:'mobile',label:'移动',description:'降低画面像素开销，以稳定游玩为先，界面文字保持清晰。'})
]);

const profile=(pixels,dpr,targetFps,postQuality=1,shadowHz=targetFps===30?20:30)=>Object.freeze({pixels,dpr,targetFps,postQuality,shadowHz});
const profiles=Object.freeze({
 auto:Object.freeze([profile(3200000,1.5,60),profile(1800000,1.35,30)]),
 high:Object.freeze([profile(4150000,1.75,60),profile(2200000,1.5,30)]),
 balanced:Object.freeze([profile(2400000,1.25,60,.9,24),profile(1500000,1.15,30,.9)]),
 mobile:Object.freeze([profile(1100000,1,30,.9),profile(1100000,1,30,.9)])
});

export function normalizeRenderQuality(mode){return typeof mode==='string'&&Object.hasOwn(profiles,mode)?mode:'auto';}
export function renderQualityProfile(mode='auto',mobile=false){return profiles[normalizeRenderQuality(mode)][mobile?1:0];}
export function readRenderQuality(storage){
 try{return normalizeRenderQuality((storage===undefined?globalThis.localStorage:storage)?.getItem(RENDER_QUALITY_KEY));}catch{return 'auto';}
}
export function saveRenderQuality(mode,storage){
 mode=normalizeRenderQuality(mode);
 try{(storage===undefined?globalThis.localStorage:storage)?.setItem(RENDER_QUALITY_KEY,mode);}catch{/* Storage restrictions never block settings or play. */}
 return mode;
}
