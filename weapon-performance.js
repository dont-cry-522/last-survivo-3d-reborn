import{SCYTHE}from'./scythe-combat.js?v=230';
import{POISON}from'./poison-config.js?v=230';
import{MIRAGE}from'./mirage-config.js?v=230';
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,t)=>{const x=clamp((t-a)/(b-a));return x*x*(3-2*x);};
const pulse=(t,a,b,c)=>smooth(a,b,t)*(1-smooth(b,c,t));
export const WEAPON_RECOVERY={windbow:1.30,resonator:.72,mycelialwhip:.70,venomfan:.72,miasmalantern:.72,sporelantern:POISON.castRecovery,boomerang:.55,briarpot:.65,harpoon:.48,hammer:.7,rifle:.22,shotgun:.48,crossbow:.26,shuriken:.46,fire:.62,dark:.68,arcstaff:.18,shade:.36,shadowblade:SCYTHE.recovery,grimoire:.72};
// Combat compresses release with attack speed without a 120 ms animation floor.
export const weaponDuration=(id,period=1)=>Math.min(WEAPON_RECOVERY[id]||.3,Math.max(.001,period*.9));
// Cycle fractions also drive the audible mechanism cues, so haste preserves sync.
export const WEAPON_CUES={windbow:[],resonator:[],mycelialwhip:[.74],venomfan:[.70],miasmalantern:[],sporelantern:[.73],boomerang:[],briarpot:[],harpoon:[],hammer:[],rifle:[],shotgun:[.25,.6],crossbow:[.22,.68],shuriken:[.68],fire:[.68],dark:[.68],arcstaff:[],shade:[],shadowblade:[],grimoire:[.58]};
export function mirageShotDelay(rate){return Math.min(MIRAGE.releaseDelay,.3/Math.max(.01,rate));}
// One clock drives both held poses and their blade trails; damage timings stay unchanged.
export function meleeSwing(id,age,period=1){
 const hit=id==='shadowblade'?SCYTHE.hitFraction:.34,duration=weaponDuration(id,period),t=age/duration;
 const gather=pulse(t,0,hit*.42,hit),follow=smooth(hit*.48,hit+.19,t)*(1-smooth(.72,1,t));
 return{kick:pulse(t,hit*.20,hit,.95),gather,sweep:follow,cut:-.70*gather+follow,draw:0,
  // Weight transfer begins before the hands and fades into the original gait.
  body:smooth(0,.10,t)*(1-smooth(.65,1,t)),
  clipPhase:t<hit?clamp(t/hit)*.42:.42+clamp((t-hit)/(1-hit))*.58,
  recover:pulse(t,.60,.82,1),weight:1-smooth(.78,1,t),trail:t>hit*.46&&t<hit+.22};
}
export function weaponGesture(id,age,cycle=1,period=1){
  const t=age/weaponDuration(id,period);
  if(id==='windbow'){
    const pull=smooth(0,.39,t)*(1-smooth(.42,.49,t)),handPull=smooth(0,.39,t)*(1-smooth(.53,.79,t));
    return{pull,handPull,ready:smooth(0,.18,t)*(1-smooth(.66,1,t)),arrowVisible:t<.42||t>=.88,open:smooth(.42,.47,t)*(1-smooth(.72,.86,t)),kick:pulse(t,.30,.42,.78),sweep:0,draw:pull,gather:pull,body:smooth(0,.10,t)*(1-smooth(.78,1,t))};
  }
  if(id==='resonator')return{kick:pulse(t,.12,.32,.78),sweep:pulse(t,.16,.45,1),draw:0,gather:pulse(t,0,.14,.32),swing:-pulse(t,0,.14,.32)+pulse(t,.16,.45,1),body:smooth(0,.10,t)*(1-smooth(.78,1,t))};
  if(id==='mycelialwhip'||id==='venomfan')return herbalPose(id,age,period);
  // Rapid conduction has a small wrist pulse, with no overhead windup or sweep.
  if(id==='arcstaff')return{kick:pulse(t,0,.18,1),sweep:0,draw:0,gather:0};
  if(id==='briarpot')return{kick:pulse(t,.08,.24,.90),sweep:pulse(t,.16,.42,1),draw:0,gather:pulse(t,0,.10,.24),seedHeld:t<.24||t>.78};
  if(id==='miasmalantern'){
    const release=mirageShotDelay(1/period),settle=weaponDuration(id,period);
    return{kick:pulse(age,release*.40,release,settle),sweep:pulse(age,release*.55,release+(settle-release)*.23,settle),draw:0,gather:pulse(age,0,release*.42,release)};
  }
  if(id==='shadowblade'||id==='harpoon')return meleeSwing(id,age,period);
  if(id==='sporelantern')return{kick:pulse(t,0,POISON.releaseFraction,1),sweep:pulse(t,.18,.50,1),draw:0,gather:pulse(t,0,.13,POISON.releaseFraction),podHeld:t<POISON.releaseFraction||t>.76,open:smooth(POISON.releaseFraction-.04,POISON.releaseFraction+.025,t)*(1-smooth(.58,.76,t))};
  if(id==='boomerang')return slingshotMechanism(age,period);
  const peak={boomerang:.24,harpoon:.34,rifle:.10,shotgun:.14,crossbow:.12,shuriken:.24,fire:.3,dark:.4,shade:.18,shadowblade:.32,grimoire:.46}[id]||.2;
  return {kick:pulse(t,0,peak,1),sweep:pulse(t,.04,peak+.12,1),
    draw:age<period&&cycle<1?pulse(cycle,.12,id==='crossbow'?.53:.42,id==='crossbow'?.82:.78):0,
    gather:pulse(t,.38,.68,1)};
}
// Authored phase curves for the two herbal tools. The torso leads, the wrist
// crosses the target once, then the free end settles. No full-circle rotation.
export function herbalPose(id,age,period=1,combo=0,path=''){
 const phase=clamp(age/weaponDuration(id,period)),whip=id==='mycelialwhip',hit=whip?.42:.32,side=combo%2?-1:1,fold=path==='venomfan_fold';
 const gather=pulse(phase,0,hit*.43,hit),kick=pulse(phase,hit*.42,hit,.88),sweep=smooth(hit*.48,hit+.17,phase)*(1-smooth(.70,1,phase)),weight=smooth(0,.07,phase)*(1-smooth(.78,1,phase));
 const cut=-.66*gather+sweep;
 return{phase,gather,kick,sweep,weight,body:weight,draw:0,side,fold,
  snap:pulse(phase,.17,hit,.82),open:fold?.12+.24*gather:.48+.52*pulse(phase,0,.18,.94),
  x:whip?-.27+side*(-.10*gather+.30*sweep):fold?-.23+.015*kick:-.23+side*(-.10*gather+.18*sweep),
  y:whip?-.22+.15*gather+.05*kick-.06*sweep:fold?-.18+.025*kick:-.19+.075*gather-.025*sweep,
  z:whip?.16-.12*gather+.18*kick:fold?.16-.08*gather+.33*kick:.19-.045*gather+.12*kick,
  yaw:whip?side*(-.62*gather+.61*sweep):fold?.04*gather:side*(-.36*gather+.52*sweep),
  pitch:whip?.10+.28*gather-.15*kick:fold?-.75*kick+.08*gather:.10+.18*gather-.16*kick,
  roll:whip?-.12+side*(-.27*gather+.36*sweep):fold?-.06:side*(.10+.30*cut),
  torso:whip?side*(-.32*gather+.30*sweep):fold?-.08*gather+.10*kick:side*(-.19*gather+.22*sweep)};
}
// Old weapon id is retained for saves. The sling remains held: draw, release the
// pouch at the existing .24 release fraction, then bring the empty fingers back.
export function slingshotMechanism(age=10,period=1){
 const duration=Math.min(.55,Math.max(.001,period*.9)),t=clamp(age/duration),draw=smooth(0,.20,t),pull=draw*(1-smooth(.24,.34,t));
 return{pull,handPull:draw*(1-smooth(.48,.80,t)),open:smooth(.22,.27,t)*(1-smooth(.64,.82,t)),stoneVisible:t<.24||t>=.82,
  kick:pulse(t,.20,.28,.65),sweep:0,gather:pull,draw:pull,weight:smooth(0,.10,t)*(1-smooth(.72,1,t))};
}
export function shotStarted(d,attack,previous){
  const fired=d.shotSerial===undefined?attack>previous+.025:d.shotSerial!==(d.lastShotSerial||0);
  d.lastShotSerial=d.shotSerial;return fired;
}

