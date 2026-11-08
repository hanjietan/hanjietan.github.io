/* Offline adapter contract/lifecycle checks. No network or API key. */
'use strict';
var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var source = fs.readFileSync(path.join(__dirname, 'provider.js'), 'utf8');
var DAY = 86400;
var START = 1794067200;
function fixture() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hepo-20261108.json'), 'utf8'));
}
function harness(protocol) {
  var xhrs = [];
  var timers = {};
  var nextTimer = 0;
  function XHR() { xhrs.push(this); this.aborted = false; }
  XHR.prototype.open = function (method, url, async) { this.method=method; this.url=url; this.async=async; };
  XHR.prototype.send = function () { this.sent = true; };
  XHR.prototype.abort = function () { this.aborted = true; if (this.onabort) { this.onabort(); } };
  var window = {location: {protocol: protocol || 'about:'}, XMLHttpRequest: XHR,
    setTimeout: function (callback) { nextTimer+=1; timers[nextTimer]=callback; return nextTimer; },
    clearTimeout: function (id) { delete timers[id]; }};
  vm.runInNewContext(source, {window: window, console: console});
  return {provider: window.OpenMeteoProvider, xhrs: xhrs, timers: timers,
    respond: function (index, status, body) {
      var xhr=xhrs[index]; xhr.status=status; xhr.responseText=typeof body==='string'?body:JSON.stringify(body);
      xhr.readyState=4; xhr.onreadystatechange();
    }};
}
var count = 0;
function test(name, callback) { callback(); count+=1; console.log('ok - '+name); }

