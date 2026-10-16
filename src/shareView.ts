export interface SharedView {
  position:number[];target:number[];collapsed:boolean;offset:number[];viewport:number[];preset:string;place?:string;frame?:number[];
}
export function formatSharedView(view:SharedView):string {
  const round=(v:number)=>Math.round(v*10000)/10000;
  const p=new URLSearchParams({v:[...view.position,...view.target].map(round).join(','),
    panel:view.collapsed?'closed':'open',o:view.offset.map(round).join(','),vp:view.viewport.join(','),light:view.preset});
  if(view.place)p.set('place',view.place);
  if(view.frame)p.set('f',view.frame.map(round).join(','));
  return '#'+p.toString();
}
export function parseSharedView(hash:string):SharedView|null {
  const p=new URLSearchParams(hash.replace(/^#/,'')),v=p.get('v')?.split(',').map(Number);
  if(!v||v.length!==6||v.some(x=>!Number.isFinite(x)||Math.abs(x)>50000))return null;
  const distance=Math.hypot(v[0]-v[3],v[1]-v[4],v[2]-v[5]);
  if(distance<12||distance>8500)return null;
  const pair=(key:string,limit:number)=>{const a=p.get(key)?.split(',').map(Number);return a?.length===2&&a.every(x=>Number.isFinite(x)&&Math.abs(x)<=limit)?a:[];};
  const light=p.get('light')??'day',place=p.get('place');
  return {position:v.slice(0,3),target:v.slice(3),collapsed:p.get('panel')==='closed',offset:pair('o',.5),
    viewport:pair('vp',20000),preset:['morning','day','dusk','night'].includes(light)?light:'day',
    ...(place&&place.length<100?{place}:{}),...(pair('f',20000).length?{frame:pair('f',20000)}:{})};
}
export function sharedDistanceScale(view:SharedView,destination:{width:number;height:number},free:{width:number;height:number},depthRange:[number,number]=[0,0]):number {
  if(view.viewport.length!==2||view.viewport[1]<=0)return 1;
  const source=view.frame??view.viewport,h=view.viewport[1];
  const ratio=Math.max((source[0]/h)/(free.width/destination.height),(source[1]/h)/(free.height/destination.height));
  const d=Math.hypot(...view.position.map((v,i)=>v-view.target[i]));
  // Perspective depth matters when shrinking or enlarging the available field of view.
  return (ratio*d+(1-ratio)*depthRange[ratio>1?0:1])/d;
}
