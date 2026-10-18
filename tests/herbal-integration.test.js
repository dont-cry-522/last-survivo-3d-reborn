import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weaponStats} from '../rules.js';
import {HerbalWaves,herbalFront,herbalPoint} from '../herbal-weapons.js';
import {MirageCombat} from '../mirage-combat.js';

test('fan wave thickness never damages a body entirely beyond the advertised range',()=>{
 const origin={x:0,y:1,z:0},world={half:64,obstacles:[],groundHeightAt:()=>0};
 for(const pathId of [null,'venomfan_return','venomfan_fold'])for(const fps of [15,30,60,120]){
  const w=weaponStats({weaponId:'venomfan',weaponPath:pathId?{id:pathId,rank:3}:null});
  // The first body intersects the maximum reach; the other starts 17.5 cm
  // outside it. A thick travelling wave must still honor its outer limit.
  const inside={x:0,y:0,z:w.range+.15,height:1.5,size:.5,alive:true};
  const outside={...inside,z:w.range+.45},hits=[];
  const waves=new HerbalWaves({active:()=>true,world:()=>world,foes:()=>[inside,outside],hit:(q,e)=>hits.push(e)});
  waves.cast(origin,{w,angle:0,pitch:0});
  for(let i=0;i<fps*2;i++)waves.update(1/fps);
  assert.equal(hits.filter(e=>e===outside).length,0,`${pathId||'base'} at ${fps} fps hit beyond ${w.range} m`);
  assert.equal(hits.filter(e=>e===inside).length,w.returning?2:1,`${pathId||'base'} lost a body intersecting the reach limit`);
 }
});

test('fan poison refresh ending the last boss cannot recreate effects after cleanup',()=>{
 // Execute the real production callback. Mirage's refresh can settle the
 // fraction of a poison tick between frames, after the direct hit survives.
 const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
 const callback=source.match(/const herbalWaves=new HerbalWaves\([\s\S]*?\n hit:([\s\S]*?),\r?\n draw:/)?.[1];
 assert(callback,'production fan callback not found');
 const effects=[],damageSources=[],player={heroId:'mirage',upgrades:{},x:0,z:0};
 const e={x:0,y:0,z:.8,height:1.5,size:.5,hp:20.25,alive:true};
 const world={half:64,obstacles:[],groundHeightAt:()=>0};
 let game,waves,mirage;
 const damage=(foe,n,flash,hit)=>{damageSources.push(hit.source||hit.kind);foe.hp-=n;if(foe.hp<=0){foe.alive=false;game.finish();waves.clear();mirage.reset();effects.length=0;}};
 mirage=new MirageCombat({player:()=>player,active:()=>game?.state==='playing',foes:()=>[e],damage});
 const api={hurtEnemy:damage,mirage,player,heroSkills:{onHit:()=>effects.push('skill')},vfx:{herbalHit:()=>effects.push('hit')},weaponRouteEffect:()=>effects.push('route'),sound:{impact:()=>effects.push('sound')}};
 game=new Function('api',`let state='playing';const {hurtEnemy,mirage,player,heroSkills,vfx,weaponRouteEffect,sound}=api;return {hit:${callback},finish(){state='won';},get state(){return state;}};`)(api);
 waves=new HerbalWaves({active:()=>game.state==='playing',world:()=>world,foes:()=>[e],hit:game.hit,draw:()=>effects.push('wave')});
 const w=weaponStats({weaponId:'venomfan'});
 mirage.attackHit(e,w);mirage.update(.05);
 assert.equal(e.hp,20.25,'setup must stop between regular poison ticks');
 waves.cast({x:0,y:1,z:0},{w,angle:0,pitch:0});waves.update(.05);
 assert.equal(game.state,'won');assert.equal(e.alive,false);
 assert.deepEqual(damageSources,['venomfan','mirage-needle']);
 assert.equal(waves.waves.length,0);assert.equal(mirage.marks.size,0);
 assert.deepEqual(effects,[],'no hit/route/skill/sound or wave may survive final-boss cleanup');
});

test('production fan draw damages standing breakables once across both legs, never ordinary scenery',()=>{
 const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
 const callback=source.match(/const herbalWaves=new HerbalWaves\([\s\S]*?\n draw:([\s\S]*?)\}\);\r?\n/)?.[1];
 assert(callback,'production fan draw callback not found');
 for(const props of[{tactic:'wall',state:'standing'},{},{tactic:'wall',state:'fallen'}]){
  const obstacle={x:0,y:0,z:2,r:.6,height:3,...props},world={half:64,obstacles:[obstacle],groundHeightAt:()=>0};
  const terrain=[],impacts=[];
  const api={world,herbalFront,herbalPoint,vfx:{herbalGust(){}},terrainHit:(o,n,origin)=>terrain.push({o,n,origin}),environmentImpacts:{contact:o=>({object:o}),hit:(w,contact)=>impacts.push(contact.object),ground(){}}};
  const draw=new Function('api',`const {world,herbalFront,herbalPoint,vfx,terrainHit,environmentImpacts}=api;return ${callback};`)(api);
  const waves=new HerbalWaves({active:()=>true,world:()=>world,foes:()=>[],hit(){},draw});
  const w=weaponStats({weaponId:'venomfan',weaponPath:{id:'venomfan_return',rank:3}}),origin={x:0,y:1,z:0};
  for(let cast=1;cast<=2;cast++){
   waves.cast(origin,{w,angle:0,pitch:0});
   for(let frame=0;frame<120;frame++)waves.update(1/60);
   assert.equal(waves.waves.length,0);assert.equal(impacts.length,cast,'surface feedback repeats on returning leg');
   assert.equal(terrain.length,props.tactic&&props.state==='standing'?cast:0,'only standing breakables take damage, once per cast');
  }
  for(const hit of terrain){assert.equal(hit.o,obstacle);assert.equal(hit.n,w.damage);assert.deepEqual(hit.origin,origin);}
 }
});
