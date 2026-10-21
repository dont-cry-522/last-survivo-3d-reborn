export const playerHidden=p=>p.heroId==='tide'&&p.dashTime>0||p.heroId==='mirage'&&!!p.mirageHidden;
// Store coordinates, never the live player object: submerged motion must not leak into pursuit.
export function observePlayer(observer,player,dt=0,decoy=null){
 observer.reacquired=false;
 // A decoy is a real stationary target, not the concealed player's moving coordinates.
 if(player.heroId==='mirage'&&decoy?.alive){
  observer.targetLost=false;observer.searchTime=0;observer.decoyTarget=decoy.id;
  const seen=observer.lastSeenPlayer??={x:0,z:0,vx:0,vz:0};seen.x=decoy.x;seen.z=decoy.z;seen.vx=seen.vz=0;return decoy;
 }
 if(!playerHidden(player)){
  observer.reacquired=!!observer.targetLost||observer.decoyTarget!=null;observer.decoyTarget=null;observer.targetLost=false;observer.searchTime=0;
  const seen=observer.lastSeenPlayer??={x:0,z:0,vx:0,vz:0};seen.x=player.x;seen.z=player.z;seen.vx=seen.vz=0;return player;
 }
 if(!observer.targetLost){observer.searchHeading=observer.mesh?.rotation.y||0;observer.searchTime=0;}
 observer.targetLost=true;observer.searchTime=(observer.searchTime||0)+dt;
 return observer.lastSeenPlayer||{x:observer.x,z:observer.z,vx:0,vz:0};
}
