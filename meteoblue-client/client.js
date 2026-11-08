/* ES5 reader for the public Meteoblue cache. No provider credentials or direct provider requests. */
(function (root) {
  "use strict";
  var CACHE_URL = "https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/cache/hepo.json?ref=codex%2Fkindle-weather";
  var PERIOD = 21600000, STEP = 21600, OFFSET = 28800, STORAGE_KEY = "kindle-meteoblue-cache-v1:hepo";
  var EXPECTED_UNITS = {temperature:"C",relativeHumidity:"%",totalCloudCover:"%",windSpeed:"m/s",windDirection:"degree",precipitation:"mm"};
  var FIELDS = ["temperature","relativeHumidity","totalCloudCover","precipitation","windSpeed","windDirection"];
  var canvas = document.getElementById("screen"), ctx = canvas.getContext("2d"), toolbar = document.getElementById("toolbar");
  var status = document.getElementById("status"), cache = null, networkTimer = null, displayTimer = null;
  var generation = 0, displayGeneration = 0, stopped = false, statusMessage = "", awakeMessage = "", awake = null;

  function now() { return new Date().getTime(); }
  function finite(value) { return typeof value === "number" && isFinite(value); }
  function timestamp(value) { return finite(value) && value >= 0 && value < 100000000000; }
  function nullable(value) { return value === null || finite(value); }
  function pad(value) { return value < 10 ? "0" + value : String(value); }
  function clock(value, date) {
    if (!timestamp(value)) return "--";
    var d = new Date((value + OFFSET) * 1000);
    return (date ? pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate()) + " " : "") + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }
  function amount(value, digits, suffix) { return finite(value) ? value.toFixed(digits || 0) + (suffix || "") : "--"; }
  function direction(value) {
    if (!finite(value) || value < 0 || value > 360) return "--";
    return ["北","东北","东","东南","南","西南","西","西北"][Math.floor((value % 360 + 22.5) / 45) % 8];
  }
  function modelTime(value) {
    if (value === null) return true;
    if (Object.prototype.toString.call(value) === "[object Array]") {
      for (var i = 0; i < value.length; i++) if (!timestamp(value[i])) return false;
      return true;
    }
    return timestamp(value);
  }
  function latestTime(value) {
    return Object.prototype.toString.call(value) === "[object Array]" ? value.length ? Math.max.apply(Math,value) : null : value;
  }
  function packageMetadata(group) {
    if (!group || group.resolutionHours !== 6 || !(group.fetchedAt === null || timestamp(group.fetchedAt))) throw new Error("数据时间格式异常");
    if (!modelTime(group.modelrunUtc)) throw new Error("模型时间格式异常");
    if (!modelTime(group.modelrunUpdateTimeUtc)) throw new Error("发布时间格式异常");
  }
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || data.source !== "meteoblue") throw new Error("天气来源或版本异常");
    var location = data.location;
    if (!location || location.id !== "hepo" || location.timezone !== "Asia/Shanghai" || !location.name || !finite(location.latitude) || !finite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) throw new Error("地点数据异常");
    for (var unit in EXPECTED_UNITS) if (EXPECTED_UNITS.hasOwnProperty(unit) && (!data.units || data.units[unit] !== EXPECTED_UNITS[unit])) throw new Error("天气单位异常");
    if (!data.packages) throw new Error("天气发布时间缺失");
    packageMetadata(data.packages.basic); packageMetadata(data.packages.clouds);
    if (Object.prototype.toString.call(data.sixHourly) !== "[object Array]") throw new Error("预报时段缺失");
    var previous = -1;
    for (var i = 0; i < data.sixHourly.length; i++) {
      var row = data.sixHourly[i];
      if (!row || !timestamp(row.time) || row.time <= previous) throw new Error("预报时间顺序异常");
      if (previous >= 0 && (row.time - previous) % STEP !== 0) throw new Error("预报时段间隔异常");
      previous = row.time;
      for (var f = 0; f < FIELDS.length; f++) {
        var key = FIELDS[f], value = row[key];
        if (!nullable(value)) throw new Error("天气数值缺失或异常");
        if (value !== null && ((key === "relativeHumidity" || key === "totalCloudCover") && (value < 0 || value > 100) || key === "windDirection" && (value < 0 || value > 360) || (key === "windSpeed" || key === "precipitation") && value < 0)) throw new Error("天气数值范围异常");
      }
    }
    return data;
  }
  function rowsAt(data, instant, hours) {
    var out = [], rows = data && data.sixHourly || [], end = instant + hours * 3600;
    for (var i = 0; i < rows.length; i++) if (rows[i].time > instant && rows[i].time <= end) out.push(rows[i]);
    return out;
  }
  function text(x, y, message, size, bold, align, color) {
    ctx.fillStyle = color || "#000"; ctx.textAlign = align || "left"; ctx.textBaseline = "top";
    ctx.font = (bold ? "bold " : "") + (size || 16) + "px sans-serif"; ctx.fillText(String(message), x, y);
  }
  function line(x1, y1, x2, y2, width, color) {
    ctx.strokeStyle = color || "#000"; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
  function rule(y) { line(20,y,580,y,1.5); }
  function xAt(time, first) { return 94 + (time - first) / (11 * STEP) * 470; }
  function hatch(x, y, width, height) {
    ctx.fillStyle = "#eee"; ctx.fillRect(x,y,width,height);
    line(x+2,y+height-2,x+width-2,y+2,1,"#777");
  }
  function issue(group) {
    var published=latestTime(group.modelrunUpdateTimeUtc);
    if (timestamp(published)) return "发布 " + clock(published,true);
    var run=latestTime(group.modelrunUtc);
    return timestamp(run) ? "起报 " + clock(run,true) : "发布时间 --";
  }
  function metadataLine(label, group, y) {
    text(20,y,label + "  " + issue(group) + "  ·  取得 " + clock(group.fetchedAt,true),12);
    if (group.latestAttempt && /^(failed|expired|paused)$/.test(group.latestAttempt.status)) text(580,y,"未更新",12,true,"right");
  }
  function curve(rows, key, top, bottom, low, high, labels) {
    var previous = null, first = rows[0].time;
    for (var i = 0; i < rows.length; i++) {
      var value = rows[i][key], x = xAt(rows[i].time,first);
      if (!finite(value)) { previous = null; text(x,bottom-12,"--",11,false,"center"); continue; }
      var y = bottom - (value-low)/(high-low)*(bottom-top);
      if (previous) line(previous[0],previous[1],x,y,1.8);
      ctx.fillStyle="#000"; ctx.fillRect(x-1.5,y-1.5,3,3);
      if (labels && i%2===0) text(x,y-17,amount(value,0),13,true,"center");
      previous=[x,y];
    }
  }
  function render() {
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,600,800);
    text(20,18,cache ? cache.location.name : "揭西河婆",24,true); rule(59);
    var rows=rowsAt(cache,now()/1000,72);
    if (!rows.length) {
      text(300,300,cache && cache.sixHourly.length ? "暂无有效预报时段" : "等待天气数据",27,true,"center");
      if(cache){rule(716);metadataLine("温雨风",cache.packages.basic,732);metadataLine("总云量",cache.packages.clouds,762);}
      fit(); scheduleDisplay(); return;
    }
    var current=rows[0], first=current.time;
    text(580,25,clock(first-STEP,true)+"–"+clock(first)+" 预报",13,true,"right");
    text(20,78,clock(first)+" 气温",12);text(20,98,amount(current.temperature,1,"°"),48,true);
    text(260,103,"湿度 "+amount(current.relativeHumidity,0,"%"),20,true);
    text(420,105,"平均云 "+amount(current.totalCloudCover,0,"%"),17);
    text(20,163,"降水 "+amount(current.precipitation,1)+" mm/6h",19,true);
    text(580,164,"平均风 "+amount(current.windSpeed,1)+" m/s  "+direction(current.windDirection)+" "+amount(current.windDirection,0,"°"),17,false,"right");rule(204);
    text(20,216,"未来72小时",21,true);text(580,221,"6小时",13,false,"right");
    for(var i=0;i<rows.length;i++){
      var x=xAt(rows[i].time,first);
      if(i%2===0){var d=new Date((rows[i].time+OFFSET)*1000);text(x,254,pad(d.getUTCDate())+"日 "+pad(d.getUTCHours()),12,false,"center");line(x,281,x,689,0.6,"#ddd");}
    }
    var temps=[],maxWind=1,maxRain=1;
    for(i=0;i<rows.length;i++){if(finite(rows[i].temperature))temps.push(rows[i].temperature);if(finite(rows[i].windSpeed))maxWind=Math.max(maxWind,rows[i].windSpeed);if(finite(rows[i].precipitation))maxRain=Math.max(maxRain,rows[i].precipitation);}
    var low=temps.length?Math.min.apply(Math,temps)-1:0,high=temps.length?Math.max.apply(Math,temps)+1:1;
    text(20,311,"气温",16,true);text(20,338,"°C",12);curve(rows,"temperature",299,366,low,high,true);
    text(20,399,"湿度",16,true);text(20,423,"%",12);curve(rows,"relativeHumidity",389,438,0,100,true);
    text(20,465,"总云",16,true);text(20,488,"%",12);
    for(i=0;i<rows.length;i++){x=xAt(rows[i].time,first);var cloud=rows[i].totalCloudCover;if(!finite(cloud))hatch(x-18,464,36,25);else{var shade=Math.round(255-cloud*2.35);ctx.fillStyle="rgb("+shade+","+shade+","+shade+")";ctx.fillRect(x-18,464,36,25);ctx.strokeStyle="#aaa";ctx.lineWidth=0.5;ctx.strokeRect(x-18,464,36,25);text(x,470,amount(cloud),12,false,"center",shade<140?"#fff":"#000");}}
    text(20,532,"降水",16,true);text(20,557,"mm/6h",11);line(76,577,582,577,1,"#888");
    for(i=0;i<rows.length;i++){x=xAt(rows[i].time,first);var rain=rows[i].precipitation;if(!finite(rain))hatch(x-10,549,20,27);else{var bar=rain>0?Math.max(2,rain/maxRain*40):0;ctx.fillStyle="#000";if(bar)ctx.fillRect(x-10,577-bar,20,bar);}text(x,514,amount(rain,1),12,false,"center");}
    text(20,616,"平均风",14,true);text(20,640,"m/s",12);curve(rows,"windSpeed",609,655,0,maxWind+0.5,true);
    text(20,678,"风向",16,true);for(i=0;i<rows.length;i++)text(xAt(rows[i].time,first),678,direction(rows[i].windDirection),11,false,"center");
    rule(716);metadataLine("温雨风",cache.packages.basic,732);metadataLine("总云量",cache.packages.clouds,762);
    fit(); scheduleDisplay();
  }
  function fit() {
    var w=root.innerWidth||document.documentElement.clientWidth,h=root.innerHeight||document.documentElement.clientHeight;
    var scale=Math.max(0.2,Math.min(w/600,(h-toolbar.offsetHeight)/800));
    canvas.style.width=Math.floor(600*scale)+"px";canvas.style.height=Math.floor(800*scale)+"px";
  }
  function setStatus(message) {statusMessage=message;status.textContent=message+(awakeMessage?(message?" · ":"")+awakeMessage:"");status.style.display=status.textContent?"block":"none";fit();}
  function cancelDisplay() {displayGeneration++;if(displayTimer!==null)root.clearTimeout(displayTimer);displayTimer=null;}
  function scheduleDisplay() {
    cancelDisplay();if(stopped||!cache)return;
    var rows=rowsAt(cache,now()/1000,72);if(!rows.length)return;
    var marker=displayGeneration;
    displayTimer=root.setTimeout(function(){if(stopped||marker!==displayGeneration)return;displayTimer=null;render();},Math.max(50,rows[0].time*1000-now()+50));
  }
  function nextReadAt(milliseconds) {
    // Beijing 00:35 / 06:35 / 12:35 / 18:35, strictly after this instant.
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
  root.MeteoblueClient={cacheURL:CACHE_URL,validate:validate,rowsAt:rowsAt,clock:clock,direction:direction,nextReadAt:nextReadAt,getState:function(){return{hasData:!!cache,validTimes:rowsAt(cache,now()/1000,72).map(function(row){return row.time;}),basicFetchedAt:cache?cache.packages.basic.fetchedAt:null,cloudsFetchedAt:cache?cache.packages.clouds.fetchedAt:null,networkTimerActive:networkTimer!==null,displayTimerActive:displayTimer!==null};}};
  render();refresh();
}(this));
