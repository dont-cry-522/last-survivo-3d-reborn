// Synchronous owner scopes reuse the game's combat routines without sharing
// cooldowns, projectiles or upgrade drafts between room members.
export function createOwnerScope({capture,bind,save=(runtime,snapshot)=>Object.assign(runtime,snapshot)}){
 let active=null;
 return{run(runtime,fn){
  if(!runtime||typeof runtime!=='object'||typeof fn!=='function')throw new TypeError('Owner scope requires a runtime and function');
  if(Object.prototype.toString.call(fn)==='[object AsyncFunction]')throw new TypeError('Owner scope must be synchronous');
  const previous=capture(),parent=active;
  // Nested calls can re-enter the same owner after replacing an array.
  if(parent)save(parent,previous);
  let bound=false;
  try{
   bind(runtime);bound=true;active=runtime;
   const result=fn();
   if(result&&typeof result.then==='function')throw new TypeError('Owner scope cannot return a promise');
   return result;
  }finally{
   try{if(bound)save(runtime,capture());}
   // A -> B -> A may replace A's arrays while resolving B's death rewards.
   // The saved parent runtime includes that change; the entry snapshot is stale.
   finally{active=parent;bind(parent||previous);}
  }
 }};
}

const combatMarkFields=['shadowMark','scytheMarks','scytheMarkAt','lingyaMark'];
const isolatedTargets=new WeakSet();
// Room-only adapter: keep the monster's object identity for its AI, site guards,
// hit Sets and poison Maps, while combo marks belong to the attacking player.
export function isolateCombatMarks(target,ownerId){
 if(!target||typeof target!=='object'||typeof ownerId!=='function')throw new TypeError('Mark isolation requires a target and owner callback');
 if(isolatedTargets.has(target))return target;
 const marks=new Map(),initial={};
 for(const key of combatMarkFields){const property=Object.getOwnPropertyDescriptor(target,key);if(property?.configurable===false)throw new TypeError('Combat mark must be configurable');if(property&&Object.hasOwn(property,'value'))initial[key]=property.value;}
 if(Object.keys(initial).length)marks.set(ownerId(),initial);
 const current=()=>{const id=ownerId();if(!marks.has(id))marks.set(id,{});return marks.get(id);};
 for(const key of combatMarkFields)Object.defineProperty(target,key,{configurable:true,enumerable:true,get:()=>current()[key],set:value=>{current()[key]=value;}});
 isolatedTargets.add(target);return target;
}

// Keep one target identity for Maps/Sets used by poison, chains and melee.
// Accessors follow a replaced player/model rather than capturing stale objects.
export function createPlayerTarget(runtime,{height=p=>p.standHeight||1.8,ownerId=()=>null}={}){
 const target={boss:false,size:.45,radius:.45};
 const getPlayer=()=>runtime.player;
 const marked=()=>{
  runtime.marks??=new Map();
  const id=ownerId();
  if(!runtime.marks.has(id))runtime.marks.set(id,{});
  return runtime.marks.get(id);
 };
 const field=(key,get,set)=>Object.defineProperty(target,key,{enumerable:true,get,set});
 field('id',()=>`p:${runtime.id}`);
 field('playerId',()=>runtime.id);
 field('heroId',()=>runtime.heroId||getPlayer()?.heroId);
 field('kind',()=>runtime.heroId||getPlayer()?.heroId);
 field('mesh',()=>runtime.hero);
 field('alive',()=>!!getPlayer()&&getPlayer().hp>0&&!getPlayer().networkDead&&!runtime.networkDead);
 field('height',()=>height(getPlayer()||{},runtime));
 for(const key of ['x','y','z','vx','vz','hp','maxHp','hurt','groundHeight','standHeight','dashTime','mirageHidden'])
  field(key,()=>getPlayer()?.[key],value=>{if(getPlayer())getPlayer()[key]=value;});
 for(const [key,stored]of [['slow','hexSlow'],['stagger','networkStagger']])
  field(key,()=>getPlayer()?.[stored]||0,value=>{if(getPlayer())getPlayer()[stored]=value;});
 for(const key of combatMarkFields)
  field(key,()=>marked()[key],value=>{marked()[key]=value;});
 for(const key of ['burnTime','burnDamage'])
  field(key,()=>getPlayer()?.[key]||0,value=>{
   const p=getPlayer();if(!p)return;p[key]=value;
   // Decrementing a burn timer must not reattribute it to an unrelated tick.
   if(key==='burnDamage'&&value>0)p.burnOwnerId=ownerId();
  });
 field('burnOwnerId',()=>getPlayer()?.burnOwnerId,value=>{if(getPlayer())getPlayer().burnOwnerId=value;});
 return target;
}

const unsafeKeys=new Set(['__proto__','prototype','constructor']);
const referenceKeys=new Set(['mesh','scene','geometry','material','skeleton','parent','api','owner','target','enemy','command']);
const plain=value=>{const p=Object.getPrototypeOf(value);return p===Object.prototype||p===null;};

// This is a bounded wire projection, not a save-game serializer. References,
// getters and renderer resources never execute or cross the transport boundary.
export function snapshotValue(value,{maxDepth=6,maxArray=256}={}){
 maxDepth=Number.isFinite(maxDepth)?Math.max(0,Math.min(6,Math.floor(maxDepth))):6;
 maxArray=Number.isFinite(maxArray)?Math.max(0,Math.min(256,Math.floor(maxArray))):256;
 const ancestors=new Set();let remaining=4096;
 const copy=(v,depth)=>{
  if(remaining--<=0||depth>maxDepth)return undefined;
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number')return Number.isFinite(v)?v:undefined;
  if(typeof v==='string')return v.slice(0,4096);
  if(typeof v!=='object'||ancestors.has(v))return undefined;
  const array=Array.isArray(v);if(!array&&!plain(v))return undefined;
  if(['isObject3D','isMaterial','isBufferGeometry','isTexture'].some(key=>Object.getOwnPropertyDescriptor(v,key)?.value===true))return undefined;
  ancestors.add(v);
  try{
   const result=array?[]:{};
   const keys=array?Array.from({length:Math.min(v.length,maxArray)},(_,i)=>String(i)):Object.keys(v).slice(0,256);
   for(const key of keys){
    if(unsafeKeys.has(key)||referenceKeys.has(key))continue;
    const property=Object.getOwnPropertyDescriptor(v,key);
    const child=property&&Object.hasOwn(property,'value')?copy(property.value,depth+1):undefined;
    if(array)result.push(child??null);else if(child!==undefined)result[key]=child;
   }
   return result;
  }finally{ancestors.delete(v);}
 };
 return copy(value,0);
}

export function mergeSnapshot(target,snapshot,keys){
 if(!snapshot||typeof snapshot!=='object'||!plain(snapshot))return target;
 for(const key of keys){
  if(typeof key!=='string'||unsafeKeys.has(key)||referenceKeys.has(key))continue;
  const property=Object.getOwnPropertyDescriptor(snapshot,key);
  if(!property||!Object.hasOwn(property,'value'))continue;
  const value=snapshotValue(property.value);
  if(value!==undefined)target[key]=value;
 }
 return target;
}
