import * as THREE from "three";

/** Fit the complete asset into the unoccluded viewport, including portrait screens. */
export function frameBox(box: THREE.Box3, fov: number,
  viewport: { width: number; height: number; usableWidth?: number; usableHeight?: number },
): { target: THREE.Vector3; distance: number } {
  const target = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  // Cropping UI space does not change the physical camera aspect or its FOV.
  const vertical = Math.atan(tangent * (viewport.usableHeight ?? viewport.height) / viewport.height);
  const horizontal = Math.atan(tangent * (viewport.usableWidth ?? viewport.width) / viewport.height);
  const radius = size.length() / 2;
  return { target, distance: Math.max(55, radius / Math.sin(Math.min(vertical, horizontal)) * 1.12) };
}

export function placeRoot(mesh: THREE.Mesh): THREE.Object3D {
  return (mesh.userData.pickRoot as THREE.Object3D | undefined) ?? mesh;
}

export function boundsOf(mesh: THREE.Mesh): THREE.Box3 {
  return new THREE.Box3().setFromObject(placeRoot(mesh));
}

/** Fit real campus points to a centered free rectangle without a guessed distance factor. */
export function framePoints(points: THREE.Vector3[], fov: number,
  viewport: {width:number;height:number},rect: {left:number;right:number;top:number;bottom:number},direction: THREE.Vector3,
): {target:THREE.Vector3;distance:number;offset:{x:number;y:number}} {
  const target=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const dir=direction.clone().normalize(),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),dir).normalize();
  const up=new THREE.Vector3().crossVectors(dir,right).normalize();
  const tangent=Math.tan(THREE.MathUtils.degToRad(fov/2));
  const horizontal=tangent*(rect.right-rect.left)/viewport.height*.94;
  const vertical=tangent*(rect.bottom-rect.top)/viewport.height*.94;
  let distance=55;
  for(const point of points) {
    const offset=point.clone().sub(target),depth=offset.dot(dir);
    distance=Math.max(distance,depth+Math.abs(offset.dot(right))/horizontal,depth+Math.abs(offset.dot(up))/vertical);
  }
  return {target,distance,offset:{x:viewport.width/2-(rect.left+rect.right)/2,y:viewport.height/2-(rect.top+rect.bottom)/2}};
}
