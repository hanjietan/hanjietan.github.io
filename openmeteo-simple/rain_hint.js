/* Server-only ES5 QWeather precipitation analysis. No I/O or credentials.
 * Backend callers supply privately fetched raw data and the current UTC time.
 * Official precip is an accumulated 5-minute amount (mm), not a rate.
 * fxTime's exact preceding/following bucket boundary is undocumented: messages
 * are approximate possibilities, never precise onset or observed-rain claims.
 */
(function (root) {
  "use strict";
  function finite(value) {return typeof value==="number" && isFinite(value);}
  function epoch(value) {return finite(value) && value>=946684800 && value<4102444800;}
  function array(value) {return Object.prototype.toString.call(value)==="[object Array]";}
  function option(value,minimum,maximum,fallback) {return finite(value) && value>=minimum && value<=maximum?value:fallback;}
  function parseTime(value) {
    if(typeof value!=="string")return null;
    var m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if(!m)return null;
    var year=+m[1],month=+m[2],day=+m[3],hour=+m[4],minute=+m[5],second=+(m[6]||0);
    if(month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)return null;
    var milliseconds=+((m[7]||"")+"00").slice(0,3),local=Date.UTC(year,month-1,day,hour,minute,second,milliseconds),check=new Date(local),offset=0;
    if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return null;
    if(m[8]!=="Z"){
      var hours=+m[8].slice(1,3),minutes=+m[8].slice(4,6);
      if(hours>14||minutes>59||hours===14&&minutes!==0)return null;
      offset=(hours*60+minutes)*60*(m[8].charAt(0)==="-"?-1:1);
    }
    var result=local/1000-offset;
    return epoch(result)?result:null;
  }
  function precipitation(value) {
    if(typeof value==="string"){
      value=value.replace(/^\s+|\s+$/g,"");
      if(value.length>32||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))return null;
      value=Number(value);
    }
    return finite(value)&&value>=0&&value<=10000?value:null;
  }
  function summary(value) {
    if(typeof value!=="string")return "";
    value=value.replace(/<[^>]*>/g,"").replace(/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,"").replace(/\s+/g," ").replace(/^\s+|\s+$/g,"");
    var output="",count=0;
    for(var i=0;i<value.length&&count<30;i++,count++){
      var code=value.charCodeAt(i);output+=value.charAt(i);
      if(code>=55296&&code<=56319&&i+1<value.length&&value.charCodeAt(i+1)>=56320&&value.charCodeAt(i+1)<=57343)output+=value.charAt(++i);
    }
    return output;
  }
  function normalize(raw,fetchedAt) {
    if(!raw||raw.code!=="200")throw new Error("qweather_not_success");
    if(!epoch(fetchedAt))throw new Error("invalid_fetched_time");
    var updatedAt=parseTime(raw.updateTime);
    if(updatedAt===null)throw new Error("invalid_update_time");
    if(!array(raw.minutely)||!raw.minutely.length)throw new Error("missing_minutely_data");
    var bins=[],previous=-1;
    for(var i=0;i<raw.minutely.length;i++){
      var row=raw.minutely[i],time=row&&typeof row==="object"?parseTime(row.fxTime):null;
      if(time===null||time===undefined||time<=previous)throw new Error("invalid_forecast_times");
      previous=time;
      bins.push({time:time,precipitation:precipitation(row.precip),type:row.type==="rain"||row.type==="snow"?row.type:null});
    }
    return {schemaVersion:1,source:"qweather",fetchedAt:fetchedAt,updatedAt:updatedAt,summary:summary(raw.summary),bins:bins,intervalSeconds:300,units:{precipitation:"mm/5min"}};
  }
  function hidden(reason,until) {return {visible:false,text:"",reason:reason,validUntil:until||null};}
  function unknownBefore(data,instant,selected) {
    if(selected.time<=instant)return false;
    var start=-1,i;
    for(i=0;i<data.bins.length;i++){
      if(!data.bins[i]||!epoch(data.bins[i].time))return true;
      if(data.bins[i].time<=instant)start=i;else break;
    }
    // Without a current/adjacent label, the beginning of the window is unknown.
    if(start<0 || instant-data.bins[start].time>=300)return true;
    var previous=data.bins[start].time;
    for(i=start;i<data.bins.length;i++){
      var bin=data.bins[i];
      if(!bin||!epoch(bin.time))return true;
      if(bin.time>selected.time)break;
      if(i>start && bin.time-previous!==300)return true;
      previous=bin.time;
      if(bin.time===selected.time)return false;
      // Even a small earlier positive could mean precipitation already began.
      if(!finite(bin.precipitation)||bin.precipitation!==0||bin.type!=="rain"&&bin.type!=="snow")return true;
    }
    return true;
  }
  function analyze(data,instant,options) {
    options=options||{};
    if(!epoch(instant)||!data||data.schemaVersion!==1||data.source!=="qweather"||!epoch(data.updatedAt)||!epoch(data.fetchedAt)||!array(data.bins)||!data.bins.length)return hidden("unknown_data");
    var maxAge=option(options.maxAgeSeconds,60,1800,900),skew=option(options.futureClockToleranceSeconds,0,300,120);
    var horizon=option(options.horizonSeconds,300,7200,7200),threshold=option(options.thresholdMm,0,100,0);
    var last=data.bins[data.bins.length-1];
    if(!last||!epoch(last.time))return hidden("unknown_data");
    var until=Math.min(data.updatedAt+maxAge,data.fetchedAt+maxAge,last.time+300);
    if(data.updatedAt>instant+skew||data.fetchedAt>instant+skew)return hidden("future_data_time",until);
    if(instant>=until)return hidden("expired",until);
    var selected=null;
    for(var i=0;i<data.bins.length;i++){
      var bin=data.bins[i];
      // Do not turn a positive historical label into a future rain warning.
      if(!bin||!epoch(bin.time)||bin.time<instant||bin.time>instant+horizon||!finite(bin.precipitation)||bin.precipitation<=threshold||bin.type!=="rain"&&bin.type!=="snow")continue;
      if(!selected||bin.time<selected.time)selected=bin;
    }
    if(!selected)return hidden("no_known_future_precipitation",until);
    var delta=selected.time-instant,minutes=Math.ceil(delta/300)*5,kind=selected.type==="snow"?"雪":"雨",uncertain=unknownBefore(data,instant,selected);
    var text=uncertain?"近期可能有"+kind:delta===0?"短时可能有"+kind:delta<=300?"5分钟内可能有"+kind:"约"+minutes+"分钟后可能有"+kind;
    return {visible:true,text:text,reason:uncertain?"unknown_prior_coverage":"positive_forecast",type:selected.type,minutes:uncertain?null:minutes,coverageUnknown:uncertain,forecastTime:selected.time,precipitation:selected.precipitation,updatedAt:data.updatedAt,fetchedAt:data.fetchedAt,validUntil:until,nextCheckAt:Math.min(instant+60,until,selected.time+1),officialSummary:data.summary||""};
  }
  // Qualitative display periods, not provider rows or amounts. A 5-minute
  // accumulated amount x12 gives an equivalent short-period mm/hour rate.
  // WMO short-duration rain-intensity bands are approximated here; these are
  // not China's 12/24-hour accumulated rainfall classes or drizzle diagnosis.
  function rainStrength(amount) {
    if(!finite(amount)||amount<=0)return null;
    var rate=amount*12;
    return rate<2.5?"light":rate<10?"moderate":rate<50?"heavy":"violent";
  }
  function deriveOutlook(data,instant) {
    if(!data||data.schemaVersion!==1||!epoch(instant)||!array(data.bins)||!data.bins.length)throw new Error("invalid_outlook_data");
    var last=data.bins[data.bins.length-1],end=Math.min(last.time+300,instant+7200),periods=[],cursor=instant;
    if(!epoch(end)||end<=instant)throw new Error("exhausted_outlook");
    function append(from,to,kind,strength) {
      if(to<=from)return;
      var previous=periods.length?periods[periods.length-1]:null;
      if(previous&&previous.to===from&&previous.kind===kind&&previous.strength===strength)previous.to=to;
      else periods.push({from:from,to:to,kind:kind,strength:strength});
    }
    for(var i=0;i<data.bins.length&&cursor<end;i++){
      var bin=data.bins[i],from=Math.max(instant,bin.time),to=Math.min(bin.time+300,end);
      if(i+1<data.bins.length)to=Math.min(to,data.bins[i+1].time);
      if(to<=cursor)continue;
      if(from>cursor){append(cursor,Math.min(from,end),"unknown",null);cursor=Math.min(from,end);}
      if(cursor>=end)break;
      from=Math.max(from,cursor);
      var kind="unknown",strength=null;
      if(finite(bin.precipitation)&&bin.precipitation===0&&(bin.type==="rain"||bin.type==="snow"))kind="dry";
      else if(finite(bin.precipitation)&&bin.precipitation>0&&(bin.type==="rain"||bin.type==="snow")){
        kind=bin.type;strength=kind==="rain"?rainStrength(bin.precipitation):null;
      }
      append(from,to,kind,strength);cursor=to;
    }
    if(cursor<end)append(cursor,end,"unknown",null);
    return {periods:periods};
  }
  root.KindleRainHint={normalize:normalize,analyze:analyze,deriveOutlook:deriveOutlook,rainStrength:rainStrength,parseTime:parseTime,sanitizeSummary:summary};
}(typeof window!=="undefined"?window:this));
