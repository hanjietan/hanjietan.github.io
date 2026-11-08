"""Quota-bounded Meteoblue fetcher. Standard library only; no client-side key.

Production protocol: reserve -> durably commit ledger -> fetch -> commit results.
Never retry an ambiguous HTTP request: it might already have consumed credits.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

SCHEMA = 1
STEP = 21600
EXPECTED_CREDITS = 4000
BEIJING = timezone(timedelta(hours=8))
LOCATION = {"id": "hepo", "name": "揭西河婆", "latitude": 23.4394,
            "longitude": 115.8305, "timezone": "Asia/Shanghai"}
PACKAGES = {"basic": "basic-6h,basic-day", "clouds": "clouds-6h,clouds-day"}
UNITS = {"temperature": "C", "relativeHumidity": "%", "totalCloudCover": "%",
         "windSpeed": "m/s", "windDirection": "degree", "precipitation": "mm"}
SIX_FIELDS = {
    "basic": {"temperature": "temperature_instant", "relativeHumidity": "relativehumidity_instant",
              "windSpeed": "windspeed_mean", "windDirection": "winddirection_mean",
              "precipitation": "precipitation"},
    "clouds": {"totalCloudCover": "totalcloudcover_mean"},
}
DAY_FIELDS = {
    "basic": {"temperatureMin": "temperature_min", "temperatureMax": "temperature_max",
              "temperatureMean": "temperature_mean", "relativeHumidity": "relativehumidity_mean",
              "windSpeed": "windspeed_mean", "windDirection": "winddirection",
              "precipitation": "precipitation"},
    "clouds": {"totalCloudCover": "totalcloudcover_mean"},
}


class ServiceError(Exception):
    """Messages are fixed safe codes, never raw transport exceptions or URLs."""


class FetchError(ServiceError):
    def __init__(self, code, credits=None):
        super().__init__(code)
        self.credits = credits


def epoch(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ServiceError("invalid_timestamp_seconds")
    if value < 946684800 or value > 4102444800 or int(value) != value:
        raise ServiceError("invalid_timestamp_seconds")
    return int(value)


def number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if field in ("relativeHumidity", "totalCloudCover") and not 0 <= value <= 100:
        return None
    if field in ("windSpeed", "precipitation") and value < 0:
        return None
    if field == "windDirection" and not 0 <= value <= 360:
        return None
    if field.startswith("temperature") and not -100 <= value <= 70:
        return None
    return value


def model_time(value):
    if value is None:
        return None
    try:
        return [epoch(item) for item in value] if isinstance(value, list) else epoch(value)
    except ServiceError:
        return None  # Unknown metadata never becomes a fabricated time.


def credit_header(headers):
    if headers is None:
        return None
    value = headers.get("MB-Credits-Accounted")
    if value is None or not re.fullmatch(r"\d+", value.strip()):
        return None
    return int(value)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the secret to a different URL/host.


class MeteoblueClient:
    def __init__(self):
        self.opener = build_opener(NoRedirect())

    def fetch(self, family, key):
        if family not in PACKAGES:
            raise ServiceError("unsupported_package")
        params = {"lat": LOCATION["latitude"], "lon": LOCATION["longitude"],
                  "apikey": key, "tz": LOCATION["timezone"], "timeformat": "timestamp_utc",
                  "format": "json", "forecastDays": 7, "historyDays": 0}
        if family == "basic":
            params.update(temperatureUnit="C", windSpeedUnit="m/s",
                          windDirectionUnit="degree", precipitationUnit="metric")
        url = "https://my.meteoblue.com/packages/" + PACKAGES[family] + "?" + urlencode(params)
        req = Request(url, headers={"Accept": "application/json",
                                     "User-Agent": "KindleWeather-Meteoblue/1"})
        credits = None
        try:
            with self.opener.open(req, timeout=35) as response:
                credits = credit_header(response.headers)
                content = response.read(2_000_001)
                if len(content) > 2_000_000:
                    raise FetchError("response_too_large", credits)
                try:
                    raw = json.loads(content)
                except (ValueError, UnicodeError):
                    raise FetchError("invalid_json", credits) from None
                if not isinstance(raw, dict):
                    raise FetchError("invalid_response_object", credits)
                return raw, credits
        except HTTPError as exc:
            raise FetchError("http_" + str(exc.code), credit_header(exc.headers)) from None
        except (URLError, TimeoutError, OSError):
            raise FetchError("network_or_timeout", credits) from None


def rows(data, fields, interval, required):
    if data is None and not required:
        return []
    if not isinstance(data, dict) or not isinstance(data.get("time"), list) or not data["time"]:
        raise ServiceError("missing_forecast_axis")
    stamps = [epoch(value) for value in data["time"]]
    if any(b - a != interval for a, b in zip(stamps, stamps[1:])):
        raise ServiceError("unordered_or_wrong_interval_axis")
    for field in fields.values():
        if not isinstance(data.get(field), list) or len(data[field]) != len(stamps):
            raise ServiceError("missing_or_incomplete_forecast_field")
    return [{"time": stamp, **{name: number(data[field][i], name)
                              for name, field in fields.items()}} for i, stamp in enumerate(stamps)]


def normalize(raw, family, fetched_at, credits):
    units = raw.get("units", {})
    expected = ({"temperature": {"C"}, "relativehumidity": {"percent", "%"},
                 "precipitation": {"mm"}, "windspeed": {"ms-1", "m/s"},
                 "winddirection": {"degree"}} if family == "basic"
                else {"cloudcover": {"percent", "%"}})
    if not isinstance(units, dict) or any(units.get(k) not in accepted for k, accepted in expected.items()):
        raise ServiceError("unexpected_forecast_units")
    samples = rows(raw.get("data_6h"), SIX_FIELDS[family], STEP, True)
    if samples[-1]["time"] <= fetched_at:
        raise ServiceError("forecast_horizon_exhausted")
    future = [row for row in samples if row["time"] > fetched_at]
    if any(not any(row[name] is not None for row in future) for name in SIX_FIELDS[family]):
        raise ServiceError("no_usable_future_forecast_values")
    daily = rows(raw.get("data_day"), DAY_FIELDS[family], 86400, False)
    metadata = raw.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}
    return {"fetchedAt": epoch(fetched_at), "modelrunUtc": model_time(metadata.get("modelrun_utc")),
            "modelrunUpdateTimeUtc": model_time(metadata.get("modelrun_updatetime_utc")),
            "resolutionHours": 6, "accountedCredits": credits,
            "sixHourly": samples, "daily": daily}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


@contextmanager
def exclusive_lock(state_dir):
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = state_dir / ".fetch.lock"
    try:
        handle = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ServiceError("another_process_or_stale_lock") from None
    try:
        os.write(handle, str(os.getpid()).encode("ascii"))
        os.close(handle)
        yield
    finally:
        lock.unlink(missing_ok=True)


def load_state(state_path):
    if not state_path.exists():
        return {"schemaVersion": SCHEMA, "location": LOCATION, "ledger": {}, "packages": {},
                "accounting": {"reportedCredits": 0, "conservativeCredits": 0,
                               "unknownCreditRequests": 0}}
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ServiceError("unreadable_ledger_stop_without_fetch") from None
    if (state.get("schemaVersion") != SCHEMA or state.get("location") != LOCATION
            or not isinstance(state.get("ledger"), dict) or not isinstance(state.get("packages"), dict)
            or not isinstance(state.get("accounting"), dict)):
        raise ServiceError("unexpected_ledger_stop_without_fetch")
    return state


def reserve(state_path, run_id, now):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", run_id):
        raise ServiceError("invalid_run_identifier")
    state = load_state(state_path)
    if state.get("paused"):
        raise ServiceError("unexpected_provider_tariff")
    if any(entry.get("runId") == run_id for entry in state["ledger"].values()):
        raise ServiceError("run_identifier_already_used")
    local = datetime.fromtimestamp(now, BEIJING)
    day, slot = local.date().isoformat(), local.hour // 6
    reserved = []
    for family, suffix in (("basic", str(slot)), ("clouds", "daily")):
        token = day + "/" + family + "/" + suffix
        if token not in state["ledger"]:
            state["ledger"][token] = {"runId": run_id, "family": family, "reservedAt": now,
                                       "attemptedAt": None, "status": "reserved",
                                       "accountedCredits": None, "conservativeCredits": EXPECTED_CREDITS}
            reserved.append(family)
            # Reserve full standard cost before HTTP. A runner can die after a
            # billable request but before committing its outcome to GitHub.
            state["accounting"]["conservativeCredits"] += EXPECTED_CREDITS
            state["accounting"]["unknownCreditRequests"] += 1
    # Keep all ledger entries: no forgotten slot/run token and auditable full-year history.
    atomic_json(state_path, state)
    return {"runId": run_id, "beijingDay": day, "basicSlot": slot, "reserved": reserved}


def merged_rows(packages, key, fields):
    by_time = {}
    names = sorted({name for family in fields.values() for name in family})
    for family in PACKAGES:
        for row in packages.get(family, {}).get(key, []):
            stamp = row["time"]
            target = by_time.setdefault(stamp, {"time": stamp, **dict.fromkeys(names)})
            target.update({name: row.get(name) for name in fields[family]})
    return [by_time[stamp] for stamp in sorted(by_time)]


def public_cache(state, generated_at):
    packages = {}
    for family in PACKAGES:
        package = state["packages"].get(family, {})
        attempts = [entry for entry in state["ledger"].values() if entry["family"] == family]
        latest = max(attempts, key=lambda row: row["reservedAt"], default=None)
        packages[family] = {name: package.get(name) for name in
                            ("fetchedAt", "modelrunUtc", "modelrunUpdateTimeUtc", "accountedCredits")}
        packages[family].update(resolutionHours=6, status="ready" if package else "unavailable")
        if latest:
            packages[family]["latestAttempt"] = {key: latest.get(key) for key in
                                                  ("reservedAt", "attemptedAt", "status", "error",
                                                   "accountedCredits", "conservativeCredits")}
    return {"schemaVersion": SCHEMA, "source": "meteoblue", "location": LOCATION,
            "generatedAt": generated_at, "intervalSeconds": STEP, "units": UNITS,
            "attribution": {"name": "meteoblue", "url": "https://www.meteoblue.com/"},
            "packages": packages, "sixHourly": merged_rows(state["packages"], "sixHourly", SIX_FIELDS),
            "daily": merged_rows(state["packages"], "daily", DAY_FIELDS),
            "accounting": state["accounting"], "paused": state.get("paused"),
            "semantics": {"temperature": "instant_at_interval_end", "relativeHumidity": "instant_at_interval_end",
                          "precipitation": "preceding_6h_sum", "windSpeed": "preceding_6h_mean",
                          "windDirection": "preceding_6h_mean", "totalCloudCover": "preceding_6h_mean",
                          "daily": "local_calendar_day; precipitation=sum, clouds/wind/humidity=mean",
                          "freshness": "Package fetchedAt is last successful retrieval, not display redraw time.",
                          "version": "Modelrun timestamps do not guarantee detection of all short-range revisions."}}


def fetch_reserved(state_path, cache_path, run_id, now, key, client):
    if not key or not key.strip():
        raise ServiceError("missing_METEOBLUE_API_KEY")
    state = load_state(state_path)
    if state.get("paused"):
        raise ServiceError("unexpected_provider_tariff")
    selected = [entry for entry in state["ledger"].values()
                if entry["runId"] == run_id and entry["status"] == "reserved"]
    results = []
    for entry in selected:
        family = entry["family"]
        if state.get("paused"):
            entry.update(status="paused", error="unexpected_provider_tariff")
            atomic_json(state_path, state)
            atomic_json(cache_path, public_cache(state, now))
            results.append({"family": family, "status": "paused", "error": "unexpected_provider_tariff"})
            continue
        reserved_local = datetime.fromtimestamp(entry["reservedAt"], BEIJING)
        current_local = datetime.fromtimestamp(now, BEIJING)
        if (reserved_local.date() != current_local.date() or
                (family == "basic" and reserved_local.hour // 6 != current_local.hour // 6)):
            entry.update(status="expired", error="reservation_window_elapsed")
            atomic_json(state_path, state)
            results.append({"family": family, "status": "expired", "error": "reservation_window_elapsed"})
            continue
        # Persist before making the one possibly billable HTTP request.
        entry.update(status="attempted", attemptedAt=now)
        atomic_json(state_path, state)
        credits = None
        try:
            raw, credits = client.fetch(family, key)
            package = normalize(raw, family, now, credits)
            state["packages"][family] = package
            entry.update(status="success")
        except FetchError as exc:
            credits = exc.credits
            entry.update(status="failed", error=str(exc))
        except ServiceError as exc:
            entry.update(status="failed", error=str(exc))
        except Exception:
            # Never expose unknown exception text: libraries may include the secret URL.
            entry.update(status="failed", error="unexpected_fetch_failure")
        entry["accountedCredits"] = credits
        if credits is not None:
            entry["conservativeCredits"] = credits
            state["accounting"]["reportedCredits"] += credits
            state["accounting"]["conservativeCredits"] += credits - EXPECTED_CREDITS
            state["accounting"]["unknownCreditRequests"] -= 1
            if credits > EXPECTED_CREDITS:
                state["paused"] = {"code": "unexpected_provider_tariff", "detectedAt": now,
                                   "family": family, "accountedCredits": credits,
                                   "expectedCredits": EXPECTED_CREDITS}
        atomic_json(state_path, state)
        atomic_json(cache_path, public_cache(state, now))
        results.append({"family": family, "status": entry["status"], "accountedCredits": credits,
                        "conservativeCredits": entry["conservativeCredits"], "error": entry.get("error")})
    return {"runId": run_id, "results": results, "accounting": state["accounting"],
            "paused": state.get("paused")}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("reserve", "fetch"))
    parser.add_argument("--run-id", required=True, help="Unique per invocation; GitHub run_id-run_attempt")
    parser.add_argument("--state-dir", type=Path, default=Path(__file__).resolve().parent / "state")
    parser.add_argument("--cache-dir", type=Path, default=Path("kindle-weather/cache"))
    args = parser.parse_args(argv)
    now = int(time.time())
    try:
        if not os.environ.get("METEOBLUE_API_KEY", "").strip():
            raise ServiceError("missing_METEOBLUE_API_KEY")
        with exclusive_lock(args.state_dir):
            if args.operation == "reserve":
                result = reserve(args.state_dir / "hepo.json", args.run_id, now)
            else:
                result = fetch_reserved(args.state_dir / "hepo.json", args.cache_dir / "hepo.json",
                                        args.run_id, now, os.environ.get("METEOBLUE_API_KEY"), MeteoblueClient())
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 2 if (result.get("paused") or any(row["status"] != "success"
                                                for row in result.get("results", []))) else 0
    except ServiceError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    except Exception:
        print('{"error":"unexpected_local_failure"}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
