'use strict';
// Offline only. Cryptographic credentials are ephemeral test keys, never registered or printed.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const https = require('node:https');
const zlib = require('node:zlib');
const s = require('./service.js');
const NOW = Date.parse('2026-11-08T04:30:00Z') / 1000;
const keypair = crypto.generateKeyPairSync('ed25519');
const input = {apiHost: 'offline.example.qweatherapi.com', kid: 'TESTKID001', iss: 'QTESTISS01',
  sub: 'TESTSUB001', privateKeyPem: keypair.privateKey.export({type: 'pkcs8', format: 'pem'})};
const credentials = s.parseCredentials(JSON.stringify(input));
const iso = time => new Date(time * 1000).toISOString();
function raw(now = NOW) {
  return {code: '200', updateTime: iso(now), summary: '合成测试：十五分钟后可能有雨（非真实天气）',
    minutely: Array.from({length: 24}, (_, i) => ({fxTime: iso(now + i * 300),
      precip: i === 3 || i === 4 ? '0.15' : '0.0', type: 'rain'})),
    refer: {sources: ['https://developer.qweather.com/attribution.html'], license: ['QWeather Developers License']},
    extraPrivateField: JSON.stringify(input), request_url: 'https://' + input.apiHost + '/private'};
}
function files(t) {
  const base = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(base, 'qweather-offline-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('qweather-offline-')) {
      throw new Error('refuse cleanup outside the explicitly created test directory');
    }
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  return {root, state: path.join(root, 'state', 'hepo.json'), cache: path.join(root, 'cache', 'hepo-rain.json')};
}
async function slot(f, runId, now, transport = async () => ({statusCode: 200, raw: raw(now)})) {
  const plan = s.reserve(f.state, runId, now);
  const result = await s.fetchReserved(f.state, f.cache, runId, credentials, transport, () => now);
  return {plan, result};
}

