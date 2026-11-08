/* Offline tests consume the REAL service normalize/public_cache result with synthetic weather. */
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict"),{execFileSync}=require("node:child_process");
const fixture=JSON.parse(execFileSync("python",[path.join(__dirname,"test_support.py")],{encoding:"utf8"}));
const source=fs.readFileSync(path.join(__dirname,"client.js"),"utf8"),noop=()=>{};
function harness(saved){
  const nodes={},requests=[],timers=new Map(),events={},texts=[],readKeys=[];let time=fixture.now*1000,id=0,awakeRequested=false,awakeStops=0;
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const context={fillText:msg=>texts.push(String(msg)),fillRect:noop,strokeRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop};
  const node=name=>nodes[name]||(nodes[name]={style:{},offsetHeight:65,getContext:()=>context});
  const environment={Date:ClockDate,document:{getElementById:node,documentElement:{clientWidth:600,clientHeight:800}},innerWidth:600,innerHeight:800,
    localStorage:{getItem(key){readKeys.push(key);return saved?JSON.stringify(saved):null;},setItem:noop},
    setTimeout(fn,delay){timers.set(++id,{fn,delay,due:time+delay});return id;},clearTimeout(key){timers.delete(key);},addEventListener(name,fn){(events[name]||(events[name]=[])).push(fn);},
    XMLHttpRequest:function(){this.headers={};this.open=(method,url)=>{this.method=method;this.url=url;};this.setRequestHeader=(key,value)=>{this.headers[key]=value;};this.send=()=>requests.push(this);},
    KindleKeepAwake:function(options){this.getState=()=>({requested:awakeRequested});this.enable=()=>{awakeRequested=true;options.onChange({requested:true,code:"playing"});};this.disable=()=>{awakeStops++;awakeRequested=false;options.onChange({requested:false,code:"disabled"});};}};
  vm.runInNewContext(source,environment);
  return {client:environment.MeteoblueClient,nodes,requests,timers,texts,readKeys,
    reply(request,data,status=200){request.status=status;request.responseText=typeof data==="string"?data:JSON.stringify(data);request.onload();},
    advance(target){for(let loops=0;loops<100;loops++){const pending=[...timers.entries()].filter(([k,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due);if(!pending.length)break;const [k,t]=pending[0];time=t.due;timers.delete(k);t.fn();}time=target;},
    leave(){for(const fn of events.pagehide||[])fn();},awake:()=>({requested:awakeRequested,stops:awakeStops})};
}
const h=harness();assert.ok(h.texts.includes("等待天气数据"));assert.equal(h.requests.length,1);
h.reply(h.requests[0],fixture.full);assert.equal(h.client.getState().hasData,true);
assert.equal(h.client.getState().validTimes.length,12,"72h contains twelve six-hour endpoints");
assert.equal(h.client.getState().basicFetchedAt,fixture.full.packages.basic.fetchedAt);
assert.equal(h.client.getState().cloudsFetchedAt,fixture.full.packages.clouds.fetchedAt);
assert.notEqual(h.client.getState().cloudsFetchedAt,h.client.getState().basicFetchedAt,"Clouds retains its own older success time");
assert.ok(Array.isArray(fixture.full.packages.basic.modelrunUpdateTimeUtc),"real service fixture preserves valid processing-time arrays");
assert.ok(h.texts.some(text=>text.includes("发布 "+h.client.clock(Math.max(...fixture.full.packages.basic.modelrunUpdateTimeUtc),true))),"display uses the newest reported group processing time");
assert.deepEqual(h.readKeys,["kindle-meteoblue-cache-v1:hepo"]);
for(const [degrees,name] of [[0,"北"],[360,"北"],[45,"东北"],[90,"东"],[180,"南"],[270,"西"],[359,"北"],[null,"--"],[-1,"--"],[361,"--"]])assert.equal(h.client.direction(degrees),name);
assert.equal(h.client.clock(Date.parse("2026-12-31T16:00:00Z")/1000,true),"01/01 00:00");
assert.equal(h.client.clock(Date.parse("2028-02-28T16:00:00Z")/1000,true),"02/29 00:00");
assert.equal(h.client.clock(Date.parse("2026-03-29T16:00:00Z")/1000,true),"03/30 00:00","Shanghai has no European DST change");
assert.ok(h.texts.includes("--"),"null values remain visibly unknown");
const bad=JSON.parse(JSON.stringify(fixture.full));bad.units.windSpeed="km/h";assert.throws(()=>h.client.validate(bad));
bad.units.windSpeed="m/s";bad.sixHourly[0].windDirection=361;assert.throws(()=>h.client.validate(bad));
bad.sixHourly[0].windDirection=90;bad.source="different-provider";assert.throws(()=>h.client.validate(bad));
const before=h.client.getState().basicFetchedAt;h.nodes.refresh.onclick();h.reply(h.requests[1],{},503);
assert.equal(h.client.getState().basicFetchedAt,before);assert.ok(h.nodes.status.textContent.includes("HTTP 503"));
const nextRead=Date.parse("2026-11-08T04:35:00Z");
assert.ok([...h.timers.values()].some(timer=>timer.due===nextRead),"failure waits until the next normal Beijing :35 slot");
h.nodes.awake.onclick();const firstVisible=h.client.getState().validTimes[0];h.advance(nextRead);const requestsBeforeLocalRedraw=h.requests.length;h.advance(firstVisible*1000+50);
assert.ok(h.client.getState().validTimes[0]>firstVisible,"forecast boundary advances locally");assert.equal(h.requests.length,requestsBeforeLocalRedraw,"local redraw performs no additional cache/network query");
assert.equal(h.client.getState().basicFetchedAt,before);assert.deepEqual(h.awake(),{requested:true,stops:0});
h.nodes.refresh.onclick();const old=h.requests[h.requests.length-1];h.nodes.refresh.onclick();const latest=h.requests[h.requests.length-1];
h.reply(latest,fixture.full);h.reply(old,{},503);assert.equal(h.nodes.status.textContent,"");
for(const request of h.requests){assert.equal(request.method,"GET");assert.equal(request.url,h.client.cacheURL);assert.ok(request.url.startsWith("https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/cache/hepo.json?"));assert.deepEqual(request.headers,{Accept:"application/vnd.github.raw+json"});assert.ok(!/apikey|token|127\.0\.0\.1|localhost/.test(request.url));}
h.leave();assert.equal(h.timers.size,0);assert.equal(h.awake().stops,1);
const partial=harness();partial.reply(partial.requests[0],fixture.partial);assert.equal(partial.client.getState().cloudsFetchedAt,null);assert.ok(partial.texts.includes("--"));
const empty=harness();empty.reply(empty.requests[0],fixture.empty);assert.ok(empty.texts.includes("等待天气数据"));
const saved=harness(fixture.full);assert.equal(saved.client.getState().hasData,true);
assert.equal(h.client.nextReadAt(Date.parse("2026-11-08T02:50:00Z")),nextRead,"10:50 Beijing schedules 12:35, not 16:50");
const midnight=Date.parse("2026-11-07T16:35:00Z");assert.equal(h.client.nextReadAt(midnight-1),midnight);assert.equal(h.client.nextReadAt(midnight),midnight+21600000,"an exact slot never triggers an immediate duplicate");
assert.equal(h.client.nextReadAt(Date.parse("2026-12-31T15:59:59Z")),Date.parse("2026-12-31T16:35:00Z"),"Beijing year boundary remains aligned");
const automatic=harness();automatic.reply(automatic.requests[0],fixture.full);automatic.advance(nextRead-1);assert.equal(automatic.requests.length,1);automatic.advance(nextRead);assert.equal(automatic.requests.length,2,"normal GitHub cache read occurs at Beijing 12:35");assert.equal(automatic.client.getState().basicFetchedAt,fixture.full.packages.basic.fetchedAt,"a read attempt never fabricates a newer provider retrieval time");
automatic.reply(automatic.requests[1],fixture.full);for(let slot=1;slot<=3;slot++){automatic.advance(nextRead+slot*21600000);automatic.reply(automatic.requests[automatic.requests.length-1],fixture.full);}assert.equal(automatic.requests.length,5,"one immediate startup read plus four automatic slots in 24h");
const pausedCache=JSON.parse(JSON.stringify(fixture.full));pausedCache.paused={code:"unexpected_provider_tariff"};const paused=harness();paused.reply(paused.requests[0],pausedCache);assert.equal(paused.nodes.status.textContent,"天气更新已暂停");assert.equal(paused.client.getState().basicFetchedAt,fixture.full.packages.basic.fetchedAt);
console.log("PASS: real-service offline contract, 72h selection, separate package times, Shanghai dates, nulls/units/direction, six-hour reads/local redraw, race/retention/cleanup and fixed credential-free URL.");
