# Optional weather-code extension after the frozen display

This is a backward-compatible addition to schemaVersion 1. Files changed:

- `service.py`: optional Basic `pictocode` allowlist as `weatherCode` in
  `sixHourly` and `daily`; valid integer set 1–17/20–25; top-level
  `weatherCodeSystem:"meteoblue-pictocode-1-25"`.
- `tests/test_service.py`: valid, missing, unknown and malformed optional-code
  cases, including already-persisted packages lacking the field.
- `README.md`: contract clarification.
- This separate change note.

Existing field meanings, schemaVersion, package selection, timing, quotas,
tariff pause, retry policy, secret handling and workflow are unchanged. No
provider call, workflow run, secret access, deployment or ledger edit was made
for this extension. Old cache without codes stays usable and displays weather
unavailable; the next naturally scheduled Basic response supplies the new
field. Do not manufacture condition codes from cloud amount or rain amount.

Source: [official Forecast OpenAPI](https://my.meteoblue.com/packages/openapi.json),
Basic `data_6h` / `data_day` → `pictocode.items.x-enumDescriptions`. The Basic
description explicitly assigns six-hour data to the daily code family; hourly
and three-hourly data instead use the different 1–35 family. Codes 18/19 are
absent from the daily enum, and 26–35 must not be interpreted under this family.

| Code | Chinese display based on the official code meaning |
|---:|---|
| 1 | 晴 |
| 2 | 晴间少云 |
| 3 | 多云 |
| 4 | 阴 |
| 5 | 雾 |
| 6 | 阴有雨 |
| 7 | 阵雨 |
| 8 | 阵雨，可能伴雷电 |
| 9 | 阴有雪 |
| 10 | 阵雪 |
| 11 | 雨夹雪 |
| 12 | 阴，间歇有雨 |
| 13 | 阴，间歇有雪 |
| 14 | 多云有雨 |
| 15 | 多云有雪 |
| 16 | 多云，间歇有雨 |
| 17 | 多云，间歇有雪 |
| 20 | 大部多云 |
| 21 | 大部晴，局地可能雷雨 |
| 22 | 多云，局地可能雷雨 |
| 23 | 多云，局地可能有雷阵雨 |
| 24 | 阴有雷雨和较强阵雨 |
| 25 | 大部多云，伴雷阵雨 |

Code 24's English “heavy showers” is not translated into a Chinese statutory
24-hour heavy-rain threshold. Daily descriptions are forecast conditions for the
given day, not reports of current observations. Current six-hour temperatures
are forecast values at the labelled instant: show the nearest valid point with
an explicit forecast hour, not as a station measurement. Daily timestamps in the
first live cache are 06:00 in Asia/Shanghai; select tomorrow/next day by the local
calendar date, not midnight epoch equality.

Offline validation (no API key or network):

```sh
python -m unittest discover -s meteoblue-service/tests -v
```
