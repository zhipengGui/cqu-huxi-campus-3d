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
