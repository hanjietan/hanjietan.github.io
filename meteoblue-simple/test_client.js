/* Offline synthetic fixtures pass through the REAL service normalization. */
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict"),{execFileSync}=require("node:child_process");
const fixture=JSON.parse(execFileSync("python",[path.join(__dirname,"test_support.py")],{encoding:"utf8"}));
const source=fs.readFileSync(path.join(__dirname,"client.js"),"utf8"),noop=()=>{},epoch=text=>Date.parse(text)/1000;
function harness(saved,start=fixture.now*1000,storageFails=false){
  const nodes={},requests=[],timers=new Map(),events={},texts=[],keys=[];let time=start,id=0,awakeRequested=false,awakeStops=0;
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const context={fillText:msg=>texts.push(String(msg)),fillRect:noop,strokeRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop};
  const node=name=>nodes[name]||(nodes[name]={style:{},offsetHeight:80,getContext:()=>context});
  const environment={Date:ClockDate,document:{getElementById:node,documentElement:{clientWidth:600,clientHeight:800}},innerWidth:600,innerHeight:800,
    localStorage:{getItem(key){keys.push(key);if(storageFails)throw Error("blocked");return saved?JSON.stringify(saved):null;},setItem(){if(storageFails)throw Error("blocked");}},
    setTimeout(fn,delay){timers.set(++id,{fn,delay,due:time+delay});return id;},clearTimeout(key){timers.delete(key);},addEventListener(name,fn){(events[name]||(events[name]=[])).push(fn);},
    XMLHttpRequest:function(){this.headers={};this.open=(method,url)=>{this.method=method;this.url=url;};this.setRequestHeader=(key,value)=>{this.headers[key]=value;};this.send=()=>requests.push(this);},
    KindleKeepAwake:function(options){assert.equal(options.videoOnly,true);this.getState=()=>({requested:awakeRequested});this.enable=()=>{awakeRequested=true;options.onChange({requested:true,code:"playing"});};this.disable=()=>{awakeStops++;awakeRequested=false;options.onChange({requested:false,code:"disabled"});};}};
  vm.runInNewContext(source,environment);
  return{client:environment.MeteoblueSimple,nodes,requests,timers,texts,keys,
    reply(request,data,status=200){request.status=status;request.responseText=typeof data==="string"?data:JSON.stringify(data);request.onload();},
    advance(target){for(let loops=0;loops<100;loops++){const list=[...timers.entries()].filter(([k,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due);if(!list.length)break;const[k,t]=list[0];time=t.due;timers.delete(k);t.fn();}time=target;},
    leave(){for(const fn of events.pagehide||[])fn();},awake:()=>({requested:awakeRequested,stops:awakeStops})};
}
const h=harness();assert.ok(h.texts.includes("等待天气数据"));assert.equal(h.requests.length,1);h.reply(h.requests[0],fixture.full);
assert.equal(h.client.getState().hasData,true);assert.deepEqual(h.keys,["kindle-meteoblue-simple-v1:hepo"]);
assert.equal(h.client.getState().tomorrowTime,epoch("2026-11-08T22:00:00Z"),"daily labels are CST06:00, not midnight");
assert.equal(h.client.getState().afterTomorrowTime,epoch("2026-11-09T22:00:00Z"));
assert.ok(h.texts.includes("13—23°"));assert.ok(h.texts.includes("降水8.2毫米"));assert.ok(h.texts.includes("晴"));
assert.ok(h.texts.includes("降水0毫米"));assert.ok(h.texts.includes("26°C"));
assert.ok(h.texts.includes("预报更新 "+h.client.clock(Math.max(...fixture.full.packages.basic.modelrunUpdateTimeUtc),true)),"footer retains the actual package processing time");
assert.ok(!h.texts.some(value=>/湿度|风速|平均风|总云量/.test(value)),"simple display excludes unused fields");
const c=h.client;
assert.equal(c.currentAt(fixture.full,epoch("2026-11-08T04:30:00Z")).time,epoch("2026-11-08T04:00:00Z"),"12:30 uses nearby 12:00, not 18:00");
assert.equal(c.currentAt(fixture.full,epoch("2026-11-08T06:59:59Z")).time,epoch("2026-11-08T04:00:00Z"));
assert.equal(c.currentAt(fixture.full,epoch("2026-11-08T07:00:00Z")).time,epoch("2026-11-08T10:00:00Z"),"midpoint ties select later endpoint");
const last=fixture.full.sixHourly[fixture.full.sixHourly.length-1];assert.equal(c.currentAt(fixture.full,last.time+21600),last);assert.equal(c.currentAt(fixture.full,last.time+21601),null,"no stale point beyond six hours");
assert.equal(c.currentAt({sixHourly:[{time:1000,temperature:20},{time:22600,temperature:30}]},2000).temperature,20,"never interpolate temperatures");
for(const hour of [3,9,15,21]){const boundary=epoch("2026-11-07T16:00:00Z")+hour*3600;assert.equal(c.currentAt(fixture.full,boundary-1).time,boundary-10800);assert.equal(c.currentAt(fixture.full,boundary).time,boundary+10800);}
for(const instant of ["2026-12-31T16:00:00Z","2028-02-28T16:00:00Z","2026-03-29T16:00:00Z"]){
  const t=epoch(instant),expected={"2026-12-31T16:00:00Z":"2027-01-01","2028-02-28T16:00:00Z":"2028-02-29","2026-03-29T16:00:00Z":"2026-03-30"}[instant];assert.equal(c.dayKey(t),expected);
}
assert.equal(c.targetDay(epoch("2026-12-31T15:59:59Z"),1).key,"2027-01-01");
assert.equal(c.targetDay(epoch("2028-02-28T15:59:59Z"),2).key,"2028-03-01");
assert.equal(c.dayFor({daily:[{time:epoch("2027-01-01T22:00:00Z"),temperatureMin:1}]},epoch("2026-12-31T16:00:00Z"),1).temperatureMin,1);
assert.equal(c.dayFor(fixture.full,epoch("2026-11-15T16:00:00Z"),1),null,"old cached rows never become tomorrow by index");
assert.equal(c.weatherText(fixture.legacy,fixture.legacy.daily[1]),"天气暂无");
for(const code of [null,undefined,0,18,19,26,35,1.5,"1"])assert.equal(c.weatherText(fixture.full,{weatherCode:code}),"天气暂无");
for(const code of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,20,21,22,23,24,25])assert.notEqual(c.weatherText(fixture.full,{weatherCode:code}),"天气暂无");
assert.ok(/雷雨/.test(c.weatherText(fixture.full,{weatherCode:21})));assert.equal(c.weatherText({...fixture.full,weatherCodeSystem:"hourly-1-35"},{weatherCode:1}),"天气暂无");
const legacy=harness();legacy.reply(legacy.requests[0],fixture.legacy);assert.ok(legacy.texts.includes("天气暂无"));
const partial=harness();partial.reply(partial.requests[0],fixture.partial);assert.ok(partial.texts.includes("--°C"));assert.ok(partial.texts.includes("--—23°"));assert.ok(partial.texts.includes("降水--毫米"));
const empty=harness();empty.reply(empty.requests[0],fixture.empty);assert.ok(empty.texts.includes("等待天气数据"));
const noDay=harness();noDay.reply(noDay.requests[0],{...fixture.full,daily:[]});assert.equal(noDay.client.getState().tomorrowTime,null);assert.ok(noDay.texts.includes("--—--°"),"six-hour samples never manufacture daily extrema");
const fetchedOnly=JSON.parse(JSON.stringify(fixture.full));fetchedOnly.packages.basic.modelrunUpdateTimeUtc=null;const fetched=harness();fetched.reply(fetched.requests[0],fetchedOnly);assert.ok(fetched.texts.includes("数据取得 "+c.clock(fetchedOnly.packages.basic.fetchedAt,true)));
const bad=JSON.parse(JSON.stringify(fixture.full));bad.units.temperature="F";assert.throws(()=>c.validate(bad));bad.units.temperature="C";bad.daily[1].temperatureMin=100;assert.throws(()=>c.validate(bad));
const saved=harness(fixture.full);assert.equal(saved.client.getState().hasData,true);const denied=harness(null,fixture.now*1000,true);denied.reply(denied.requests[0],fixture.full);assert.equal(denied.client.getState().hasData,true);
const before=h.client.getState().basicFetchedAt;h.nodes.refresh.onclick();h.reply(h.requests[1],{},503);assert.equal(h.client.getState().basicFetchedAt,before);assert.ok(h.nodes.status.textContent.includes("HTTP 503"));
h.nodes.refresh.onclick();const old=h.requests[h.requests.length-1];h.nodes.refresh.onclick();const newest=h.requests[h.requests.length-1];h.reply(newest,fixture.full);h.reply(old,{},503);assert.equal(h.nodes.status.textContent,"");
const middle=harness(null,epoch("2026-11-08T04:40:00Z")*1000);middle.reply(middle.requests[0],fixture.full);middle.nodes.awake.onclick();middle.advance(epoch("2026-11-08T06:59:59Z")*1000);assert.equal(middle.client.getState().currentTime,epoch("2026-11-08T04:00:00Z"));middle.advance(epoch("2026-11-08T07:00:00Z")*1000+51);assert.equal(middle.client.getState().currentTime,epoch("2026-11-08T10:00:00Z"));assert.equal(middle.requests.length,1,"midpoint redraw is local only");assert.deepEqual(middle.awake(),{requested:true,stops:0});
const midnight=harness(null,epoch("2026-11-08T15:59:50Z")*1000);midnight.reply(midnight.requests[0],fixture.full);const firstTomorrow=midnight.client.getState().tomorrowTime;midnight.nodes.awake.onclick();midnight.advance(epoch("2026-11-08T16:00:00Z")*1000+51);assert.equal(midnight.client.getState().today,"2026-11-09");assert.equal(midnight.client.getState().tomorrowTime,firstTomorrow+86400);assert.equal(midnight.requests.length,1,"Shanghai midnight changes cards without network");assert.equal(midnight.client.getState().basicFetchedAt,before);assert.deepEqual(midnight.awake(),{requested:true,stops:0});
assert.equal(c.nextReadAt(Date.parse("2026-11-08T02:50:00Z")),Date.parse("2026-11-08T04:35:00Z"));const slot=Date.parse("2026-11-07T16:35:00Z");assert.equal(c.nextReadAt(slot-1),slot);assert.equal(c.nextReadAt(slot),slot+21600000);assert.equal(c.nextReadAt(Date.parse("2026-12-31T15:59:59Z")),Date.parse("2026-12-31T16:35:00Z"));
const automatic=harness();automatic.reply(automatic.requests[0],fixture.full);let due=c.nextReadAt(fixture.now*1000);for(let n=0;n<4;n++){automatic.advance(due);automatic.reply(automatic.requests[automatic.requests.length-1],fixture.full);due+=21600000;}assert.equal(automatic.requests.length,5,"startup plus four automatic GitHub reads per day");
for(const request of h.requests){assert.equal(request.method,"GET");assert.equal(request.url,c.cacheURL);assert.deepEqual(request.headers,{Accept:"application/vnd.github.raw+json"});assert.ok(!/apikey|token|localhost|127\.0\.0\.1/.test(request.url));}
h.leave();middle.leave();midnight.leave();assert.equal(h.timers.size,0);assert.equal(h.awake().stops,1);assert.equal(middle.timers.size,0);
const pausedCache={...fixture.full,paused:{code:"unexpected_provider_tariff"}};const paused=harness();paused.reply(paused.requests[0],pausedCache);assert.equal(paused.nodes.status.textContent,"天气更新已暂停");
console.log("PASS: service contract, optional day codes, nearest original temperature, Shanghai midnight/year/leap dates, nulls/units, cache retention/races, four scheduled reads, local midpoint/date redraw and NoSleep cleanup; no network.");
