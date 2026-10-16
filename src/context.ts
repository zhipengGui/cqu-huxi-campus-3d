import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clipRoads, distanceToCampus, distanceToBoundary, inCampus } from './campusClip.ts';
import type { Area, SceneData } from './types';

type Point=[number,number];
type Vertex={point:Point;distance:number};

/** Clip triangulated surfaces to the context band at a coarse 24m resolution.
 *  Native ShapeGeometry preserves the source outlines and islands; no boolean library.
 */
export function contextSurface(area:Area,ring:Point[]):THREE.BufferGeometry {
  const positions:number[]=[];
  const vertex=(point:Point):Vertex=>({point,distance:distanceToBoundary(point,ring)*(inCampus(point,ring)?-1:1)});
  function cut(polygon:Vertex[],limit:number,above:boolean):Vertex[] {
    const out:Vertex[]=[];
    const inside=(p:Vertex)=>above?p.distance>=limit:p.distance<=limit;
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      if(inside(a)!==inside(b)) {
        let lo=a,hi=b;
        for(let j=0;j<13;j++) {
          const mid=vertex([(lo.point[0]+hi.point[0])/2,(lo.point[1]+hi.point[1])/2]);
          if(inside(mid)===inside(a))lo=mid;else hi=mid;
        }
        out.push(inside(lo)?lo:hi);
      }
      if(inside(b))out.push(b);
    }
    return out;
  }
  function triangle(a:Vertex,b:Vertex,c:Vertex):void {
    const edges=[Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1]),Math.hypot(b.point[0]-c.point[0],b.point[1]-c.point[1]),Math.hypot(c.point[0]-a.point[0],c.point[1]-a.point[1])];
    const longest=Math.max(...edges),distances=[a.distance,b.distance,c.distance];
    if(Math.min(...distances)-longest>200||Math.max(...distances)+longest<0)return;
    if(longest>24) {
      const vertices=[a,b,c],i=edges.indexOf(longest),start=vertices[i],end=vertices[(i+1)%3],other=vertices[(i+2)%3];
      const mid=vertex([(start.point[0]+end.point[0])/2,(start.point[1]+end.point[1])/2]);
      triangle(start,mid,other);triangle(mid,end,other);return;
    }
    const clipped=cut(cut([a,b,c],0,true),200,false);
    for(let i=1;i<clipped.length-1;i++) {
      const [a,b,c]=[clipped[0],clipped[i],clipped[i+1]].map(v=>v.point.map(Math.fround));
      if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<.0001)continue;
      for(const [x,y]of [a,b,c])positions.push(x,.006,-y);
    }
  }
  for(const outer of area.outers) {
    const shape=new THREE.Shape(outer.map(p=>new THREE.Vector2(...p)));
    for(const hole of area.inners)if(inCampus(hole[0],outer))shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(...p))));
    const geometry=new THREE.ShapeGeometry(shape),p=geometry.attributes.position,index=geometry.index!;
    for(let i=0;i<index.count;i+=3) {
      const corners=[0,1,2].map(k=>{const n=index.getX(i+k);return vertex([p.getX(n),p.getY(n)]);});
      triangle(corners[0],corners[1],corners[2]);
    }
    geometry.dispose();
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));return geometry;
}

