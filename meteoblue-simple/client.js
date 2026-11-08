/* ES5 Meteoblue daily display. Reads only the public credential-free cache. */
(function (root) {
  "use strict";
  var CACHE_URL = "https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/cache/hepo.json?ref=codex%2Fkindle-weather";
  var PERIOD = 21600000, STEP = 21600, OFFSET = 28800, HEIGHT = 716;
  var STORAGE_KEY = "kindle-meteoblue-simple-v1:hepo";
  var EXPECTED_UNITS = {temperature:"C",relativeHumidity:"%",totalCloudCover:"%",windSpeed:"m/s",windDirection:"degree",precipitation:"mm"};
  var FIELDS = ["temperature","relativeHumidity","totalCloudCover","precipitation","windSpeed","windDirection"];
  var DAY_FIELDS = ["temperatureMin","temperatureMax","precipitation"];
  // The official 6-hourly/daily family has no codes 18 or 19. Hourly codes differ.
  var WEATHER = {1:"晴",2:"晴间少云",3:"多云",4:"阴",5:"雾",6:"阴有雨",7:"阵雨",8:"阵雨，可能雷电",9:"阴有雪",10:"阵雪",11:"雨夹雪",12:"阴，间歇有雨",13:"阴，间歇有雪",14:"多云有雨",15:"多云有雪",16:"多云，间歇有雨",17:"多云，间歇有雪",20:"大部多云",21:"晴，可能雷雨",22:"可能雷雨",23:"可能雷阵雨",24:"雷雨及强阵雨",25:"多云伴雷阵雨"};
  var canvas = document.getElementById("screen"), ctx = canvas.getContext("2d"), controls = document.getElementById("controls");
  var status = document.getElementById("status"), cache = null, networkTimer = null, displayTimer = null;
  var generation = 0, displayGeneration = 0, stopped = false, statusMessage = "", awakeMessage = "", awake = null;

  function now() { return new Date().getTime(); }
  function finite(value) { return typeof value === "number" && isFinite(value); }
  function timestamp(value) { return finite(value) && value >= 0 && value < 100000000000; }
  function nullable(value) { return value === null || finite(value); }
  function array(value) { return Object.prototype.toString.call(value) === "[object Array]"; }
  function pad(value) { return value < 10 ? "0" + value : String(value); }
  function civil(value) { return new Date((value + OFFSET) * 1000); }
  function dayKey(value) {
    var d = civil(value);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function targetDay(instant, offset) {
    var d = civil(instant), target = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+offset));
    return {key:target.getUTCFullYear()+"-"+pad(target.getUTCMonth()+1)+"-"+pad(target.getUTCDate()),month:target.getUTCMonth()+1,day:target.getUTCDate(),weekday:target.getUTCDay()};
  }
  function clock(value, date) {
    if (!timestamp(value)) return "--";
    var d = civil(value);
    return (date ? pad(d.getUTCMonth()+1)+"/"+pad(d.getUTCDate())+" " : "")+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes());
  }
  function amount(value, digits) { return finite(value) ? value.toFixed(digits || 0).replace(/^-0$/,"0") : "--"; }
  function rainAmount(value) {
    if(!finite(value))return "--";
    if(value>0 && value<0.01)return "<0.01";
    return value.toFixed(2).replace(/\.?0+$/,"");
  }
  function modelTime(value) {
    if (value === null) return true;
    if (array(value)) { for (var i=0;i<value.length;i++) if (!timestamp(value[i])) return false; return true; }
    return timestamp(value);
  }
  function latestTime(value) { return array(value) ? value.length ? Math.max.apply(Math,value) : null : value; }
  function packageMetadata(group) {
    if (!group || group.resolutionHours !== 6 || !(group.fetchedAt === null || timestamp(group.fetchedAt))) throw new Error("数据时间格式异常");
    if (!modelTime(group.modelrunUtc) || !modelTime(group.modelrunUpdateTimeUtc)) throw new Error("发布时间格式异常");
  }
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || data.source !== "meteoblue") throw new Error("天气来源或版本异常");
    var location=data.location;
    if (!location || location.id!=="hepo" || location.timezone!=="Asia/Shanghai" || !location.name || !finite(location.latitude) || !finite(location.longitude) || Math.abs(location.latitude)>90 || Math.abs(location.longitude)>180) throw new Error("地点数据异常");
    for (var unit in EXPECTED_UNITS) if (EXPECTED_UNITS.hasOwnProperty(unit) && (!data.units || data.units[unit]!==EXPECTED_UNITS[unit])) throw new Error("天气单位异常");
    if (!data.packages) throw new Error("天气发布时间缺失");
    packageMetadata(data.packages.basic); packageMetadata(data.packages.clouds);
    if (!array(data.sixHourly) || !array(data.daily)) throw new Error("预报时段缺失");
    var previous=-1,i,f,row,value,key;
    for (i=0;i<data.sixHourly.length;i++) {
      row=data.sixHourly[i];
      if (!row || !timestamp(row.time) || row.time<=previous || previous>=0 && (row.time-previous)%STEP!==0) throw new Error("预报时间顺序异常");
      previous=row.time;
      for (f=0;f<FIELDS.length;f++) {
        key=FIELDS[f]; value=row[key];
        if (!nullable(value)) throw new Error("天气数值缺失或异常");
        if (value!==null && ((key==="relativeHumidity" || key==="totalCloudCover") && (value<0 || value>100) || key==="windDirection" && (value<0 || value>360) || (key==="windSpeed" || key==="precipitation") && value<0)) throw new Error("天气数值范围异常");
      }
    }
    previous=-1;var previousDay="";
    for (i=0;i<data.daily.length;i++) {
      row=data.daily[i];
      if (!row || !timestamp(row.time) || row.time<=previous || dayKey(row.time)===previousDay) throw new Error("日预报日期异常");
      previous=row.time;previousDay=dayKey(row.time);
      for (f=0;f<DAY_FIELDS.length;f++) if (!nullable(row[DAY_FIELDS[f]])) throw new Error("日预报数值异常");
      if (row.precipitation!==null && row.precipitation<0 || finite(row.temperatureMin) && finite(row.temperatureMax) && row.temperatureMin>row.temperatureMax) throw new Error("日预报范围异常");
    }
    return data;
  }
  function currentAt(data, instant) {
    var rows=data && data.sixHourly || [], closest=null, distance=STEP+1;
    for (var i=0;i<rows.length;i++) {
      var delta=Math.abs(rows[i].time-instant);
      if(delta<=STEP && (delta<distance || delta===distance && (!closest || rows[i].time>closest.time))){closest=rows[i];distance=delta;}
    }
    return closest;
  }
  function dayFor(data, instant, offset) {
    var target=targetDay(instant,offset).key, rows=data && data.daily || [];
    for (var i=0;i<rows.length;i++) if (dayKey(rows[i].time)===target) return rows[i];
    return null;
  }
  function weatherText(data, row) {
    var code=row && row.weatherCode;
    return data && data.weatherCodeSystem==="meteoblue-pictocode-1-25" && finite(code) && code%1===0 && WEATHER.hasOwnProperty(code) ? WEATHER[code] : "天气暂无";
  }
  function text(x,y,message,size,bold,align) {
    ctx.fillStyle="#000";ctx.textAlign=align||"left";ctx.textBaseline="top";
    ctx.font=(bold?"bold ":"")+(size||20)+"px sans-serif";ctx.fillText(String(message),x,y);
  }
  function rule(y) {ctx.strokeStyle="#000";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(28,y);ctx.lineTo(572,y);ctx.stroke();}
  function dayCard(instant, offset, top) {
    var date=targetDay(instant,offset),row=dayFor(cache,instant,offset);
    text(28,top,offset===1?"明天":"后天",36,true);
    text(28,top+49,date.month+"月"+date.day+"日",24);
    text(572,top+10,amount(row && row.temperatureMin)+"—"+amount(row && row.temperatureMax)+"°",60,true,"right");
    var condition=weatherText(cache,row);
    text(28,top+103,condition,32,true);
    text(572,top+107,"降水"+rainAmount(row && row.precipitation)+"毫米",29,false,"right");
  }
  function render() {
    var instant=now()/1000,today=targetDay(instant,0),current=currentAt(cache,instant),basic=cache && cache.packages.basic;
    ctx.fillStyle="#fff";ctx.fillRect(0,0,600,HEIGHT);
    text(28,18,cache?cache.location.name:"揭西河婆",32,true);
    text(572,25,today.month+"月"+today.day+"日 周"+"日一二三四五六".charAt(today.weekday),23,false,"right");
    var valid=current?dayKey(current.time)===today.key?"今天 "+clock(current.time):clock(current.time,true):"";
    text(300,83,"气温预报"+(valid?" · "+valid:""),26,false,"center");
    text(300,120,amount(current && current.temperature)+"°C",126,true,"center");
    if (!current) text(300,252,cache?"暂无有效气温预报":"等待天气数据",23,false,"center");
    rule(282);dayCard(instant,1,303);rule(458);dayCard(instant,2,479);rule(634);
    var published=basic?latestTime(basic.modelrunUpdateTimeUtc):null;
    var label=timestamp(published)?"预报更新 ":"数据取得 ";
    text(300,655,label+clock(timestamp(published)?published:basic?basic.fetchedAt:null,true),21,false,"center");
    if (basic && basic.latestAttempt && /^(failed|expired|paused)$/.test(basic.latestAttempt.status)) text(300,681,"预报未更新",18,true,"center");
    fit();scheduleDisplay();
  }
  function fit() {
    var w=root.innerWidth||document.documentElement.clientWidth,h=root.innerHeight||document.documentElement.clientHeight;
    var scale=Math.max(0.2,Math.min(w/600,(h-controls.offsetHeight)/HEIGHT));
    canvas.style.width=Math.floor(600*scale)+"px";canvas.style.height=Math.floor(HEIGHT*scale)+"px";
  }
  function setStatus(message) {statusMessage=message;status.textContent=message+(awakeMessage?(message?" · ":"")+awakeMessage:"");status.style.display=status.textContent?"block":"none";fit();}
  function cancelDisplay() {displayGeneration++;if(displayTimer!==null)root.clearTimeout(displayTimer);displayTimer=null;}
  function nextMidnight(instant) {
    var d=civil(instant);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1)-OFFSET*1000;
  }
  function scheduleDisplay() {
    cancelDisplay();if(stopped)return;
    var instant=now()/1000,current=currentAt(cache,instant),due=nextMidnight(instant)+50;
    var rows=cache && cache.sixHourly || [],i;
    if(current){
      due=Math.min(due,(current.time+STEP)*1000+50);
      for(i=0;i<rows.length;i++)if(rows[i].time>current.time){due=Math.min(due,(current.time+rows[i].time)*500+50);break;}
    }else{
      for(i=0;i<rows.length;i++)if(rows[i].time-STEP>instant){due=Math.min(due,(rows[i].time-STEP)*1000+50);break;}
    }
    var marker=displayGeneration;
    displayTimer=root.setTimeout(function(){if(stopped||marker!==displayGeneration)return;displayTimer=null;render();},Math.max(50,due-now()));
  }
  function nextReadAt(milliseconds) {
    // Beijing 00:35 / 06:35 / 12:35 / 18:35. Screen redraws never query the provider.
    var shift=OFFSET*1000-35*60000;
    return (Math.floor((milliseconds+shift)/PERIOD)+1)*PERIOD-shift;
  }
  function scheduleNetwork() {if(networkTimer!==null)root.clearTimeout(networkTimer);if(!stopped)networkTimer=root.setTimeout(refresh,Math.max(1,nextReadAt(now())-now()));}
  function refresh() {
    if(stopped)return;if(networkTimer!==null)root.clearTimeout(networkTimer);networkTimer=null;
    var token=++generation,xhr=new XMLHttpRequest(),finished=false;setStatus("正在读取…");
    function complete(error) {
      if(finished||token!==generation||stopped)return;finished=true;
      if(!error){try{cache=validate(JSON.parse(xhr.responseText));try{root.localStorage.setItem(STORAGE_KEY,JSON.stringify(cache));}catch(ignore){}}catch(bad){error=bad.message||"天气格式异常";}}
      render();setStatus(error?"读取失败："+error:cache&&cache.paused?"天气更新已暂停":"");scheduleNetwork();
    }
    xhr.onload=function(){complete(xhr.status===200?null:"HTTP "+xhr.status);};xhr.onerror=function(){complete("网络错误");};xhr.ontimeout=function(){complete("访问超时");};
    try{xhr.open("GET",CACHE_URL,true);xhr.timeout=20000;xhr.setRequestHeader("Accept","application/vnd.github.raw+json");xhr.send(null);}catch(error){complete("无法读取天气");}
  }
  function stop(){stopped=true;generation++;cancelDisplay();if(networkTimer!==null)root.clearTimeout(networkTimer);networkTimer=null;if(awake)awake.disable();}
  document.getElementById("refresh").onclick=refresh;
  if(typeof root.KindleKeepAwake==="function"){
    awake=new root.KindleKeepAwake({videoOnly:true,onChange:function(state){awakeMessage=state.code==="failed"?"保持显示失败":state.code==="paused"?"保持显示已停止":state.code==="unsupported"?"保持显示不可用":"";document.getElementById("awake").textContent=state.requested?"停止保持":"保持显示";setStatus(statusMessage);}});
    document.getElementById("awake").onclick=function(){if(awake.getState().requested)awake.disable();else awake.enable();};
  }
  root.addEventListener("pagehide",stop,false);root.addEventListener("beforeunload",stop,false);root.onresize=fit;
  try{var saved=root.localStorage.getItem(STORAGE_KEY);if(saved)cache=validate(JSON.parse(saved));}catch(ignore){}
  root.MeteoblueSimple={cacheURL:CACHE_URL,validate:validate,clock:clock,dayKey:dayKey,targetDay:targetDay,dayFor:dayFor,currentAt:currentAt,weatherText:weatherText,nextReadAt:nextReadAt,nextMidnight:nextMidnight,getState:function(){var instant=now()/1000,current=currentAt(cache,instant),tomorrow=dayFor(cache,instant,1),after=dayFor(cache,instant,2);return{hasData:!!cache,currentTime:current?current.time:null,tomorrowTime:tomorrow?tomorrow.time:null,afterTomorrowTime:after?after.time:null,today:targetDay(instant,0).key,basicFetchedAt:cache?cache.packages.basic.fetchedAt:null,networkTimerActive:networkTimer!==null,displayTimerActive:displayTimer!==null};}};
  render();refresh();
}(this));
