import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildTrees} from '../src/trees.ts';
const square=(x0:number,y0:number,x1:number,y1:number)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]] as [number,number][];
const green=[{id:1,name:'',kind:'grass',outers:[square(0,0,150,150)],inners:[]},
  {id:2,name:'',kind:'pitch',sport:'soccer',outers:[square(30,30,110,110)],inners:[]}];
const b={id:3,name:'test',inside:true,type:'yes',style:'lab',landmark:'',height:12,heightSource:'default' as const,area:400,polygon:square(5,5,25,25),holes:[]};
const group=new THREE.Group();buildTrees(group,green,[],[],[b],square(0,0,150,150));
const points:THREE.Vector3[]=[];
for(const mesh of group.children) {
  if(!(mesh instanceof THREE.InstancedMesh)||mesh.material.color.getHex()!==0xffffff)continue;
  for(let i=0;i<mesh.count;i++){
    const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);const p=new THREE.Vector3().setFromMatrixPosition(matrix),x=p.x,y=-p.z;
    assert.ok(!(x>=27&&x<=113&&y>=27&&y<=113),'trees must leave mapped sports fields and their edge clear');
    const dx=Math.max(5-x,0,x-25),dy=Math.max(5-y,0,y-25);
    assert.ok(Math.hypot(dx,dy)>=4,'tree crowns must clear building facades');
    for(const q of points)assert.ok(p.distanceTo(q)>=6,'avoid coincident avenue and scattered trees');points.push(p);
  }
}
assert.ok(points.length>0);
console.log('PASS sports/facade clearance and tree spacing',points.length,'trees');
