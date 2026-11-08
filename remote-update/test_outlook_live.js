/* Explicit opt-in only after publication and a genuine derived rain cache exist.
 * Exact installed book -> real GitHub program -> real OM + GitHub schema3 outlook.
 * No request interception, synthetic weather, Date changes or direct QW requests.
 */
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const {spawn, execFileSync} = require("node:child_process");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (!args.includes("--run-live") || !option("--manifest")) {
  throw Error("Wait for publication and the first real cache, then --run-live --manifest PATH [--output NEW_DIRECTORY]");
}
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(option("--manifest"), "utf8"));
assert.deepEqual(manifest.actual_sources, ["open-meteo", "qweather"]);
assert.match(manifest.client_sha256, /^[a-f0-9]{64}$/);
assert.match(manifest.envelope_sha256, /^[a-f0-9]{64}$/);
const output = path.resolve(option("--output") || path.join(root, "runtime", "qweather-outlook-chain-live-" + Date.now()));
assert.ok(output.startsWith(root + path.sep), "Output must stay in the workspace");
assert.ok(!fs.existsSync(output), "Never overwrite an earlier verification");
fs.mkdirSync(output, {recursive: true});
const readFrozen = "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); sys.stdout.buffer.write(z.read('local/remote-update/build-meteoblue-20261108_035354/launcher.html'))";
const launcher = execFileSync("python", ["-X", "utf8", "-c", readFrozen,
  path.join(root, "runtime/frozen/weather-full-20261108-032139z/weather-full.zip")], {encoding: "utf8"});
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const testerSHA256 = sha(fs.readFileSync(__filename));
assert.equal(sha(launcher), "5cb58f7f271ceb0a1f84702597f785af04db49ce2a51f8cd20ee6dd362725a18");
const programURL = "https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/weather.html?ref=codex%2Fkindle-weather";
const rainURL = "https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/cache/hepo-rain.json?ref=codex%2Fkindle-weather";
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const profile = path.join(os.tmpdir(), "kindle-mixed-live-" + Date.now());
const browser = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu",
  "--disable-background-networking", "--no-first-run", "--disable-default-apps", "--remote-debugging-port=0",
  "--user-data-dir=" + profile, "about:blank"], {windowsHide: true, stdio: "ignore"});
