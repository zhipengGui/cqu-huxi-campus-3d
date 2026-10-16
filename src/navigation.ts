import * as THREE from 'three';
import type {RoadGraph} from './types';
import {RoadRouter,type RoadSnap,type RoadRoute} from './routing.ts';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {resolveAccess} from './accessPoints.ts';

export interface NavEndpoint {snap:RoadSnap;label:string}
function marker(color:number):THREE.Mesh {
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,.8,20),new THREE.MeshBasicMaterial({color}));
  mesh.visible=false;mesh.renderOrder=5;return mesh;
}

/** UI adapter; all route points are rendered without cutting road corners. */
export class Navigator {
  active=false;
  onStatus:(text:string)=>void=()=>{};
  onChange:()=>void=()=>{};
  readonly router:RoadRouter;
  start:NavEndpoint|null=null;
  end:NavEndpoint|null=null;
  result:RoadRoute|null=null;
  private scene:THREE.Scene;
  private routeMesh:THREE.Group|null=null;
  private markerA=marker(0x2e9e4f);
  private markerB=marker(0xd23f31);
  constructor(scene:THREE.Scene,graph:RoadGraph){this.scene=scene;this.router=new RoadRouter(graph);scene.add(this.markerA,this.markerB);}
  setActive(v:boolean):void {this.active=v;if(!v)this.clearRoute();else this.recompute();}
  snap(x:number,z:number,maxDistance=140):RoadSnap|null {return this.router.snap(x,-z,maxDistance);}
  setStart(x:number,z:number,label='地图起点',maxDistance=140):boolean {return this.setEndpoint('start',x,z,label,maxDistance);}
  setEnd(x:number,z:number,label='地图终点',maxDistance=140):boolean {return this.setEndpoint('end',x,z,label,maxDistance);}
  private setEndpoint(which:'start'|'end',x:number,z:number,label:string,maxDistance:number):boolean {
    const snap=this.snap(x,z,maxDistance);if(!snap){this.onStatus('附近没有道路，请点更靠近道路的位置');return false;}
    this[which]={snap,label};this.recompute();return true;
  }
  clickGround(x:number,z:number):void {
    if(this.result){this.clearRoute();this.setStart(x,z);}else if(!this.start)this.setStart(x,z);else this.setEnd(x,z);
  }
  setEndBuilding(x:number,z:number,name='建筑'):void {
    const access=resolveAccess(name,[x,-z],this.router);if(!access){this.onStatus('该地点附近没有可导航道路');return;}
    this.end={snap:access.snap,label:access.label};this.recompute();
  }
  swap():void {[this.start,this.end]=[this.end,this.start];this.recompute();}
  clearRoute():void {this.start=null;this.end=null;this.recompute();}
  private clearDrawing():void {
    if(this.routeMesh){this.scene.remove(this.routeMesh);this.routeMesh.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh){m.geometry.dispose();for(const mat of Array.isArray(m.material)?m.material:[m.material])mat.dispose();}});this.routeMesh=null;}
    this.result=null;
  }
  recompute():void {
    this.clearDrawing();
    for(const [endpoint,m]of [[this.start,this.markerA],[this.end,this.markerB]] as const){m.visible=!!endpoint;if(endpoint){const [x,y]=this.router.point(endpoint.snap);m.position.set(x,.4,-y);}}
    let status=this.start?'起点已设：点击楼栋或地面设置终点':this.end?'终点已设：请设置起点':'点击道路或地面设置起点';
    if(this.start&&this.end){
      const route=this.router.route(this.start.snap,this.end.snap);
      if(!route)status='未找到可达路线';
      else if(route.distanceMeters<1)status='起点和终点太近了';
      else {
        this.result=route;const root=new THREE.Group(),mat=new THREE.MeshBasicMaterial({color:0xff7a1a});
        // Each segment follows the road exactly; merge for a single draw call.
        const up=new THREE.Vector3(0,1,0),geometries:THREE.BufferGeometry[]=[];
        for(let i=1;i<route.points.length;i++){
          const a=new THREE.Vector3(route.points[i-1][0],.28,-route.points[i-1][1]),b=new THREE.Vector3(route.points[i][0],.28,-route.points[i][1]),d=b.clone().sub(a),length=d.length();
          if(length<1e-6)continue;
          const g=new THREE.CylinderGeometry(.7,.7,length,6);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,d.normalize()));const center=a.add(b).multiplyScalar(.5);g.translate(center.x,center.y,center.z);geometries.push(g);
        }
        const geometry=mergeGeometries(geometries);for(const g of geometries)g.dispose();
        if(geometry){const mesh=new THREE.Mesh(geometry,mat);mesh.renderOrder=6;root.add(mesh);}else mat.dispose();this.routeMesh=root;this.scene.add(root);
        status=`路线 ${Math.round(route.distanceMeters)} m · 步行约 ${Math.max(1,Math.round(route.distanceMeters/80))} 分钟`;
      }
    }
    this.onStatus(status);this.onChange();
  }
}