test('native Ed25519 JWT and assigned multi-label host are correct; credentials remain memory-only', () => {
  const token = s.createJwt(credentials, NOW), parts = token.split('.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.deepEqual(header, {alg: 'EdDSA', kid: input.kid});
  assert.deepEqual(payload, {iss: input.iss, sub: input.sub, iat: NOW - 30, exp: NOW + 900});
  assert.equal(crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1]), keypair.publicKey,
    Buffer.from(parts[2], 'base64url')), true);
  assert.equal(s.host('https://example.re.qweatherapi.com'), 'https://example.re.qweatherapi.com');
  for (const bad of ['http://x.qweatherapi.com', 'https://x.qweatherapi.com/path',
    'https://x.qweatherapi.com:443', 'https://user@x.qweatherapi.com',
    'https://x.qweatherapi.com?key=test', 'https://x.qweatherapi.com.evil.invalid']) {
    assert.throws(() => s.host(bad), /invalid_api_host/);
  }
});
test('one request per five-minute slot, including manual reruns and ambiguous failures', async t => {
  const f = files(t); let calls = 0;
  const fail = async () => { calls += 1; throw new Error('PRIVATE ERROR ' + input.privateKeyPem); };
  const first = await slot(f, 'one', NOW, fail);
  assert.equal(first.result.status, 'failed'); assert.equal(first.result.error, 'unexpected_fetch_failure');
  assert.throws(() => s.reserve(f.state, 'one', NOW), /run_identifier_already_used/);
  const duplicate = await slot(f, 'manual-new-run', NOW + 10, fail);
  assert.equal(duplicate.plan.reserved, false); assert.equal(duplicate.result.apiRequests, 0);
  const repeated = await s.fetchReserved(f.state, f.cache, 'one', credentials, fail, () => NOW + 15);
  assert.equal(repeated.apiRequests, 0); assert.equal(calls, 1);
  await slot(f, 'next-slot', NOW + 300, fail); assert.equal(calls, 2);
  assert.equal(s.loadState(f.state).monthlyCounts[s.monthOf(NOW)], 2);
});
test('crossed slot expires the consumed reservation without making any request', async t => {
  const f = files(t); s.reserve(f.state, 'delayed', NOW); let calls = 0;
  const result = await s.fetchReserved(f.state, f.cache, 'delayed', credentials,
    async () => { calls += 1; }, () => NOW + 300);
  assert.equal(result.status, 'expired'); assert.equal(result.apiRequests, 0); assert.equal(calls, 0);
  assert.equal(s.loadState(f.state).monthlyCounts[s.monthOf(NOW)], 1);
  assert.equal(s.reserve(f.state, 'new-slot', NOW + 300).reserved, true);
});
test('monthly cap and bounded reservation pruning cannot reset consumed totals', async t => {
  const f = files(t);
  for (let i = 0; i < 100; i += 1) s.reserve(f.state, 'prune-' + i, NOW + i * 300);
  let state = s.loadState(f.state);
  assert.equal(Object.keys(state.ledger).length, 96);
  assert.equal(state.monthlyCounts[s.monthOf(NOW)], 100);
  let calls = 0;
  const absent = await s.fetchReserved(f.state, f.cache, 'prune-0', credentials,
    async () => { calls += 1; }, () => NOW + 30000);
  assert.equal(absent.apiRequests, 0); assert.equal(calls, 0);
  state.monthlyCounts[s.monthOf(NOW)] = 9999; s.atomicJson(f.state, state);
  assert.equal(s.reserve(f.state, 'last-allowed', NOW + 100 * 300).monthlyCount, 10000);
  assert.throws(() => s.reserve(f.state, 'over-cap', NOW + 101 * 300), /monthly_request_cap_reached/);
  const december = Date.parse('2026-11-30T16:01:00Z') / 1000; // Beijing December.
  assert.equal(s.reserve(f.state, 'new-month', december).monthlyCount, 1);
  state = s.loadState(f.state);
  assert.equal(state.monthlyCounts['2026-11'], 10000); assert.equal(state.monthlyCounts['2026-12'], 1);
});
test('HTTP and provider API auth/billing/rate statuses persistently pause future requests', async t => {
  for (const code of [401, 402, 403, 429]) {
    for (const channel of ['http', 'api']) {
      const f = files(t); let calls = 0;
      const transport = async () => { calls += 1; return {statusCode: channel === 'http' ? code : 200,
        raw: {code: String(code)}}; };
      const {result} = await slot(f, 'blocked', NOW, transport);
      assert.equal(result.status, 'failed'); assert.equal(result.paused.code, 'qweather_access_blocked');
      assert.throws(() => s.reserve(f.state, 'later', NOW + 300), /qweather_access_blocked/);
      await assert.rejects(s.fetchReserved(f.state, f.cache, 'blocked', credentials, transport, () => NOW + 300),
        /qweather_access_blocked/);
      assert.equal(calls, 1); assert.equal(fs.existsSync(f.cache), false);
    }
  }
});
test('schema3 publishes qualitative periods and preserves unknown coverage', async t => {
  const f = files(t); const inputRaw = raw();
  inputRaw.minutely[1].precip = null; inputRaw.minutely[2].precip = '';
  inputRaw.minutely[5].precip = 'NaN'; inputRaw.minutely[6].type = 'unknown';
  const {result} = await slot(f, 'normal', NOW, async () => ({statusCode: 200, raw: inputRaw}));
  assert.equal(result.status, 'success');
  const cache = JSON.parse(fs.readFileSync(f.cache, 'utf8'));
  assert.deepEqual(cache.location, s.LOCATION); assert.equal(cache.location.datum, 'GCJ02');
  assert.equal(cache.schemaVersion, 3); assert.equal(cache.source, 'qweather'); assert.equal(cache.fetchedAt, NOW);
  assert.equal(cache.updatedAt, NOW); assert.equal(cache.validUntil, NOW + 600);
  assert.deepEqual(cache.outlook.periods, [
    {from: NOW, to: NOW + 300, kind: 'dry', strength: null},
    {from: NOW + 300, to: NOW + 900, kind: 'unknown', strength: null},
    {from: NOW + 900, to: NOW + 1500, kind: 'rain', strength: 'light'},
    {from: NOW + 1500, to: NOW + 2100, kind: 'unknown', strength: null},
    {from: NOW + 2100, to: NOW + 7200, kind: 'dry', strength: null}
  ]);
  for (const name of ['raw', 'summary', 'minutely', 'precip', 'precipitation', 'refer', 'extraPrivateField', 'request_url']) {
    assert.equal(Object.hasOwn(cache, name), false);
    assert.equal(Object.hasOwn(s.loadState(f.state).lastSuccess, name), false);
  }
  const text = fs.readFileSync(f.cache, 'utf8') + fs.readFileSync(f.state, 'utf8') + JSON.stringify(result);
  for (const secret of [input.privateKeyPem, input.apiHost, input.kid, input.iss, input.sub]) assert.equal(text.includes(secret), false);
});
test('stale, regressed, future or malformed provider data preserves exact old cache bytes and timestamps', async t => {
  for (const kind of ['stale', 'regressed', 'future', 'bad-axis']) {
    const f = files(t); await slot(f, 'first', NOW);
    const before = fs.readFileSync(f.cache, 'utf8');
    let response = raw(NOW + 300);
    if (kind === 'stale') response = raw(NOW - 1800);
    if (kind === 'regressed') response = raw(NOW - 300);
    if (kind === 'future') response = raw(NOW + 3600);
    if (kind === 'bad-axis') response.minutely[1].fxTime = response.minutely[0].fxTime;
    const {result} = await slot(f, 'second', NOW + 300, async () => ({statusCode: 200, raw: response}));
    assert.equal(result.status, 'failed'); assert.equal(fs.readFileSync(f.cache, 'utf8'), before);
    assert.equal(s.loadState(f.state).lastSuccess.fetchedAt, NOW);
  }
});
test('a repeated successful source issue keeps updatedAt instead of renewing source age', async t => {
  const f = files(t); await slot(f, 'first', NOW);
  await slot(f, 'second', NOW + 300, async () => ({statusCode: 200, raw: raw(NOW)}));
  const cache = JSON.parse(fs.readFileSync(f.cache, 'utf8'));
  assert.equal(cache.fetchedAt, NOW + 300); assert.equal(cache.updatedAt, NOW);
  assert.equal(cache.validUntil, NOW + 900); // A new upstream response, not merely a cache GET.
});
test('source aged twelve minutes gets ten received minutes; age twenty-nine gets only one', () => {
  assert.equal(s.MAX_CACHE_AGE, 600); assert.equal(s.MAX_SOURCE_AGE, 1800);
  const twelve = s.normalizeRaw(raw(NOW - 720), NOW);
  assert.equal(twelve.updatedAt, NOW - 720); assert.equal(twelve.fetchedAt, NOW);
  assert.equal(twelve.validUntil, NOW + 600);
  const twentyNine = s.normalizeRaw(raw(NOW - 1740), NOW);
  assert.equal(twentyNine.updatedAt, NOW - 1740); assert.equal(twentyNine.validUntil, NOW + 60);
  assert.throws(() => s.normalizeRaw(raw(NOW - 1801), NOW), /stale_provider_data/);
});
test('a failed later fetch never renews the prior derived validUntil', async t => {
  const f = files(t); await slot(f, 'initial', NOW, async () => ({statusCode: 200, raw: raw(NOW - 720)}));
  const before = fs.readFileSync(f.cache, 'utf8');
  const initial = JSON.parse(before); assert.equal(initial.validUntil, NOW + 600);
  await slot(f, 'later-failure', NOW + 300, async () => { throw new Error('offline test network failure'); });
  assert.equal(fs.readFileSync(f.cache, 'utf8'), before);
  assert.equal(s.loadState(f.state).lastSuccess.validUntil, NOW + 600);
});
test('raw summary, amounts, references, secrets and raw rows never enter the derived public product', () => {
  const token = s.createJwt(credentials, NOW);
  const response = raw(); response.summary = token;
  response.refer.sources = ['https://' + input.apiHost + '/?key=' + token];
  const envelope = s.normalizeRaw(response, NOW);
  const text = JSON.stringify(envelope);
  for (const forbidden of [token, input.apiHost, input.privateKeyPem, 'summary', 'raw', 'minutely',
    'refer', 'precipitation', '0.15']) assert.equal(text.includes(forbidden), false);
  assert.deepEqual(envelope.outlook.periods, [
    {from: NOW, to: NOW + 900, kind: 'dry', strength: null},
    {from: NOW + 900, to: NOW + 1500, kind: 'rain', strength: 'light'},
    {from: NOW + 1500, to: NOW + 7200, kind: 'dry', strength: null}
  ]);
  const gap = raw(); gap.minutely.splice(1, 1);
  assert.deepEqual(s.normalizeRaw(gap, NOW).outlook.periods[1],
    {from: NOW + 300, to: NOW + 600, kind: 'unknown', strength: null});
});

