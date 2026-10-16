import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {buildSportsMarks} from '../src/sports.ts';
import {campusAreas} from '../src/campusClip.ts';

function court(angle:number) {
  const c=Math.cos(angle),s=Math.sin(angle);
  const point=([u,v]:number[])=>[120+u*c-v*s,80+u*s+v*c] as [number,number];
  const area={id:1,name:'',kind:'pitch',sport:'basketball',outers:[[[-7.7,-14.8],[7.7,-14.8],[7.7,14.8],[-7.7,14.8]].map(point)],inners:[]};
  const group=new THREE.Group();buildSportsMarks(group,[area]);group.updateMatrixWorld(true);
  const local=(p:THREE.Vector3)=>[(p.x-120)*c+(-p.z-80)*s,-(p.x-120)*s+(-p.z-80)*c];
  let floorVertices=0;
  group.traverse(o=>{
    if(!(o instanceof THREE.Mesh)||o.material.color.getHex()!==0x347e69)return;
    const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++) {
      const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld),[u,w]=local(v);
      assert.ok(Math.abs(u)<=7.71&&Math.abs(w)<=14.81,'basketball coloured floor must fit the mapped rotated footprint');floorVertices++;
    }
  });
  assert.ok(floorVertices>0);
  const [x,y]=point([6,0]);
  const ray=new THREE.Raycaster(new THREE.Vector3(x,10,-y),new THREE.Vector3(0,-1,0));
  const hit=ray.intersectObject(group,true)[0];
  assert.ok(hit&&hit.object.material.color.getHex()===0xf5f3e7,'basketball half-way line must cross the width, including after rotation');
  let rimVertices=0;
  group.traverse(o=>{
    if(!(o instanceof THREE.Mesh)||o.material.color.getHex()!==0xe5762c)return;
    const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++) {
      const [u,v]=local(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));
      assert.ok(Math.abs(u)<.4&&Math.abs(v)>11.8&&Math.abs(v)<13,'both hoops must sit over the two keys');rimVertices++;
    }
  });
  assert.ok(rimVertices>0);
}
for(const angle of [0,Math.PI/2,.31])court(angle);
console.log('PASS basketball floor, cross-court line and hoop alignment at three rotations');

for(const [sport,width,length] of [['soccer',68,105],['tennis',16,26],['badminton',7,15],['volleyball',11,20]] as const) {
  const group=new THREE.Group();buildSportsMarks(group,[{id:2,name:'',kind:'pitch',sport,outers:[[[0,0],[width,0],[width,length],[0,length]]],inners:[]}]);
  group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(width*.2,10,-length*.35),new THREE.Vector3(0,-1,0));
  assert.ok(ray.intersectObject(group,true).length,'each confirmed court needs a visible coloured surface: '+sport);
}
const data=JSON.parse(readFileSync(new URL('../public/data/scene.json',import.meta.url),'utf8'));
const before=JSON.stringify(data);const group=new THREE.Group();buildSportsMarks(group,campusAreas(data.green,data.boundary.pts));
let calls=0,triangles=0;group.traverse(o=>{if(o instanceof THREE.Mesh){calls++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
assert.ok(calls<=24&&triangles<65000,'sports must remain batched and bounded');
assert.equal(JSON.stringify(data),before,'rendering must not mutate mapped data or navigation');
console.log('PASS all mapped sports surfaces and immutable inputs',JSON.stringify({calls,triangles}));
