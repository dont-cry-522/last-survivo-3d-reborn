import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {tube} from '../creature-forms.js';

const cases=[
 {name:'straight tapered limb',points:[[0,0,0],[0,1,0]],radii:[.10,.14,.10],sides:10,steps:12},
 {name:'frostking curved forearm',points:[[0,.12,0],[.03,-.19,.015],[.06,-.43,.03],[0,-.83,.08]],radii:[.29,.35,.36,.28],sides:16,steps:16},
 {name:'tree boss tapered root',points:[[0,-.73,.08],[.25,-1.04,.16],[.30,-1.34,.31],[.27,-1.46,.45]],radii:[.13,.11,.065,.012],sides:8,steps:12},
 {name:'coast guard curved pincer',points:[[0,0,0],[-.25,.02,.37],[-.24,.03,.77],[.08,0,.97]],radii:[.23,.21,.13,.01],sides:10,steps:15},
 {name:'jelly soft tentacle',points:[[0,0,0],[.1,-.4,.06],[-.1,-.8,.1],[0,-1,.04]],radii:[.07,.055,.03,.003],sides:5,steps:9},
];

test('coincident tube seam vertices share smooth unit normals on straight, tapered and bent anatomy',()=>{
 const a=new T.Vector3(),b=new T.Vector3();
 for(const c of cases){
  const g=tube(0x83919c,c.points,c.radii,c),p=g.attributes.position,n=g.attributes.normal;
  for(let row=0;row<=c.steps;row++){
   const first=row*(c.sides+1),last=first+c.sides;
   assert(a.fromBufferAttribute(p,first).distanceTo(b.fromBufferAttribute(p,last))<1e-6,c.name+' seam position');
   a.fromBufferAttribute(n,first);b.fromBufferAttribute(n,last);
   assert(Math.abs(a.length()-1)<1e-6&&a.distanceTo(b)<1e-7,c.name+' retained longitudinal lighting seam');
  }
  g.dispose();
 }
});

test('seam repair preserves the authored curve, radius, topology, sealed caps and every non-seam normal',()=>{
 const a=new T.Vector3(),b=new T.Vector3(),expected=new T.Vector3();
 for(const c of cases){
  const {points,radii,sides,steps}=c,curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),source=new T.TubeGeometry(curve,steps,1,sides,false);
  const flex=(x,y,z)=>[.01,y*2,.4,.2,.1],g=tube(0x83919c,points,radii,{...c,flexible:flex}),p=g.attributes.position;
  assert.equal(p.count,(steps+1)*(sides+1)+2,c.name+' vertex budget');
  assert.equal(g.index.count,steps*sides*6+sides*6,c.name+' triangle budget');
  assert.deepEqual(Array.from(g.index.array).slice(0,source.index.count),Array.from(source.index.array),c.name+' body topology');
  for(let row=0;row<=steps;row++){
   const t=row/steps,at=curve.getPointAt(t),fraction=t*(radii.length-1),radius=T.MathUtils.lerp(radii[Math.floor(fraction)],radii[Math.ceil(fraction)],fraction%1);
   for(let side=0;side<=sides;side++){
    const i=row*(sides+1)+side;expected.fromBufferAttribute(source.attributes.normal,i).multiplyScalar(radius).add(at);
    assert(a.fromBufferAttribute(p,i).distanceTo(expected)<1e-6,c.name+' silhouette moved');
    assert(Math.abs(g.attributes.creatureFlex.getY(i)-p.getY(i)*2)<1e-6,c.name+' bend phase moved');
   }
  }
  const raw=g.clone();raw.computeVertexNormals();
  for(let i=0;i<p.count;i++)if(i>=(steps+1)*(sides+1)||(i%(sides+1)!==0&&i%(sides+1)!==sides)){
   assert(a.fromBufferAttribute(g.attributes.normal,i).distanceTo(b.fromBufferAttribute(raw.attributes.normal,i))<1e-7,c.name+' altered other surface/cap normals');
  }
  const mesh=new T.Mesh(g,new T.MeshBasicMaterial());mesh.updateMatrixWorld(true);
  for(const end of[0,1]){
   const centerIndex=(steps+1)*(sides+1)+end,center=a.fromBufferAttribute(p,centerIndex).clone(),tangent=curve.getTangentAt(end).multiplyScalar(end?1:-1);
   assert(center.distanceTo(curve.getPointAt(end))<1e-6,c.name+' cap center');
   const hits=new T.Raycaster(center.clone().addScaledVector(tangent,.002),tangent.negate()).intersectObject(mesh);
   assert(hits.length&&hits[0].point.distanceTo(center)<1e-5,c.name+' open or reversed end cap');
  }
  source.dispose();raw.dispose();g.dispose();mesh.material.dispose();
 }
});
