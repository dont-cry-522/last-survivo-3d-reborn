import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as T from '../vendor/three.module.js';
const worldURL=new URL('../world.js',import.meta.url),entry=fs.readFileSync(worldURL,'utf8').match(/from['"](.\/skinned-hero\.js[^'"]*)['"]/)[1];
const {loadHeroAssets,createSkinnedHero,animateSkinnedHero,disposeHero}=await import(new URL(entry,worldURL));

test('shadow loadouts use complete centred cloth with restrained pale seams and a fitted animated yoke',async()=>{
 const saved=Object.fromEntries(['fetch','self','ProgressEvent','createImageBitmap'].map(k=>[k,globalThis[k]]));
 try{
  globalThis.self=globalThis;globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,data);}};globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
  globalThis.fetch=async input=>{const url=typeof input==='string'?input:input.url;return url.startsWith('file:')?new Response(fs.readFileSync(fileURLToPath(url))):saved.fetch(input);};
  await loadHeroAssets();
  for(const weapon of['shade','shadowblade','grimoire']){
   const hero=createSkinnedHero('wraith',weapon),d=hero.userData,cape=d.cape,p=cape.geometry.attributes.position,uv=cape.geometry.attributes.uv,c=cape.geometry.attributes.color;
   const body=d.model.getObjectByName('Male_Ranger_Body'),skin=body.geometry.clone(),sp=skin.attributes.position,probe=new T.Mesh(skin,new T.MeshBasicMaterial({side:T.DoubleSide}));let disposedHero=false;
   try{
    assert(d.owned.includes(cape));assert.equal(cape.parent.name,'spine_03');assert.equal(p.count,25*29,'cloth budget must not grow');
    const meanX=Array.from({length:p.count},(_,i)=>p.getX(i)).reduce((a,b)=>a+b)/p.count;assert(Math.abs(meanX)<1e-6,'cape is still a one-sided strip');
    let pale=0;for(let i=0;i<p.count;i++){
     assert([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite));
     const u=uv.getX(i),v=uv.getY(i),light=Math.max(c.getX(i),c.getY(i),c.getZ(i));if(light>.15){pale++;assert(u<.05||u>.95||v>.97,'pale colour escaped the narrow hem');}
    }assert(pale>20&&pale/p.count<.16,'cloth lost the light hem or returned to half-white');
    // The rebuilt continuous coat owns the piping previously drawn in a
    // separate seam mesh. Test its actual coverage, not an all-dark vertex
    // requirement that also rejects a narrow, correctly integrated edge.
    const bc=body.geometry.attributes.color,buv=body.geometry.attributes.uv,bp=body.geometry.attributes.position,bi=body.geometry.index;
    let bodyPale=0,paleArea=0,totalArea=0;
    for(let i=0;i<bc.count;i++){
     const light=Math.max(bc.getX(i),bc.getY(i),bc.getZ(i));assert(Number.isFinite(light)&&light>=0&&light<=1,'invalid normalized cloth colour');
     if(light>=.07){bodyPale++;const u=buv.getX(i),v=buv.getY(i);assert(v<.035||v>.965||(v>.5&&v<.96&&(u<.15||u>.85)),'pale colour escaped the collar, hem or front lapel');}
    }
    const areaA=new T.Vector3(),areaB=new T.Vector3(),areaC=new T.Vector3(),areaTriangle=new T.Triangle(areaA,areaB,areaC);
    for(let i=0;i<bi.count;i+=3){
     const ids=[bi.getX(i),bi.getX(i+1),bi.getX(i+2)];areaA.fromBufferAttribute(bp,ids[0]);areaB.fromBufferAttribute(bp,ids[1]);areaC.fromBufferAttribute(bp,ids[2]);
     const area=areaTriangle.getArea(),light=Math.max(...['getX','getY','getZ'].map(channel=>ids.reduce((sum,id)=>sum+bc[channel](id),0)/3));
     totalArea+=area;if(light>=.07)paleArea+=area;
    }
    // DCC subdivision concentrates vertices around the turned collar and hem.
    // Physical coverage is independent of that tessellation density; retain
    // the same strict 7% area budget and the UV-region constraint above.
    assert(bodyPale>0&&paleArea/totalArea<.07,'white half-panel returned to the tunic');
    for(let row=0;row<29;row++)for(let col=1;col<25;col++)assert(p.getX(row*25+col)>p.getX(row*25+col-1),'cloth wraps around or doubles back');
    let checked=0,min=Infinity,max=-Infinity,maxSurface=0;const point=new T.Vector3(),origin=new T.Vector3(),forward=new T.Vector3(0,0,1),ray=new T.Raycaster(),triangle=new T.Triangle(),closest=new T.Vector3(),indices=skin.index.array;
    for(let frame=0;frame<100;frame++){
     d.aimActive=frame>20;d.reloadDuration=.9;d.reloadPhase=(frame%54)/54;d.shotSerial=1+Math.floor(frame/54);d.attackAge=(frame%54)/60;d.travelAngle=.25*Math.sin(frame/20);d.turnRate=.5*Math.cos(frame/20);
     animateSkinnedHero(hero,frame/60,frame<20?0:4,frame%54<18?.25:0,0);hero.updateMatrixWorld(true);if(frame%10)continue;
     for(let i=0;i<sp.count;i++){body.getVertexPosition(i,point).applyMatrix4(body.matrixWorld);sp.setXYZ(i,point.x,point.y,point.z);}skin.computeBoundingBox();skin.computeBoundingSphere();probe.updateMatrixWorld(true);
     for(let i=0;i<p.count;i++){
      // Measure the same upper 18 cm yoke for all three garment lengths;
      // the book's lower waist/skirt is free cloth rather than a fitted shoulder.
      const v=uv.getY(i),u=uv.getX(i);if(p.getY(i)<-.18||u<.2||u>.8)continue;point.fromBufferAttribute(p,i);
      if(weapon!=='shadowblade'){
       const h=T.MathUtils.clamp(-point.y/(weapon==='shade'?.62:.96),0,1),time=cape.userData.wind.time.value,run=cape.userData.wind.run.value,turn=cape.userData.wind.turn.value,x=point.x,y=point.y;
       point.z+=Math.sin(y*9+time*5)*(.009+run*.026)*h+Math.sin(x*14+y*7-time*3)*run*.009*h-.055*h*h*(.25+run);
       point.x+=(Math.sin(time*3+y*6)*.012+turn*.14)*h*h;point.y+=.018*h*h*run;
      }
      cape.localToWorld(point);origin.copy(point).addScaledVector(forward,-1);ray.set(origin,forward);const hit=ray.intersectObject(probe,false)[0];if(!hit)continue;
      const gap=hit.distance-1;min=Math.min(min,gap);max=Math.max(max,gap);checked++;
      // A fixed forward ray at a turning shoulder can hit the torso's opposite
      // side. Nearest actual triangles measure cloth separation independently.
      let distance=Infinity;for(let k=0;k<indices.length;k+=3){triangle.a.fromBufferAttribute(sp,indices[k]);triangle.b.fromBufferAttribute(sp,indices[k+1]);triangle.c.fromBufferAttribute(sp,indices[k+2]);triangle.closestPointToPoint(point,closest);distance=Math.min(distance,point.distanceToSquared(closest));}maxSurface=Math.max(maxSurface,Math.sqrt(distance));
     }
    }
    console.log(weapon,'animated upper-back clearance',{checked,min,max,maxSurface});assert(checked>300);assert(min>=-.003,'fitted yoke cuts through the animated back');assert(maxSurface<.07,'upper cloth floats away from the back');
    const second=createSkinnedHero('wraith',weapon);try{assert.notEqual(second.userData.cape.geometry,cape.geometry);assert.notEqual(second.userData.cape.material,cape.material);let disposed=0;second.userData.cape.geometry.addEventListener('dispose',()=>disposed++);disposeHero(hero);disposedHero=true;assert.equal(disposed,0,'cape cache shares disposable instance geometry');}finally{disposeHero(second);}
   }finally{if(!disposedHero)disposeHero(hero);skin.dispose();probe.material.dispose();}
  }
 }finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});
