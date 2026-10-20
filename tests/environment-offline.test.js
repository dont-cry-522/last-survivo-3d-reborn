import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {roomRuntimeFixture} from './helpers/offline-room-fixture.js';

const root=new URL('../',import.meta.url),prefix='assets/environment/models/',
 delivered=['weathered-rock-a.glb','weathered-rock-b.glb','old-stump.glb','sources.json','LICENSE.txt','CC0-1.0.txt'],
 forestPrefix='assets/environment/forest-reborn/',
 forestFiles=['bark-color-1k.jpg','bark-normal-1k.jpg','bark-roughness-1k.jpg','mossRock-color-1k.jpg','mossRock-normal-1k.jpg','mossRock-roughness-1k.jpg','sources.json','LICENSE.txt'],
 treePrefix='assets/environment/forest-trees-v222/',
 treeFiles=['woodland-canopy.glb','leaning-canopy.glb','sources.json','LICENSE.txt','CC0-1.0.txt'];

test('offline export includes approved models and all eight forest PBR resources, invalidates changed assets and excludes source archives',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forest-environment-offline-'));
 const put=(path,data)=>writeFileSync(join(folder,path),data),copy=path=>copyFileSync(new URL(path,root),join(folder,path));
 try{
  for(const dir of ['scripts','vendor','assets/bestiary','assets/icons','assets/audio','assets/environment/models','assets/environment/lighting','assets/environment/forest-reborn',treePrefix,'assets/characters/rebuilt-v215'])mkdirSync(join(folder,dir),{recursive:true});
  copy('scripts/build-offline.mjs');copy('scripts/offline-worker.txt');
  put('package.json','{"type":"module"}');put('index.html','<script type="module" src="./main.js?v=1"></script>');put('main.js','export const version=1;');
  put('character-assets.js',"export const CHARACTER_ASSETS={textures:[],models:{},motion:{file:'motion.json'},motionFallback:{file:'fallback.json'}};");
  put('hero-refinement-assets.js','export const HERO_REFINEMENTS={files:[]};');
  put('assets/characters/rebuilt-v215/sources.json','{}');put('assets/characters/rebuilt-v215/LICENSE.txt','CC0');
  for(const name of ['style.css','manifest.webmanifest','THIRD_PARTY_ASSETS.md','START_OFFLINE.cmd','start-offline.py','start-offline.mjs','OFFLINE_README.txt','assets/characters/motion.json','assets/characters/fallback.json'])put(name,'test fixture\n');
  for(const [path,text] of Object.entries(roomRuntimeFixture(root)))if(!existsSync(join(folder,path))){mkdirSync(dirname(join(folder,path)),{recursive:true});put(path,text);}
  for(const file of delivered)copy(prefix+file);
  for(const file of ['forest-1k.hdr','sky-1k.hdr','sources.json'])copy('assets/environment/lighting/'+file);
  for(const file of forestFiles)copy(forestPrefix+file);
  for(const file of treeFiles)copy(treePrefix+file);
  put(treePrefix+'source-trees.zip','unselected source download');put(treePrefix+'unused.glb','unselected model');
  put(prefix+'source-download.zip','unselected original archive');put(prefix+'authoring.blend','unselected authoring project');put(prefix+'unused.glb','unselected model');
  put(forestPrefix+'source-textures.zip','unselected source texture archive');put(forestPrefix+'source-preview.blend','unselected authoring project');
  const build=spawnSync(process.execPath,['scripts/build-offline.mjs'],{cwd:folder,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr||build.stdout);
  const manifest=JSON.parse(readFileSync(join(folder,'offline-package.json'),'utf8')),
   models=manifest.files.filter(file=>file.path.startsWith(prefix));
  assert.deepEqual(models.map(file=>file.path).sort(),delivered.map(file=>prefix+file).sort());
  const surfaces=manifest.files.filter(file=>file.path.startsWith(forestPrefix));
  assert.deepEqual(surfaces.map(file=>file.path).sort(),forestFiles.map(file=>forestPrefix+file).sort());
  const trees=manifest.files.filter(file=>file.path.startsWith(treePrefix));
  assert.deepEqual(trees.map(file=>file.path).sort(),treeFiles.map(file=>treePrefix+file).sort());
  const worker=readFileSync(join(folder,'sw.js'),'utf8');
  for(const file of ['forest-1k.hdr','sky-1k.hdr','sources.json'])assert(manifest.files.some(entry=>entry.path==='assets/environment/lighting/'+file));
  for(const file of [...models,...surfaces,...trees]){
   let data=readFileSync(new URL(file.path,root));if(/\.(json|txt)$/.test(file.path))data=Buffer.from(data.toString().replace(/\r\n/g,'\n'));
   assert.equal(file.bytes,data.length);assert.equal(file.sha256,createHash('sha256').update(data).digest('hex'));assert(worker.includes(JSON.stringify(file.path)));
  }
  for(const file of ['source-download.zip','authoring.blend','unused.glb','source-textures.zip','source-preview.blend','source-trees.zip'])assert(!worker.includes(file));
  const check=spawnSync(process.execPath,['scripts/build-offline.mjs','--check'],{cwd:folder,encoding:'utf8'});assert.equal(check.status,0,check.stderr);
  // Every colour/data map and the provenance travel with the package hash.
  // A check must reject stale bytes without silently rewriting a user's cache.
  for(const file of [...forestFiles.map(f=>forestPrefix+f),...treeFiles.map(f=>treePrefix+f)]){
   put(file,'changed forest resource bytes');
   const stale=spawnSync(process.execPath,['scripts/build-offline.mjs','--check'],{cwd:folder,encoding:'utf8'});
   assert.notEqual(stale.status,0,'changed forest resource must invalidate the offline build: '+file);
   assert.match(stale.stderr,/Offline resource list is stale/);
   assert.equal(readFileSync(join(folder,'sw.js'),'utf8'),worker,'check rewrote the installed cache');
   copy(file);
  }
  const restored=spawnSync(process.execPath,['scripts/build-offline.mjs','--check'],{cwd:folder,encoding:'utf8'});assert.equal(restored.status,0,restored.stderr);
  put(prefix+'weathered-rock-a.glb','changed bytes');
  const stale=spawnSync(process.execPath,['scripts/build-offline.mjs','--check'],{cwd:folder,encoding:'utf8'});assert.notEqual(stale.status,0,'changed model must invalidate the offline build');
 }finally{
  assert(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true});
 }
});
