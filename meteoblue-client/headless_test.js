/* LOCAL ONLY. Synthetic data from real service normalization; no network. */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{spawn,execFileSync}=require("node:child_process");
const root=__dirname,fixture=JSON.parse(execFileSync("python",[path.join(root,"test_support.py")],{encoding:"utf8"}));
const html=fs.readFileSync(path.join(root,"bundle.html"),"utf8"),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=path.join(root,"headless-profile-"+Date.now()),browser=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--disable-gpu","--no-first-run","--disable-default-apps","--hide-scrollbars","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{windowsHide:true,stdio:"ignore"});
let socket,session,id=0;const pending=new Map(),network=[];
function send(method,params={},target=session){return new Promise((resolve,reject)=>{const n=++id,message={id:n,method,params};if(target)message.sessionId=target;pending.set(n,{resolve,reject});socket.send(JSON.stringify(message));});}
async function evaluate(expression){const r=await send("Runtime.evaluate",{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function screenshot(name){const r=await send("Page.captureScreenshot",{format:"png"});const bytes=Buffer.from(r.data,"base64");fs.writeFileSync(path.join(root,name),bytes);return crypto.createHash("sha256").update(bytes).digest("hex");}
(async()=>{let report;try{
  const file=path.join(profile,"DevToolsActivePort");for(let i=0;i<50&&!fs.existsSync(file);i++)await wait(200);const port=fs.readFileSync(file,"utf8").trim().split(/\r?\n/);
  socket=new WebSocket("ws://127.0.0.1:"+port[0]+port[1]);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  socket.addEventListener("message",event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==="Network.requestWillBeSent")network.push(m.params.request.url);});
  const target=await send("Target.createTarget",{url:"about:blank"},null);session=(await send("Target.attachToTarget",{targetId:target.targetId,flatten:true},null)).sessionId;
  await send("Page.enable");await send("Network.enable");await send("Emulation.setDeviceMetricsOverride",{width:600,height:800,deviceScaleFactor:1,mobile:false});
  await evaluate("window.syntheticResponse="+JSON.stringify(fixture.full)+";window.requestLog=[];var NativeDate=Date;function TestDate(value){return arguments.length?new NativeDate(value):new NativeDate("+fixture.now*1000+");}TestDate.UTC=NativeDate.UTC;TestDate.now=function(){return "+fixture.now*1000+";};window.Date=TestDate;window.XMLHttpRequest=function(){this.headers={};this.open=function(method,url){this.url=url;};this.setRequestHeader=function(k,v){this.headers[k]=v;};this.send=function(){var self=this;requestLog.push({url:self.url,headers:self.headers});setTimeout(function(){self.status=200;self.responseText=JSON.stringify(syntheticResponse);self.onload();},0);};};document.open();document.write("+JSON.stringify(html)+");document.close();void 0;");
  for(let i=0;i<30;i++){if(await evaluate("window.MeteoblueClient&&MeteoblueClient.getState().hasData"))break;await wait(100);}
  assert.equal(await evaluate("MeteoblueClient.getState().validTimes.length"),12);
  await evaluate("var badge=document.createElement('div');badge.textContent='模拟数据 · 仅本地验证';badge.style.cssText='position:fixed;top:2px;right:2px;font-size:9px;background:white;color:black';document.body.appendChild(badge);void 0;");
  const full=await screenshot("preview-synthetic.png");
  await evaluate("window.syntheticResponse="+JSON.stringify(fixture.partial)+";document.getElementById('refresh').click();void 0;");await wait(100);
  assert.equal(await evaluate("MeteoblueClient.getState().cloudsFetchedAt"),null);const partial=await screenshot("preview-partial-synthetic.png");
  await evaluate("window.syntheticResponse="+JSON.stringify(fixture.empty)+";document.getElementById('refresh').click();void 0;");await wait(100);const empty=await screenshot("preview-waiting.png");
  assert.equal(await evaluate("MeteoblueClient.getState().validTimes.length"),0);assert.deepEqual(network,[],"Mock preview must not access external services");
  report={passed:true,synthetic_only:true,actual_network_requests:network,bundle_sha256:crypto.createHash("sha256").update(html).digest("hex"),screenshots:{full,partial,empty},requests:await evaluate("requestLog"),limit:"Current headless Chromium with real-service offline fixtures; not real weather or Kindle hardware validation."};console.log(JSON.stringify(report,null,2));
}catch(error){report={passed:false,synthetic_only:true,error:String(error.stack||error),network};console.error(JSON.stringify(report,null,2));process.exitCode=1;}
finally{if(report)fs.writeFileSync(path.join(root,"headless-results.json"),JSON.stringify(report,null,2));if(socket&&socket.readyState===1){try{await send("Browser.close",{},null);}catch(ignore){}socket.close();}if(!browser.killed)browser.kill();}})();
