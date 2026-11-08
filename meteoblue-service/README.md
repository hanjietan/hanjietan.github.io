# Meteoblue forecast cache for Kindle

Single location: 揭西河婆, WGS84 `23.4394,115.8305`, `Asia/Shanghai`.
Python 3.10+; standard library only. The service requests **only Meteoblue**:

| Family | Requested packages | Maximum HTTP requests per Beijing day |
|---|---|---:|
| Basic | `basic-6h,basic-day` | 4, one in each six-hour slot |
| Clouds | `clouds-6h,clouds-day` | 1 |

Every request asks for seven forecast days, zero history days, JSON and
`timeformat=timestamp_utc`. Basic explicitly requests Celsius, metres/second,
degrees and metric precipitation. No Current, Wind, Nowcast, radar, model-domain
probe or alternative weather provider is called.

The [official package schema](https://my.meteoblue.com/packages/openapi.json)
lists 4,000 credits per family at 6h/day resolution, with the more expensive
resolution charged once when that family's resolutions are combined. This
schedule therefore budgets **20,000/day, 7,300,000 per 365 days**, excluding a
change in actual provider pricing. Each ordinary response's actual
`MB-Credits-Accounted` header is retained. A missing header or ambiguous failed
request reserves the full documented 4,000 credits, never zero. No extra
validation requests are made. **An actual header above 4,000 permanently pauses
further API requests**, including the other package in that same task. State and
public cache record `paused.code:unexpected_provider_tariff` with the actual
charge; subsequent reserve/fetch commands stop with that fixed error. There is
no automatic reset. The price discrepancy must be reviewed before an authorized
maintainer clears the pause; the existing ledger/accounting must remain intact.
Headers at or below 4,000 and missing headers retain the normal behavior.
`reportedCredits` totals known headers;
`conservativeCredits` includes all unconfirmed reservations at the standard fee;
`unknownCreditRequests` includes reservations whose actual charge is unknown,
even if a crashed runner might never have sent the request.

## Output contract

Public file: `kindle-weather/cache/hepo.json`.
Durable state: `meteoblue-service/state/hepo.json` (contains no secret or raw API
response). State includes the full slot ledger, accounting totals and the
allowlisted last successful data for each family. Do not delete or reset state:
that would remove duplicate-request protection and accounting history.

Top-level fields: `schemaVersion:1`, `source:"meteoblue"`, `location`,
`generatedAt`, `intervalSeconds:21600`, `units`, `packages`, `sixHourly`, `daily`,
`attribution`, `accounting`, `semantics`. All times are Unix **seconds**.
Missing, invalid or sentinel values are `null`, never dry weather/zero.

Each of `packages.basic` and `packages.clouds` independently preserves:

- `fetchedAt`: last successful retrieval; never refreshed by a redraw or error.
- `modelrunUtc`: number, array of numbers, or `null`.
- `modelrunUpdateTimeUtc`: number, array of numbers, or `null`.
- `resolutionHours:6`, `accountedCredits` (last successful response header).
- `status`: `ready` when a successful cache exists, otherwise `unavailable`.
- `latestAttempt`: `reservedAt`, `attemptedAt`, `status`, safe `error` code,
  actual `accountedCredits` and estimated/actual `conservativeCredits`.
  Attempt status is `reserved`, `attempted`, `success`, `failed`, `expired` or
  `paused` (no API request sent because an earlier package exceeded the tariff).

`sixHourly` rows join the two families by **exact timestamp**, not by row index:

| Field | Meaning | Unit |
|---|---|---|
| `time` | Labelled interval endpoint | Unix seconds |
| `temperature` | `temperature_instant`, at endpoint | C |
| `relativeHumidity` | `relativehumidity_instant`, at endpoint | % |
| `precipitation` | Preceding six-hour accumulation | mm |
| `totalCloudCover` | Preceding six-hour mean total cloud | % |
| `windSpeed` | Preceding six-hour mean speed | m/s |
| `windDirection` | Preceding six-hour mean direction | degree |

`daily` has local-calendar-day timestamps and `temperatureMin`,
`temperatureMax`, `temperatureMean`, `relativeHumidity`, `precipitation`,
`totalCloudCover`, `windSpeed`, `windDirection`. Temperature and humidity are
forecasts, not live station observations. Wind maximum is not mislabelled as a
gust. Entirely unusable future data or malformed units/axes/fields do not replace
a previous successful package. Partial missing values remain `null`. Old data
retain their own success timestamps, including when the other family succeeds.

## Quota and failure behavior

Production uses two phases:

1. **Reserve** the current Beijing date/slot; atomically save state and commit/push
   it to GitHub **before any weather HTTP request**.
2. **Fetch** each reserved family at most once, marking it attempted before HTTP;
   save its success/failure and publish the merged cache. Commit/push outcomes.

The Actions concurrency group serializes runs. The run ID includes
`github.run_id` and `github.run_attempt`; a rerun has a new ID and cannot reuse a
previously claimed slot. Local processes also use an exclusive file lock.
Do not reuse an old run ID, replay old reservations or call fetch directly from
another scheduler. An expired date/Basic slot is not fetched. A duplicate manual
run gets no additional API request. Missing secret stops **before reservation**.
Corrupt or unexpected state stops rather than starting a fresh budget.

There are **no automatic HTTP retries** after a possibly billable request. Basic
can try again in its next six-hour slot; Clouds on the next Beijing day. This
keeps the strict 4+1 limit through failures. A crash can waste a reserved slot or
leave its actual billing unknown; it cannot deliberately refill that slot.
Only Git push is retried, without repeating an API request. If final publication
fails, the earlier durable reservation still prevents another billable retry.

`METEOBLUE_API_KEY` is read only from the environment. No URL, raw provider body,
key or transport exception text is logged or written. HTTP redirects are refused
so the secret is not forwarded to another URL. Store the key as the repository
Actions secret with that exact name, never in a committed config or HTML.

## Deployment mapping (not performed by these files)

1. Copy `meteoblue-service/` to branch `codex/kindle-weather` unchanged.
2. Add repository Actions secret `METEOBLUE_API_KEY` using GitHub's secret UI or
   authorized tooling. Do not paste the key into a chat, workflow or shell log.
3. Copy `deploy/kindle-meteoblue.yml` to **main** at
   `.github/workflows/kindle-meteoblue.yml`. GitHub schedules must be defined on
   the repository default branch. It checks out `codex/kindle-weather` to execute
   source and read/write state/cache. Uses official `checkout@v4` and
   `setup-python@v5`; repository policy can pin their verified release SHAs.
4. Run once manually after the secret is present. This is the first normal
   Basic/Clouds batch, not an additional test API call. Inspect both actual
   accounted headers and successful package timestamps before switching the
   production Kindle frontend.

Schedule: Beijing `00:17,06:17,12:17,18:17` (`04:17,10:17,16:17,22:17` UTC).
Clouds is requested on the first allowed run each Beijing day. GitHub can delay
or skip scheduled jobs; the cache makes its actual age visible. Public
repositories' schedules can also be disabled after 60 days of inactivity.
See [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

All 7-day weather responses remain subject to the account's Meteoblue licence.
The public cache is a small forecast display feed with Meteoblue attribution,
not an assertion that the provider's data have an open-data licence. Basic and
Clouds are refreshed independently; redraw timing does not change model run or
retrieval time. No documented free HEAD/ETag/metadata update probe is assumed.

## Commands

Offline tests (no secret, network or weather data requests):

```sh
python -m unittest discover -s meteoblue-service/tests -v
```

Production steps, normally run by the workflow with the secret already supplied
as an environment variable:

```sh
python meteoblue-service/service.py reserve --run-id "$RUN_TOKEN"
# Commit and successfully push meteoblue-service/state/hepo.json before fetch.
python meteoblue-service/service.py fetch --run-id "$RUN_TOKEN" --cache-dir kindle-weather/cache
# Commit and push state plus kindle-weather/cache/hepo.json, including failures.
```

CLI output is allowlisted JSON. Exit 0 means success/no eligible request; exit 1
means local precondition failure; exit 2 means a package failed or its reservation
expired. Previous successful packages stay in the cache. A stale local
`.fetch.lock` fails closed; investigate the old process before removing only that
lock. Do not remove or edit the actual ledger to force another request.