test('normalizes real-format current conditions, WMO zero and six local-calendar days', function () {
  var p=harness().provider, data=p.normalize(fixture(),START+43812);
  assert.strictEqual(data.source,'open-meteo'); assert.strictEqual(data.weatherCodeSystem,'wmo-4677');
  assert.strictEqual(data.current.temperature,28.2); assert.strictEqual(data.current.time,START+43200);
  assert.strictEqual(data.current.intervalSeconds,900); assert.strictEqual(data.current.weatherCode,0);
  assert.strictEqual(data.current.precipitation,0); assert.strictEqual(data.daily.length,6);
  assert.strictEqual(data.daily[1].date,'2026-11-09'); assert.strictEqual(data.daily[1].weatherCode,51);
  assert.strictEqual(data.daily[1].precipitation,0.1); assert.strictEqual(data.units.temperature,'C');
});
test('unknown weather/rain stays null, not clear or dry', function () {
  var raw=fixture(); raw.current.weather_code=100; raw.current.precipitation=null;
  raw.daily.weather_code[1]='51'; raw.daily.precipitation_sum[1]=null;
  var data=harness().provider.normalize(raw,START+43812);
  assert.strictEqual(data.current.weatherCode,null); assert.strictEqual(data.current.precipitation,null);
  assert.strictEqual(data.daily[1].weatherCode,null); assert.strictEqual(data.daily[1].precipitation,null);
});
test('wrong units/timezone, absent axis and misaligned daily values fail validation', function () {
  var p=harness().provider, raw=fixture(); raw.current_units.temperature_2m='\u00b0F';
  assert.throws(function(){p.normalize(raw,START+43812);},/unexpected_units/);
  raw=fixture(); raw.utc_offset_seconds=0;
  assert.throws(function(){p.normalize(raw,START+43812);},/unexpected_timezone/);
  raw=fixture(); delete raw.daily.time;
  assert.throws(function(){p.normalize(raw,START+43812);},/missing_daily_forecast/);
  raw=fixture(); raw.daily.precipitation_sum.pop();
  assert.throws(function(){p.normalize(raw,START+43812);},/incomplete_daily_forecast/);
  raw=fixture(); raw.daily.time[1]+=3600;
  assert.throws(function(){p.normalize(raw,START+43812);},/invalid_daily_axis/);
});
test('public request fixes one place, six days, current+daily, no API key or explicit model', function () {
  var h=harness(); h.provider.fetch({},function(){});
  assert.strictEqual(h.xhrs.length,1); assert.strictEqual(h.xhrs[0].method,'GET');
  assert.ok(/^http:\/\//.test(h.xhrs[0].url)); assert.ok(/forecast_days=6/.test(h.xhrs[0].url));
  assert.ok(/latitude=23\.4394&longitude=115\.8305/.test(h.xhrs[0].url));
  assert.ok(/timeformat=unixtime/.test(h.xhrs[0].url)); assert.ok(!/apikey|models=/.test(h.xhrs[0].url));
  h.provider.cancel();
});
test('normal HTTPS pages use HTTPS; opaque legacy pages use explicit HTTP', function () {
  var h=harness('https:'); h.provider.fetch({},function(){});
  assert.ok(/^https:\/\//.test(h.xhrs[0].url)); h.provider.cancel();
  h=harness('about:'); h.provider.fetch({protocol:'https:'},function(){});
  assert.ok(/^https:\/\//.test(h.xhrs[0].url)); h.provider.cancel();
});
test('a 503 retains last valid values and actual fetch time without another request', function () {
  var h=harness(), first, failed;
  h.provider.fetch({},function(error,data){assert.strictEqual(error,null); first=data;});
  h.respond(0,200,fixture());
  h.provider.fetch({},function(error,data){failed={error:error,data:data};});
  h.respond(1,503,'unavailable');
  assert.strictEqual(h.xhrs.length,2); assert.strictEqual(failed.error,'http_503');
  assert.strictEqual(failed.data.fetchedAt,first.fetchedAt); assert.strictEqual(failed.data.current.time,first.current.time);
  assert.strictEqual(failed.data.current.temperature,28.2); assert.strictEqual(failed.data.stale,true);
  assert.strictEqual(h.provider.getCached().stale,false);
});
test('timeouts abort once, clear timers and never start a retry loop', function () {
  var h=harness(), calls=0, error;
  h.provider.fetch({timeoutMs:1000},function(code){calls+=1; error=code;});
  var id=Object.keys(h.timers)[0]; h.timers[id]();
  assert.strictEqual(error,'timeout'); assert.strictEqual(calls,1); assert.strictEqual(h.xhrs.length,1);
  assert.strictEqual(h.xhrs[0].aborted,true); assert.strictEqual(Object.keys(h.timers).length,0);
});
test('pagehide cancellation aborts active request and prevents late completion', function () {
  var h=harness(), calls=0, error;
  h.provider.fetch({},function(code){calls+=1; error=code;});
  assert.strictEqual(h.provider.cancel(),true); assert.strictEqual(h.xhrs[0].aborted,true);
  assert.strictEqual(Object.keys(h.timers).length,0); assert.strictEqual(error,'aborted');
  h.respond(0,200,fixture()); assert.strictEqual(calls,1); assert.strictEqual(h.provider.getCached(),null);
  assert.strictEqual(h.provider.cancel(),false);
});
test('concurrent fetches share one request, callbacks and cached objects are isolated', function () {
  var h=harness(), results=[];
  h.provider.fetch({},function(error,data){results.push(data.current.temperature);data.current.temperature=999;});
  h.provider.fetch({},function(error,data){results.push(data.current.temperature);});
  assert.strictEqual(h.xhrs.length,1); h.respond(0,200,fixture());
  assert.deepStrictEqual(results,[28.2,28.2]); assert.strictEqual(h.provider.getCached().current.temperature,28.2);
});
test('invalid JSON/current data cannot replace a successful response', function () {
  var h=harness(), errors=[];
  h.provider.fetch({},function(){}); h.respond(0,200,fixture());
  h.provider.fetch({},function(error){errors.push(error);}); h.respond(1,200,'{broken');
  h.provider.fetch({},function(error){errors.push(error);}); var raw=fixture();raw.current.temperature_2m=null;
  h.respond(2,200,raw); assert.deepStrictEqual(errors,['invalid_json','invalid_weather_response']);
  assert.strictEqual(h.provider.getCached().current.temperature,28.2);
});
console.log('Passed '+count+' offline provider tests; network requests: 0');