export function weaponCuePhases(id,period){const scale=['crossbow','shotgun','rifle'].includes(id)?1:weaponDuration(id,period)/period;return (WEAPON_CUES[id]||[]).map(t=>t*scale);}

// Reload is driven by the existing attack cycle. The string catches at the rear
// while the support hand returns below the stock; it must not spring forward a
// second time before the next actual shot.
export function crossbowMechanism(phase=1){
 const p=clamp(phase);
 return{pull:.30*smooth(.22,.60,p),hand:smooth(.12,.22,p)*(1-smooth(.66,.88,p)),boltVisible:p>.72};
}

// Rear grip / shaft poses: diagonal carry, shoulder preparation, cutting pass,
// follow-through below the target, then an unloaded return. Both hands follow
// this single rigid pole; the blade never swings independently of the shaft.
const SCYTHE_REST=[-.20,-.28,.28,.12,.12,-1.16,0];
const SCYTHE_POSES=[
 // Horizontal cuts translate the hands across the body. A nearly fixed bank
 // keeps the blade on one cutting plane instead of twirling the shaft in place.
 [[-.42,-.25,.20,-.20,.10,-1.10,.22],[-.16,-.26,.37,.12,.12,-1.16,0],[.20,-.28,.28,.50,.15,-1.22,-.28],[-.03,-.42,.18,.26,.12,-1.18,-.12]],
 [[.18,-.25,.20,.50,.15,-1.22,-.22],[-.16,-.26,.37,.12,.12,-1.16,0],[-.43,-.28,.28,-.20,.10,-1.10,.28],[-.30,-.42,.18,-.02,.12,-1.14,.12]],
 [[-.15,-.05,.20,-.80,-.48,-.34,.16],[-.16,-.23,.41,-1.53,.25,-.08,-.10],[-.10,-.43,.32,-1.80,.76,-1.22,-.22],[-.19,-.40,.19,-.35,.24,-1.66,-.10]]
];
const SCYTHE_TIMES=[0,.24,SCYTHE.hitFraction,.62,.80,1];
export function scythePose(age,period=1,combo=0){
 const duration=weaponDuration('shadowblade',period),t=clamp(age/duration),frames=[SCYTHE_REST,...SCYTHE_POSES[combo===1?1:combo===2?2:0],SCYTHE_REST];
 let i=0;while(i<4&&t>SCYTHE_TIMES[i+1])i++;
 const span=SCYTHE_TIMES[i+1]-SCYTHE_TIMES[i],u=(t-SCYTHE_TIMES[i])/span,u2=u*u,u3=u2*u,pose={};
 // Time-aware Hermite tangents keep velocity through contact; only idle endpoints
 // stop. Independent smoothsteps would visibly brake at every authored pose.
 for(const[k,name]of ['x','y','z','yaw','pitch','roll','torso'].entries()){
  const a=frames[i][k],b=frames[i+1][k],ma=i?(b-frames[i-1][k])/(SCYTHE_TIMES[i+1]-SCYTHE_TIMES[i-1]):0,mb=i<4?(frames[i+2][k]-a)/(SCYTHE_TIMES[i+2]-SCYTHE_TIMES[i]):0;
  pose[name]=(2*u3-3*u2+1)*a+(u3-2*u2+u)*span*ma+(-2*u3+3*u2)*b+(u3-u2)*span*mb;
 }
 return pose;
}
