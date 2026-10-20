import test from 'node:test';import assert from 'node:assert/strict';
import{HERO_DODGES,heroDodgePose,HERO_ABILITY_TEXT,dodgeTravel}from'../hero-dodge.js';
test('dive has a continuous submerge, hidden middle and emergence at the two second limit',()=>{assert.equal(HERO_DODGES.tide.duration,2);assert.equal(heroDodgePose('tide',2).depth,0);assert.equal(heroDodgePose('tide',1).depth,1);assert.equal(heroDodgePose('tide',0).depth,0);let previous=0;for(let i=0;i<=240;i++){const p=heroDodgePose('tide',2-i/120);assert(Object.values(p).every(Number.isFinite));assert(Math.abs(p.depth-previous)<.09);previous=p.depth;}});
test('abilities retain a cooldown beyond their active window and fade back to locomotion',()=>{for(const [kind,c]of Object.entries(HERO_DODGES)){assert(c.cooldown>c.duration);assert(HERO_ABILITY_TEXT[kind].length>30);assert.equal(heroDodgePose(kind,c.duration).weight,0);assert.equal(heroDodgePose(kind,0).weight,0);assert.equal(heroDodgePose(kind,0).height,0);}});
test('retired and unknown heroes have no special dodge or ability description',()=>{
 assert.deepEqual(Object.keys(HERO_DODGES),['minstrel','mirage','wuling','tide','lingya']);assert.deepEqual(Object.keys(HERO_ABILITY_TEXT),['minstrel','mirage','wuling','tide','lingya']);
 for(const id of ['guardian','unknown']){assert.equal(heroDodgePose(id,.5),null);assert.equal(dodgeTravel(id,.5),0);assert.equal(HERO_ABILITY_TEXT[id],undefined);}
 for(const id of ['constructor','__proto__']){assert.equal(heroDodgePose(id,.5),null);assert.equal(dodgeTravel(id,.5),0);}
});