test('dry outlook is bounded by the real remaining forecast horizon, not another two hours', () => {
  const response = raw(NOW - 720); response.minutely.forEach(row => { row.precip = '0'; });
  const envelope = s.normalizeRaw(response, NOW);
  assert.equal(envelope.knownHorizonEnd, NOW + 6480);
  assert.deepEqual(envelope.outlook.periods, [{from: NOW, to: NOW + 6480, kind: 'dry', strength: null}]);
  assert.equal(envelope.validUntil, NOW + 600);
});

test('5-minute accumulations convert to approximate short-period rain-intensity bands only', () => {
  const values = ['0', '0.20', '0.21', '0.83', '0.84', '4.16', '4.17'];
  const response = raw();
  response.minutely = values.map((precip, i) => ({fxTime: iso(NOW + i * 300), precip, type: 'rain'}));
  const periods = s.normalizeRaw(response, NOW).outlook.periods;
  assert.deepEqual(periods.map(p => [p.kind, p.strength]), [
    ['dry', null], ['rain', 'light'], ['rain', 'moderate'], ['rain', 'heavy'], ['rain', 'violent']
  ]);
  assert.equal(periods[2].to - periods[2].from, 600);
  assert.equal(periods[3].to - periods[3].from, 600);
  response.minutely.forEach(row => { row.type = 'snow'; });
  assert.ok(s.normalizeRaw(response, NOW).outlook.periods.every(p => p.strength === null));
});

