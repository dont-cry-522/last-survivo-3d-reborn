import test from 'node:test';
import assert from 'node:assert/strict';
import {JOURNAL_KEY,RELICS,readJournal,writeJournal,recordVictory} from '../expedition.js';

// Full accepted v227 journal domain (818f019), including the legacy hammer
// entry. Removed heroes must not erase an already earned historical victory.
const oldMaps=['forest','snow','ash','sand','coast','confluence'];
const oldWeapons=['mycelialwhip','venomfan','arcstaff','briarpot','boomerang','harpoon','hammer','rifle','shotgun','fire','crossbow','shuriken','dark','shade','shadowblade','grimoire','sporelantern','miasmalantern'];
const oldWins=oldMaps.flatMap(map=>oldWeapons.map(weapon=>map+':'+weapon));
function fixture(){
 const journal={relics:Object.keys(RELICS),wins:[...oldWins]};
 const values=new Map([
  ['forest-echoes-reborn-expedition-v1',JSON.stringify(journal)],
  ['forest-echoes-expedition-v1','original-game-record'],
  ['forest-echoes-next-expedition-v1','next-game-record'],
  ['forest3d-reborn-audio','saved-audio-settings'],
  ['forest3d-reborn-discovered-enemies','["wolf","boss","frostWolf"]']
 ]);
 const writes=[];
 return{journal,values,writes,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push(key);values.set(key,value);}}};
}
test('v228 reads all 108 accepted v227 victories and relics without migrating or deleting records',()=>{
 const f=fixture();assert.equal(JOURNAL_KEY,'forest-echoes-reborn-expedition-v1');
 assert.equal(oldWins.length,108);assert.deepEqual(readJournal(f.storage),f.journal);assert.deepEqual(f.writes,[]);
 assert(writeJournal(f.storage,readJournal(f.storage)));
 assert.deepEqual(readJournal(f.storage),f.journal);assert.deepEqual(f.writes,[JOURNAL_KEY]);
});
test('new map and minstrel victories append to the old journal without overwriting settings or other games',()=>{
 const f=fixture(),untouched=new Map([...f.values].filter(([key])=>key!==JOURNAL_KEY)),journal=readJournal(f.storage);
 for(const map of ['bellvale','crystalcave'])for(const weapon of [...oldWeapons,'windbow','resonator'])assert(recordVictory(journal,map,weapon));
 for(const map of oldMaps)for(const weapon of ['windbow','resonator'])assert(recordVictory(journal,map,weapon));
 assert.equal(recordVictory(journal,'bellvale','windbow'),false,'same victory is not awarded twice');
 assert(writeJournal(f.storage,journal));
 const restored=readJournal(f.storage);assert.deepEqual(restored,journal);assert.equal(restored.wins.length,160);
 assert.deepEqual(restored.wins.slice(0,108),oldWins);
 for(const [key,value]of untouched)assert.equal(f.values.get(key),value,key);
});
test('new map admission does not accept arbitrary victories or inject battle-state persistence',()=>{
 const f=fixture(),journal=readJournal(f.storage);
 for(const [map,weapon]of [['unknown-map','windbow'],['forest','unknown-weapon'],['__proto__','resonator']])assert.equal(recordVictory(journal,map,weapon),false);
 assert(writeJournal(f.storage,journal));const stored=JSON.parse(f.values.get(JOURNAL_KEY));
 assert.deepEqual(Object.keys(stored).sort(),['relics','wins']);
});
