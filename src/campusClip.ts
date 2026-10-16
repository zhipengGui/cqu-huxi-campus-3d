import type { Road, Area } from './types';
type Point = [number,number];

export function areaCenter(area: Area): Point {
  const ring=area.outers[0];
  return [(Math.min(...ring.map(p=>p[0]))+Math.max(...ring.map(p=>p[0])))/2,
    (Math.min(...ring.map(p=>p[1]))+Math.max(...ring.map(p=>p[1])))/2];
}

/** All campus surfaces follow the same boundary policy, including sport facilities. */
export function campusAreas(areas: Area[], ring?: Point[]): Area[] {
  return areas.filter(a=>a.outers[0]?.length && (!ring || inCampus(areaCenter(a),ring)));
}

export function inCampus([x,y]: Point, ring: Point[]): boolean {
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j],b=ring[i];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}

/** Rendering-only clipping. The original graph and navigation paths stay intact. */
export function clipRoads(roads: Road[], ring: Point[]): Road[] {
  const out: Road[]=[];
  for(const road of roads) {
    for(let i=1;i<road.pts.length;i++) {
      const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dy=b[1]-a[1];
      const ts=[0,1];
      for(let j=0;j<ring.length;j++) {
        const c=ring[j],d=ring[(j+1)%ring.length],ex=d[0]-c[0],ey=d[1]-c[1];
        const denominator=dx*ey-dy*ex;
        if(Math.abs(denominator)<1e-9) continue;
        const t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/denominator;
        const u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/denominator;
        if(t>0 && t<1 && u>=0 && u<=1) ts.push(t);
      }
      ts.sort((a,b)=>a-b);
      for(let j=1;j<ts.length;j++) {
        const lo=ts[j-1],hi=ts[j],mid=(lo+hi)/2;
        if(hi-lo>1e-8 && inCampus([a[0]+mid*dx,a[1]+mid*dy],ring)) {
          out.push({...road,pts:[[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]]});
        }
      }
    }
  }
  return out;
}