/** A bounded, disposable background: no textures, shadows, labels or picking. */
export function buildContext(data: SceneData): THREE.Group {
  const root=new THREE.Group();root.name='context';
  const ring=data.boundary?.pts;
  const metrics={buildings:0,roadSegments:0,areas:0,triangles:0,drawCalls:0,radius:200};
  root.userData.metrics=metrics;
  root.userData.surfaceIds=[];
  if(!ring?.length)return root;
  const buckets=new Map<string,THREE.BufferGeometry[]>();
  const background=new THREE.Color(0xd6d8c8);
  function add(bucket:string,geometry:THREE.BufferGeometry,hex:number): boolean {
    const count=(geometry.index?.count??geometry.attributes.position.count)/3;
    if(metrics.triangles+count>50000){geometry.dispose();return false;}
    const geo=geometry.index?geometry.toNonIndexed():geometry;
    if(geo!==geometry)geometry.dispose();
    geo.deleteAttribute('uv');
    if(!geo.attributes.normal)geo.computeVertexNormals();
    const positions=geo.attributes.position,colors=new Float32Array(positions.count*3);
    const base=new THREE.Color(hex),color=base.clone();
    for(let i=0;i<positions.count;i++) {
      const distance=distanceToCampus([positions.getX(i),-positions.getZ(i)],ring!);
      color.copy(base).lerp(background,THREE.MathUtils.smoothstep(distance,70,200)*.92);
      colors.set([color.r,color.g,color.b],i*3);
    }
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    if(!buckets.has(bucket))buckets.set(bucket,[]);
    buckets.get(bucket)!.push(geo);metrics.triangles+=count;return true;
  }
  function flat(points:[number,number][],y:number): THREE.BufferGeometry {
    const geo=new THREE.ShapeGeometry(new THREE.Shape(points.map(p=>new THREE.Vector2(...p))));
    geo.rotateX(-Math.PI/2);geo.translate(0,y,0);return geo;
  }
  const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
  // A low-resolution transition ground joins nearby features instead of floating islands.
  const step=32,ground:number[]=[];
  for(let x=Math.floor((Math.min(...xs)-200)/step)*step;x<Math.max(...xs)+200;x+=step) {
    for(let y=Math.floor((Math.min(...ys)-200)/step)*step;y<Math.max(...ys)+200;y+=step) {
      const distance=distanceToCampus([x+step/2,y+step/2],ring);
      if(distance<=0||distance>185)continue;
      for(const [u,v] of [[x,y],[x+step,y],[x+step,y+step],[x,y],[x+step,y+step],[x,y+step]])ground.push(u,-.18,-v);
    }
  }
  const groundGeo=new THREE.BufferGeometry();groundGeo.setAttribute('position',new THREE.Float32BufferAttribute(ground,3));
  add('ground',groundGeo,0xc5cbbb);
  for(const area of [...data.green,...data.water,...data.paving]) {
    const outer=area.outers[0];if(!outer?.length)continue;
    const isWater=data.water.includes(area)||area.kind==='pool';
    const geometry=contextSurface(area,ring);
    if(!geometry.attributes.position.count){geometry.dispose();continue;}
    if(add('surfaces',geometry,isWater?0x9bafaf:0xb7c2a7)){metrics.areas++;root.userData.surfaceIds.push(area.id);}
  }
  for(const road of clipRoads(data.roads,ring,200)) {
    const [a,b]=road.pts,mid:[number,number]=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    if(inCampus(mid,ring))continue;
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.05)continue;
    const width=Math.min(12,road.width)/2,nx=-dy/len*width,ny=dx/len*width;
    if(add('roads',flat([[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]],.018),0x999d94))metrics.roadSegments++;
  }
  const buildings=data.buildings.filter(b=>!b.inside&&b.polygon.every(p=>distanceToCampus(p,ring)<=200));
  buildings.sort((a,b)=>distanceToCampus(a.polygon[0],ring)-distanceToCampus(b.polygon[0],ring));
  for(const building of buildings) {
    const polygon=building.polygon.filter((p,i,r)=>i===0||Math.hypot(p[0]-r[i-1][0],p[1]-r[i-1][1])>2);
    if(polygon.length<3)continue;
    const geo=new THREE.ExtrudeGeometry(new THREE.Shape(polygon.map(p=>new THREE.Vector2(...p))),
      {depth:Math.max(3,building.height),bevelEnabled:false,steps:1});
    geo.rotateX(-Math.PI/2);
    if(add('buildings',geo,0xc4c3b8))metrics.buildings++;
  }
  const material=new THREE.MeshLambertMaterial({vertexColors:true});
  for(const [name,geometries] of buckets) {
    const geometry=mergeGeometries(geometries)!;
    const mesh=new THREE.Mesh(geometry,material);mesh.name='context-'+name;
    root.add(mesh);for(const g of geometries)g.dispose();metrics.drawCalls++;
  }
  return root;
}
