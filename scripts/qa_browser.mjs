import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=process.cwd().replaceAll('\\','/');
const port=9441;
const mobileOnly=process.argv.includes('--mobile-only');
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--no-proxy-server',
  '--remote-allow-origins=http://localhost:'+port,'--remote-debugging-port='+port,
  '--user-data-dir='+root+'/work/chrome-v8','--window-size=1440,960','about:blank'
],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ws;const pending=new Map();let seq=0;const errors=[];
function send(method,params={}) { const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}); }
async function evaluate(expression) { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value; }
try {
  let pages;
  for(let i=0;i<50;i++){try{pages=await(await fetch('http://localhost:'+port+'/json/list')).json();break;}catch{await delay(200);}}
  if(!pages)throw Error('Chrome CDP unavailable');
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id){const p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}}
    if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails);
    if(msg.method==='Log.entryAdded'&&msg.params.entry.level==='error')errors.push(msg.params.entry);};
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:'http://localhost:5188/'});
  let ready=false;
  for(let i=0;i<80;i++){await delay(300);ready=await evaluate('!!window.__huxi && document.querySelector("#hud-stats").textContent.startsWith("楼栋")');if(ready)break;}
  if(!ready)throw Error('Map not ready: '+await evaluate('document.body.innerText.slice(-1800)'));
  await mkdir(root+'/work/qa',{recursive:true});
  async function capture(name){await delay(1700);const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(root+'/work/qa/'+name+'.png',Buffer.from(r.data,'base64'));}
  await capture('v8-campus');
  const checks={};
  checks.context=await evaluate(`(()=>{const root=window.__huxi.scene.getObjectByName('context');let triangles=0,calls=0,shadows=false;root.traverse(o=>{if(o.isMesh){calls++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;shadows||=o.castShadow||o.receiveShadow;}});return {...root.userData.metrics,calls,triangles,shadows};})()`);
  assert.ok(checks.context.buildings>0&&checks.context.calls<=20&&checks.context.triangles<=50000&&!checks.context.shadows);
  console.log('CONTEXT',JSON.stringify(checks.context));
  assert.ok(await evaluate(`(async()=>{
    const {BuildingPicker}=await import('/src/interact.ts');const h=window.__huxi,e=h.detailAssets.find(e=>e.asset==='zonghe');
    let mesh;e.far.traverse(m=>{if(m.isMesh&&!mesh)mesh=m;});
    const p=new BuildingPicker(document.createElement('div'),h.camera,e.root,{onSelect(){},onClear(){}});p.select(mesh);
    let count=0,selected=true;e.far.traverse(m=>{if(m.isMesh){for(const mat of Array.isArray(m.material)?m.material:[m.material])if(mat.emissive){count++;selected&&=mat.emissive.getHex()===0x2a3550;}}});
    p.clearSelection();let restored=true;e.far.traverse(m=>{if(m.isMesh)for(const mat of Array.isArray(m.material)?m.material:[m.material])if(mat.emissive)restored&&=mat.emissive.getHex()===0;});
    return count>1&&selected&&restored;
  })()`),'selection must highlight the whole asset and clear completely');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'4'}));[...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent==='信息技术科研楼').click();`);
  await delay(2200);
  assert.ok(await evaluate(`document.querySelector('#pd-back').click();(()=>{const e=window.__huxi.detailAssets.find(e=>e.asset==='info');let correct=!!e.near;e.near?.traverse(m=>{if(m.isMesh)for(const mat of Array.isArray(m.material)?m.material:[m.material])if(mat.emissive)correct&&=mat.emissive.getHex()===0x0a1424;});return correct;})()`),'lazy near model must inherit night lighting');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'2'}));document.querySelector('#tl-home').click();`);
  for(const [name,label] of (mobileOnly?[]:[['zonghe','综合楼'],['teaching1','第一教学楼'],['info','信息技术科研楼'],['library','图书馆'],['likelou','理科楼'],['gym','体育馆'],['activity','学生活动中心'],['gongke','工科大楼'],['gate_north','北门'],['gate_east','东门'],['gate_west','西门']]).slice(0,process.argv.includes('--priority-only')?3:undefined)){
    await evaluate(`document.querySelector('#pd-back').click(); [...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent===${JSON.stringify(label)}).click();`);
    await delay(2000);await capture('v8-'+name);
    checks[name]=await evaluate(`({title:document.querySelector('#pd-name').textContent, detail:window.__huxi.detailAssets.map(e=>({asset:e.asset,near:!!e.near,farVisible:e.far.visible})), calls:window.__huxi.renderer.info.render.calls,triangles:window.__huxi.renderer.info.render.triangles})`);
    assert.equal(checks[name].title,label);console.log('PLACE',name,'PASS',checks[name].calls,'draw calls');
  }
  checks.views={};
  for(const [asset,label] of [['zonghe','综合楼'],['teaching1','第一教学楼'],['info','信息技术科研楼']]) {
    await evaluate(`document.querySelector('#pd-back').click();[...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent===${JSON.stringify(label)}).click();document.querySelector('[data-building-view=court]').click();`);
    const court=await evaluate(`(()=>{const h=window.__huxi,e=h.detailAssets.find(e=>e.asset===${JSON.stringify(asset)}),expected=e.root.localToWorld(e.root.userData.court.clone()),offset=h.camera.position.clone().sub(h.controls.target);return {targetError:h.controls.target.distanceTo(expected),elevation:offset.y/offset.length()};})()`);
    assert.ok(court.targetError<.01&&court.elevation>.85,'close view must target an actual courtyard: '+asset);
    await capture('v8-'+asset+'-courtyard');
    await evaluate(`document.querySelector('[data-building-view=facade]').click()`);
    const facade=await evaluate(`(()=>{const h=window.__huxi,d=h.camera.position.clone().sub(h.controls.target);return d.y/d.length();})()`);
    assert.ok(facade>0&&facade<.5,'facade view must lower the camera');checks.views[asset]={court,facade};
  }
  checks.geometry=await evaluate(`(async()=>{
    const data=await(await fetch('data/scene.json')).json(),h=window.__huxi;
    const inside=(p,r)=>{let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[j],b=r[i];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
    const awayFromEdges=(p,r)=>r.every((a,i)=>{const b=r[(i+1)%r.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)>.03;});
    const reports=[];
    for(const entry of h.detailAssets){const b=data.buildings.find(b=>b.name===entry.building.name);if(!b.holes.length)continue;let roofTriangles=0,covered=0;
      const asset=entry.near??entry.far;entry.root.updateWorldMatrix(true,true);
      asset.traverse(m=>{if(!m.isMesh||m.name!=='roof')return;const a=m.geometry.attributes.position,ix=m.geometry.index;for(let i=0;i<(ix?ix.count:a.count);i+=3){const p=h.camera.position.clone().set(0,0,0);for(let k=0;k<3;k++){const n=ix?ix.getX(i+k):i+k;p.x+=a.getX(n)/3;p.y+=a.getY(n)/3;p.z+=a.getZ(n)/3;}m.localToWorld(p);roofTriangles++;if(b.holes.some(r=>inside([p.x,-p.z],r)&&awayFromEdges([p.x,-p.z],r)))covered++;}});
      reports.push({asset:entry.asset,roofTriangles,covered});}
    return {reports,graphNodes:data.graph.nodes.length,graphEdges:data.graph.edges.length,landmarks:h.detailAssets.length};
  })()`);
  assert.equal(checks.geometry.landmarks,8);assert.equal(checks.geometry.graphNodes,2671);assert.equal(checks.geometry.graphEdges,2986);
  for(const r of checks.geometry.reports){assert.ok(r.roofTriangles>0);assert.equal(r.covered,0,r.asset+' roof covers courtyard');}
  console.log('DECODED_GLBS',JSON.stringify(checks.geometry));
  await evaluate(`document.querySelector('#pd-back').click();const input=document.querySelector('#search');input.value='第一教学楼';input.dispatchEvent(new Event('input'));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));`);
  assert.equal(await evaluate(`document.querySelector('#pd-name').textContent`),'第一教学楼');checks.search=true;
  assert.ok(await evaluate(`const toggle=document.querySelector('#layer-校园建筑');toggle.click();const hidden=window.__huxi.detailAssets.every(e=>!e.root.parent.visible);toggle.click();hidden;`),'building layer must include all GLB landmarks');checks.layers=true;
  await evaluate('document.querySelector("#quality-seg [data-q=low]").click()');await delay(300);
  assert.ok(await evaluate('window.__huxi.detailAssets.every(e=>!e.near||!e.near.visible)'),'low quality must hide all detail assets');
  await evaluate('document.querySelector("#quality-seg [data-q=auto]").click(); window.dispatchEvent(new KeyboardEvent("keydown",{key:"4"}));');
  assert.ok(await evaluate('document.body.classList.contains("night")'));
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"2"})); document.querySelector("#tour-start").click();document.querySelector("#tour-pause").click();');
  assert.equal(await evaluate('document.querySelector("#tour-name").textContent'),'图书馆');
  await evaluate('document.querySelector("#tour-exit").click();document.querySelector("#tl-home").click();');
  await delay(300);
  const road=await evaluate(`(async()=>{const data=await(await fetch('data/scene.json')).json(),{Vector3}=await import('/node_modules/.vite/deps/three.js'),{inCampus}=await import('/src/campusClip.ts');for(const [a,b,len] of data.graph.edges){if(len<30)continue;const ends=[data.graph.nodes[a],data.graph.nodes[b]];if(!ends.every(p=>inCampus(p,data.boundary.pts)))continue;const p=ends.map(([x,y])=>{const v=new Vector3(x,0,-y).project(window.__huxi.camera);return [(v.x+1)*720,(1-v.y)*480];});if(p.every(([x,y])=>x>330&&x<1350&&y>100&&y<800)&&Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1])>12)return p;}throw Error('no visible road test segment');})()`);
  await evaluate(`document.querySelector('#tb-nav').click()`);
  async function clickMap([x,y]){await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});}
  // At this fixed home view the first endpoint projects behind a building. One tap
  // must not set both a ground start and a building destination.
  await clickMap(road[0]);
  assert.doesNotMatch(await evaluate(`document.querySelector('#nav-status').textContent`),/路线/,'one building click must not create a route');
  await clickMap(road[1]);await clickMap(road[0]);
  checks.navigation=await evaluate(`document.querySelector('#nav-status').textContent`);
  assert.match(checks.navigation,/路线.*m/);await evaluate(`document.querySelector('#nav-clear').click();document.querySelector('#nav-exit').click();`);
  checks.performance=await evaluate('new Promise(resolve=>{const t=performance.now(),f=window.__huxi.renderer.info.render.frame;setTimeout(()=>resolve({fps:(window.__huxi.renderer.info.render.frame-f)*1000/(performance.now()-t),pixelRatio:window.__huxi.renderer.getPixelRatio()}),2200)})');
  console.log('PERFORMANCE',JSON.stringify(checks.performance));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('window.dispatchEvent(new Event("resize")); document.querySelector("#pd-back").click(); document.querySelector("#tl-home").click();');
  await capture('v8-mobile');
  checks.mobile={};
  for(const [asset,label] of [['zonghe','综合楼'],['teaching1','第一教学楼'],['info','信息技术科研楼'],['library','图书馆']]) {
    await evaluate(`document.querySelector('#pd-back').click();[...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent===${JSON.stringify(label)}).click();`);
    await delay(400);
    const result=await evaluate(`(async()=>{const {Box3,Vector3}=await import('/node_modules/.vite/deps/three.js');const h=window.__huxi,e=h.detailAssets.find(e=>e.asset===${JSON.stringify(asset)}),box=new Box3().setFromObject(e.root);const points=[];
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new Vector3(x,y,z).project(h.camera);points.push([(p.x+1)*195,(1-p.y)*422]);}
      const detail=document.querySelector('#place-detail'),fly=document.querySelector('#pd-fly');fly.scrollIntoView({block:'nearest'});
      const r=fly.getBoundingClientRect(),hud=document.querySelector('#hud').getBoundingClientRect();return {points,hudTop:hud.top,flyBottom:r.bottom,flyTop:r.top,scrollable:getComputedStyle(detail).overflowY};})()`);
    checks.mobile[asset]=result;console.log('MOBILE',asset,JSON.stringify(result));
    assert.ok(result.points.every(([x,y])=>x>=0&&x<=390&&y>=50&&y<=result.hudTop),'portrait building must fit above HUD: '+asset);
    assert.ok(result.flyBottom<=832&&result.flyTop>=result.hudTop,'detail action must be reachable: '+asset);
    await capture('v8-mobile-'+asset);
  }
  console.log('ERRORS',JSON.stringify(errors));
  await writeFile(root+'/work/qa/browser-check.json',JSON.stringify({ready,errors,checks},null,2));
  assert.equal(errors.length,0,'browser errors');
} finally {
  if(ws){try{await send('Browser.close');}catch{}ws.close();}
  browser.kill();
}
