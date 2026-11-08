/* ES5 public GitHub cache reader. No direct QWeather API or authentication. */
(function (root) {
  "use strict";
  var URL="https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/cache/hepo-rain.json?ref=codex%2Fkindle-weather";
  var POLL=300000,LOCAL=60000,FUTURE_SKEW=120,RECEIPT_MAX_AGE=600,SOURCE_MAX_AGE=1800;
  function finite(value){return typeof value==="number"&&isFinite(value);}
  function epoch(value){return finite(value)&&value>=946684800&&value<4102444800;}
  function hidden(reason,until){return{visible:false,text:"",reason:reason,validUntil:until||null};}
  function normalizeEnvelope(envelope){
    var p=envelope&&envelope.location;
    if(!envelope||envelope.schemaVersion!==2||envelope.source!=="qweather"||!p||p.id!=="hepo"||p.timezone!=="Asia/Shanghai"||p.datum!=="GCJ02"||!finite(p.latitude)||!finite(p.longitude)||Math.abs(p.latitude-23.44)>0.000001||Math.abs(p.longitude-115.84)>0.000001)throw new Error("invalid_rain_location_or_source");
    if("raw" in envelope||"minutely" in envelope||"summary" in envelope||"refer" in envelope||!epoch(envelope.fetchedAt)||!epoch(envelope.updatedAt)||!epoch(envelope.validUntil)||envelope.validUntil<=envelope.fetchedAt||envelope.validUntil<=envelope.updatedAt)throw new Error("invalid_derived_rain_cache");
    var alert=envelope.alert;
    if(alert!==null&&(!alert||(alert.kind!=="rain"&&alert.kind!=="snow")||!epoch(alert.forecastTime)||alert.forecastTime>envelope.fetchedAt+7200||(alert.timing!=="approximate"&&alert.timing!=="nearby")||"precipitation" in alert||"summary" in alert))throw new Error("invalid_rain_alert");
    return{schemaVersion:2,source:"qweather",fetchedAt:envelope.fetchedAt,updatedAt:envelope.updatedAt,validUntil:Math.min(envelope.validUntil,envelope.updatedAt+SOURCE_MAX_AGE,envelope.fetchedAt+RECEIPT_MAX_AGE),alert:alert?{kind:alert.kind,forecastTime:alert.forecastTime,timing:alert.timing}:null};
  }
  function Reader(options){
    options=options||{};
    var stopped=true,generation=0,xhr=null,pollTimer=null,localTimer=null,requestTimer=null;
    var forecast=null,lastEnvelope=null,transportOK=false,lastError=null,hint=hidden("not_loaded"),notified=null;
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
      if(stopped||!transportOK||!forecast)return hidden(lastError||"cache_unavailable");
      var instant=now()/1000,until=forecast.validUntil,alert=forecast.alert;
      if(forecast.updatedAt>instant+FUTURE_SKEW||forecast.fetchedAt>instant+FUTURE_SKEW)return hidden("future_data_time",until);
      if(instant>=until)return hidden("expired",until);
      if(!alert)return hidden("no_positive_hint",until);
      var delta=alert.forecastTime-instant,nearby=alert.timing==="nearby"||delta<0,kind=alert.kind==="snow"?"雪":"雨",minutes=nearby?null:Math.ceil(delta/300)*5;
      var message=nearby?"近期可能有"+kind:delta===0?"短时可能有"+kind:delta<=300?"5分钟内可能有"+kind:"约"+minutes+"分钟后可能有"+kind;
      return{visible:true,text:message,reason:"positive_derived_hint",type:alert.kind,minutes:minutes,forecastTime:alert.forecastTime,updatedAt:forecast.updatedAt,fetchedAt:forecast.fetchedAt,validUntil:until,nextCheckAt:Math.min(instant+60,until,delta>=0?alert.forecastTime+1:instant+60)};
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
    this.stop=function(){if(stopped)return;stopped=true;generation++;cancelPoll();cancelLocal();cancelRequestTimer();var request=xhr;xhr=null;if(request){try{request.abort();}catch(ignore){}}transportOK=false;hint=hidden("stopped");};
    this.getState=function(){return{source:"qweather",stopped:stopped,transportOK:transportOK,lastError:lastError,fetchedAt:forecast?forecast.fetchedAt:null,updatedAt:forecast?forecast.updatedAt:null,hasRetainedCache:!!lastEnvelope,pollTimerActive:pollTimer!==null,localTimerActive:localTimer!==null,requestActive:xhr!==null,hint:currentHint()};};
  }
  Reader.cacheURL=URL;Reader.normalizeEnvelope=normalizeEnvelope;
  root.QWeatherRainCache=Reader;
}(typeof window!=="undefined"?window:this));
