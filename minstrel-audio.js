// Original locally synthesized foley. Bow: taut fibre snap and feather air.
// Bell: felt mallet against bronze with short, inharmonic modal resonance.
export const MINSTREL_SOUNDS={windbow:[.30,.18,.34],resonator:[.48,.21,.18]};
export function minstrelSample(id,event,rate,variant=0,take=0){
 const index={shot:0,impact:1,mechanism:2}[event],duration=MINSTREL_SOUNDS[id]?.[index];
 if(!duration)return null;
 const out=new Float32Array(Math.ceil(rate*duration)),bow=id==='windbow',hit=event==='impact',hold=event==='mechanism';
 let seed=(bow?3181:7109)+take*613+variant*151,low=0,body=0;
 const freq=(bow?142:392)*(1+take*.011),delay=new Float32Array(Math.round(rate/freq));let cursor=0,string=0;
 for(let i=0;i<out.length;i++){
  const t=i/rate,u=t/duration;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=seed/2147483648-1;
  low+=(n-low)*(1-Math.exp(-2*Math.PI*(bow?1900:1300)/rate));body+=(n-body)*(1-Math.exp(-2*Math.PI*130/rate));
  const air=low-body,attack=(1-Math.exp(-t*1000)),edge=Math.min(1,t/.003,(duration-t)/.022);let v=0;
  if(bow){
   const next=(cursor+1)%delay.length,p=i<delay.length?n:(delay[cursor]+delay[next])*.487;
   delay[cursor]=p;cursor=next;string+=(p-string)*(1-Math.exp(-2*Math.PI*2100/rate));
   if(hold)v=air*.12*Math.sin(Math.PI*u)**2*(.45+.55*Math.sin(t*93)**2)+body*.08*Math.exp(-t*30);
   else if(hit)v=(body*2.5+air*.45)*attack*Math.exp(-t*38)+(n-low)*.12*Math.exp(-t*125);
   else v=string*.8+air*.30*Math.exp(-t*21)+(n-low)*.09*Math.exp(-t*170);
  }else{
   const modal=(Math.sin(t*2*Math.PI*freq)*Math.exp(-t*9)+.30*Math.sin(t*2*Math.PI*freq*2.71)*Math.exp(-t*17)+.17*Math.sin(t*2*Math.PI*freq*4.13)*Math.exp(-t*23));
   if(hold)v=air*.10*Math.sin(Math.PI*u)**2+body*.09*attack*Math.exp(-t*38);
   else if(hit)v=(body*1.7+air*.32)*attack*Math.exp(-t*29)+modal*.10*attack;
   else v=modal*.30*attack+body*.65*attack*Math.exp(-t*32)+air*.09*Math.exp(-t*60);
  }
  out[i]=Math.tanh(v)*Math.max(0,edge)*(hold?.50:hit?.64:variant?.48:.72);
 }
 return out;
}
