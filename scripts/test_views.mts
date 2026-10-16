import assert from 'node:assert/strict';
import { Box3, Vector3, PerspectiveCamera } from 'three';
import { frameBox } from '../src/landmarkViews.ts';
import { existsSync } from 'node:fs';
const box = new Box3(new Vector3(10,0,20),new Vector3(210,30,120));
const desktop = frameBox(box,50,{width:1440,height:960,usableWidth:1090});
const portrait = frameBox(box,50,{width:390,height:844});
assert.deepEqual(desktop.target.toArray(),[110,15,70]);
assert.ok(portrait.distance>desktop.distance,'portrait must fit the full building');
assert.ok(desktop.distance>Math.hypot(200,30,100)/2);
console.log('PASS full model framing and portrait fit');
// Match the physical portrait projection and the rectangle above the detail HUD.
for (const size of [[200,30,100],[100,67,95]]) {
  const viewport={width:390,height:844};
  const bounds=new Box3(new Vector3(0,0,0),new Vector3(...size));
  const fit=frameBox(bounds,50,{...viewport,usableHeight:viewport.height*.48});
  const camera=new PerspectiveCamera(50,viewport.width/viewport.height,2,18000);
  camera.setViewOffset(390,844,0,844*.18,390,844);
  camera.position.copy(fit.target).add(new Vector3(.70,.80,1).normalize().multiplyScalar(fit.distance));
  camera.lookAt(fit.target);camera.updateMatrixWorld();
  for(const x of [bounds.min.x,bounds.max.x]) for(const y of [bounds.min.y,bounds.max.y]) for(const z of [bounds.min.z,bounds.max.z]) {
    const p=new Vector3(x,y,z).project(camera);
    const px=(p.x+1)*195,py=(1-p.y)*422;
    assert.ok(px>=0&&px<=390&&py>=60&&py<=478,`portrait asset outside free viewport: ${px},${py}`);
  }
}
console.log('PASS actual portrait projection clears toolbar and detail panel');
assert.ok(existsSync(new URL('../src/campusClip.ts',import.meta.url)),'visual road clipping missing');
const { clipRoads } = await import('../src/campusClip.ts');
const ring: [number,number][] = [[0,0],[10,0],[10,10],[0,10]];
const source = {id:1,kind:'service',name:'test',width:4,pts:[[-5,5],[15,5]] as [number,number][]};
const clipped=clipRoads([source],ring);
assert.equal(clipped.length,1);
assert.deepEqual(clipped[0].pts,[[0,5],[10,5]]);
assert.deepEqual(source.pts,[[-5,5],[15,5]],'navigation data must not be mutated');
assert.equal(clipRoads([{...source,pts:[[-5,-5],[15,-5]]}],ring).length,0);
console.log('PASS crossing road clip, exterior exclusion and immutable source');
