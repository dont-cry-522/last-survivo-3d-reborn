import {readFileSync,readdirSync} from 'node:fs';

// Include the real, locally imported room graph in isolated offline fixtures.
// Callers keep their deliberate main/character stubs when paths overlap.
export function roomRuntimeFixture(root){
 const files={},pending=readdirSync(root).filter(name=>/^multiplayer.*\.(js|css)$/.test(name));
 while(pending.length){
  const path=pending.pop();if(Object.hasOwn(files,path))continue;
  const url=new URL(path,root),text=readFileSync(url,'utf8');files[path]=text;
  if(!path.endsWith('.js'))continue;
  for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)){
   if(!match[1].startsWith('.'))continue;
   const dependency=new URL(match[1],url);dependency.search='';dependency.hash='';
   if(!dependency.href.startsWith(root.href)||!dependency.pathname.endsWith('.js'))continue;
   pending.push(decodeURIComponent(dependency.href.slice(root.href.length)));
  }
 }
 return files;
}