let socket, session, id = 0;
const pending = new Map(), requests = [], responses = [], loaded = new Set(), errors = [];
function send(method, params = {}, target = session) {
  return new Promise((resolve, reject) => {
    const n = ++id, message = {id: n, method, params};
    if (target) message.sessionId = target;
    pending.set(n, {resolve, reject}); socket.send(JSON.stringify(message));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {expression, returnByValue: true});
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function body(request) {
  for (let n = 0; n < 80 && !loaded.has(request.requestId); n++) await wait(50);
  const result = await send("Network.getResponseBody", {requestId: request.requestId});
  return result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body;
}
const dayKey = stamp => new Date((stamp + 28800) * 1000).toISOString().slice(0, 10);
function checkDerivedOutlook(value, observedAt) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const allowed = ["schemaVersion", "source", "location", "fetchedAt", "updatedAt", "validUntil", "knownHorizonEnd", "outlook"];
  assert.ok(Object.keys(value).every(key => allowed.includes(key)), "Only the derived outlook may be public");
  assert.equal(value.schemaVersion, 3); assert.equal(value.source, "qweather");
  const location = value.location;
  assert.equal(location.id, "hepo"); assert.equal(location.datum, "GCJ02");
  assert.equal(location.timezone, "Asia/Shanghai"); assert.equal(location.latitude, 23.44); assert.equal(location.longitude, 115.84);
  for (const key of ["fetchedAt", "updatedAt", "validUntil", "knownHorizonEnd"]) assert.ok(Number.isInteger(value[key]));
  assert.ok(value.fetchedAt <= observedAt + 120 && value.updatedAt <= observedAt + 120);
  assert.equal(value.validUntil, Math.min(value.fetchedAt + 600, value.updatedAt + 1800, value.knownHorizonEnd));
  assert.deepEqual(Object.keys(value.outlook), ["periods"]);
  const periods = value.outlook.periods;
  assert.ok(Array.isArray(periods) && periods.length > 0 && periods.length <= 256);
  let cursor = value.fetchedAt;
  for (const period of periods) {
    assert.deepEqual(Object.keys(period).sort(), ["from", "to", "kind", "strength"].sort());
    assert.ok(Number.isInteger(period.from) && Number.isInteger(period.to) && period.from === cursor && period.to > period.from);
    assert.ok(["dry", "rain", "snow", "unknown"].includes(period.kind));
    if (period.kind === "rain") assert.ok(["light", "moderate", "heavy", "violent"].includes(period.strength));
    else assert.equal(period.strength, null);
    cursor = period.to;
  }
  assert.equal(cursor, value.knownHorizonEnd); assert.ok(cursor <= value.fetchedAt + 7200);
  const text = JSON.stringify(value);
  assert.ok(!/qweatherapi\.com|BEGIN [A-Z ]*PRIVATE KEY|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|apiHost|privateKey|seedBase64|apikey|"(?:raw|minutely|summary|precip|precipitation|refer|synthetic)"/i.test(text));
  const current = periods.find(period => period.from <= observedAt && observedAt < period.to) || null;
  const remaining = periods.filter(period => period.to > observedAt);
  const nextNonDry = remaining.find(period => period.kind !== "dry") || null;
  const fresh = observedAt < value.validUntil && observedAt - value.fetchedAt < 600 && observedAt - value.updatedAt < 1800;
  let expectedStatuses = ["updating"], onset = null;
  if (fresh && current) {
    if (current.kind === "rain" || current.kind === "snow") expectedStatuses = ["wet"];
    else if (current.kind === "dry" && !nextNonDry) expectedStatuses = ["dry"];
    else if (current.kind === "dry" && nextNonDry && (nextNonDry.kind === "rain" || nextNonDry.kind === "snow")) {
      expectedStatuses = ["onset"]; onset = nextNonDry;
    } else expectedStatuses = ["nearby", "updating", "dry"];
  }
  return {observedAt, fetchedAgeSeconds: observedAt - value.fetchedAt, sourceAgeSeconds: observedAt - value.updatedAt,
    validUntil: value.validUntil, secondsRemaining: value.validUntil - observedAt, fresh,
    maximumReceivedAgeSeconds: 600, maximumSourceAgeSeconds: 1800,
    currentKind: current && current.kind, currentStrength: current && current.strength,
    expectedStatuses, onsetTime: onset && onset.from, onsetKind: onset && onset.kind};
}
(async () => {
  let report;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let n = 0; n < 70 && !fs.existsSync(portFile); n++) await wait(100);
    const port = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    socket = new WebSocket("ws://127.0.0.1:" + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, {once: true}); socket.addEventListener("error", reject, {once: true}); });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id); pending.delete(message.id);
        message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result);
      } else if (message.method === "Network.requestWillBeSent" && /^https?:/.test(message.params.request.url)) {
        const request = message.params.request;
        requests.push({requestId: message.params.requestId, url: request.url, method: request.method});
      } else if (message.method === "Network.responseReceived" && /^https?:/.test(message.params.response.url)) {
        const response = message.params.response, headers = {};
        for (const key of Object.keys(response.headers)) if (/^(content-type|access-control-allow-origin|date|cache-control|age)$/i.test(key)) headers[key] = response.headers[key];
        responses.push({requestId: message.params.requestId, url: response.url, status: response.status, mimeType: response.mimeType, headers});
      } else if (message.method === "Network.loadingFinished") loaded.add(message.params.requestId);
      else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    });
    const target = await send("Target.createTarget", {url: "about:blank"}, null);
    session = (await send("Target.attachToTarget", {targetId: target.targetId, flatten: true}, null)).sessionId;
    await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", {width: 600, height: 800, deviceScaleFactor: 1, mobile: false});
    // Canvas observation alone: partial footer clears remove old labels too.
    await evaluate("window.observedPaint=[];var actualText=CanvasRenderingContext2D.prototype.fillText,actualFill=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){observedPaint=observedPaint.filter(function(p){return !(p.x>=x&&p.x<x+w&&p.y>=y&&p.y<y+h);});return actualFill.apply(this,arguments);};CanvasRenderingContext2D.prototype.fillText=function(text,x,y){observedPaint.push({text:String(text),x:x,y:y});return actualText.apply(this,arguments);};document.open();document.write(" + JSON.stringify(launcher) + ");document.close();void 0;");
    let ready = false;
    for (let n = 0; n < 700; n++) {
      ready = await evaluate("!!(window.OpenMeteoSimple&&OpenMeteoSimple.getState().hasData&&OpenMeteoSimple.getState().rain&&OpenMeteoSimple.getState().rain.transportOK&&!OpenMeteoSimple.getState().rain.requestActive)");
      if (ready) break; await wait(50);
    }
    assert.equal(ready, true, "Both actual weather and the actual public derived rain cache must load");
    const state = await evaluate("({update:KindleRemoteUpdateState,package:KindleWeatherPackage,client:OpenMeteoSimple.getState(),data:OpenMeteoProvider.getCached(),labels:observedPaint.map(function(p){return p.text;}),observedAt:Date.now()/1000,canvasCount:document.querySelectorAll('canvas#screen').length,canvasVisible:getComputedStyle(document.getElementById('screen')).display!=='none',loadingPlaceholder:!!document.getElementById('transport-loading'),nativeXHR:/native code/.test(XMLHttpRequest.toString()),nativeDate:/native code/.test(Date.toString()),oldClient:typeof MeteoblueClient,rawRainHelper:typeof KindleRainHint})");
    assert.equal(state.nativeXHR, true); assert.equal(state.nativeDate, true);
    assert.equal(state.update.mode, "remote"); assert.equal(state.update.source, "open-meteo");
    assert.deepEqual(state.update.sources, ["open-meteo", "qweather"]); assert.deepEqual(state.package.actualSources, ["open-meteo", "qweather"]);
    assert.equal(state.package.clientSHA256, manifest.client_sha256); assert.equal(state.oldClient, "undefined");
    assert.equal(state.rawRainHelper, "undefined", "Raw upstream helper must remain server-only");
    assert.equal(state.canvasCount, 1); assert.equal(state.canvasVisible, true); assert.equal(state.loadingPlaceholder, false);
    assert.equal(state.data.source, "open-meteo"); assert.equal(state.client.rain.source, "qweather");
    assert.equal(requests.length, 3, "Exactly program GET, OM forecast GET and GitHub derived-cache GET");
    assert.equal(requests[0].url, programURL); assert.ok(requests.every(request => request.method === "GET"));
    const programRequest = requests.find(request => request.url === programURL);
    const rainRequest = requests.find(request => request.url === rainURL);
    const forecastRequest = requests.find(request => new URL(request.url).hostname === "api.open-meteo.com");
    assert.ok(programRequest && rainRequest && forecastRequest);
    assert.ok(requests.every(request => request === programRequest || request === rainRequest || request === forecastRequest));
    assert.ok(!requests.some(request => /qweatherapi\.com|meteoblue|rainviewer|cache\/hepo\.json|apikey=/i.test(request.url)));
    const forecastURL = new URL(forecastRequest.url);
    assert.equal(forecastURL.pathname, "/v1/forecast"); assert.equal(forecastURL.searchParams.get("timezone"), "Asia/Shanghai");
    assert.equal(forecastURL.searchParams.get("latitude"), "23.4394"); assert.equal(forecastURL.searchParams.get("longitude"), "115.8305");
    const [programBody, forecastBody, rainBody] = await Promise.all([body(programRequest), body(forecastRequest), body(rainRequest)]);
    assert.equal(sha(programBody), manifest.envelope_sha256);
    const raw = JSON.parse(forecastBody), rain = JSON.parse(rainBody);
    // Freshness belongs to the unmodified clock at the observed UI state, not
    // a later clock after response-body extraction or screenshot encoding.
    const rainFreshness = checkDerivedOutlook(rain, state.observedAt);
    assert.equal(state.client.rain.fetchedAt, rain.fetchedAt); assert.equal(state.client.rain.updatedAt, rain.updatedAt);
    assert.equal(state.client.rain.transportOK, true); assert.equal(state.client.rain.hasRetainedCache, true);
    assert.equal(state.client.rain.schemaVersion, 3);
    assert.equal(state.client.rain.periodCount, rain.outlook.periods.length);
    assert.equal(state.client.rain.knownHorizonEnd, rain.knownHorizonEnd);
    const hint = state.client.rain.hint;
    assert.equal(hint.visible, true); assert.ok(state.labels.includes(hint.text), "The actual canvas must display the computed rain status");
    assert.ok(state.labels.some(label => label.includes("和风天气")), "The provider must be drawn on canvas in all outlook states");
    assert.ok(rainFreshness.expectedStatuses.includes(hint.status), "Actual outlook state must agree with the public periods: " + JSON.stringify(rainFreshness));
    if (!rainFreshness.fresh) assert.equal(hint.text, "雨情更新中");
    else if (hint.status === "dry") assert.match(hint.text, /无.*(?:雨|降水)/);
    else if (hint.status === "wet") assert.ok(hint.text.includes(rainFreshness.currentKind === "snow" ? "雪" : "雨"));
    else if (hint.status === "onset") {
      assert.ok(hint.text.includes(rainFreshness.onsetKind === "snow" ? "雪" : "雨"));
      const minutes = Math.ceil((rainFreshness.onsetTime - state.observedAt) / 300) * 5;
      if (typeof hint.minutes === "number") assert.equal(hint.minutes, minutes);
      if (minutes > 5 && minutes < 120) assert.ok(hint.text.includes(String(minutes) + "分钟"), "Rounded onset minutes must come from the real period boundary");
    }
    for (const [field, native] of [["temperature", "temperature_2m"], ["weatherCode", "weather_code"], ["precipitation", "precipitation"]]) {
      assert.ok(Number.isFinite(raw.current[native])); assert.equal(state.data.current[field], raw.current[native]);
    }
    const fields = ["temperatureMin", "temperatureMax", "weatherCode", "precipitation"];
    const nativeFields = ["temperature_2m_min", "temperature_2m_max", "weather_code", "precipitation_sum"];
    state.data.daily.forEach((row, i) => {
      assert.equal(row.time, raw.daily.time[i]); assert.equal(row.date, dayKey(row.time));
      fields.forEach((field, n) => { assert.ok(Number.isFinite(row[field]), "Real daily " + field + " must be present"); assert.equal(row[field], raw.daily[nativeFields[n]][i]); });
    });
    const today = dayKey(Date.now() / 1000);
    const calendarDay = offset => new Date(Date.parse(today + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
    const todayRow = state.data.daily.find(row => row.date === today), tomorrowRow = state.data.daily.find(row => row.date === calendarDay(1)), afterRow = state.data.daily.find(row => row.date === calendarDay(2));
    assert.ok(todayRow && tomorrowRow && afterRow); assert.equal(state.client.todayTime, todayRow.time);
    assert.equal(state.client.tomorrowTime, tomorrowRow.time); assert.equal(state.client.afterTomorrowTime, afterRow.time);
    assert.ok(state.labels.includes(state.client.currentCondition)); assert.ok(state.labels.includes("今天 " + state.client.todayRange));
    assert.ok(state.labels.includes("明天") && state.labels.includes("后天")); assert.ok(!state.labels.some(label => /天气暂无|暂无有效|等待天气/.test(label)));
    assert.ok(responses.length === 3 && responses.every(response => response.status === 200)); assert.deepEqual(errors, []);
    const image = await send("Page.captureScreenshot", {format: "png"});
    const screenshot = path.join(output, "installed-loader-outlook-weather.png");
    fs.writeFileSync(screenshot, Buffer.from(image.data, "base64"));
    fs.writeFileSync(path.join(output, "program-envelope.html"), programBody);
    fs.writeFileSync(path.join(output, "forecast-response.json"), forecastBody);
    fs.writeFileSync(path.join(output, "rain-derived-cache.json"), rainBody);
    await evaluate("dispatchEvent(new Event('pagehide'));void 0;");
    const stopped = await evaluate("OpenMeteoSimple.getState()");
    assert.equal(stopped.networkTimerActive, false); assert.equal(stopped.displayTimerActive, false);
    assert.equal(stopped.rain.pollTimerActive, false); assert.equal(stopped.rain.localTimerActive, false);
    report = {passed: true, testerSHA256, checkedAtUTC: new Date().toISOString(), nativeDate: true, nativeXHR: true,
      installedLauncherSHA256: sha(launcher), clientSHA256: manifest.client_sha256, envelopeSHA256: sha(programBody),
      actualSources: state.update.sources, requests, responses, current: state.data.current, today: todayRow,
      tomorrow: tomorrowRow, afterTomorrow: afterRow, rainDerivedCache: rain, rainState: state.client.rain,
      rainFreshness, freshRainCacheVerified: rainFreshness.fresh,
      outcome: rainFreshness.fresh ? "complete real chain with fresh derived cache" : "real chain complete; expired rain cache correctly hidden",
      renderedLabels: state.labels, sourceState: state.update, oneVisibleCanvas: true, rawRainHelperBundled: false,
      rawRainPublished: false, derivedQualitativePeriodsOnly: true, noCredentialsInCache: true, noDirectQWeatherRequests: true, errors,
      programCalls: 1, openMeteoCalls: 1, gitHubRainCacheReads: 1, qweatherProviderCallsByThisTest: 0,
      deviceOperations: 0, screenshot, timersStoppedAfterCapture: true,
      limit: "Actual network from isolated current Chromium, not a new Kindle hardware test. Dry/onset/wet/updating reflects the same public qualitative periods and observed native time, not a simulated forecast."};
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report = {passed: false, testerSHA256, error: String(error.stack || error), requests, responses, errors, deviceOperations: 0,
      qweatherProviderCallsByThisTest: 0};
    console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
  } finally {
    if (report) fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(report, null, 2));
    if (socket && socket.readyState === 1) { try { await send("Browser.close", {}, null); } catch (_) {} socket.close(); }
    if (!browser.killed) browser.kill();
  }
})();
