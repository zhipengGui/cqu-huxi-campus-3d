import * as THREE from "three";

/** Fit the complete asset into the unoccluded viewport, including portrait screens. */
export function frameBox(box: THREE.Box3, fov: number, aspect: number): { target: THREE.Vector3; distance: number } {
  const target = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const vertical = THREE.MathUtils.degToRad(fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(.25, aspect));
  const radius = size.length() / 2;
  return { target, distance: Math.max(55, radius / Math.sin(Math.min(vertical, horizontal)) * 1.12) };
}

export function placeRoot(mesh: THREE.Mesh): THREE.Object3D {
  return (mesh.userData.pickRoot as THREE.Object3D | undefined) ?? mesh;
}

export function boundsOf(mesh: THREE.Mesh): THREE.Box3 {
  return new THREE.Box3().setFromObject(placeRoot(mesh));
}
