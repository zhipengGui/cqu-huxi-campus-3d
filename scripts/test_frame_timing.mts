import assert from 'node:assert/strict';
import {advanceFrame} from '../src/frameTiming.ts';
for(const hz of [60,75,90,120,144,165,240]) {
  let last=0,frames=0;
  for(let i=1;i<=hz*2;i++){const next=advanceFrame(last,i*1000/hz);if(next!==null){last=next;frames++;}}
  assert.ok(frames>=118&&frames<=121,`60fps cap should preserve frame budget on ${hz}Hz, got ${frames/2}fps`);
}
assert.equal(advanceFrame(100,105),null);
assert.ok(advanceFrame(100,10000)!>9980,'resume after a background pause without replaying missed frames');
console.log('PASS 60fps scheduling on 60/75/90/120/144/165/240Hz and background resume');
