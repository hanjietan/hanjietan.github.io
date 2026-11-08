/* ES5 large-type weather display; direct Open-Meteo current and daily data. */
(function (root) {
  "use strict";
  var PERIOD=1800000,OFFSET=28800,HEIGHT=716,STORAGE_KEY="kindle-openmeteo-simple-v1:hepo";
  var WEATHER={0:"晴",1:"大部晴",2:"多云",3:"阴",45:"雾",48:"雾凇",51:"小毛毛雨",53:"毛毛雨",55:"较强毛毛雨",56:"冻毛毛雨",57:"冻毛毛雨",61:"小雨",63:"中雨",65:"大雨",66:"轻冻雨",67:"强冻雨",71:"小雪",73:"中雪",75:"大雪",77:"雪粒",80:"小阵雨",81:"阵雨",82:"强阵雨",85:"小阵雪",86:"强阵雪",95:"雷雨",96:"雷雨伴冰雹",99:"雷雨伴冰雹"};
  var canvas=document.getElementById("screen"),ctx=canvas.getContext("2d"),controls=document.getElementById("controls");
  var status=document.getElementById("status"),clockElement=document.getElementById("local-clock"),cache=null,networkTimer=null,displayTimer=null,clockTimer=null;
  var generation=0,displayGeneration=0,stopped=false,statusMessage="",awakeMessage="",awake=null;
  if(root.KindleRemoteUpdateState)root.KindleRemoteUpdateState.source="open-meteo";

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
    if (!timestamp(value)) return "—";
    var d = civil(value);
    return (date ? pad(d.getUTCMonth()+1)+"/"+pad(d.getUTCDate())+" " : "")+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes());
  }
  function amount(value, digits) { return finite(value) ? value.toFixed(digits || 0).replace(/^-0$/,"0") : "—"; }
  function rainAmount(value) {
    if(!finite(value))return "—";
    if(value>0 && value<0.01)return "<0.01";
    return value.toFixed(2).replace(/\.?0+$/,"");
  }
  function validate(data) {
    if(!data || data.schemaVersion!==1 || data.source!=="open-meteo" || data.weatherCodeSystem!=="wmo-4677")throw new Error("天气来源或版本异常");
    var location=data.location;
    if(!location || location.id!=="hepo" || location.timezone!=="Asia/Shanghai" || !location.name || !finite(location.latitude) || !finite(location.longitude) || Math.abs(location.latitude-23.4394)>0.02 || Math.abs(location.longitude-115.8305)>0.02)throw new Error("地点数据异常");
    if(!data.units || data.units.temperature!=="C" || data.units.precipitation!=="mm")throw new Error("天气单位异常");
    if(!timestamp(data.fetchedAt) || !data.current || !timestamp(data.current.time) || !nullable(data.current.temperature) || !array(data.daily))throw new Error("天气数据异常");
    var previous=-1,previousDay="";
    for(var i=0;i<data.daily.length;i++){
      var row=data.daily[i];
      if(!row || !timestamp(row.time) || row.time<=previous || dayKey(row.time)===previousDay || row.date!==dayKey(row.time))throw new Error("日预报日期异常");
      previous=row.time;previousDay=row.date;
      if(!nullable(row.temperatureMin) || !nullable(row.temperatureMax) || !nullable(row.precipitation) || row.precipitation!==null && row.precipitation<0 || finite(row.temperatureMin) && finite(row.temperatureMax) && row.temperatureMin>row.temperatureMax)throw new Error("日预报数值异常");
    }
    return data;
  }
  function currentAt(data) {return data?data.current:null;}
  function dayFor(data, instant, offset) {
    var target=targetDay(instant,offset).key, rows=data && data.daily || [];
    for (var i=0;i<rows.length;i++) if (dayKey(rows[i].time)===target) return rows[i];
    return null;
  }
  function weatherText(data, row) {
    var code=row && row.weatherCode;
    return data && data.weatherCodeSystem==="wmo-4677" && finite(code) && code%1===0 && WEATHER.hasOwnProperty(code) ? WEATHER[code] : "—";
  }
  function temperatureRange(row) {
    return row && (finite(row.temperatureMin)||finite(row.temperatureMax))?amount(row.temperatureMin)+"—"+amount(row.temperatureMax)+"°":"—";
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
    text(572,top+10,temperatureRange(row),60,true,"right");
    var condition=weatherText(cache,row);
    text(28,top+103,condition,32,true);
    text(572,top+107,"降水"+rainAmount(row && row.precipitation)+"毫米",29,false,"right");
  }
  function render() {
    var instant=now()/1000,today=targetDay(instant,0),current=currentAt(cache);
    ctx.fillStyle="#fff";ctx.fillRect(0,0,600,HEIGHT);
    text(28,18,cache?cache.location.name:"揭西河婆",32,true);
    text(572,25,today.month+"月"+today.day+"日 周"+"日一二三四五六".charAt(today.weekday),23,false,"right");
    var valid=current?dayKey(current.time)===today.key?"今天 "+clock(current.time):clock(current.time,true):"";
    text(300,66,current?"当前气温"+(valid?" · 天气时刻 "+valid:""):"等待天气数据",26,false,"center");
    text(300,100,amount(current && current.temperature)+"°C",126,true,"center");
    text(28,242,weatherText(cache,current),32,true);
    text(572,244,"今天 "+temperatureRange(dayFor(cache,instant,0)),30,true,"right");
    rule(282);dayCard(instant,1,303);rule(458);dayCard(instant,2,479);rule(634);
    text(300,655,"数据取得 "+clock(cache?cache.fetchedAt:null,true),21,false,"center");
    fit();scheduleDisplay();
  }
  function fit() {
    var w=root.innerWidth||document.documentElement.clientWidth,h=root.innerHeight||document.documentElement.clientHeight;
    var scale=Math.max(0.2,Math.min(w/600,(h-controls.offsetHeight)/HEIGHT));
    canvas.style.width=Math.floor(600*scale)+"px";canvas.style.height=Math.floor(HEIGHT*scale)+"px";
  }
  function setStatus(message) {statusMessage=message;status.textContent=message+(awakeMessage?(message?" · ":"")+awakeMessage:"");status.style.display=status.textContent?"block":"none";fit();}
  function cancelDisplay(){displayGeneration++;if(displayTimer!==null)root.clearTimeout(displayTimer);displayTimer=null;}
  function nextMidnight(instant){var d=civil(instant);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1)-OFFSET*1000;}
  function scheduleDisplay(){cancelDisplay();if(stopped)return;var marker=displayGeneration;displayTimer=root.setTimeout(function(){if(stopped||marker!==displayGeneration)return;displayTimer=null;render();},Math.max(50,nextMidnight(now()/1000)+50-now()));}
  function updateClock(){if(clockElement)clockElement.textContent="北京时间 "+clock(now()/1000);}
  function scheduleClock(){if(clockTimer!==null)root.clearTimeout(clockTimer);if(stopped)return;clockTimer=root.setTimeout(function(){clockTimer=null;if(!stopped){updateClock();scheduleClock();}},Math.max(1000,60000-now()%60000+150));}
  function nextReadAt(milliseconds){var shift=OFFSET*1000-35*60000;return(Math.floor((milliseconds+shift)/PERIOD)+1)*PERIOD-shift;}
  function scheduleNetwork(){if(networkTimer!==null)root.clearTimeout(networkTimer);if(!stopped)networkTimer=root.setTimeout(refresh,Math.max(1,nextReadAt(now())-now()));}
  function refresh(){
    if(stopped)return;if(networkTimer!==null)root.clearTimeout(networkTimer);networkTimer=null;
    var token=++generation,finished=false;setStatus("正在读取…");
    function complete(error,data){
      if(finished||token!==generation||stopped)return;finished=true;
      if(!error){try{cache=validate(data);try{root.localStorage.setItem(STORAGE_KEY,JSON.stringify(cache));}catch(ignore){}}catch(bad){error=bad.message||"天气格式异常";}}
      render();setStatus(error?"读取失败："+(error.message||String(error)):"");scheduleNetwork();
    }
    if(!root.OpenMeteoProvider || typeof root.OpenMeteoProvider.fetch!=="function"){complete("天气读取器不可用");return;}
    try{root.OpenMeteoProvider.fetch({},complete);}catch(error){complete("无法读取天气");}
  }
  function stop(){stopped=true;generation++;if(root.OpenMeteoProvider && typeof root.OpenMeteoProvider.cancel==="function")root.OpenMeteoProvider.cancel();cancelDisplay();if(networkTimer!==null)root.clearTimeout(networkTimer);networkTimer=null;if(clockTimer!==null)root.clearTimeout(clockTimer);clockTimer=null;if(awake)awake.disable();}
  document.getElementById("refresh").onclick=refresh;
  if(typeof root.KindleKeepAwake==="function"){
    awake=new root.KindleKeepAwake({videoOnly:true,onChange:function(state){awakeMessage=state.code==="failed"?"保持显示失败":state.code==="paused"?"保持显示已停止":state.code==="unsupported"?"保持显示不可用":"";document.getElementById("awake").textContent=state.requested?"停止保持":"保持显示";setStatus(statusMessage);}});
    document.getElementById("awake").onclick=function(){if(awake.getState().requested)awake.disable();else awake.enable();};
  }
  root.addEventListener("pagehide",stop,false);root.addEventListener("beforeunload",stop,false);root.onresize=fit;
  try{var saved=root.localStorage.getItem(STORAGE_KEY);if(saved)cache=validate(JSON.parse(saved));}catch(ignore){}
  root.OpenMeteoSimple={validate:validate,clock:clock,dayKey:dayKey,targetDay:targetDay,dayFor:dayFor,currentAt:currentAt,weatherText:weatherText,nextReadAt:nextReadAt,nextMidnight:nextMidnight,getState:function(){var instant=now()/1000,current=currentAt(cache),today=dayFor(cache,instant,0),tomorrow=dayFor(cache,instant,1),after=dayFor(cache,instant,2);return{source:cache?cache.source:null,hasData:!!cache,currentTime:current?current.time:null,currentTemperature:current?current.temperature:null,currentCondition:weatherText(cache,current),todayTime:today?today.time:null,todayRange:temperatureRange(today),tomorrowTime:tomorrow?tomorrow.time:null,afterTomorrowTime:after?after.time:null,today:targetDay(instant,0).key,fetchedAt:cache?cache.fetchedAt:null,networkTimerActive:networkTimer!==null,displayTimerActive:displayTimer!==null,clockTimerActive:clockTimer!==null,displayedClock:clockElement?clockElement.textContent:null};}};
  render();updateClock();scheduleClock();refresh();
}(this));
