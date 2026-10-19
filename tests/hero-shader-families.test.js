import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../vendor/three.module.js';
import {finishHeroSurface} from '../hero-finish.js';

const source=readFileSync(new URL('../skinned-hero.js',import.meta.url),'utf8');
const skinSource=source.slice(source.indexOf('function skinTone('),source.indexOf('function bindParts('));
const {skinTone,tideCloth}=vm.runInNewContext(`(function(){${skinSource};return {skinTone,tideCloth};})()`,{T});
const capeStart=source.indexOf('const material=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true',source.indexOf('function capeMesh('));
const capeSource=source.slice(capeStart,source.indexOf(';const m=new T.Mesh(geometry,material)',capeStart));
const capeMaterial=vm.runInNewContext(`(function(kind,weapon){const shadowLength=weapon==='shade'?.62:weapon==='shadowblade'?.44:.96;${capeSource};return {material,wind};})`,{T});
const vendor=readFileSync(new URL('../vendor/three.module.js',import.meta.url),'utf8');
const uniformSource=vendor.slice(vendor.indexOf('const emptyTexture ='),vendor.indexOf('function WebGLShader('));
const WebGLUniforms=vm.runInNewContext(`(function(){${uniformSource};return WebGLUniforms;})()`,{...T});
const shader=()=>({uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <map_fragment>\n#include <color_fragment>\n#include <emissivemap_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <opaque_fragment>'});
const compact=s=>s.replace(/\s+/g,'');
const cloneHooks=source=>{const copy=source.clone();copy.onBeforeCompile=source.onBeforeCompile;copy.customProgramCacheKey=source.customProgramCacheKey;return copy;};

test('skin variants retain their exact authored linear constants with one source program and no shared tint changes',()=>{
 const variants={scout:[.63,.43,.32],tide:[.63,.43,.32],silver:[.80,.66,.60],wraith:[.085,.080,.095],wuling:[.57,.36,.28],mirage:[.70,.58,.68]},results=[];
 for(const [kind,values]of Object.entries(variants)){
  const material=new T.MeshStandardMaterial({map:new T.Texture(),normalMap:new T.Texture()}),s=shader(),before=s.fragmentShader;
  skinTone(material,kind);material.onBeforeCompile(s);results.push({kind,material,s,values});
  assert.deepEqual(s.uniforms.heroSkinTint.value.toArray(),values);
  const resolved=s.fragmentShader.replace('uniform vec3 heroSkinTint;\n','').replaceAll('heroSkinTint',`vec3(${values.join(',')})`);
  const expected=before.replace('#include <map_fragment>',`#include <map_fragment>
float skinShade=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
diffuseColor.rgb=vec3(${values.join(',')})*(.72+skinShade*.42)+diffuseColor.rgb*.09;`);
  assert.equal(compact(resolved),compact(expected),kind+' changed more than the literal tint');
  const copy=cloneHooks(material),again=shader();copy.onBeforeCompile(again);
  assert.equal(again.fragmentShader,s.fragmentShader);assert.equal(again.uniforms.heroSkinTint,s.uniforms.heroSkinTint);
  copy.dispose();material.map.dispose();material.normalMap.dispose();material.dispose();
 }
 assert.equal(new Set(results.map(r=>r.material.customProgramCacheKey())).size,1);
 assert.equal(new Set(results.map(r=>r.s.fragmentShader)).size,1);
 for(const a of results)for(const b of results)if(a!==b)assert.notEqual(a.s.uniforms.heroSkinTint,b.s.uniforms.heroSkinTint);
 for(const r of results)assert.deepEqual(r.s.uniforms.heroSkinTint.value.toArray(),r.values);
 const lingya=new T.MeshStandardMaterial({map:new T.Texture(),normalMap:new T.Texture(),aoMap:new T.Texture()});skinTone(lingya,'lingya');
 assert.equal(lingya.color.getHex(),0xefbda1);assert.equal(lingya.map,null);assert.equal(lingya.normalMap,null);assert.equal(lingya.aoMap,null);lingya.dispose();
});

test('three coastal fabric tints keep the same weave formula and survive actual tailored-material cloning',()=>{
 const values=[[.20,.13,.075],[.022,.052,.068],[.035,.12,.16]],keys=new Set(),sources=new Set();
 for(const [i,tint]of values.entries()){
  const original=new T.MeshStandardMaterial({name:'MAT_Peasant',map:new T.Texture()}),root=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(),original);
  mesh.name=i===0?'Female_Peasant_Feet':'Female_Peasant_Body';root.add(mesh);tideCloth(original,tint);
  const before=shader();original.onBeforeCompile(before);keys.add(original.customProgramCacheKey());sources.add(before.fragmentShader);
  assert.deepEqual(before.uniforms.heroTideTint.value.toArray(),tint);
  assert(compact(before.fragmentShader).includes('diffuseColor.rgb=heroTideTint*(.6+weave*1.8);'));
  finishHeroSurface(root,'tide');const after=shader();mesh.material.onBeforeCompile(after);
  assert.equal(after.uniforms.heroTideTint,before.uniforms.heroTideTint);
  assert.match(mesh.material.customProgramCacheKey(),/tide-coat-tint-tailored-surface-(cloth|leather)$/);
  assert.deepEqual(after.uniforms.heroTideTint.value.toArray(),tint);mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();
 }
 assert.equal(keys.size,1);assert.equal(sources.size,1);
});

test('a shared real WebGL uniform cache uploads each material tint on alternating draws, including copied hooks',()=>{
 for(const uniformName of ['heroSkinTint','heroTideTint']){
  const a=new T.MeshStandardMaterial(),b=new T.MeshStandardMaterial();
  if(uniformName==='heroSkinTint'){skinTone(a,'silver');skinTone(b,'wuling');}else{tideCloth(a,[.20,.13,.075]);tideCloth(b,[.022,.052,.068]);}
  const copy=cloneHooks(a),sa=shader(),sb=shader(),sc=shader();a.onBeforeCompile(sa);b.onBeforeCompile(sb);copy.onBeforeCompile(sc);
  const uploads=[],gl={ACTIVE_UNIFORMS:0x8B86,getProgramParameter:()=>1,getActiveUniform:()=>({name:uniformName,type:0x8B51,size:1}),getUniformLocation:()=>uniformName,
   uniform3f(location,x,y,z){assert.equal(location,uniformName);uploads.push([x,y,z]);}};
  const programUniforms=new WebGLUniforms(gl,{});
  for(const sample of [sa,sb,sc])WebGLUniforms.upload(gl,programUniforms.seq,sample.uniforms,{});
  assert.deepEqual(uploads,[sa.uniforms[uniformName].value.toArray(),sb.uniforms[uniformName].value.toArray(),sa.uniforms[uniformName].value.toArray()]);
  a.dispose();b.dispose();copy.dispose();
 }
});

test('only identical cape shader families share programs while per-actor wind and shadow lengths stay independent',()=>{
 const cpu=[['silver','crossbow'],['tide','harpoon'],['wraith','shadowblade']].map(args=>capeMaterial(...args));
 for(const {material}of cpu){const s=shader(),before=shader();material.onBeforeCompile(s);assert.deepEqual(s,before);}
 assert.equal(new Set(cpu.map(c=>c.material.customProgramCacheKey())).size,1);
 const herb=capeMaterial('wuling','sporelantern'),mirror=capeMaterial('mirage','miasmalantern'),a=shader(),b=shader();herb.material.onBeforeCompile(a);mirror.material.onBeforeCompile(b);
 assert.equal(a.vertexShader,b.vertexShader);assert.equal(a.fragmentShader,b.fragmentShader);assert.equal(herb.material.customProgramCacheKey(),mirror.material.customProgramCacheKey());
 herb.wind.time.value=9;herb.wind.run.value=.8;assert.equal(b.uniforms.capeTime.value,0);assert.equal(b.uniforms.capeRun.value,0);
 const shade=capeMaterial('wraith','shade'),book=capeMaterial('wraith','grimoire'),sa=shader(),sb=shader();shade.material.onBeforeCompile(sa);book.material.onBeforeCompile(sb);
 assert.equal(sa.vertexShader,sb.vertexShader);assert.equal(sa.fragmentShader,sb.fragmentShader);assert.equal(shade.material.customProgramCacheKey(),book.material.customProgramCacheKey());
 assert.equal(sa.uniforms.capeLength.value,.62);assert.equal(sb.uniforms.capeLength.value,.96);
 assert.notEqual(sa.uniforms.capeLength,sb.uniforms.capeLength);assert.notEqual(sa.uniforms.capeTime,sb.uniforms.capeTime);
 assert.match(sa.vertexShader,/uniform float capeLength;/);assert.match(sa.vertexShader,/-position.y\/capeLength/);
 assert.match(sa.fragmentShader,/discard/);assert.notEqual(shade.material.customProgramCacheKey(),herb.material.customProgramCacheKey());
 const lingya=capeMaterial('lingya','boomerang'),sl=shader();lingya.material.onBeforeCompile(sl);assert.notEqual(sl.vertexShader,a.vertexShader);assert.notEqual(lingya.material.customProgramCacheKey(),herb.material.customProgramCacheKey());
 for(const c of [...cpu,herb,mirror,shade,book,lingya])c.material.dispose();
});
