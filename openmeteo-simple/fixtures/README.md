# Offline public-weather fixture

`hepo-20261108.json` is the unmodified public Open-Meteo Forecast API response
retrieved on **2026-11-08 at 04:10:12 UTC**, for WGS84 23.4394 N, 115.8305 E
(揭西河婆), timezone Asia/Shanghai. It contains no key or personal/device data.

Source: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Request: `http://api.open-meteo.com/v1/forecast?latitude=23.4394&longitude=115.8305&current=temperature_2m%2Cweather_code%2Cprecipitation&daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_sum&timezone=Asia%2FShanghai&forecast_days=6&timeformat=unixtime&temperature_unit=celsius&precipitation_unit=mm`

This is a historical offline test fixture, **not current weather**. Tests freeze
their clock and may create clearly labelled synthetic variants from it. The
production bundle inlines only HTML and JavaScript, never this file or its data.

`hepo-rain.synthetic.json` is **entirely synthetic rain**, generated through the
real backend allowlist and pure hint analyzer. It tests the schema2
public-envelope contract (GCJ02 location, original issue/receipt/expiry times
and a derived alert only; no raw array, summary or amounts). It is not QWeather live data, must never be deployed to
the public `cache/hepo-rain.json` endpoint, and is not included in the bundle.
