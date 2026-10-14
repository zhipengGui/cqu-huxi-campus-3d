import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** 轻量镜头飞行：直线插值相机位置与观察目标，缓入缓出。无第三方依赖。 */

let cancelCurrent: (() => void) | null = null;

export function cancelFly(): void {
  cancelCurrent?.();
  cancelCurrent = null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 飞到 target 点，落点距离 distance（保持当前方位角与俯仰角） */
export function flyTo(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  target: THREE.Vector3,
  distance: number,
  durationMs = 1100,
): void {
  cancelFly();
  const startCam = camera.position.clone();
  const startTgt = controls.target.clone();
  const dir = startCam.clone().sub(startTgt);
  if (dir.lengthSq() < 1e-6) dir.set(300, 400, 500);
  dir.normalize();
  // 系统开启「减少动态效果」时直接跳转，不做飞行动画
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    camera.position.copy(target).add(dir.clone().multiplyScalar(distance));
    controls.target.copy(target);
    return;
  }
  const endCam = target.clone().add(dir.multiplyScalar(distance));

  let raf = 0;
  let cancelled = false;
  const t0 = performance.now();
  const step = (): void => {
    if (cancelled) return;
    const t = Math.min(1, (performance.now() - t0) / durationMs);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(startCam, endCam, e);
    controls.target.lerpVectors(startTgt, target, e);
    if (t < 1) {
      raf = requestAnimationFrame(step);
    } else {
      cancelCurrent = null;
    }
  };
  raf = requestAnimationFrame(step);
  cancelCurrent = (): void => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
