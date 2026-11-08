/*!
 * Low-rate legacy-video candidate, adapted from the NoSleep.js technique.
 * NoSleep.js (c) Rich Tibbett, MIT; see LICENSE.nosleep.txt.
 * Local 16x16 Baseline H.264, 1fps, 60s, no audio. No frame-event handler/seek.
 * Playback is not proof of a system wake lock, deep sleep or month-long battery.
 */
(function(root){
  "use strict";
  var WATCHDOG_MS=61000; // Avoid aliasing a 60-second native video loop.
  function finite(value){return typeof value==="number"&&isFinite(value);}
  function KindleKeepAwake(options){
    this.options=options||{};this.video=null;this._wanted=false;this._generation=0;
    this._timer=null;this._watchdog=null;this._state="disabled";this._message="保活未开启";
    this._playedAt=null;this._lastProgressAt=null;this._lastMediaTime=null;
    var self=this;this._leave=function(){self.disable();};
    this._hidden=function(){if(document.hidden||document.visibilityState==="hidden")self.disable();};
    root.addEventListener("pagehide",this._leave,false);root.addEventListener("beforeunload",this._leave,false);root.addEventListener("unload",this._leave,false);document.addEventListener("visibilitychange",this._hidden,false);
  }
  KindleKeepAwake.prototype.getState=function(){return{code:this._state,message:this._message,method:"low-rate-video-candidate",requested:this._wanted,playbackConfirmed:this._state==="playing",wakeLockConfirmed:false,playedAt:this._playedAt,lastProgressAt:this._lastProgressAt,watchdogMs:WATCHDOG_MS};};
  KindleKeepAwake.prototype._emit=function(code,message){var changed=this._state!==code||this._message!==message;this._state=code;this._message=message;if(changed&&typeof this.options.onChange==="function"){try{this.options.onChange(this.getState());}catch(ignore){}}};
  KindleKeepAwake.prototype._clear=function(){if(this._timer!==null)root.clearTimeout(this._timer);if(this._watchdog!==null)root.clearInterval(this._watchdog);this._timer=null;this._watchdog=null;};
  KindleKeepAwake.prototype._removeVideo=function(){var video=this.video;this.video=null;if(video){try{video.pause();}catch(ignore){}if(video.parentNode)video.parentNode.removeChild(video);}};
  KindleKeepAwake.prototype._fail=function(code,message,generation){if(!this._wanted||generation!==this._generation)return;this._wanted=false;this._clear();this._removeVideo();this._emit(code,message);};
  KindleKeepAwake.prototype.enable=function(){
    this.disable();var self=this,generation=this._generation,media=root.PowerSavingMedia,video=document.createElement("video");
    if(!media||typeof media.src!=="string"||!video||typeof video.play!=="function"){this._emit("unsupported","此浏览器不支持候选视频保活");return this.getState();}
    this.video=video;this._wanted=true;this._playedAt=null;this._lastProgressAt=null;this._lastMediaTime=null;
    video.setAttribute("aria-hidden","true");video.setAttribute("playsinline","");video.setAttribute("webkit-playsinline","");video.setAttribute("muted","");video.setAttribute("loop","");
    video.preload="auto";video.muted=true;video.volume=0;video.loop=true;
    video.style.cssText="position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;";
    var source=document.createElement("source");source.type="video/mp4";source.src=media.src;video.appendChild(source);
    function valid(){return self._wanted&&generation===self._generation;}
    function playing(){if(!valid())return;var instant=new Date().getTime();self._playedAt=self._playedAt||instant;self._lastProgressAt=instant;var current=Number(video.currentTime);if(finite(current))self._lastMediaTime=current;if(self._timer!==null)root.clearTimeout(self._timer);self._timer=null;self._emit("playing","候选视频正在播放，保活效果需实机确认");}
    video.addEventListener("playing",playing,false);
    video.addEventListener("pause",function(){self._fail("paused","保活视频已停止，请重新点击",generation);},false);
    video.addEventListener("ended",function(){self._fail("paused","保活视频已结束，请重新点击",generation);},false);
    video.addEventListener("error",function(){self._fail("failed","候选视频无法播放",generation);},false);
    video.addEventListener("stalled",function(){if(valid())self._emit("unconfirmed","视频播放待确认");},false);
    (document.body||document.documentElement).appendChild(video);this._emit("starting","正在尝试候选保活…");
    this._timer=root.setTimeout(function(){if(valid()&&!self._playedAt)self._emit("unconfirmed","未收到播放确认，请检查屏幕");},15000);
    this._watchdog=root.setInterval(function(){
      if(!valid())return;
      if(video.paused===true||video.ended===true){self._fail("paused","保活视频已停止，请重新点击",generation);return;}
      if(video.error){self._fail("failed","候选视频播放失败",generation);return;}
      var instant=new Date().getTime(),current=Number(video.currentTime);
      if(finite(current)&&(self._lastMediaTime===null||Math.abs(current-self._lastMediaTime)>0.01)){
        self._lastMediaTime=current;self._lastProgressAt=instant;
        if(self._playedAt)self._emit("playing","候选视频正在播放，保活效果需实机确认");
      }else if(self._playedAt&&instant-(self._lastProgressAt||self._playedAt)>122000)self._emit("unconfirmed","未收到持续进度，保活待实机确认");
    },WATCHDOG_MS);
    try{var result=video.play();if(result&&typeof result.then==="function")result.then(playing,function(){self._fail("failed","浏览器拒绝候选视频播放",generation);});}catch(error){self._fail("failed","无法启动候选视频",generation);}
    return this.getState();
  };
  KindleKeepAwake.prototype.disable=function(){this._wanted=false;this._generation++;this._clear();this._removeVideo();this._emit("disabled","保活已关闭");return this.getState();};
  KindleKeepAwake.prototype.destroy=function(){this.disable();root.removeEventListener("pagehide",this._leave,false);root.removeEventListener("beforeunload",this._leave,false);root.removeEventListener("unload",this._leave,false);document.removeEventListener("visibilitychange",this._hidden,false);};
  root.KindleKeepAwake=KindleKeepAwake;
}(this));
