/* ES5 public GitHub cache reader. No direct QWeather API or authentication. */
(function (root) {
  "use strict";
  var URL="https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/cache/hepo-rain.json?ref=codex%2Fkindle-weather";
  var POLL=300000,LOCAL=60000,FUTURE_SKEW=120,RECEIPT_MAX_AGE=600,SOURCE_MAX_AGE=1800;
  function finite(value){return typeof value==="number"&&isFinite(value);}
  function epoch(value){return finite(value)&&value>=946684800&&value<4102444800;}
  function updating(reason,until){return{visible:true,text:"雨情更新中",status:"updating",reason:reason,validUntil:until||null};}
  function wet(period){return period.kind==="rain"||period.kind==="snow";}
  function precipitationText(period){return period.kind==="snow"?"降雪":{light:"小雨",moderate:"中雨",heavy:"大雨",violent:"强降雨"}[period.strength];}
  function duration(seconds,up){
    var minutes=(up?Math.ceil(seconds/300):Math.floor(seconds/300))*5,hours=Math.floor(minutes/60),rest=minutes%60;
    return hours?hours+"小时"+(rest?rest+"分钟":""):minutes+"分钟";
  }
  function normalizeEnvelope(envelope){
    var p=envelope&&envelope.location;
    if(!envelope||(envelope.schemaVersion!==2&&envelope.schemaVersion!==3)||envelope.source!=="qweather"||!p||p.id!=="hepo"||p.timezone!=="Asia/Shanghai"||p.datum!=="GCJ02"||!finite(p.latitude)||!finite(p.longitude)||Math.abs(p.latitude-23.44)>0.000001||Math.abs(p.longitude-115.84)>0.000001)throw new Error("invalid_rain_location_or_source");
    if("raw" in envelope||"minutely" in envelope||"summary" in envelope||"refer" in envelope||!epoch(envelope.fetchedAt)||!epoch(envelope.updatedAt)||!epoch(envelope.validUntil)||envelope.validUntil<=envelope.fetchedAt||envelope.validUntil<=envelope.updatedAt)throw new Error("invalid_derived_rain_cache");
    var result={schemaVersion:envelope.schemaVersion,source:"qweather",fetchedAt:envelope.fetchedAt,updatedAt:envelope.updatedAt,validUntil:Math.min(envelope.validUntil,envelope.updatedAt+SOURCE_MAX_AGE,envelope.fetchedAt+RECEIPT_MAX_AGE)};
    if(envelope.schemaVersion===2){
      var alert=envelope.alert;
      if(alert!==null&&(!alert||(alert.kind!=="rain"&&alert.kind!=="snow")||!epoch(alert.forecastTime)||alert.forecastTime>envelope.fetchedAt+7200||(alert.timing!=="approximate"&&alert.timing!=="nearby")||"precipitation" in alert||"summary" in alert))throw new Error("invalid_rain_alert");
      result.alert=alert?{kind:alert.kind,forecastTime:alert.forecastTime,timing:alert.timing}:null;return result;
    }
    var periods=envelope.outlook&&envelope.outlook.periods,end=envelope.fetchedAt,normalized=[];
    if("alert" in envelope||!epoch(envelope.knownHorizonEnd)||envelope.knownHorizonEnd<=end||envelope.knownHorizonEnd>end+7200||Object.prototype.toString.call(periods)!=="[object Array]"||!periods.length||periods.length>256)throw new Error("invalid_rain_coverage");
    for(var i=0;i<periods.length;i++){
      var row=periods[i],strength=row&&row.strength;
      if(!row||!epoch(row.from)||!epoch(row.to)||row.from!==end||row.to<=row.from||row.to>envelope.knownHorizonEnd||(row.kind!=="dry"&&row.kind!=="unknown"&&row.kind!=="rain"&&row.kind!=="snow"))throw new Error("invalid_rain_periods");
      if(row.kind==="rain"?strength!=="light"&&strength!=="moderate"&&strength!=="heavy"&&strength!=="violent":strength!==null)throw new Error("invalid_rain_strength");
      end=row.to;var previous=normalized[normalized.length-1];
      if(previous&&previous.kind===row.kind&&previous.strength===strength)previous.to=row.to;
      else normalized.push({from:row.from,to:row.to,kind:row.kind,strength:strength});
    }
    if(end!==envelope.knownHorizonEnd)throw new Error("incomplete_rain_coverage");
    result.knownHorizonEnd=end;result.periods=normalized;return result;
  }
  function Reader(options){
    options=options||{};
    var stopped=true,generation=0,xhr=null,pollTimer=null,localTimer=null,requestTimer=null;
    var forecast=null,lastEnvelope=null,transportOK=false,lastError=null,hint=updating("not_loaded"),notified=null;
    function now(){return new Date().getTime();}
    function cancelPoll(){if(pollTimer!==null)root.clearTimeout(pollTimer);pollTimer=null;}
    function cancelLocal(){if(localTimer!==null)root.clearTimeout(localTimer);localTimer=null;}
    function cancelRequestTimer(){if(requestTimer!==null)root.clearTimeout(requestTimer);requestTimer=null;}
    function notify(){
      var signature=hint.visible+"|"+hint.text;
      if(signature===notified)return;notified=signature;
      if(typeof options.onChange==="function"){try{options.onChange(hint);}catch(ignore){}}
    }
    function currentHint(){
      if(stopped||!transportOK||!forecast)return updating(lastError||"cache_unavailable");
      var instant=now()/1000,until=forecast.validUntil,alert=forecast.alert;
      if(forecast.updatedAt>instant+FUTURE_SKEW||forecast.fetchedAt>instant+FUTURE_SKEW)return updating("future_data_time",until);
      if(instant>=until)return updating("expired",until);
      if(forecast.schemaVersion===3){
        var periods=forecast.periods,current=-1,i,deadline=instant+60;
        for(i=0;i<periods.length;i++)if(periods[i].from<=instant&&instant<periods[i].to){current=i;break;}
        if(current<0)return updating("outside_coverage",until);
        var row=periods[current],message,status,stop=null;
        deadline=Math.min(deadline,row.to,until);
        if(wet(row)){
          i=current+1;while(i<periods.length&&wet(periods[i]))i++;
          if(i<periods.length&&periods[i].kind==="dry")stop=periods[i].from;
          message="当前"+precipitationText(row)+(stop!==null?"·约"+duration(stop-instant,true)+"后停":"");status="wet";
        }else{
          var unknown=row.kind==="unknown",nextWet=null;
          for(i=current+1;i<periods.length;i++){
            if(periods[i].kind==="unknown")unknown=true;
            if(wet(periods[i])){nextWet=periods[i];break;}
          }
          if(nextWet){
            if(unknown){message="近期有"+precipitationText(nextWet);status="nearby";}
            else{var delay=nextWet.from-instant;message=(delay<=300?"5分钟内":"约"+duration(delay,true)+"后")+"有"+precipitationText(nextWet);status="onset";}
          }else if(unknown){return updating("unknown_coverage",until);}
          else{var covered=forecast.knownHorizonEnd-instant;message=covered<300?"短时无雨":"未来"+duration(covered,false)+"无雨";status="dry";}
        }
        return{visible:true,text:message,status:status,reason:"derived_outlook",updatedAt:forecast.updatedAt,fetchedAt:forecast.fetchedAt,validUntil:until,nextCheckAt:deadline};
      }
      if(!alert)return updating("legacy_has_no_positive_hint",until);
      var delta=alert.forecastTime-instant,nearby=alert.timing==="nearby"||delta<0,kind=alert.kind==="snow"?"雪":"雨",minutes=nearby?null:Math.ceil(delta/300)*5;
      var message=nearby?"近期可能有"+kind:delta===0?"短时可能有"+kind:delta<=300?"5分钟内可能有"+kind:"约"+minutes+"分钟后可能有"+kind;
      return{visible:true,text:message,status:"legacy-positive",reason:"positive_derived_hint",type:alert.kind,minutes:minutes,forecastTime:alert.forecastTime,updatedAt:forecast.updatedAt,fetchedAt:forecast.fetchedAt,validUntil:until,nextCheckAt:Math.min(instant+60,until,delta>=0?alert.forecastTime+1:instant+60)};
    }
    function recompute(){
      if(stopped)return;
      hint=currentHint();
      notify();scheduleLocal();
    }
    function scheduleLocal(){
      cancelLocal();if(stopped||!transportOK||!forecast)return;
      var due=now()+LOCAL;
      if(hint.nextCheckAt)due=Math.min(due,hint.nextCheckAt*1000);
      if(hint.validUntil){if(hint.validUntil*1000<=now())return;due=Math.min(due,hint.validUntil*1000);}
      localTimer=root.setTimeout(function(){localTimer=null;recompute();},Math.max(1,due-now()));
    }
    function schedulePoll(){cancelPoll();if(!stopped)pollTimer=root.setTimeout(refresh,POLL);}
    function refresh(){
      if(stopped)return;cancelPoll();cancelRequestTimer();var token=++generation,previous=xhr,finished=false;
      xhr=null;if(previous){try{previous.abort();}catch(ignore){}}
      var request;
      try{request=new root.XMLHttpRequest();xhr=request;}catch(unavailable){complete("request_unavailable");return;}
      function complete(error){
        if(finished||stopped||token!==generation)return;finished=true;cancelRequestTimer();xhr=null;
        if(!error){try{
          var envelope=JSON.parse(request.responseText),next=normalizeEnvelope(envelope),instant=now()/1000;
          if(next.updatedAt>instant+FUTURE_SKEW||next.fetchedAt>instant+FUTURE_SKEW)throw new Error("future_data_time");
          if(forecast&&next.updatedAt<forecast.updatedAt)throw new Error("older_rain_version");
          // Successful retrieval of the same issue never changes its source time.
          lastEnvelope=envelope;forecast=next;transportOK=true;lastError=null;
        }catch(bad){error=bad.message||"invalid_rain_cache";}}
        if(error){transportOK=false;lastError=String(error);}
        recompute();schedulePoll();
      }
      request.onload=function(){complete(request.status===200?null:"http_"+request.status);};
      request.onerror=function(){complete("network_error");};request.ontimeout=function(){complete("timeout");};request.onabort=function(){complete("aborted");};
      try{request.open("GET",URL,true);request.timeout=20000;request.setRequestHeader("Accept","application/vnd.github.raw+json");requestTimer=root.setTimeout(function(){complete("timeout");try{request.abort();}catch(ignore){}},20000);request.send(null);}catch(error){complete("request_unavailable");}
    }
    this.start=function(){if(!stopped)return;stopped=false;refresh();};
    this.refresh=refresh;
    this.getHint=currentHint;
    this.stop=function(){if(stopped)return;stopped=true;generation++;cancelPoll();cancelLocal();cancelRequestTimer();var request=xhr;xhr=null;if(request){try{request.abort();}catch(ignore){}}transportOK=false;hint=updating("stopped");};
    this.getState=function(){return{source:"qweather",stopped:stopped,transportOK:transportOK,lastError:lastError,schemaVersion:forecast?forecast.schemaVersion:null,knownHorizonEnd:forecast?forecast.knownHorizonEnd||null:null,periodCount:forecast&&forecast.periods?forecast.periods.length:0,fetchedAt:forecast?forecast.fetchedAt:null,updatedAt:forecast?forecast.updatedAt:null,hasRetainedCache:!!lastEnvelope,pollTimerActive:pollTimer!==null,localTimerActive:localTimer!==null,requestActive:xhr!==null,hint:currentHint()};};
  }
  Reader.cacheURL=URL;Reader.normalizeEnvelope=normalizeEnvelope;
  root.QWeatherRainCache=Reader;
}(typeof window!=="undefined"?window:this));
