import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {FramePacer} from '../frame-pacing.js';

const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const targetCode=source.slice(source.indexOf('function combatTargets('),source.indexOf('function aliveRoomOwners('))+source.slice(source.indexOf('function closestAutoTarget('),source.indexOf('function inflictStatus('));
function targeting(enemies,lock=null){
 const metrics={terrain:0,obstacles:0};
 const context=vm.createContext({enemies,boss:null,roomSession:null,roomOwner:null,player:{x:0,y:0,z:0},eyeHeight:1.5,autoTargetLock:lock,
  world:{groundHeightAt:()=>0,obstacles:[{}],breakables:[]},visibleEnemy:e=>e.alive!==false,
  segmentGroundEntry(from,to){metrics.terrain++;return to.y<0?0:null;},
  segmentHitsBody(x,y,z,tx,ty,tz){metrics.obstacles++;return tx<0;},Math});
 vm.runInContext(targetCode,context);
 return{pick:range=>vm.runInContext(`closestAutoTarget(${range})`,context),metrics};
}

test('auto aim retains nearest visible target, occlusion, lock preference and tie order',()=>{
 const near={x:4,z:0,height:2},locked={x:4.2,z:0,height:2},blocked={x:-2,z:0},buried={x:1,y:-4,z:0},dead={x:1,z:0,alive:false};
 assert.equal(targeting([blocked,buried,dead,locked,near]).pick(20),near);
 assert.equal(targeting([near,locked],locked).pick(20),locked);
 const tie={...near};assert.equal(targeting([near,tie]).pick(20),near);
 assert.equal(targeting([near]).pick(2),null);
 assert.equal(targeting([blocked,buried,dead]).pick(20),null);
});

test('auto aim skips terrain and obstacle scans for candidates unable to beat the best target',()=>{
 const nearest={x:2,z:0,height:2},crowd=[nearest,...Array.from({length:199},(_,i)=>({x:4+i*.04,z:1,height:2}))];
 const {pick,metrics}=targeting(crowd);assert.equal(pick(20),nearest);
 assert.equal(metrics.terrain,1);assert.equal(metrics.obstacles,1);
 // An occluded nearest candidate must not prevent a farther clear candidate.
 assert.equal(targeting([{x:-1,z:0},nearest]).pick(20),nearest);
});

test('real frame scheduling respects active/pause targets and excludes hidden/preparation time',()=>{
 // Execute the real frame entry with a sentinel at the rendering boundary.
 const entry=source.slice(source.indexOf('function frame(now){'),source.indexOf('if(renderWidth!==innerWidth',source.indexOf('function frame(now){')))+'draws.push({dt,active});requestAnimationFrame(frame);}';
 const pacer=new FramePacer(60);pacer.reset(0);
 const context=vm.createContext({framePacer:pacer,pacedState:'paused',preparing:false,state:'paused',last:0,document:{hidden:false},draws:[],scheduled:0,resets:0,
  renderBudget:{profile:{targetFps:60},sample(){context.resets++;}},requestAnimationFrame(){context.scheduled++;}});
 vm.runInContext(entry,context);
 const tick=now=>vm.runInContext(`frame(${now})`,context);
 for(let i=1;i<=120;i++)tick(i*1000/120);
 assert.equal(context.draws.length,30);assert.equal(context.scheduled,120);
 context.document.hidden=true;context.state='playing';tick(11000);
 assert.equal(context.draws.length,30);assert.equal(context.last,11000);assert.equal(context.resets,1);
 context.document.hidden=false;tick(11008);
 assert.equal(context.draws.length,30,'resume resets before consuming new time');
 tick(11016);assert.equal(context.draws.length,30,'120 Hz callbacks must not bypass the 60 Hz target');
 tick(11025);assert.equal(context.draws.length,31);assert(Math.abs(context.draws.at(-1).dt-.017)<1e-10);
 tick(11042);assert.equal(context.draws.length,32);
 context.preparing=true;tick(60000);assert.equal(context.draws.length,32);
 context.preparing=false;tick(60008);assert.equal(context.draws.length,32);
 tick(60017);assert.equal(context.draws.length,33);assert(Math.abs(context.draws.at(-1).dt-.017)<1e-10);
 context.renderBudget.profile.targetFps=30;const start=context.draws.length;
 for(let i=1;i<=120;i++)tick(60017+i*1000/120);
 assert.equal(context.draws.length-start,30,'mobile target applies to actual active frames');
});
