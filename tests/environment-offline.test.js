import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url),prefix='assets/environment/models/',
 delivered=['weathered-rock-a.glb','weathered-rock-b.glb','old-stump.glb','sources.json','LICENSE.txt','CC0-1.0.txt'];

test('offline export contains the six approved environment files and excludes unselected source assets',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forest-environment-offline-'));
 const put=(path,data)=>writeFileSync(join(folder,path),data),copy=path=>copyFileSync(new URL(path,root),join(folder,path));
 try{
  for(const dir of ['scripts','vendor','assets/bestiary','assets/icons','assets/audio','assets/environment/models','assets/environment/lighting','assets/characters/rebuilt-v215'])mkdirSync(join(folder,dir),{recursive:true});
  copy('scripts/build-offline.mjs');copy('scripts/offline-worker.txt');
  put('package.json','{"type":"module"}');put('index.html','<script type="module" src="./main.js?v=1"></script>');put('main.js','export const version=1;');
  put('character-assets.js',"export const CHARACTER_ASSETS={textures:[],models:{},motion:{file:'motion.json'},motionFallback:{file:'fallback.json'}};");
  put('hero-refinement-assets.js','export const HERO_REFINEMENTS={files:[]};');
  put('assets/characters/rebuilt-v215/sources.json','{}');put('assets/characters/rebuilt-v215/LICENSE.txt','CC0');
  for(const name of ['style.css','manifest.webmanifest','THIRD_PARTY_ASSETS.md','START_OFFLINE.cmd','start-offline.py','start-offline.mjs','OFFLINE_README.txt','assets/characters/motion.json','assets/characters/fallback.json'])put(name,'test fixture\n');
  for(const file of delivered)copy(prefix+file);
  for(const file of ['forest-1k.hdr','sky-1k.hdr','sources.json'])copy('assets/environment/lighting/'+file);
  put(prefix+'source-download.zip','unselected original archive');put(prefix+'authoring.blend','unselected authoring project');put(prefix+'unused.glb','unselected model');
  const build=spawnSync(process.execPath,['scripts/build-offline.mjs'],{cwd:folder,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr||build.stdout);
  const manifest=JSON.parse(readFileSync(join(folder,'offline-package.json'),'utf8')),
   models=manifest.files.filter(file=>file.path.startsWith(prefix));
  assert.deepEqual(models.map(file=>file.path).sort(),delivered.map(file=>prefix+file).sort());
  const worker=readFileSync(join(folder,'sw.js'),'utf8');
  for(const file of ['forest-1k.hdr','sky-1k.hdr','sources.json'])assert(manifest.files.some(entry=>entry.path==='assets/environment/lighting/'+file));
  for(const file of models){
   let data=readFileSync(new URL(file.path,root));if(/\.(json|txt)$/.test(file.path))data=Buffer.from(data.toString().replace(/\r\n/g,'\n'));
   assert.equal(file.bytes,data.length);assert.equal(file.sha256,createHash('sha256').update(data).digest('hex'));assert(worker.includes(JSON.stringify(file.path)));
  }
  for(const file of ['source-download.zip','authoring.blend','unused.glb'])assert(!worker.includes(file));
  const check=spawnSync(process.execPath,['scripts/build-offline.mjs','--check'],{cwd:folder,encoding:'utf8'});assert.equal(check.status,0,check.stderr);
  put(prefix+'weathered-rock-a.glb','changed bytes');
  const stale=spawnSync(process.execPath,['scripts/build-offline.mjs','--check'],{cwd:folder,encoding:'utf8'});assert.notEqual(stale.status,0,'changed model must invalidate the offline build');
 }finally{
  assert(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true});
 }
});
