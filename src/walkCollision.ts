import type {SceneData} from './types';
import type {RoadPoint} from './routing';
import {inCampus,distanceToBoundary} from './campusClip.ts';

type Region={ring:RoadPoint[];holes:RoadPoint[][]};
type Segment={a:RoadPoint;b:RoadPoint;width:number};
type Cell={blocks:Set<Region>;paving:Set<Region>;roads:Set<Segment>};
function segmentDistance(p:RoadPoint,a:RoadPoint,b:RoadPoint):number {
  const x=b[0]-a[0],y=b[1]-a[1],l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/l)):0;
  return Math.hypot(p[0]-a[0]-x*t,p[1]-a[1]-y*t);
}
function inside(p:RoadPoint,r:Region):boolean {return inCampus(p,r.ring)&&!r.holes.some(h=>inCampus(p,h));}
function edgeDistance(p:RoadPoint,r:Region):number {return Math.min(distanceToBoundary(p,r.ring),...r.holes.map(h=>distanceToBoundary(p,h)));}

/** Flat outdoor walking only: mapped roads/paving, with building, water and campus barriers. */
export class WalkWorld {
  private cells=new Map<string,Cell>();
  private boundary:RoadPoint[]|undefined;
  constructor(data:Pick<SceneData,'boundary'|'buildings'|'roads'|'paving'|'water'>){
    this.boundary=data.boundary?.pts;
    for(const b of data.buildings.filter(b=>b.inside))this.index({ring:b.polygon,holes:b.holes},'blocks');
    for(const a of data.water)for(const ring of a.outers)this.index({ring,holes:a.inners},'blocks');
    for(const a of data.paving)for(const ring of a.outers)this.index({ring,holes:a.inners},'paving');
    for(const road of data.roads)for(let i=1;i<road.pts.length;i++){
      const segment={a:road.pts[i-1],b:road.pts[i],width:road.width};this.put([segment.a,segment.b],road.width/2,cell=>cell.roads.add(segment));
    }
  }
  private index(region:Region,field:'blocks'|'paving'):void {if(region.ring.length>=3)this.put(region.ring,0,cell=>cell[field].add(region));}
  private put(points:RoadPoint[],padding:number,add:(cell:Cell)=>void):void {
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    for(let x=Math.floor((Math.min(...xs)-padding)/32);x<=Math.floor((Math.max(...xs)+padding)/32);x++)for(let y=Math.floor((Math.min(...ys)-padding)/32);y<=Math.floor((Math.max(...ys)+padding)/32);y++){
      const key=x+','+y;let cell=this.cells.get(key);if(!cell){cell={blocks:new Set(),paving:new Set(),roads:new Set()};this.cells.set(key,cell);}add(cell);
    }
  }
  isFree(p:RoadPoint,radius=.3):boolean {
    if(!p.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0)return false;
    if(this.boundary&&(!inCampus(p,this.boundary)||distanceToBoundary(p,this.boundary)<radius))return false;
    const blocks=new Set<Region>(),paving=new Set<Region>(),roads=new Set<Segment>();
    for(let x=Math.floor((p[0]-radius)/32);x<=Math.floor((p[0]+radius)/32);x++)for(let y=Math.floor((p[1]-radius)/32);y<=Math.floor((p[1]+radius)/32);y++){
      const cell=this.cells.get(x+','+y);if(cell){for(const a of cell.blocks)blocks.add(a);for(const a of cell.paving)paving.add(a);for(const a of cell.roads)roads.add(a);}
    }
    for(const area of blocks)if(inside(p,area)||edgeDistance(p,area)<radius-1e-8)return false;
    for(const s of roads)if(segmentDistance(p,s.a,s.b)<=s.width/2-radius+1e-8)return true;
    for(const area of paving)if(inside(p,area)&&edgeDistance(p,area)>=radius-1e-8)return true;
    return false;
  }
  move(position:RoadPoint,delta:RoadPoint,radius=.3):RoadPoint {
    let p:RoadPoint=[...position];if(!this.isFree(p,radius)||!delta.every(Number.isFinite))return p;
    const steps=Math.max(1,Math.ceil(Math.hypot(...delta)/(radius*.5))),dx=delta[0]/steps,dy=delta[1]/steps;
    for(let i=0;i<steps;i++){
      const full:RoadPoint=[p[0]+dx,p[1]+dy];if(this.isFree(full,radius)){p=full;continue;}
      const x:RoadPoint=[p[0]+dx,p[1]];if(this.isFree(x,radius))p=x;
      const y:RoadPoint=[p[0],p[1]+dy];if(this.isFree(y,radius))p=y;
    }return p;
  }
  findSpawn(preferred:RoadPoint,candidates:RoadPoint[]):RoadPoint|null {
    const points=[preferred,...candidates.filter(p=>Math.hypot(p[0]-preferred[0],p[1]-preferred[1])<=100)];
    points.sort((a,b)=>Math.hypot(a[0]-preferred[0],a[1]-preferred[1])-Math.hypot(b[0]-preferred[0],b[1]-preferred[1]));
    const point=points.find(p=>this.isFree(p));return point?[...point]:null;
  }
}
