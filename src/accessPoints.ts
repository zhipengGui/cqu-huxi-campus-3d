import definitions from '../data/entrances.json' with {type:'json'};
import type {RoadPoint,RoadRouter,RoadSnap} from './routing.ts';

export interface AccessTarget {point:RoadPoint;snap:RoadSnap;label:string;confirmed:boolean}
export function resolveAccess(name:string,fallback:RoadPoint,router:RoadRouter):AccessTarget|null {
  const entry=definitions.find(d=>d.name===name),point=entry?.point??fallback;
  const snap=router.snap(point[0],point[1],entry?20:320);if(!snap)return null;
  return {point:router.point(snap),snap,label:entry?.label??`${name}附近道路`,confirmed:entry?.confirmed??false};
}
