# Open-Meteo simple display provider

`provider.js` is an ES5 XMLHttpRequest adapter for one place: 揭西河婆, WGS84
23.4394 N, 115.8305 E, Asia/Shanghai. No API key, backend server, Meteoblue call,
provider fallback or cloud weather cache is needed. The frontend owns its
30-minute forecast refresh schedule and separate minute clock and optional persistent cache.

## Interface

```js
OpenMeteoProvider.fetch({protocol: 'http:', timeoutMs: 20000}, function (error, data) {
  // Replace the displayed/cache data only when error === null.
});
OpenMeteoProvider.cancel(); // Pagehide/stop: clears timeout and aborts pending XHR.
OpenMeteoProvider.normalize(rawResponse, fetchedAtUnixSeconds); // Pure function.
```

`fetch(config, callback)` also accepts `fetch(callback)`. Protocol values must
include the colon: `http:` or `https:`. Without an explicit setting, HTTPS pages
request HTTPS; other contexts, including the Kindle's about:blank/JavaScript
launcher, request HTTP. This uses the legacy device's already-tested public HTTP
weather path. The single background format validation also used HTTP, returned
200 directly with `Access-Control-Allow-Origin: *`, and **did not verify HTTPS
TLS compatibility**. There is no automatic protocol switch or HTTP retry loop.
The request includes public town coordinates and weather variables only.

Requests fix six forecast days, `timezone=Asia/Shanghai`, `timeformat=unixtime`,
Celsius/mm, `current=temperature_2m,weather_code,precipitation` and
`daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum`.
No model is explicitly selected: the service's default automatic model choice
applies. Simultaneous fetches share a single request. Timeout defaults to 20s;
failure is reported once without a retry. A successful result is kept in memory.
On error the callback receives a fixed error string and, if available, a copy
of that result with `stale:true`; its actual `fetchedAt` and valid times remain
unchanged. A new failure never overwrites the successful memory cache. The
frontend separately retains its valid display and can persist successful data.
Cancel emits one `aborted` callback; the frontend should mark itself stopped
before calling it, so a pagehide callback cannot redraw the closed screen.

Normalized result:

- `schemaVersion:1`, `source:"open-meteo"`, `weatherCodeSystem:"wmo-4677"`.
- `location:{id:"hepo",name:"揭西河婆",latitude,longitude,timezone}`;
  `grid` separately preserves the returned grid/elevation metadata.
- `fetchedAt`: successful network retrieval time in Unix seconds; `stale:false`.
- `current:{time,intervalSeconds,temperature,weatherCode,precipitation}`.
- `daily:[{time,date,temperatureMin,temperatureMax,weatherCode,precipitation}]`;
  `date` is the correct Beijing `YYYY-MM-DD` calendar date.
- `units:{temperature:"C",precipitation:"mm"}`, Open-Meteo attribution and
  explicit aggregation/model semantics.

All times are Unix seconds. Invalid/missing numeric values are `null`, never
zero/dry/clear. WMO code 0 is a valid clear condition. Wrong units, timezone,
malformed axes or unusable current temperatures fail validation and retain the
last good data. Daily WMO conditions use the day's most severe condition; a
drizzle code does not mean every hour of that day will have drizzle. Daily
precipitation includes rain, showers and snow water equivalent.

## Data freshness and terms

Current conditions are **model-derived 15-minute conditions**, not a direct
weather-station observation. In China, the service interpolates hourly data
for this time resolution. The returned `current.time` is the genuine valid
instant, while `current.interval` specifies the backward accumulation window
for current precipitation (900 seconds in the validated response). A six-hour
screen/network schedule does not create six-hourly fresh current conditions
between requests: always retain/display the real valid and retrieval times.
No station accuracy or minute-scale rain-nowcast accuracy is claimed.
See the [official forecast/current documentation](https://open-meteo.com/en/docs).

Under the currently published [Free API terms](https://open-meteo.com/en/terms),
private home automation is non-commercial use; the limits are fewer than 10,000
calls/day, 5,000/hour and 600/minute. The [pricing page](https://open-meteo.com/en/pricing)
also lists a 300,000/month free allowance and confirms no API key is needed for
the public endpoint. A normal single-place six-hour schedule is four requests
per day. This is a rate-limited non-commercial service rather than an announced
one-year credit trial; future availability and terms are not guaranteed.
Data require [CC BY 4.0 attribution](https://open-meteo.com/en/licence). Keep the
visible Open-Meteo source link. No paid account or payment was created.

## Offline checks

```sh
node openmeteo-simple/provider.test.js
```

Ten offline tests cover real-format fields, valid WMO zero, unknown values,
date/unit validation, protocol selection, timeout, pagehide cancellation,
concurrent-request deduplication, 503 retention and invalid-response retention.
No test sends a network request. The attributed immutable public-weather test
input at `fixtures/hepo-20261108.json` makes the checks runnable from a clean
checkout; it is never bundled or shown as current weather. The original single
public validation response and its exact request URL/HTTP headers are under ignored
`runtime/openmeteo-simple-live/api-response.json` and `api-validation.json`;
reuse that snapshot for layout checks instead of making duplicate weather calls.
