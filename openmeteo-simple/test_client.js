/* Offline UI tests; actual provider normalization, no HTTP or device access. */
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict"),fixture=require("./test_support.js");
const source=fs.readFileSync(path.join(__dirname,"client.js"),"utf8"),noop=()=>{},epoch=text=>Date.parse(text)/1000;
function harness(saved,start=fixture.now*1000,storageFails=false){
  const nodes={},requests=[],timers=new Map(),events={},texts=[],keys=[];let time=start,id=0,awakeRequested=false,awakeStops=0,cancelCount=0;
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const context={fillText:msg=>texts.push(String(msg)),fillRect:noop,strokeRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop};
  const node=name=>nodes[name]||(nodes[name]={style:{},offsetHeight:80,getContext:()=>context});
  const environment={Date:ClockDate,document:{getElementById:node,documentElement:{clientWidth:600,clientHeight:800}},innerWidth:600,innerHeight:800,
    localStorage:{getItem(key){keys.push(key);if(storageFails)throw Error("blocked");return saved?JSON.stringify(saved):null;},setItem(){if(storageFails)throw Error("blocked");}},
    setTimeout(fn,delay){timers.set(++id,{fn,delay,due:time+delay});return id;},clearTimeout(key){timers.delete(key);},addEventListener(name,fn){(events[name]||(events[name]=[])).push(fn);},
    OpenMeteoProvider:{fetch(config,cb){requests.push({config,cb});},cancel(){cancelCount++;return true;}},KindleRemoteUpdateState:{source:"transport"},
    KindleKeepAwake:function(options){assert.equal(options.videoOnly,true);this.getState=()=>({requested:awakeRequested});this.enable=()=>{awakeRequested=true;options.onChange({requested:true,code:"playing"});};this.disable=()=>{awakeStops++;awakeRequested=false;options.onChange({requested:false,code:"disabled"});};}};
  vm.runInNewContext(source,environment);
  return{remoteState:environment.KindleRemoteUpdateState,client:environment.OpenMeteoSimple,nodes,requests,timers,texts,keys,
    reply(request,data,error=null){request.cb(error,data);},
    advance(target){for(let loops=0;loops<100;loops++){const list=[...timers.entries()].filter(([k,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due);if(!list.length)break;const[k,t]=list[0];time=t.due;timers.delete(k);t.fn();}time=target;},
    leave(){for(const fn of events.pagehide||[])fn();},cancelled:()=>cancelCount,awake:()=>({requested:awakeRequested,stops:awakeStops})};
}
const h=harness();assert.ok(h.texts.includes("等待天气数据"));h.reply(h.requests[0],fixture.full);const c=h.client;
assert.equal(h.remoteState.source,"open-meteo");assert.equal(c.getState().source,"open-meteo");assert.deepEqual(h.keys,["kindle-openmeteo-simple-v1:hepo"]);
assert.equal(c.getState().currentTime,fixture.full.current.time);assert.equal(c.getState().currentTemperature,28.2);assert.ok(h.texts.includes("28°C"));assert.ok(h.texts.some(t=>t.includes("当前气温")&&t.includes("12:00")));
assert.equal(c.getState().tomorrowTime,epoch("2026-11-08T16:00:00Z"));assert.equal(c.getState().afterTomorrowTime,epoch("2026-11-09T16:00:00Z"));
assert.ok(h.texts.includes("15—24°"));assert.ok(h.texts.includes("小毛毛雨"));assert.ok(h.texts.includes("阴"));assert.ok(h.texts.includes("降水0.1毫米"));assert.ok(h.texts.includes("降水0毫米"));
assert.ok(!h.texts.some(t=>/湿度|风速|云量|实测|Meteoblue/.test(t)));
for(const [code,text] of [[0,"晴"],[3,"阴"],[51,"小毛毛雨"],[61,"小雨"],[65,"大雨"],[71,"小雪"],[95,"雷雨"],[96,"雷雨伴冰雹"]])assert.equal(c.weatherText(fixture.full,{weatherCode:code}),text);
for(const code of [null,undefined,18,1.5,"0",100])assert.equal(c.weatherText(fixture.full,{weatherCode:code}),"—");assert.equal(c.weatherText({...fixture.full,weatherCodeSystem:"meteoblue-pictocode-1-25"},{weatherCode:3}),"—");
const partial=harness();partial.reply(partial.requests[0],fixture.partial);assert.ok(partial.texts.includes("——24°"));assert.ok(partial.texts.includes("降水—毫米"));
const bad=JSON.parse(JSON.stringify(fixture.full));bad.units.temperature="F";assert.throws(()=>c.validate(bad));bad.units.temperature="C";bad.source="meteoblue";assert.throws(()=>c.validate(bad));
for(const [instant,date] of [["2026-12-31T16:00:00Z","2027-01-01"],["2028-02-28T16:00:00Z","2028-02-29"],["2026-03-29T16:00:00Z","2026-03-30"]])assert.equal(c.dayKey(epoch(instant)),date);
assert.equal(c.targetDay(epoch("2028-02-28T15:59:59Z"),2).key,"2028-03-01");assert.equal(c.dayFor(fixture.full,epoch("2026-11-20T16:00:00Z"),1),null,"stale daily array index must not be called tomorrow");
const saved=harness(fixture.full);assert.equal(saved.client.getState().hasData,true);const denied=harness(null,fixture.now*1000,true);denied.reply(denied.requests[0],fixture.full);assert.equal(denied.client.getState().hasData,true);
const before=c.getState().fetchedAt;h.nodes.refresh.onclick();h.reply(h.requests[1],{...fixture.full,fetchedAt:before+100},"network error");assert.equal(c.getState().fetchedAt,before);assert.ok(h.nodes.status.textContent.includes("network error"));
h.nodes.refresh.onclick();const old=h.requests[h.requests.length-1];h.nodes.refresh.onclick();const latest=h.requests[h.requests.length-1];h.reply(latest,fixture.full);h.reply(old,null,"old error");assert.equal(h.nodes.status.textContent,"");
const midnight=harness(null,epoch("2026-11-08T15:59:50Z")*1000);midnight.reply(midnight.requests[0],fixture.full);midnight.nodes.awake.onclick();const tomorrow=midnight.client.getState().tomorrowTime;midnight.advance(epoch("2026-11-08T16:00:00Z")*1000+51);assert.equal(midnight.client.getState().today,"2026-11-09");assert.equal(midnight.client.getState().tomorrowTime,tomorrow+86400);assert.equal(midnight.requests.length,1);assert.deepEqual(midnight.awake(),{requested:true,stops:0});
assert.equal(c.nextReadAt(Date.parse("2026-11-08T02:50:00Z")),Date.parse("2026-11-08T04:35:00Z"));const slot=Date.parse("2026-11-07T16:35:00Z");assert.equal(c.nextReadAt(slot-1),slot);assert.equal(c.nextReadAt(slot),slot+21600000);
const automatic=harness();automatic.reply(automatic.requests[0],fixture.full);let due=c.nextReadAt(fixture.now*1000);for(let n=0;n<4;n++){automatic.advance(due);automatic.reply(automatic.requests[automatic.requests.length-1],fixture.full);due+=21600000;}assert.equal(automatic.requests.length,5,"startup plus four six-hour reads; no one/five-minute retry");
h.leave();midnight.leave();assert.equal(h.timers.size,0);assert.equal(h.awake().stops,1);assert.equal(h.cancelled(),1);assert.equal(midnight.timers.size,0);
console.log("PASS: actual Open-Meteo adapter contract, original current object, WMO/day selection, nulls/units, Shanghai dates, six-hour reads, local midnight, retained failures/races and NoSleep teardown; no network.");
