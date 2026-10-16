import * as THREE from 'three';
import {PointerLockControls} from 'three/examples/jsm/controls/PointerLockControls.js';
import type {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {WalkWorld} from './walkCollision';
import type {RoadPoint} from './routing';

export class Walking {
  active=false;
  readonly pointer:PointerLockControls;
  private keys=new Set<string>();
  private attempt=0;
  private camera:THREE.PerspectiveCamera;
  private orbit:OrbitControls;
  private world:WalkWorld;
  private changed:(active:boolean,message?:string)=>void;
  private snapshot:{position:THREE.Vector3;quaternion:THREE.Quaternion;target:THREE.Vector3;fov:number;near:number;far:number;view:THREE.PerspectiveCamera['view']}|null=null;
  constructor(camera:THREE.PerspectiveCamera,orbit:OrbitControls,canvas:HTMLElement,world:WalkWorld,changed:(active:boolean,message?:string)=>void){
    this.camera=camera;this.orbit=orbit;this.world=world;this.changed=changed;this.pointer=new PointerLockControls(camera,canvas);
    this.pointer.minPolarAngle=.12;this.pointer.maxPolarAngle=Math.PI-.12;
    this.pointer.addEventListener('lock',()=>{if(!this.active)this.pointer.unlock();});
    this.pointer.addEventListener('unlock',()=>{if(this.active)this.exit();});
    canvas.ownerDocument.addEventListener('pointerlockerror',()=>{if(this.active)this.exit('无法锁定鼠标，请重新点击开始或返回地图。');});
    window.addEventListener('blur',()=>this.exit());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.exit();});
    document.addEventListener('keydown',e=>{if(this.active&&this.pointer.isLocked&&['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(e.code)){this.keys.add(e.code);e.preventDefault();}});
    document.addEventListener('keyup',e=>this.keys.delete(e.code));
  }
  enter(point:RoadPoint,lookAt:RoadPoint):boolean {
    if(this.active||!this.world.isFree(point))return false;
    const c=this.camera,o=this.orbit;
    this.snapshot={position:c.position.clone(),quaternion:c.quaternion.clone(),target:o.target.clone(),fov:c.fov,near:c.near,far:c.far,view:c.view?{...c.view}:null};
    // Flush residual orbit damping before giving the camera to another controller.
    const damping=o.enableDamping;o.enableDamping=false;o.update();o.enableDamping=damping;o.enabled=false;
    this.active=true;this.keys.clear();c.clearViewOffset();c.fov=60;c.near=.1;c.far=4000;c.updateProjectionMatrix();
    c.position.set(point[0],1.65,-point[1]);
    const direction=new THREE.Vector3(lookAt[0]-point[0],0,-lookAt[1]+point[1]);if(direction.lengthSq()<.01)direction.set(0,0,-1);
    c.lookAt(c.position.clone().add(direction));this.update(0);this.changed(true);
    const attempt=++this.attempt;try{
      // r170's convenience lock() drops the browser Promise; handle rejections here.
      const request=this.pointer.domElement!.requestPointerLock() as Promise<void>|undefined;
      request?.catch(()=>{if(this.attempt===attempt)this.exit('无法锁定鼠标，请重新点击开始或返回地图。');});
    }catch{this.exit('无法锁定鼠标，请重新点击开始或返回地图。');return false;}return true;
  }
  exit(message?:string):void {
    if(!this.active||!this.snapshot)return;
    this.active=false;this.attempt++;this.keys.clear();const s=this.snapshot;this.snapshot=null;
    if(this.pointer.isLocked)this.pointer.unlock();
    const c=this.camera;c.position.copy(s.position);c.quaternion.copy(s.quaternion);this.orbit.target.copy(s.target);
    c.fov=s.fov;c.near=s.near;c.far=s.far;c.aspect=innerWidth/innerHeight;
    if(s.view){const v=s.view;c.setViewOffset(innerWidth,innerHeight,v.offsetX/v.fullWidth*innerWidth,v.offsetY/v.fullHeight*innerHeight,innerWidth,innerHeight);if(!v.enabled)c.clearViewOffset();}
    else {c.view=null;c.updateProjectionMatrix();}
    this.orbit.enabled=true;this.orbit.update();
    this.changed(false,message);
  }
  update(seconds:number):void {
    if(!this.active)return;
    const c=this.camera,forward=c.getWorldDirection(new THREE.Vector3());forward.y=0;forward.normalize();
    if(this.pointer.isLocked){
      const right=new THREE.Vector3().crossVectors(forward,c.up),delta=new THREE.Vector3();
      delta.addScaledVector(forward,Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS')));
      delta.addScaledVector(right,Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA')));
      if(delta.lengthSq()){
        const speed=this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')?8:3.5;
        delta.normalize().multiplyScalar(speed*Math.max(0,Math.min(.05,seconds)));
        const [x,north]=this.world.move([c.position.x,-c.position.z],[delta.x,-delta.z]);c.position.set(x,1.65,-north);
      }
    }
    this.orbit.target.copy(c.position).addScaledVector(forward,10);
  }
}
