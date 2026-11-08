'use strict';
// Scheduled fixed-place fetcher. Native Node modules only; never logs credentials/URLs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');
const {KindleRainHint} = require('../openmeteo-simple/rain_hint.js');

const SLOT_SECONDS = 300;
const MONTH_CAP = 10000;
const KEEP_RESERVATIONS = 96;
const MAX_CACHE_AGE = 600;
const MAX_SOURCE_AGE = 1800;
const LOCATION = Object.freeze({id: 'hepo', name: '揭西河婆', latitude: 23.44,
  longitude: 115.84, datum: 'GCJ02', timezone: 'Asia/Shanghai'});
const BLOCK_CODES = new Set([401, 402, 403, 429]);

class SafeError extends Error {
  constructor(code, statusCode = null) { super(code); this.code = code; this.statusCode = statusCode; }
}
function epoch(value) {
  if (!Number.isInteger(value) || value < 946684800 || value > 4102443900) throw new SafeError('invalid_clock');
  return value;
}
function host(value) {
  if (typeof value !== 'string') throw new SafeError('invalid_api_host');
  let result = value.trim().toLowerCase();
  if (!result.includes('://')) result = 'https://' + result;
  if (!/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+qweatherapi\.com$/.test(result) || result.length > 261) {
    throw new SafeError('invalid_api_host');
  }
  return result;
}
function parseCredentials(text) {
  if (!text || !text.trim()) throw new SafeError('missing_QWEATHER_CREDENTIALS');
  let raw;
  try { raw = JSON.parse(text); } catch (_) { throw new SafeError('invalid_QWEATHER_CREDENTIALS'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SafeError('invalid_QWEATHER_CREDENTIALS');
  const result = {apiHost: host(raw.apiHost)};
  for (const name of ['kid', 'iss', 'sub']) {
    if (typeof raw[name] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw[name])) {
      throw new SafeError('invalid_QWEATHER_CREDENTIALS');
    }
    result[name] = raw[name];
  }
  if (typeof raw.privateKeyPem !== 'string' || raw.privateKeyPem.length > 8192) throw new SafeError('invalid_private_key');
  try { result.privateKey = crypto.createPrivateKey(raw.privateKeyPem); }
  catch (_) { throw new SafeError('invalid_private_key'); }
  if (result.privateKey.asymmetricKeyType !== 'ed25519') throw new SafeError('invalid_private_key_type');
  return result;
}
function createJwt(credentials, now) {
  epoch(now);
  const header = Buffer.from(JSON.stringify({alg: 'EdDSA', kid: credentials.kid})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({iss: credentials.iss, sub: credentials.sub,
    iat: now - 30, exp: now + 900})).toString('base64url');
  const input = header + '.' + payload;
  try { return input + '.' + crypto.sign(null, Buffer.from(input), credentials.privateKey).toString('base64url'); }
  catch (_) { throw new SafeError('jwt_signing_failed'); }
}
function monthOf(now) { return new Date((now + 28800) * 1000).toISOString().slice(0, 7); }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.tmp-' + process.pid;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
async function withLock(directory, callback) {
  fs.mkdirSync(directory, {recursive: true});
  const file = path.join(directory, '.fetch.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (_) { throw new SafeError('another_process_or_stale_lock'); }
  try { fs.writeFileSync(fd, String(process.pid)); return await callback(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function loadState(file) {
  if (!fs.existsSync(file)) return {schemaVersion: 1, location: LOCATION, ledger: {}, monthlyCounts: {}, paused: null, lastSuccess: null};
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { throw new SafeError('unreadable_ledger_stop_without_fetch'); }
  if (!state || state.schemaVersion !== 1 || JSON.stringify(state.location) !== JSON.stringify(LOCATION) ||
      !state.ledger || typeof state.ledger !== 'object' || Array.isArray(state.ledger) ||
      !state.monthlyCounts || typeof state.monthlyCounts !== 'object' || Array.isArray(state.monthlyCounts)) {
    throw new SafeError('unexpected_ledger_stop_without_fetch');
  }
  const recent = {};
  for (const [token, item] of Object.entries(state.ledger)) {
    if (!item || !/^[A-Za-z0-9_.-]{1,100}$/.test(item.runId) ||
        !Number.isInteger(item.slot) || String(item.slot) !== token ||
        typeof item.month !== 'string' || !/^\d{4}-\d{2}$/.test(item.month)) {
      throw new SafeError('unexpected_ledger_stop_without_fetch');
    }
    recent[item.month] = (recent[item.month] || 0) + 1;
  }
  for (const [month, count] of Object.entries(state.monthlyCounts)) {
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isInteger(count) || count < 0 || count > MONTH_CAP) {
      throw new SafeError('unexpected_ledger_stop_without_fetch');
    }
  }
  for (const [month, count] of Object.entries(recent)) {
    if (!Number.isInteger(state.monthlyCounts[month]) || state.monthlyCounts[month] < count) {
      throw new SafeError('monthly_count_regressed_stop_without_fetch');
    }
  }
  if (state.lastSuccess && (state.lastSuccess.schemaVersion !== 2 || state.lastSuccess.source !== 'qweather' ||
      'raw' in state.lastSuccess || 'minutely' in state.lastSuccess || 'summary' in state.lastSuccess || 'refer' in state.lastSuccess)) {
    throw new SafeError('unexpected_cache_contract_stop_without_fetch');
  }
  return state;
}
function reserve(stateFile, runId, now) {
  epoch(now);
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(runId)) throw new SafeError('invalid_run_identifier');
  const state = loadState(stateFile);
  if (state.paused) throw new SafeError('qweather_access_blocked');
  if (Object.values(state.ledger).some(item => item.runId === runId)) throw new SafeError('run_identifier_already_used');
  const slot = Math.floor(now / SLOT_SECONDS);
  const month = monthOf(now);
  if (state.ledger[String(slot)]) return {runId, slot, month, reserved: false, monthlyCount: state.monthlyCounts[month] || 0};
  const count = state.monthlyCounts[month] || 0;
  if (count >= MONTH_CAP) throw new SafeError('monthly_request_cap_reached');
  state.monthlyCounts[month] = count + 1; // Count reservations, including ambiguous/crashed requests.
  state.ledger[String(slot)] = {runId, slot, month, reservedAt: now, attemptedAt: null, status: 'reserved'};
  const keys = Object.keys(state.ledger).sort((a, b) => Number(b) - Number(a));
  for (const old of keys.slice(KEEP_RESERVATIONS)) delete state.ledger[old];
  atomicJson(stateFile, state);
  return {runId, slot, month, reserved: true, monthlyCount: state.monthlyCounts[month], monthlyCap: MONTH_CAP};
}
function normalizeRaw(raw, now, previous = null) {
  epoch(now);
  if (!raw || raw.code !== '200') throw new SafeError('invalid_success_response');
  if (!Array.isArray(raw.minutely) || raw.minutely.length < 2 || raw.minutely.length > 120) {
    throw new SafeError('missing_minutely_forecast');
  }
  let normalized;
  try { normalized = KindleRainHint.normalize(raw, now); }
  catch (_) { throw new SafeError('invalid_minutely_forecast'); }
  const issued = normalized.updatedAt;
  if (issued > now + 120) throw new SafeError('provider_time_in_future');
  if (now - issued >= MAX_SOURCE_AGE) throw new SafeError('stale_provider_data');
  if (previous && issued < previous.updatedAt) throw new SafeError('provider_time_regressed');
  const useful = normalized.bins.some(item => item.time >= now && Number.isFinite(item.precipitation));
  if (!useful) throw new SafeError('no_usable_future_precipitation');
  const hint = KindleRainHint.analyze(normalized, now, {maxAgeSeconds: MAX_SOURCE_AGE});
  const horizonEnd = normalized.bins[normalized.bins.length - 1].time + SLOT_SECONDS;
  const validUntil = Math.min(hint.validUntil || horizonEnd, issued + MAX_SOURCE_AGE,
    now + MAX_CACHE_AGE, horizonEnd);
  if (now >= validUntil) throw new SafeError('stale_provider_data');
  const alert = hint.visible ? {kind: hint.type, forecastTime: Math.floor(hint.forecastTime),
    timing: hint.minutes === null ? 'nearby' : 'approximate'} : null;
  // Publish only the small derived display product. No provider text, amounts or arrays.
  return {schemaVersion: 2, source: 'qweather', location: LOCATION, fetchedAt: now,
    updatedAt: Math.floor(issued), validUntil: Math.floor(validUntil),
    knownHorizonEnd: Math.floor(horizonEnd), alert};
}
function requestOnce(credentials, token) {
  const url = credentials.apiHost + '/v7/minutely/5m?location=115.84%2C23.44&lang=zh';
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let statusSeen = null;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    let request;
    try {
      request = https.request(url, {method: 'GET', headers: {Authorization: 'Bearer ' + token,
        Accept: 'application/json', 'Accept-Encoding': 'gzip', 'User-Agent': 'KindleWeatherRainCache/1'}}, response => {
        const statusCode = response.statusCode || 0;
        statusSeen = statusCode;
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 1000000) {
            done(new SafeError('response_too_large', statusCode));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on('error', () => done(new SafeError('response_error', statusCode)));
        response.on('end', () => {
          if (settled) return;
          let raw = null;
          try {
            let bytes = Buffer.concat(chunks);
            const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
            if (encoding === 'gzip') bytes = zlib.gunzipSync(bytes, {maxOutputLength: 1000000});
            else if (encoding !== 'identity') throw new Error('encoding');
            raw = JSON.parse(bytes.toString('utf8'));
          } catch (_) {
            if (statusCode === 200) { done(new SafeError('invalid_provider_json', statusCode)); return; }
          }
          done(null, {statusCode, raw});
        });
      });
      timer = setTimeout(() => { done(new SafeError('request_timeout', statusSeen)); request.destroy(); }, 20000);
      request.on('error', () => done(new SafeError('network_error', statusSeen)));
      request.end(); // Native https does not follow redirects.
    } catch (_) { done(new SafeError('request_unavailable')); }
  });
}
async function fetchReserved(stateFile, cacheFile, runId, credentials, transport = requestOnce,
                             clock = () => Math.floor(Date.now() / 1000)) {
  const state = loadState(stateFile);
  if (state.paused) throw new SafeError('qweather_access_blocked');
  const entry = Object.values(state.ledger).find(item => item.runId === runId && item.status === 'reserved');
  if (!entry) return {runId, status: 'nothing_reserved', apiRequests: 0};
  const now = epoch(clock());
  if (entry.slot !== Math.floor(now / SLOT_SECONDS)) {
    entry.status = 'expired'; entry.error = 'reservation_window_elapsed';
    atomicJson(stateFile, state);
    return {runId, status: 'expired', apiRequests: 0, error: entry.error};
  }
  entry.status = 'attempted'; entry.attemptedAt = now;
  atomicJson(stateFile, state); // Persist BEFORE the single possibly billable request.
  let statusCode = null;
  let apiCode = null;
  let apiRequests = 0;
  try {
    const token = createJwt(credentials, now);
    apiRequests = 1;
    const response = await transport(credentials, token);
    statusCode = response.statusCode;
    apiCode = response.raw && typeof response.raw.code === 'string' && /^\d{3}$/.test(response.raw.code) ? response.raw.code : null;
    if (statusCode !== 200) throw new SafeError('http_' + (Number.isInteger(statusCode) ? statusCode : 0), statusCode);
    if (apiCode !== '200') throw new SafeError(apiCode ? 'api_' + apiCode : 'invalid_api_code');
    const receivedAt = epoch(clock());
    const envelope = normalizeRaw(response.raw, receivedAt, state.lastSuccess);
    state.lastSuccess = envelope;
    entry.status = 'success'; entry.completedAt = receivedAt;
    entry.httpStatus = statusCode; entry.apiCode = apiCode;
    atomicJson(stateFile, state);
    atomicJson(cacheFile, envelope);
  } catch (error) {
    if (error instanceof SafeError && error.statusCode !== null) statusCode = error.statusCode;
    const safeCode = error instanceof SafeError && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : 'unexpected_fetch_failure';
    entry.status = 'failed'; entry.error = safeCode; entry.httpStatus = statusCode; entry.apiCode = apiCode;
    if (BLOCK_CODES.has(statusCode) || BLOCK_CODES.has(Number(apiCode))) {
      state.paused = {code: 'qweather_access_blocked', reason: safeCode, detectedAt: epoch(clock())};
    }
    atomicJson(stateFile, state); // Cache file stays byte-for-byte untouched on every failure.
  }
  return {runId, status: entry.status, apiRequests, httpStatus: entry.httpStatus,
    apiCode: entry.apiCode, error: entry.error || null, paused: state.paused,
    month: entry.month, monthlyCount: state.monthlyCounts[entry.month], monthlyCap: MONTH_CAP};
}
function argumentsOf(argv) {
  const operation = argv[0];
  const options = {operation, stateDir: path.join(__dirname, 'state'), cacheDir: path.join('kindle-weather', 'cache')};
  if (operation !== 'reserve' && operation !== 'fetch') throw new SafeError('expected_reserve_or_fetch');
  for (let i = 1; i < argv.length; i += 2) {
    const name = argv[i], value = argv[i + 1];
    if (!value) throw new SafeError('invalid_cli_arguments');
    if (name === '--run-id') options.runId = value;
    else if (name === '--state-dir') options.stateDir = value;
    else if (name === '--cache-dir') options.cacheDir = value;
    else throw new SafeError('invalid_cli_arguments');
  }
  if (!options.runId || !/^[A-Za-z0-9_.-]{1,100}$/.test(options.runId)) throw new SafeError('invalid_run_identifier');
  return options;
}
async function main(argv = process.argv.slice(2), env = process.env, output = console) {
  try {
    const credentials = parseCredentials(env.QWEATHER_CREDENTIALS); // Before lock/reservation/any ledger mutation.
    const args = argumentsOf(argv);
    const stateFile = path.join(args.stateDir, 'hepo.json');
    const result = await withLock(args.stateDir, () => args.operation === 'reserve' ?
      reserve(stateFile, args.runId, Math.floor(Date.now() / 1000)) :
      fetchReserved(stateFile, path.join(args.cacheDir, 'hepo-rain.json'), args.runId, credentials));
    output.log(JSON.stringify(result));
    return result.status === 'failed' || result.status === 'expired' ? 2 : 0;
  } catch (error) {
    const code = error instanceof SafeError && /^[A-Za-z0-9_]{1,80}$/.test(error.code) ? error.code : 'unexpected_local_failure';
    output.error(JSON.stringify({error: code}));
    return 1;
  }
}
module.exports = {SLOT_SECONDS, MONTH_CAP, KEEP_RESERVATIONS, MAX_CACHE_AGE, MAX_SOURCE_AGE, LOCATION, SafeError,
  host, parseCredentials, createJwt, monthOf, atomicJson, withLock, loadState,
  reserve, normalizeRaw, requestOnce, fetchReserved, main};
if (require.main === module) main().then(code => { process.exitCode = code; });
