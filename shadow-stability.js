import * as T from './vendor/three.module.js';

const direction=new T.Vector3(),right=new T.Vector3(),up=new T.Vector3();

// Round only in the existing shadow camera's image plane. The caller applies
// this focus to both the sun target and position, preserving its direction,
// distance, frustum and near/far planes. No extra shadow map is allocated.
export function snapShadowFocus(focus,sunDirection,camera,mapSize,out=focus){
 const stepX=(camera.right-camera.left)/mapSize.x,stepY=(camera.top-camera.bottom)/mapSize.y;
 out.copy(focus);direction.copy(sunDirection);
 if(!(stepX>0&&stepY>0)||!Number.isFinite(stepX+stepY)||direction.lengthSq()<1e-12)return out;
 direction.normalize();right.crossVectors(camera.up,direction);
 // Match the orientation of the normal Y-up camera when the sun is overhead.
 if(right.lengthSq()<1e-12)right.set(1,0,0);
 else right.normalize();
 up.crossVectors(direction,right).normalize();
 const x=focus.dot(right),y=focus.dot(up);
 return out.addScaledVector(right,Math.round(x/stepX)*stepX-x)
  .addScaledVector(up,Math.round(y/stepY)*stepY-y);
}
