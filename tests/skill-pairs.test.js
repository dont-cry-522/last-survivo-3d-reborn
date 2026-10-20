import{test}from'node:test';
import assert from'node:assert/strict';
import{HeroSkills}from'../hero-skills.js';
import{skillPairState,skillPairHint,SKILL_PAIRS}from'../skill-catalog.js';
function rig(hero){
 const p={heroId:hero,x:0,z:0,upgrades:{}},foes=[],events=[],pet={alive:true,now:0};let active=true;
 const api={player:()=>p,foes:()=>foes,active:()=>active,blocked:()=>false,damage:(e,n)=>e.hp-=n,knock:()=>{},fx:e=>events.push(e),companion:()=>pet};
 const s=new HeroSkills(api),n=s.newHeroes;
 const foe=(x=0,z=2)=>{const e={x,z,hp:1000,alive:true};foes.push(e);return e;};
 return{p,api,s,n,events,pet,foe,step:dt=>{if(active)pet.now+=dt;s.update(dt)},pause:()=>active=false};
}
test('wake stacks salt once per enemy per field, can complete a burst and respects walls',()=>{
 const r=rig('tide');r.p.upgrades={wake:1,brine:1};const e=r.foe();r.n.hit(e);r.n.hit(e);r.n.dodge(.1);r.step(.11);assert.equal(e.hp,958);assert.equal(r.n.marks.get(e).count,0);
 for(let i=0;i<10;i++)r.step(.1);assert.equal(e.hp,958);assert.equal(r.n.marks.get(e).count,0);
 const blocked=r.foe(1,0);r.api.blocked=()=>true;r.step(.1);assert.equal(blocked.hp,1000);assert(!r.n.marks.has(blocked));
 r.api.blocked=()=>false;r.step(.1);assert.equal(blocked.hp,984);assert.equal(r.n.marks.get(blocked).count,1);
 r.step(4);assert.equal(r.n.fields.length,0);assert.equal(r.n.marks.size,0);
 const solo=rig('tide');solo.p.upgrades={wake:1};const s=solo.foe();solo.n.dodge(.1);solo.step(.11);assert.equal(s.hp,984);assert.equal(solo.n.marks.size,0);
});
test('briar marks for live partner, boosts followup once per cooldown and spares boss root',()=>{
 const r=rig('lingya');r.p.upgrades={briar:1,bond:1};const e=r.foe(0,0);e.boss=true;r.n.dodge(.5);r.step(.46);assert.equal(e.hp,980);assert(!e.stagger);assert(e.lingyaMark>r.pet.now);
 r.n.petHit(e);assert.equal(e.hp,955);assert(r.events.some(e=>e.kind==='bond'&&e.linked));r.n.petHit(e);assert.equal(e.hp,955);
 r.step(2.1);assert.equal(r.n.snared.size,0);r.n.petHit(e);assert.equal(e.hp,955);e.lingyaMark=r.pet.now+2;r.n.petHit(e);assert.equal(e.hp,935);
 const dead=rig('lingya');dead.p.upgrades={briar:1,bond:1};dead.pet.alive=false;const f=dead.foe(0,0);dead.n.dodge(.5);dead.step(.46);assert(!f.lingyaMark);assert.equal(dead.n.snared.size,0);dead.n.petHit(f);assert.equal(f.hp,980);
});
test('pause freezes pair states and prevents triggers; restart clears every pair state',()=>{
 const r=rig('lingya');r.p.upgrades={bond:1,briar:1};const e=r.foe(0,0);r.n.dodge(.4);r.step(.5);assert(r.n.snared.has(e));r.pause();const hp=e.hp,now=r.s.now,snared=r.n.snared.get(e);r.step(20);r.n.petHit(e);r.n.dodge(.4);assert.equal(e.hp,hp);assert.equal(r.s.now,now);assert.equal(r.n.snared.get(e),snared);assert.equal(r.n.pending.length,0);
 r.s.reset();assert.equal(r.n.marks.size,0);assert.equal(r.n.snared.size,0);assert.equal(r.n.fields.length,0);
});
test('all eight pairing guides show missing pieces and only new hero pairs claim bonuses',()=>{
 assert.equal(Object.keys(SKILL_PAIRS).length,8);for(const heroId of ['guardian','unknown','constructor','__proto__'])assert.equal(skillPairState({heroId}),null);assert.equal(skillPairHint({heroId:'guardian'},'fault'),'');
 for(const [hero,q]of Object.entries(SKILL_PAIRS)){const p={heroId:hero,upgrades:{}};assert.equal(skillPairState(p).missing.length,2);assert(skillPairHint(p,q.ids[0]).includes(q.name));p.upgrades[q.ids[0]]=1;assert.equal(skillPairState(p).missing.length,1);assert(skillPairHint(p,q.ids[1]).includes('选取后'));p.upgrades[q.ids[1]]=1;assert(skillPairState(p).active);assert(skillPairHint(p,q.ids[0]).includes('已成型'));assert.equal(skillPairHint(p,'power'),'');assert.equal(q.bonus,['tide','lingya'].includes(hero));}
});
