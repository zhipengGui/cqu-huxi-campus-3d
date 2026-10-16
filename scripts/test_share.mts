import assert from 'node:assert/strict';
import {parseSharedView,formatSharedView,sharedDistanceScale} from '../src/shareView.ts';
import {readFileSync} from 'node:fs';
import {Vector3,PerspectiveCamera} from 'three';
import {framePoints} from '../src/landmarkViews.ts';
const state={position:[200.12,160.32,180.5],target:[100,0,100],collapsed:true,
  offset:[.02,.18],viewport:[1440,960],preset:'dusk',place:'田径场'};
assert.deepEqual(parseSharedView(formatSharedView(state)),state,'share must preserve framing, panel, light and current place');
const legacy=parseSharedView('#v=100,120,150,0,0,0');
assert.deepEqual(legacy?.position,[100,120,150]);assert.deepEqual(legacy?.target,[0,0,0]);
for(const hash of ['#v=NaN,1,2,3,4,5','#v=1,2,3,4,5','#v=0,0,0,0,0,0','#v=1e100,2,3,4,5,6','#v=0,9000,0,0,0,0'])assert.equal(parseSharedView(hash),null,'reject invalid or out-of-range shared camera');
assert.equal(parseSharedView('#v=0,100,100,0,0,0&light=unexpected')?.preset,'day');
console.log('PASS shared view roundtrip, legacy links and invalid camera rejection');
const data=JSON.parse(readFileSync(new URL('../public/data/scene.json',import.meta.url),'utf8'));
const points=data.boundary.pts.map(([x,y]:number[])=>new Vector3(x,0,-y));
for(const b of data.buildings.filter((b:any)=>b.inside))for(const [x,y]of b.polygon)points.push(new Vector3(x,b.height,-y));
const layouts=[{width:1440,height:960,rect:{left:308,right:1368,top:98,bottom:936}},
  {width:390,height:844,rect:{left:12,right:378,top:79,bottom:384}}];
for(const [from,to] of [[layouts[0],layouts[1]],[layouts[1],layouts[0]]]) {
  const dir=new Vector3(.28,1.45,1).normalize(),fit=framePoints(points,50,from,from.rect,dir);
  const depths=points.map(p=>p.clone().sub(fit.target).dot(dir));
  const view={...state,position:fit.target.clone().addScaledVector(dir,fit.distance).toArray(),target:fit.target.toArray(),viewport:[from.width,from.height],frame:[from.rect.right-from.rect.left,from.rect.bottom-from.rect.top]};
  const scale=sharedDistanceScale(view,to,{width:to.rect.right-to.rect.left,height:to.rect.bottom-to.rect.top},[Math.min(...depths),Math.max(...depths)]);
  const camera=new PerspectiveCamera(50,to.width/to.height,2,18000);
  camera.position.copy(fit.target).addScaledVector(dir,fit.distance*scale);camera.lookAt(fit.target);
  camera.setViewOffset(to.width,to.height,to.width/2-(to.rect.left+to.rect.right)/2,to.height/2-(to.rect.top+to.rect.bottom)/2,to.width,to.height);camera.updateMatrixWorld();
  for(const p of points){const v=p.clone().project(camera),x=(v.x+1)*to.width/2,y=(1-v.y)*to.height/2;
    assert.ok(x>=to.rect.left&&x<=to.rect.right&&y>=to.rect.top&&y<=to.rect.bottom,'cross-device campus share must retain the full subject');}
}
console.log('PASS actual campus sharing desktop→phone and phone→desktop');
