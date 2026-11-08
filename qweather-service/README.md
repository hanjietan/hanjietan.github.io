# QWeather minute-precipitation cache service

Node.js 22, native modules plus the checked-in pure `openmeteo-simple/rain_hint.js`
helper: no npm packages or installation. This is the
GitHub Actions cache route for the existing Kindle program. It does not depend
on the stock Kindle trusting QWeather's certificate or handling authenticated
CORS. The Kindle reads a credential-free JSON file through its already-tested
GitHub API path. The Open-Meteo current/daily display remains separate.

## Credential and upstream request

The only secret environment variable is `QWEATHER_CREDENTIALS`, a JSON object
with the string fields `apiHost`, `kid`, `iss`, `sub`, `privateKeyPem`. Store it
as a GitHub repository Actions secret only after setup is approved. Do not put
its value in this directory, a workflow literal, program HTML, MOBI, public
cache, CLI argument, issue, log or documentation. No real credential is supplied
in these files. A malformed/missing secret or non-Ed25519 private PEM fails
**before reservation or lock creation**. The PEM is parsed directly in memory.

The assigned Host accepts valid multiple DNS labels before `.qweatherapi.com`,
for example the fictitious `example.re.qweatherapi.com`; bare host input is
canonicalized to HTTPS. HTTP, other domains, ports, userinfo, paths and query
strings are rejected. Native Ed25519 JWT uses `alg:EdDSA`, credential `kid`,
developer `iss`, project `sub`, `iat=now-30`, `exp=now+900`. Host and PEM are not
JWT claims. The token is sent only in `Authorization: Bearer ...`.

The single fixed request is:

```text
HTTPS assigned Host + /v7/minutely/5m?location=115.84%2C23.44&lang=zh
```

