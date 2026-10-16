import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd().replaceAll('\\','/'),port=9446,delay=ms=>new Promise(r=>setTimeout(r,ms));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--no-proxy-server','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--remote-allow-origins=http://localhost:'+port,'--remote-debugging-port='+port,'--user-data-dir='+root+'/work/chrome-v10-nav','--window-size=1440,960','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,seq=0;const pending=new Map(),errors=[],checks={};
function send(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function shot(name){await delay(500);const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(root+'/work/qa/'+name+'.png',Buffer.from(r.data,'base64'));}
try{
  let pages;for(let i=0;i<60;i++){try{pages=await(await fetch('http://localhost:'+port+'/json/list')).json();break;}catch{await delay(200);}}
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);};
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:process.env.HUXI_PREVIEW_URL??'http://localhost:5192/'});await mkdir(root+'/work/qa',{recursive:true});
  let ready=false;for(let i=0;i<120;i++){await delay(250);if(await evaluate(`!!window.__huxi&&document.querySelector('#hud-stats').textContent.startsWith('楼栋')&&document.querySelector('#boot').hidden`)){ready=true;break;}}assert.ok(ready,'map must load');
  assert.ok(await evaluate(`!!document.querySelector('#nav-start')&&!!document.querySelector('#nav-end')&&!!document.querySelector('#pd-nav')`),'navigation needs start/end selectors and a detail-card navigation action');
  await evaluate(`document.querySelector('#tb-nav').click();document.querySelector('#nav-start').value='综合楼';document.querySelector('#nav-start').dispatchEvent(new Event('change'));document.querySelector('#nav-end').value='图书馆';document.querySelector('#nav-end').dispatchEvent(new Event('change'));document.querySelector('#nav-go').click()`);
  checks.route=await evaluate(`({status:document.querySelector('#nav-status').textContent,note:document.querySelector('#nav-note').textContent,distance:window.__huxi.navigation.result?.distanceMeters,points:window.__huxi.navigation.result?.points.length})`);
  assert.ok(checks.route.distance>100);assert.match(checks.route.note,/附近道路/);assert.match(checks.route.status,/路线.*m/);assert.ok(checks.route.points>2);await shot('v10-navigation-desktop');
  assert.ok(await evaluate(`['start','end'].every(which=>document.querySelector('#nav-'+which).options[0].disabled)`),'placeholder options must not allow an empty selection while retaining an old endpoint');
  await evaluate(`document.querySelector('#nav-swap').click()`);
  assert.ok(await evaluate(`document.querySelector('#nav-start').value==='图书馆'&&document.querySelector('#nav-end').value==='综合楼'`),'swap must update both selectors');
  const swapped=await evaluate(`window.__huxi.navigation.result.distanceMeters`);assert.ok(Math.abs(swapped-checks.route.distance)<.001);
  await evaluate(`document.querySelector('#nav-clear').click()`);assert.ok(await evaluate(`!window.__huxi.navigation.result&&!window.__huxi.navigation.start&&!window.__huxi.navigation.end`));
  await evaluate(`document.querySelector('#nav-go').click()`);assert.match(await evaluate(`document.querySelector('#nav-status').textContent`),/起点|终点/);
  await evaluate(`document.querySelector('#nav-exit').click();[...document.querySelectorAll('.place')].find(e=>e.querySelector('.nm').textContent==='第一教学楼').click();document.querySelector('#pd-nav').click()`);
  assert.ok(await evaluate(`document.querySelector('#nav-panel').classList.contains('open')&&document.querySelector('#nav-end').value==='第一教学楼'`),'detail navigation must retain the chosen destination');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('#nav-start').value='北门';document.querySelector('#nav-start').dispatchEvent(new Event('change'));document.querySelector('#nav-go').click()`);
  checks.mobile=await evaluate(`(()=>{const r=document.querySelector('#nav-panel').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,hiddenHud:getComputedStyle(document.querySelector('#hud')).display==='none',goVisible:document.querySelector('#nav-go').getBoundingClientRect().bottom<=innerHeight-12}})()`);
  assert.ok(checks.mobile.left>=0&&checks.mobile.right<=390&&checks.mobile.bottom<=832&&checks.mobile.hiddenHud&&checks.mobile.goVisible);await shot('v10-navigation-mobile');
  await evaluate(`document.querySelector('#nav-exit').click()`);assert.ok(await evaluate(`getComputedStyle(document.querySelector('#hud')).display!=='none'`));
  checks.selectors=true;checks.detailNavigation=true;checks.swap=true;
  if(process.argv.includes('--walking')){
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
    await send('Page.reload',{ignoreCache:true});for(let i=0;i<120;i++){await delay(200);if(await evaluate(`!!window.__huxi?.walking&&document.querySelector('#boot').hidden`))break;}
    await send('Page.bringToFront');
    assert.ok(await evaluate(`!!document.querySelector('#tb-walk')&&!!window.__huxi.walking`),'desktop needs an explicit walking mode');
    await evaluate(`document.querySelector('#tl-home').click();document.querySelector('#tb-walk').click()`);
    const snapshot=await evaluate(`(()=>{const h=window.__huxi;return {position:h.camera.position.toArray(),target:h.controls.target.toArray(),fov:h.camera.fov,near:h.camera.near,far:h.camera.far,view:{...h.camera.view}}})()`);
    async function clickButton(selector){const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}
    await clickButton('#walk-start');await delay(600);
    const lock=await evaluate(`({active:window.__huxi.walking.active,locked:document.pointerLockElement===window.__huxi.renderer.domElement,orbit:window.__huxi.controls.enabled,focus:document.hasFocus(),toast:document.querySelector('#toast').textContent,setupHidden:document.querySelector('#walk-setup').hidden})`);
    assert.ok(lock.active&&lock.locked&&!lock.orbit,'walk must acquire a real pointer lock and suspend orbit: '+JSON.stringify({lock,errors}));
    const initial=await evaluate(`window.__huxi.camera.position.toArray()`);
    const sample=await evaluate(`({time:performance.now(),frame:window.__huxi.renderer.info.render.frame})`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyS',key:'s',windowsVirtualKeyCode:83});await delay(700);await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyS',key:'s',windowsVirtualKeyCode:83});
    const performanceSample=await evaluate(`({seconds:(performance.now()-${sample.time})/1000,fps:(window.__huxi.renderer.info.render.frame-${sample.frame})*1000/(performance.now()-${sample.time})})`);
    const after=await evaluate(`window.__huxi.camera.position.toArray()`);assert.ok(Math.hypot(...after.map((v,i)=>v-initial[i]))>.1,'WASD must move on the mapped ground');assert.ok(Math.abs(after[1]-1.65)<.001);
    await shot('v10-walking-zonghe');
    await evaluate(`document.exitPointerLock()`);await delay(300);
    const restored=await evaluate(`(()=>{const h=window.__huxi;return {active:h.walking.active,enabled:h.controls.enabled,position:h.camera.position.toArray(),target:h.controls.target.toArray(),fov:h.camera.fov,near:h.camera.near,far:h.camera.far,view:{...h.camera.view}}})()`);
    assert.ok(!restored.active&&restored.enabled);for(const key of ['position','target'])assert.ok(restored[key].every((v,i)=>Math.abs(v-snapshot[key][i])<.001),'walk exit must restore '+key);
    for(const key of ['fov','near','far'])assert.equal(restored[key],snapshot[key]);assert.deepEqual(restored.view,snapshot.view);
    await evaluate(`document.querySelector('#tb-walk').click();window.__savedLock=window.__huxi.renderer.domElement.requestPointerLock;window.__huxi.renderer.domElement.requestPointerLock=()=>{throw Error('simulated lock refusal')};document.querySelector('#walk-start').click();window.__huxi.renderer.domElement.requestPointerLock=window.__savedLock`);
    assert.ok(await evaluate(`!window.__huxi.walking.active&&window.__huxi.controls.enabled`),'lock failure must restore the map');
    await evaluate(`document.querySelector('#tb-walk').click();document.querySelector('#walk-start').click();window.__huxi.walking.exit()`);await delay(350);
    assert.ok(await evaluate(`!window.__huxi.walking.active&&!document.pointerLockElement&&window.__huxi.controls.enabled`),'exiting while pointer lock is pending must not leave the map mouse-locked');
    await evaluate(`document.querySelector('#tb-walk').click();window.__huxi.renderer.domElement.requestPointerLock=()=>Promise.reject(Error('simulated async refusal'));document.querySelector('#walk-start').click();window.__huxi.renderer.domElement.requestPointerLock=window.__savedLock`);await delay(150);
    assert.ok(await evaluate(`!window.__huxi.walking.active&&window.__huxi.controls.enabled`),'async lock rejection must restore the map without an unhandled Promise');
    await delay(1900); // Let the intentional failure toast fade before visual captures.
    checks.walking={realPointerLock:true,movementMeters:Math.hypot(...after.map((v,i)=>v-initial[i])),performanceSample,restored:true,lockFailureRecovery:true,pendingExitRecovery:true,asyncFailureRecovery:true,landmarks:[]};
    for(const [name,key]of [['第一教学楼','teaching1'],['信息技术科研楼','info'],['图书馆','library']]){
      await evaluate(`document.querySelector('#tb-walk').click();document.querySelector('#walk-spawn').value=${JSON.stringify(name)}`);await clickButton('#walk-start');await delay(650);
      assert.ok(await evaluate(`window.__huxi.walking.active&&!!document.pointerLockElement`),'real walk entry: '+name);
      const from=await evaluate(`window.__huxi.camera.position.toArray()`);
      await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});await delay(500);await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
      const to=await evaluate(`window.__huxi.camera.position.toArray()`),movementMeters=Math.hypot(...to.map((v,i)=>v-from[i]));assert.ok(movementMeters>.1,'mapped movement near '+name);await shot('v10-walking-'+key);
      if(key==='library'){
        await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await delay(100);
        assert.ok(await evaluate(`window.__huxi.walking.active&&window.__huxi.camera.near===.1&&!window.__huxi.camera.view.enabled`),'resize during walking must not restore orbit projection');
      }
      await evaluate(`window.dispatchEvent(new Event('blur'))`);await delay(200);assert.ok(await evaluate(`!window.__huxi.walking.active&&window.__huxi.controls.enabled&&!document.pointerLockElement`),'blur must release walking mode');checks.walking.landmarks.push({name,movementMeters});
    }
    assert.ok(await evaluate(`window.__huxi.camera.near===2&&window.__huxi.camera.view.fullWidth===innerWidth`),'exit after resize must reframe the restored map');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));await writeFile(root+'/work/qa/v10-navigation-check.json',JSON.stringify({errors,checks},null,2));console.log(JSON.stringify({errors,checks}));
}finally{if(ws){try{await send('Browser.close');}catch{}ws.close();}browser.kill();}