test('historical rain is removed, multiple wet spells remain separate, unknown type is not dry', () => {
  const response = raw(NOW - 300);
  response.minutely.forEach(row => { row.precip = '0'; });
  response.minutely[0].precip = '2'; // Entirely before now: cannot become current rain.
  response.minutely[3].precip = '0.1'; response.minutely[5].precip = '1';
  response.minutely[8].type = 'invalid';
  const envelope = s.normalizeRaw(response, NOW);
  assert.equal(envelope.outlook.periods[0].kind, 'dry');
  assert.equal(envelope.outlook.periods.filter(p => p.kind === 'rain').length, 2);
  assert.ok(envelope.outlook.periods.some(p => p.kind === 'unknown'));
  assert.ok(envelope.outlook.periods.every((p, i, ps) => p.from >= NOW && p.to > p.from && (!i || ps[i - 1].to === p.from)));
});

test('existing schema2 cache migrates on the next fetch without resetting any quota counts', async t => {
  const f = files(t); await slot(f, 'original', NOW);
  const state = s.loadState(f.state);
  state.lastSuccess = {...state.lastSuccess, schemaVersion: 2, alert: null};
  delete state.lastSuccess.outlook;
  s.atomicJson(f.state, state); s.atomicJson(f.cache, state.lastSuccess);
  assert.equal(s.loadState(f.state).monthlyCounts[s.monthOf(NOW)], 1);
  await slot(f, 'migrated', NOW + 300);
  assert.equal(s.loadState(f.state).monthlyCounts[s.monthOf(NOW)], 2);
  assert.equal(s.loadState(f.state).lastSuccess.schemaVersion, 3);
  assert.equal(JSON.parse(fs.readFileSync(f.cache, 'utf8')).schemaVersion, 3);
});
test('missing or malformed credential stops CLI before creating a reservation or any lock', async t => {
  const f = files(t); const logs = []; const output = {log: text => logs.push(text), error: text => logs.push(text)};
  const args = ['reserve', '--run-id', 'no-secret', '--state-dir', path.dirname(f.state)];
  assert.equal(await s.main(args, {}, output), 1);
  assert.equal(fs.existsSync(path.dirname(f.state)), false);
  assert.equal(await s.main(args, {QWEATHER_CREDENTIALS: 'PRIVATE-MALFORMED-JSON'}, output), 1);
  assert.equal(fs.existsSync(f.state), false);
  assert.equal(logs.join('').includes('PRIVATE-MALFORMED-JSON'), false);
});
test('corrupt ledger or decreasing month counter fails closed', async t => {
  const f = files(t); fs.mkdirSync(path.dirname(f.state), {recursive: true}); fs.writeFileSync(f.state, '{broken');
  assert.throws(() => s.reserve(f.state, 'broken', NOW), /unreadable_ledger_stop_without_fetch/);
  fs.unlinkSync(f.state); s.reserve(f.state, 'valid', NOW);
  const state = s.loadState(f.state); state.monthlyCounts[s.monthOf(NOW)] = 0; s.atomicJson(f.state, state);
  assert.throws(() => s.reserve(f.state, 'reset', NOW + 300), /monthly_count_regressed/);
});
test('local locking protects simultaneous CLI reservations across processes', async t => {
  const f = files(t);
  const execute = id => new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'service.js'), 'reserve', '--run-id', id,
      '--state-dir', path.dirname(f.state)], {env: {...process.env, QWEATHER_CREDENTIALS: JSON.stringify(input)}, windowsHide: true});
    let output = ''; child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve({code, output}));
  });
  const results = await Promise.all([execute('race-a'), execute('race-b')]);
  assert.equal(results.filter(result => result.output.includes('"reserved":true')).length, 1);
  const state = s.loadState(f.state);
  assert.equal(Object.keys(state.ledger).length, 1);
  assert.equal(Object.values(state.monthlyCounts).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(JSON.stringify(results).includes(input.privateKeyPem), false);
});
test('native transport uses header-only auth, decodes gzip and never follows redirects', async () => {
  const original = https.request; let calls = 0; let statusCode = 200;
  const token = crypto.randomBytes(24).toString('base64url');
  https.request = (url, options, callback) => {
    calls += 1; assert.equal(url.includes(token), false); assert.ok(url.includes('/v7/minutely/5m?location=115.84%2C23.44&lang=zh'));
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    const request = new EventEmitter(); request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = statusCode;
      response.headers = {'content-encoding': 'gzip', location: 'https://untrusted.invalid/'};
      response.destroy = () => {};
      callback(response); response.emit('data', zlib.gzipSync(Buffer.from(JSON.stringify(raw())))); response.emit('end');
    });
    return request;
  };
  try {
    const success = await s.requestOnce(credentials, token); assert.equal(success.raw.code, '200');
    statusCode = 302; const redirect = await s.requestOnce(credentials, token); assert.equal(redirect.statusCode, 302);
    assert.equal(calls, 2); // Two deliberate tests, one HTTPS request each, zero redirected requests.
  } finally { https.request = original; }
});
test('the 20-second deadline is absolute and aborts without retry', async () => {
  const original = {request: https.request, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout};
  let deadline; let destroyed = 0; let calls = 0; let cleared = 0;
  global.setTimeout = (callback, delay) => { assert.equal(delay, 20000); deadline = callback; return 77; };
  global.clearTimeout = id => { assert.equal(id, 77); cleared += 1; };
  https.request = () => { calls += 1; const request = new EventEmitter(); request.end = () => {};
    request.destroy = () => { destroyed += 1; }; return request; };
  try {
    const pending = s.requestOnce(credentials, 'EPHEMERAL-TEST-ONLY'); deadline();
    await assert.rejects(pending, error => error.code === 'request_timeout');
    assert.equal(calls, 1); assert.equal(destroyed, 1); assert.equal(cleared, 1);
  } finally { https.request = original.request; global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout; }
});
