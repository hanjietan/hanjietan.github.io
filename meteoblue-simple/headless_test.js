/* LOCAL ONLY. Synthetic fixtures; all XHR replaced before the app starts. */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{spawn,execFileSync}=require("node:child_process");
const root=__dirname,fixture=JSON.parse(execFileSync("python",[path.join(root,"test_support.py")],{encoding:"utf8"}));
const html=fs.readFileSync(path.join(root,"bundle.html"),"utf8"),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=path.join(root,"headless-profile-"+Date.now()),browser=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--disable-gpu","--no-first-run","--disable-default-apps","--hide-scrollbars","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{windowsHide:true,stdio:"ignore"});
let socket,session,id=0;const pending=new Map(),network=[],screenshots={},layouts=[];let gapRegression;
function send(method,params={},target=session){return new Promise((resolve,reject)=>{const n=++id,message={id:n,method,params};if(target)message.sessionId=target;pending.set(n,{resolve,reject});socket.send(JSON.stringify(message));});}
async function evaluate(expression){const r=await send("Runtime.evaluate",{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function screenshot(name){const r=await send("Page.captureScreenshot",{format:"png"});const bytes=Buffer.from(r.data,"base64");fs.writeFileSync(path.join(root,name),bytes);screenshots[name]=crypto.createHash("sha256").update(bytes).digest("hex");}
async function response(data){await evaluate("window.syntheticResponse="+JSON.stringify(data)+";document.getElementById('refresh').click();void 0;");await wait(50);}
function conditionGap(gap){assert.ok(gap>=12,"condition/rain gap must be at least 12 rendered pixels; got "+gap);}
async function layout(label){
  const value=await evaluate("(function(){function rect(n){var r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};}return{label:"+JSON.stringify(label)+",width:innerWidth,height:innerHeight,canvas:rect(document.getElementById('screen')),controls:rect(document.getElementById('controls')),buttons:[rect(document.getElementById('refresh')),rect(document.getElementById('awake'))],texts:window.canvasTexts};}())");
  assert.ok(value.controls.bottom<=value.height+1,"all controls fit viewport");assert.ok(value.canvas.right<=value.width+1);
  for(const button of value.buttons){assert.ok(button.height>=44,"touch target at least 44px high");assert.ok(button.width>=120);}
  for(const text of value.texts){assert.ok(text.left>=0&&text.right<=600,"canvas text stays in width: "+text.text);}
  for(let i=0;i<value.texts.length;i++)for(let j=i+1;j<value.texts.length;j++){
    const a=value.texts[i],b=value.texts[j],horizontal=Math.min(a.right,b.right)-Math.max(a.left,b.left),vertical=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    assert.ok(horizontal<=0||vertical<=0,"text collision: "+a.text+" / "+b.text);
  }
  value.conditionRainGaps=[];
  for(const top of [406,582]){const condition=value.texts.find(t=>t.top===top),rain=value.texts.find(t=>t.top===top+4&&t.text.startsWith("降水"));assert.ok(condition&&rain);const gap=(rain.left-condition.right)*value.canvas.width/600;conditionGap(gap);value.conditionRainGaps.push(gap);}
  layouts.push(value);return value;
}
(async()=>{let report;try{
  const file=path.join(profile,"DevToolsActivePort");for(let i=0;i<50&&!fs.existsSync(file);i++)await wait(200);const port=fs.readFileSync(file,"utf8").trim().split(/\r?\n/);
  socket=new WebSocket("ws://127.0.0.1:"+port[0]+port[1]);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  socket.addEventListener("message",event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==="Network.requestWillBeSent")network.push(m.params.request.url);});
  const target=await send("Target.createTarget",{url:"about:blank"},null);session=(await send("Target.attachToTarget",{targetId:target.targetId,flatten:true},null)).sessionId;
  await send("Page.enable");await send("Network.enable");await send("Emulation.setDeviceMetricsOverride",{width:600,height:800,deviceScaleFactor:1,mobile:false});
  await evaluate("window.syntheticResponse="+JSON.stringify(fixture.full)+";window.requestLog=[];window.canvasTexts=[];var originalText=CanvasRenderingContext2D.prototype.fillText,originalFill=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(x===0&&y===0&&w===600&&h===716)window.canvasTexts=[];return originalFill.apply(this,arguments);};CanvasRenderingContext2D.prototype.fillText=function(t,x,y){var width=this.measureText(String(t)).width,size=parseFloat(this.font.match(/[0-9.]+px/)[0]);var left=this.textAlign==='right'?x-width:this.textAlign==='center'?x-width/2:x;canvasTexts.push({text:String(t),left:left,right:left+width,top:y,bottom:y+size,font:this.font});return originalText.apply(this,arguments);};var NativeDate=Date;function TestDate(value){return arguments.length?new NativeDate(value):new NativeDate("+fixture.now*1000+");}TestDate.UTC=NativeDate.UTC;TestDate.now=function(){return "+fixture.now*1000+";};window.Date=TestDate;window.XMLHttpRequest=function(){this.headers={};this.open=function(method,url){this.url=url;};this.setRequestHeader=function(k,v){this.headers[k]=v;};this.send=function(){var self=this;requestLog.push({url:self.url,headers:self.headers});setTimeout(function(){self.status=200;self.responseText=JSON.stringify(syntheticResponse);self.onload();},0);};};document.open();document.write("+JSON.stringify(html)+");document.close();void 0;");
  for(let i=0;i<30;i++){if(await evaluate("window.MeteoblueSimple&&MeteoblueSimple.getState().hasData"))break;await wait(100);}
  await evaluate("var badge=document.createElement('div');badge.textContent='模拟数据 · 仅本地验证';badge.style.cssText='position:fixed;bottom:0;left:1px;font-size:9px;background:white;color:black';document.body.appendChild(badge);void 0;");
  await layout("full-600x800");await screenshot("preview-600x800-synthetic.png");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:520,deviceScaleFactor:1,mobile:false});await wait(60);await layout("full-390x520");await screenshot("preview-390x520-synthetic.png");
  await send("Emulation.setDeviceMetricsOverride",{width:600,height:800,deviceScaleFactor:1,mobile:false});await wait(60);
  for(const width of [600,390]){await send("Emulation.setDeviceMetricsOverride",{width,height:width===600?800:520,deviceScaleFactor:1,mobile:false});await wait(40);for(const code of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,20,21,22,23,24,25]){const data=JSON.parse(JSON.stringify(fixture.full));data.daily[1].weatherCode=code;data.daily[2].weatherCode=code;data.daily[1].precipitation=1234.56;data.daily[2].precipitation=1234.56;await response(data);await layout("code-"+code+"-rain-1234.56-width-"+width);}}
  // Negative control: the original unshortened thunderstorm wording at senior
  // font size overlaps this amount. Prove the targeted guard rejects it.
  gapRegression=await evaluate("(function(){var c=document.getElementById('screen').getContext('2d');c.font='bold 32px sans-serif';var right=28+c.measureText('多云 · 局地可能雷阵雨').width;c.font='29px sans-serif';var left=572-c.measureText('降水1234.56毫米').width;return{condition:'多云 · 局地可能雷阵雨',rain:'降水1234.56毫米',gap:left-right};}())");
  assert.throws(()=>conditionGap(gapRegression.gap),/at least 12/);gapRegression.assertionRejected=true;
  await send("Emulation.setDeviceMetricsOverride",{width:600,height:800,deviceScaleFactor:1,mobile:false});await wait(40);
  const extreme=JSON.parse(JSON.stringify(fixture.full));extreme.daily[1].weatherCode=23;extreme.daily[2].weatherCode=24;extreme.daily[1].precipitation=1234.56;extreme.daily[2].precipitation=0.001;extreme.daily[1].temperatureMin=-43;extreme.daily[1].temperatureMax=-12;await response(extreme);await layout("long-condition-extreme-rain-and-cold");
  await screenshot("preview-long-condition-synthetic.png");
  await response(fixture.legacy);assert.ok((await evaluate("canvasTexts.map(function(t){return t.text;})")).includes("天气暂无"));await layout("legacy-code-missing");await screenshot("preview-legacy-synthetic.png");
  await response(fixture.partial);await layout("partial-values");await screenshot("preview-partial-synthetic.png");
  await response(fixture.empty);assert.equal(await evaluate("MeteoblueSimple.getState().hasData"),true);await layout("empty-cache");await screenshot("preview-waiting-synthetic.png");
  assert.deepEqual(network,[],"no real weather requests in mock preview");assert.ok(!/SYNTHETIC_SECRET|synthetic_test_only/.test(html));
  report={passed:true,synthetic_only:true,actual_network_requests:network,bundle_sha256:crypto.createHash("sha256").update(html).digest("hex"),screenshots,layouts,gapRegression,requests:await evaluate("requestLog"),limit:"Current headless Chromium with real-service synthetic fixtures. This is not Kindle hardware verification or current weather."};
  console.log(JSON.stringify({passed:true,synthetic_only:true,actual_network_requests:network,bundle_sha256:report.bundle_sha256,screenshots,layout_cases:layouts.length,minimumConditionGap:Math.min(...layouts.flatMap(r=>r.conditionRainGaps)),gapRegression},null,2));
}catch(error){report={passed:false,synthetic_only:true,error:String(error.stack||error),network};console.error(JSON.stringify(report,null,2));process.exitCode=1;}
finally{if(report)fs.writeFileSync(path.join(root,"headless-results.json"),JSON.stringify(report,null,2));if(socket&&socket.readyState===1){try{await send("Browser.close",{},null);}catch(ignore){}socket.close();}if(!browser.killed)browser.kill();}})();
