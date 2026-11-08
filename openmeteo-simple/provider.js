/* Open-Meteo public, non-commercial single-place adapter. ES5 / Chrome 49. */
(function (root) {
  'use strict';
  var LOCATION = {id: 'hepo', name: '揭西河婆', latitude: 23.4394,
    longitude: 115.8305, timezone: 'Asia/Shanghai'};
  var WMO = {0:1,1:1,2:1,3:1,45:1,48:1,51:1,53:1,55:1,56:1,57:1,
    61:1,63:1,65:1,66:1,67:1,71:1,73:1,75:1,77:1,80:1,81:1,82:1,
    85:1,86:1,95:1,96:1,99:1};
  var lastSuccess = null;
  var active = null;

  function clone(value) {
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }
  function numeric(value, minimum, maximum) {
    return typeof value === 'number' && isFinite(value) && value >= minimum && value <= maximum ? value : null;
  }
  function epoch(value) {
    if (numeric(value, 946684800, 4102444800) === null || Math.floor(value) !== value) {
      throw new Error('invalid_timestamp_seconds');
    }
    return value;
  }
  function code(value) {
    return typeof value === 'number' && Math.floor(value) === value && WMO[value] === 1 ? value : null;
  }
  function pad(value) { return value < 10 ? '0' + value : '' + value; }
  function cstDate(stamp) {
    var date = new Date((stamp + 28800) * 1000);
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
  }
  function arrayOfLength(value, length) {
    return Object.prototype.toString.call(value) === '[object Array]' && value.length === length;
  }
  function normalize(raw, fetchedAt) {
    if (!raw || raw.timezone !== LOCATION.timezone || raw.utc_offset_seconds !== 28800) {
      throw new Error('unexpected_timezone');
    }
    var current = raw.current;
    var daily = raw.daily;
    var cu = raw.current_units || {};
    var du = raw.daily_units || {};
    if ((cu.temperature_2m !== '\u00b0C' && cu.temperature_2m !== 'C') || cu.precipitation !== 'mm' ||
        (du.temperature_2m_min !== '\u00b0C' && du.temperature_2m_min !== 'C') ||
        (du.temperature_2m_max !== '\u00b0C' && du.temperature_2m_max !== 'C') || du.precipitation_sum !== 'mm' ||
        cu.time !== 'unixtime' || du.time !== 'unixtime' || cu.interval !== 'seconds') {
      throw new Error('unexpected_units');
    }
    if (!current || numeric(current.temperature_2m, -100, 70) === null ||
        numeric(current.interval, 1, 3600) === null) {
      throw new Error('missing_current_temperature');
    }
    if (!daily || Object.prototype.toString.call(daily.time) !== '[object Array]' || daily.time.length < 3) {
      throw new Error('missing_daily_forecast');
    }
    var length = daily.time.length;
    var fields = ['temperature_2m_min', 'temperature_2m_max', 'weather_code', 'precipitation_sum'];
    var i;
    for (i = 0; i < fields.length; i += 1) {
      if (!arrayOfLength(daily[fields[i]], length)) { throw new Error('incomplete_daily_forecast'); }
    }
    var rows = [];
    var previous = null;
    for (i = 0; i < length; i += 1) {
      var stamp = epoch(daily.time[i]);
      if ((stamp + 28800) % 86400 !== 0 || (previous !== null && stamp - previous !== 86400)) {
        throw new Error('invalid_daily_axis');
      }
      var minimum = numeric(daily.temperature_2m_min[i], -100, 70);
      var maximum = numeric(daily.temperature_2m_max[i], -100, 70);
      if (minimum !== null && maximum !== null && minimum > maximum) { minimum = null; maximum = null; }
      rows.push({time: stamp, date: cstDate(stamp), temperatureMin: minimum, temperatureMax: maximum,
        weatherCode: code(daily.weather_code[i]), precipitation: numeric(daily.precipitation_sum[i], 0, 10000)});
      previous = stamp;
    }
    return {schemaVersion: 1, source: 'open-meteo', weatherCodeSystem: 'wmo-4677',
      location: clone(LOCATION), fetchedAt: epoch(fetchedAt), stale: false,
      current: {time: epoch(current.time), intervalSeconds: current.interval,
        temperature: current.temperature_2m, weatherCode: code(current.weather_code),
        precipitation: numeric(current.precipitation, 0, 10000)}, daily: rows,
      units: {temperature: 'C', precipitation: 'mm'},
      grid: {latitude: numeric(raw.latitude, -90, 90), longitude: numeric(raw.longitude, -180, 180),
        elevation: numeric(raw.elevation, -500, 9000)},
      attribution: {name: 'Open-Meteo', url: 'https://open-meteo.com/', licence: 'CC BY 4.0'},
      semantics: {current: '15-minute model conditions, not a station observation',
        currentPrecipitation: 'sum over preceding current.interval seconds',
        dailyPrecipitation: 'local-calendar-day total, including rain, showers and snow',
        dailyWeatherCode: 'most severe WMO weather condition during the given day',
        model: 'automatic best match; the response does not identify each contributing model run'}};
  }
  function requestUrl(protocol) {
    if (protocol !== 'http:' && protocol !== 'https:') { throw new Error('unsupported_protocol'); }
    return protocol + '//api.open-meteo.com/v1/forecast?latitude=23.4394&longitude=115.8305' +
      '&current=temperature_2m%2Cweather_code%2Cprecipitation' +
      '&daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_sum' +
      '&timezone=Asia%2FShanghai&forecast_days=6&timeformat=unixtime' +
      '&temperature_unit=celsius&precipitation_unit=mm';
  }
  function fetchWeather(config, callback) {
    if (typeof config === 'function') { callback = config; config = {}; }
    config = config || {};
    if (typeof callback !== 'function') { throw new Error('callback_required'); }
    if (active) { active.callbacks.push(callback); return; }
    var protocol = config.protocol || (root.location && root.location.protocol === 'https:' ? 'https:' : 'http:');
    var timeout = numeric(config.timeoutMs, 1000, 60000) || 20000;
    var request = {callbacks: [callback], finished: false, timer: null, xhr: null};
    active = request;
    function finish(error, raw) {
      if (request.finished) { return; }
      request.finished = true;
      if (request.timer !== null) { root.clearTimeout(request.timer); }
      if (!error) {
        try { lastSuccess = normalize(raw, Math.floor(new Date().getTime() / 1000)); }
        catch (ignored) { error = 'invalid_weather_response'; }
      }
      active = null;
      var result = clone(lastSuccess);
      if (error && result) { result.stale = true; result.errorCode = error; }
      var callbacks = request.callbacks.slice(0);
      var n;
      for (n = 0; n < callbacks.length; n += 1) {
        try { callbacks[n](error || null, clone(result)); } catch (ignoredCallback) {}
      }
    }
    request.cancel = function () {
      finish('aborted');
      if (request.xhr) { try { request.xhr.abort(); } catch (ignoredCancel) {} }
    };
    try {
      var url = requestUrl(protocol);
      var xhr = new root.XMLHttpRequest();
      request.xhr = xhr;
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        if (xhr.status !== 200) { finish(xhr.status ? 'http_' + xhr.status : 'network_error'); return; }
        var raw;
        try { raw = JSON.parse(xhr.responseText); } catch (ignoredJson) { finish('invalid_json'); return; }
        finish(null, raw);
      };
      xhr.onerror = function () { finish('network_error'); };
      xhr.ontimeout = function () { finish('timeout'); };
      xhr.onabort = function () { finish('aborted'); };
      try { xhr.timeout = timeout; } catch (ignoredTimeout) {}
      request.timer = root.setTimeout(function () {
        finish('timeout');
        try { xhr.abort(); } catch (ignoredAbort) {}
      }, timeout);
      xhr.send(null);
    } catch (ignoredRequest) { finish('request_unavailable'); }
  }
  root.OpenMeteoProvider = {fetch: fetchWeather, normalize: normalize,
    cancel: function () { if (!active) { return false; } active.cancel(); return true; },
    requestUrl: requestUrl, getCached: function () { return clone(lastSuccess); }};
}(typeof window !== 'undefined' ? window : this));
