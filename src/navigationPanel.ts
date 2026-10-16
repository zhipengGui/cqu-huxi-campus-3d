import type {Navigator} from './navigation';
import type {SearchItem} from './search';
import type {RoadPoint} from './routing';

export function routeTurns(points:RoadPoint[]):string[] {
  const turns:string[]=[];
  for(let i=1;i<points.length-1;i++){
    const [a,b,c]=[points[i-1],points[i],points[i+1]],ix=b[0]-a[0],iy=b[1]-a[1],ox=c[0]-b[0],oy=c[1]-b[1];
    if(Math.hypot(ix,iy)<5||Math.hypot(ox,oy)<5)continue;
    const angle=Math.atan2(ix*oy-iy*ox,ix*ox+iy*oy)*180/Math.PI;
    if(Math.abs(angle)>150)turns.push('前方折返');else if(Math.abs(angle)>35)turns.push(angle>0?'前方左转':'前方右转');
  }return turns.slice(0,4);
}

export function initNavigationPanel(nav:Navigator,places:SearchItem[],onRoute:()=>void):void {
  const get=<T extends HTMLElement>(id:string)=>document.querySelector<T>(id)!;
  for(const which of ['start','end'] as const){
    const select=get<HTMLSelectElement>('#nav-'+which);
    select.options[0].disabled=true;
    for(const place of places.filter(p=>p.kind!=='water'))select.add(new Option(place.name,place.name));
    select.addEventListener('change',()=>{const place=places.find(p=>p.name===select.value);if(place)nav.setPlace(which,place.name,place.target.x,place.target.z);refresh();});
    get('#nav-pick-'+which).addEventListener('click',()=>{nav.pickEndpoint=which;nav.onStatus(`点击道路或地点设置${which==='start'?'起点':'终点'}`);refresh();});
  }
  function refresh():void {
    for(const which of ['start','end'] as const){
      const e=nav[which];get<HTMLSelectElement>('#nav-'+which).value=e?(e.place??'@map'):'';
      get('#nav-pick-'+which).classList.toggle('on',nav.pickEndpoint===which);
    }
    get('#nav-note').textContent=[nav.start?.label,nav.end?.label].filter(Boolean).join(' → ');
    get('#nav-turns').textContent=nav.result?[...routeTurns(nav.result.points),'到达附近道路'].join(' · '):'';
  }
  nav.onChange=()=>{refresh();if(nav.result)onRoute();};
  get('#nav-swap').addEventListener('click',()=>nav.swap());
  get('#nav-go').addEventListener('click',()=>nav.recompute());
  refresh();
}