This is **GCJ02 longitude,latitude**, rounded to the endpoint's two-decimal
limit, for 揭西河婆. The original OpenStreetMap/Open-Meteo town point is WGS84
115.8305,23.4394; it was approximately converted offline before rounding, not
silently treated as GCJ02. See the [official coordinate requirement](https://dev.qweather.com/docs/resource/glossary/)
and [minute endpoint](https://dev.qweather.com/docs/api/minutely/minutely-precipitation/).

The transport has a 20-second **absolute** deadline, bounded gzip/JSON decoding,
no redirects and no automatic retries. Neither URLs, headers, keys, tokens,
raw bodies nor native exception text are logged. Console output is only fixed
codes and quota/slot outcomes. The provider response exists only in request
memory. Only a small derived rain/snow hint is persisted or published; provider
text, precipitation amounts, time-series arrays and references are not cached.

## Durable quota rules

State: `qweather-service/state/hepo.json`. Do not delete or reset it to retry.
Its `lastSuccess` contains only the same schema2 derived product as the public
cache, never a raw response, summary, minutely series, amounts or references.

1. Reserve the current epoch five-minute slot; increment that Beijing-calendar
   month's count. Commit and successfully push that reservation **before HTTP**.
2. Fetch only a `reserved` entry owned by this unique run ID, and only while its
   slot is still the current epoch five-minute slot. Crossing a boundary marks
   it expired without an HTTP request. Consumed reservation budget stays counted.
3. Persist `attempted` before the one potentially billable request. A new manual
   run or Actions rerun cannot refill the same slot; use
   `github.run_id-github.run_attempt` as the unique ID.
4. Save the success/failure and push it. Only Git push can be retried; the weather
   request is never repeated. A crash/final-push failure can lose one cache
   update, while the earlier durable reservation still blocks a duplicate call.

There is at most one attempt per five-minute slot and **10,000 reservations per
Beijing calendar month**. Reservations include uncertain failures or crashes,
so accounting is conservative. Only the latest 96 ledger entries are retained;
all per-month cumulative counts remain and never decrease when entries are
pruned. Fetching a pruned/unknown run ID makes zero requests. Corrupt state or
a month count below its retained reservations fails closed. Local exclusive
file locks and the Actions concurrency group protect simultaneous runs.

HTTP status **401/402/403/429**, or those same provider `code` values inside a
200 HTTP response, persist `paused:{code:"qweather_access_blocked",...}`.
Subsequent reserve/fetch commands stop until an authorized maintainer reviews
the cause and clears only the pause, preserving ledger and monthly counts.
No automatic time-based unpause is implemented. Other failures keep old cache
data and can try only in a later scheduled slot.

At five-minute intervals, 31 days is at most 8,928 requests. QWeather currently
lists the first 50,000/month for the shared weather/basic price group as free,
then postpaid billing. This service's cap does not measure unrelated account
projects; zero cash balance is not a provider spending limit. See
[pricing](https://dev.qweather.com/docs/finance/pricing/) and
[billing](https://dev.qweather.com/docs/finance/billing-and-payment/).

## Public cache contract

Path: `kindle-weather/cache/hepo-rain.json`.

```text
schemaVersion: 2
source: "qweather"
location: {id:"hepo", name:"揭西河婆", latitude:23.44, longitude:115.84,
           datum:"GCJ02", timezone:"Asia/Shanghai"}
fetchedAt: actual successful retrieval time, Unix UTC seconds
updatedAt: provider source-issue time, Unix UTC seconds
validUntil: hint/product expiry time, Unix UTC seconds
knownHorizonEnd: last known forecast label + 300 seconds
alert: null OR {kind:"rain"|"snow", forecastTime:Unix UTC seconds,
                timing:"approximate"|"nearby"}
```

The server calls the controlled helper's `normalize(raw, fetchedAt)` and
`analyze(normalized, now, {maxAgeSeconds:1800})` in memory, then clamps the
derived product to `min(fetchedAt+600, updatedAt+1800, knownHorizonEnd)`.
The exported constants are `MAX_CACHE_AGE=600` and `MAX_SOURCE_AGE=1800`.
That helper knows native amounts are
five-minute accumulated mm, not mm/hour, and keeps missing values unknown.
It downgrades timing to `nearby` when prior coverage has gaps or unknown data;
it does not infer a precise onset through missing data. A visible positive
forecast becomes the minimal `alert` object; otherwise `alert` is `null`.
Null does not assert that no rain will occur. The browser can recompute an
approximate countdown from `forecastTime`, then say nearby when that time has
passed, only until `validUntil`. No key, Host, token, request URL, raw code,
summary, minutely arrays, precipitation amounts, refer or account metadata are
published or placed in `lastSuccess`. Keep QWeather attribution separate from
Open-Meteo's licence. The output is a derived display product rather than a
redistribution of the provider's raw time series.

Only usable success data replace the public file. HTTP/API errors, malformed
data, all-unknown future amounts, source timestamps 30 minutes old or older,
more than two minutes in the future, or older than the prior source issue leave
the last public cache **byte-for-byte unchanged**, including `fetchedAt`.
A successful repeat of the same still-fresh source issue may record a new
retrieval `fetchedAt`; its original `updatedAt` is never renewed. The
frontend must expire hints by the provider time, not by cache-download time.
Reading the public cache again never creates a new retrieval or extends its
existing `validUntil`. Twelve-minute-old source data received now can be used
for at most ten more minutes; twenty-nine-minute-old source data has at most
one minute left. Failed requests preserve all old times and expiry unchanged.
Regression checks compare the prior derived `updatedAt`. A legacy raw-shaped
state fails closed instead of being republished.

## Deployment and timing limitation

The approved service is deployed with a minute-only JWT credential stored in the
repository Actions secret. To reproduce or maintain the deployment:

- Put `qweather-service/` and the controlled `openmeteo-simple/rain_hint.js` on
  `codex/kindle-weather`; both are required by the clone-reproducible tests.
- Set repository Actions secret `QWEATHER_CREDENTIALS` without exposing its value.
- Put `deploy/kindle-qweather.yml` on the default branch `main` at
  `.github/workflows/kindle-qweather.yml`. It checks out the weather branch,
  tests offline, validates credentials, pushes reservation, fetches once, then
  commits outcomes/cache. Both pushes may rebase/retry Git, never weather HTTP.
- The first normal run must verify an actual usable response before activating
  the reader. No extra probe or automatic manual rerun is needed.

Cron `2,7,12,17,22,27,32,37,42,47,52,57 * * * *` avoids minute zero. GitHub schedules may be delayed or
dropped; it is not a guaranteed five-minute service. The public cache also has
GitHub/client caching delays. Expired short-range hints must be hidden/unavailable,
never displayed as current rain/no-rain claims. The main Open-Meteo display can
remain visible. See [GitHub's documented schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Offline verification / commands

```sh
node --test qweather-service/test_service.js
```

No API key or external package is required by tests. Tests generate ephemeral
unregistered Ed25519 credentials in memory, mock HTTPS, and verify quota races,
month pruning/caps, cross-slot expiry, pause codes, gzip/no redirects, absolute
timeout, negative raw/secret leakage checks and unchanged old cache on
stale/failure responses.
No test sends a QWeather request or prints a private key/token.

Production protocol (only the approved workflow should execute it):

```sh
node qweather-service/service.js reserve --run-id "$RUN_TOKEN"
# Commit and push qweather-service/state/hepo.json successfully BEFORE fetch.
node qweather-service/service.js fetch --run-id "$RUN_TOKEN" --cache-dir kindle-weather/cache
# Commit/push state plus the public cache, including failed outcomes.
```

Exit 0 means success or no reservation; exit 1 is a local precondition/persistent
pause; exit 2 is a failed/expired attempt. A stale local `.fetch.lock` fails
closed; investigate its process before removing only that lock. Do not reset
the ledger to work around a pause, cap or duplicate slot.
