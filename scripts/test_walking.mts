import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
assert.ok(existsSync(new URL('../src/walkCollision.ts',import.meta.url)),'walking needs a tested collision world before enabling movement');
const {WalkWorld}=await import('../src/walkCollision.ts');
const rect=(x1:number,y1:number,x2:number,y2:number):[number,number][]=>[[x1,y1],[x2,y1],[x2,y2],[x1,y2]];
const ground={boundary:{pts:rect(-20,-20,20,20)},roads:[{pts:[[-19,0],[19,0]],width:10}],paving:[{outers:[rect(-18,-18,18,18)],inners:[]}],buildings:[{inside:true,polygon:rect(-.1,-10,.1,10),holes:[]}],water:[{outers:[rect(5,5,9,9)],inners:[]}]};
const before=JSON.stringify(ground),world=new WalkWorld(ground as any);
assert.ok(world.isFree([-2,0]));assert.ok(!world.isFree([0,0]));assert.ok(!world.isFree([6,6]));assert.ok(!world.isFree([19.9,0]));
const blocked=world.move([-2,0],[4,0]);assert.ok(blocked[0]<=-.4+1e-7,'must not cross a thin wall');
const slide=world.move([-.5,-1],[1,3]);assert.ok(slide[0]<=-.4+1e-7&&slide[1]>.5,'diagonal motion must slide along the wall');
const pond=world.move([4,6],[100,0]);assert.ok(pond[0]<=4.7+1e-7,'large deltas must not tunnel across water');
assert.ok(world.isFree(world.findSpawn([0,0],[[-2,0],[2,0]])!));assert.equal(JSON.stringify(ground),before);
const courtyard=new WalkWorld({...ground,water:[],buildings:[{inside:true,polygon:rect(-8,-8,8,8),holes:[rect(-2,-2,2,2)]}]} as any);
assert.ok(courtyard.isFree([0,0]),'real courtyard holes must remain open');assert.ok(!courtyard.isFree([3,0]));assert.ok(!courtyard.isFree([1.9,0]));
const roadsOnly=new WalkWorld({...ground,buildings:[],water:[],paving:[]} as any);assert.ok(roadsOnly.isFree([0,2]));assert.ok(!roadsOnly.isFree([0,9]),'unknown ground must not silently become walkable');
console.log('PASS walls, water, boundary, sliding, swept steps, courtyard holes, road-only scope and immutable data');
const data=JSON.parse(readFileSync(new URL('../public/data/scene.json',import.meta.url),'utf8')),campus=new WalkWorld(data);
const access=JSON.parse(readFileSync(new URL('../data/entrances.json',import.meta.url),'utf8'));
for(const name of ['综合楼','第一教学楼','信息技术科研楼','图书馆']){
  const point=access.find((a:any)=>a.name===name).point,spawn=campus.findSpawn(point,data.graph.nodes);
  assert.ok(spawn&&campus.isFree(spawn),'landmark approach needs a safe walkable spawn: '+name);
  assert.ok(Math.hypot(spawn[0]-point[0],spawn[1]-point[1])<=100,'spawn must stay near selected landmark');
}
console.log('PASS four real campus landmark walking spawns');
assert.ok(existsSync(new URL('../data/walk_spawns.json',import.meta.url)),'walk entry needs curated outdoor positions and headings instead of ambiguous nearest-edge headings');
const starts=JSON.parse(readFileSync(new URL('../data/walk_spawns.json',import.meta.url),'utf8'));
assert.equal(starts.length,4);
for(const start of starts){
  assert.ok(campus.isFree(start.point),'curated start must be walkable: '+start.name);
  const dx=start.lookAt[0]-start.point[0],dy=start.lookAt[1]-start.point[1],length=Math.hypot(dx,dy);
  assert.ok(length>1);const moved=campus.move(start.point,[dx/length,dy/length]);
  assert.ok(Math.hypot(moved[0]-start.point[0],moved[1]-start.point[1])>.9,'curated heading needs a clear initial road segment: '+start.name);
}
console.log('PASS four curated outdoor positions and initial road movement');
