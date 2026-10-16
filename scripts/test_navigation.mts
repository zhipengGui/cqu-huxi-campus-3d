import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Navigator} from '../src/navigation.ts';
import {RoadRouter,type RoadSnap} from '../src/routing.ts';
import {existsSync,readFileSync} from 'node:fs';
import {routeTurns} from '../src/navigationPanel.ts';

const graph={nodes:[[0,0],[100,0],[100,100],[200,100]] as [number,number][],edges:[[0,1,100],[1,2,100],[2,3,100]] as [number,number,number][]};
const nav=new Navigator(new THREE.Scene(),graph);let status='';nav.onStatus=t=>status=t;
nav.clickGround(20,0);nav.clickGround(180,-100);
assert.match(status,/260 m/,'route must retain both road corners, not cut diagonally from the start');
const previousRoute=nav.result,previousStart=nav.start,previousEnd=nav.end;
nav.clickGround(10000,10000);
assert.equal(nav.result,previousRoute,'a distant invalid replacement click must retain the existing route');
assert.equal(nav.start,previousStart);assert.equal(nav.end,previousEnd);assert.match(status,/附近没有道路/);
const fork={nodes:[[50,50],[50,55],[0,0],[100,0],[100,50]] as [number,number][],edges:[[0,1,5],[0,2,Math.hypot(50,50)],[0,4,50],[4,3,50],[2,3,100]] as [number,number,number][]};
const n2=new Navigator(new THREE.Scene(),fork);n2.onStatus=t=>status=t;
n2.clickGround(50,-50.5);n2.clickGround(90,0);
assert.match(status,/111 m/,'route must include the terminal edge cost when choosing the shortest path');
console.log('PASS real Navigator retains corners and chooses the cheaper terminal approach');

// Independent all-pairs oracle on small augmented graphs, including rounded weights.
let seed=417;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let trial=0;trial<100;trial++){
  const nodes=Array.from({length:8},()=>[random()*100,random()*100] as [number,number]);
  const edges:[number,number,number][]=[];
  for(let a=0;a<8;a++)for(let b=a+1;b<8;b++)if(b===a+1||random()<.22)edges.push([a,b,Math.round(Math.hypot(nodes[a][0]-nodes[b][0],nodes[a][1]-nodes[b][1])*10)/10]);
  const g={nodes,edges},before=JSON.stringify(g),r=new RoadRouter(g);
  for(let run=0;run<10;run++){
    const s:RoadSnap={edge:Math.floor(random()*edges.length),t:random(),offsetMeters:0},e:RoadSnap={edge:Math.floor(random()*edges.length),t:random(),offsetMeters:0};
    const S=8,E=9,d=Array.from({length:10},(_,i)=>Array.from({length:10},(_,j)=>i===j?0:Infinity));
    const add=(a:number,b:number,c:number)=>{d[a][b]=Math.min(d[a][b],c);};
    for(const [a,b,c]of edges){add(a,b,c);add(b,a,c);}
    const [sa,sb,sl]=edges[s.edge],[ea,eb,el]=edges[e.edge];add(S,sa,sl*s.t);add(S,sb,sl*(1-s.t));add(ea,E,el*e.t);add(eb,E,el*(1-e.t));
    if(s.edge===e.edge)add(S,E,sl*Math.abs(s.t-e.t));
    for(let k=0;k<10;k++)for(let i=0;i<10;i++)for(let j=0;j<10;j++)d[i][j]=Math.min(d[i][j],d[i][k]+d[k][j]);
    const result=r.route(s,e);assert.ok(result);assert.ok(Math.abs(result.distanceMeters-d[S][E])<1e-7,'A* must match independent Floyd-Warshall shortest distance');
    assert.deepEqual(result.points[0],r.point(s));assert.deepEqual(result.points.at(-1),r.point(e));
    assert.ok(Math.abs(r.route(e,s)!.distanceMeters-result.distanceMeters)<1e-7);
  }
  assert.equal(JSON.stringify(g),before,'search must not mutate the original graph');
}
const split=new RoadRouter({nodes:[[0,0],[10,0],[100,0],[110,0]],edges:[[0,1,10],[2,3,10],[0,0,0]]});
assert.equal(split.route(split.snap(2,0)!,split.snap(108,0)!),null);
assert.equal(split.snap(500,500,10),null);assert.equal(split.snap(NaN,0),null);
assert.equal(split.route({edge:2,t:.5,offsetMeters:0},split.snap(2,0)!),null);
assert.equal(split.route({edge:0,t:NaN,offsetMeters:0},split.snap(2,0)!),null);
const same=new RoadRouter(graph),s=same.snap(20,0)!,e=same.snap(80,0)!;
assert.ok(Math.abs(same.route(s,e)!.distanceMeters-60)<1e-8);assert.ok(Math.abs(same.route(e,s)!.distanceMeters-60)<1e-8);
assert.equal(same.route(s,s)!.distanceMeters,0);
const bridge=new RoadRouter({nodes:[[0,0],[10,0],[10,0],[20,0]],edges:[[0,1,10],[1,2,0],[2,3,10]]});
assert.equal(bridge.route(bridge.snap(5,0)!,bridge.snap(15,0)!)?.distanceMeters,10,'a zero-length edge between distinct nodes must preserve connectivity');
assert.deepEqual(nav.result!.points,[[20,0],[100,0],[100,100],[180,100]],'rendered route must retain road corners');
console.log('PASS 1,000 oracle comparisons, reverse/same edge, disconnected/invalid input and graph immutability');
assert.ok(existsSync(new URL('../data/entrances.json',import.meta.url)),'landmarks and gates need explicitly labelled approach-point data');
const {resolveAccess}=await import('../src/accessPoints.ts');
const data=JSON.parse(readFileSync(new URL('../public/data/scene.json',import.meta.url),'utf8'));
const definitions=JSON.parse(readFileSync(new URL('../data/entrances.json',import.meta.url),'utf8'));
const campus=new RoadRouter(data.graph),anchors=definitions.map((d:any)=>resolveAccess(d.name,[0,0],campus));
assert.equal(anchors.length,11);assert.ok(anchors.every((a:any)=>a&&!a.confirmed&&a.label.includes('附近道路')),'unverified approaches must not be advertised as confirmed entrances');
let pairs=0;for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++){assert.ok(campus.route(anchors[i].snap,anchors[j].snap));pairs++;}
assert.equal(pairs,55);console.log('PASS 11 explicitly unverified approaches and 55 campus landmark/gate routes');
assert.deepEqual(routeTurns([[0,0],[100,0],[100,100]]),['前方左转']);
assert.deepEqual(routeTurns([[0,0],[100,0],[100,-100]]),['前方右转']);
assert.deepEqual(routeTurns([[0,0],[100,0],[200,0]]),[]);
