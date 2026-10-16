import type {RoadGraph} from './types';

export type RoadPoint=[number,number];
export interface RoadSnap {edge:number;t:number;offsetMeters:number}
export interface RoadRoute {points:RoadPoint[];nodes:number[];edges:number[];distanceMeters:number}
type Link={to:number;cost:number;edge:number};

class MinHeap {
  private items:[number,number][]=[];
  push(priority:number,node:number):void {
    this.items.push([priority,node]);let i=this.items.length-1;
    while(i){const p=(i-1)>>1;if(this.items[p][0]<=priority)break;[this.items[i],this.items[p]]=[this.items[p],this.items[i]];i=p;}
  }
  pop():[number,number]|undefined {
    if(!this.items.length)return;const first=this.items[0],last=this.items.pop()!;
    if(this.items.length){this.items[0]=last;let i=0;for(;;){let m=i;for(const c of [i*2+1,i*2+2])if(c<this.items.length&&this.items[c][0]<this.items[m][0])m=c;if(m===i)break;[this.items[i],this.items[m]]=[this.items[m],this.items[i]];i=m;}}
    return first;
  }
}

/** Immutable east/north road graph. Virtual endpoints are local to each search. */
export class RoadRouter {
  readonly graph:RoadGraph;
  private adjacency:Link[][];
  private heuristicScale=1;
  private validEdges=new Set<number>();
  constructor(graph:RoadGraph){
    this.graph=graph;this.adjacency=graph.nodes.map(()=>[]);
    graph.edges.forEach(([a,b,cost],edge)=>{
      if(!graph.nodes[a]||!graph.nodes[b]||!Number.isFinite(cost)||cost<0||a===b)return;
      const length=Math.hypot(graph.nodes[b][0]-graph.nodes[a][0],graph.nodes[b][1]-graph.nodes[a][1]);
      // Co-located distinct nodes can bridge graph components, but cannot be snapped onto.
      if(length){this.validEdges.add(edge);this.heuristicScale=Math.min(this.heuristicScale,cost/length);}
      this.adjacency[a].push({to:b,cost,edge});this.adjacency[b].push({to:a,cost,edge});
    });
  }
  snap(x:number,north:number,maxDistance=140):RoadSnap|null {
    if(!Number.isFinite(x)||!Number.isFinite(north))return null;
    let best:RoadSnap|null=null,bestD=maxDistance;
    this.graph.edges.forEach(([a,b,cost],edge)=>{
      const p=this.graph.nodes[a],q=this.graph.nodes[b];if(!this.validEdges.has(edge)||!p||!q||!Number.isFinite(cost)||cost<0)return;
      const dx=q[0]-p[0],dy=q[1]-p[1],length=dx*dx+dy*dy;if(!length)return;
      const t=Math.max(0,Math.min(1,((x-p[0])*dx+(north-p[1])*dy)/length));
      const distance=Math.hypot(x-p[0]-dx*t,north-p[1]-dy*t);
      if(distance<=bestD){bestD=distance;best={edge,t,offsetMeters:distance};}
    });return best;
  }
  point(s:RoadSnap):RoadPoint {
    const [a,b]=this.graph.edges[s.edge],p=this.graph.nodes[a],q=this.graph.nodes[b];
    return [p[0]+(q[0]-p[0])*s.t,p[1]+(q[1]-p[1])*s.t];
  }
  route(start:RoadSnap,end:RoadSnap):RoadRoute|null {
    for(const s of [start,end])if(!this.validEdges.has(s.edge)||!Number.isFinite(s.t)||s.t<0||s.t>1)return null;
    const n=this.graph.nodes.length,S=n,E=n+1,sp=this.point(start),ep=this.point(end);
    const [sa,sb,sl]=this.graph.edges[start.edge],[ea,eb,el]=this.graph.edges[end.edge];
    const cost=new Float64Array(n+2).fill(Infinity),prev=new Int32Array(n+2).fill(-1),prevEdge=new Int32Array(n+2).fill(-1),closed=new Uint8Array(n+2);
    const pos=(i:number):RoadPoint=>i===S?sp:i===E?ep:this.graph.nodes[i];
    const heuristic=(i:number)=>Math.hypot(pos(i)[0]-ep[0],pos(i)[1]-ep[1])*this.heuristicScale;
    const heap=new MinHeap();cost[S]=0;heap.push(heuristic(S),S);
    for(let item=heap.pop();item;item=heap.pop()){
      const u=item[1];if(closed[u])continue;closed[u]=1;if(u===E)break;
      const links:Link[]=u===S?[{to:sa,cost:sl*start.t,edge:start.edge},{to:sb,cost:sl*(1-start.t),edge:start.edge}]:[...this.adjacency[u]];
      if(u===S&&start.edge===end.edge)links.push({to:E,cost:sl*Math.abs(start.t-end.t),edge:start.edge});
      if(u===ea)links.push({to:E,cost:el*end.t,edge:end.edge});
      if(u===eb)links.push({to:E,cost:el*(1-end.t),edge:end.edge});
      for(const link of links){const next=cost[u]+link.cost;if(!closed[link.to]&&next<cost[link.to]){cost[link.to]=next;prev[link.to]=u;prevEdge[link.to]=link.edge;heap.push(next+heuristic(link.to),link.to);}}
    }
    if(!Number.isFinite(cost[E]))return null;
    const chain:number[]=[],edges:number[]=[];for(let u=E;u!==S;u=prev[u]){if(u<0)return null;chain.push(u);edges.push(prevEdge[u]);}chain.push(S);chain.reverse();edges.reverse();
    const points:RoadPoint[]=[];for(const i of chain){const p=pos(i),last=points.at(-1);if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>1e-8)points.push([...p]);}
    return {points,nodes:chain.filter(i=>i<n),edges,distanceMeters:cost[E]};
  }
}
