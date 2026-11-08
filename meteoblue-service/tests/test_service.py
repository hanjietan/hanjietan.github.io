"""Offline behavior tests. All weather values and keys are synthetic."""
import copy
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
from contextlib import redirect_stderr, redirect_stdout

SPEC = importlib.util.spec_from_file_location("meteoblue_service", Path(__file__).resolve().parents[1] / "service.py")
s = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(s)
NOW = int(datetime(2026, 11, 9, 0, 17, tzinfo=s.BEIJING).timestamp())
SECRET = "TEST-SECRET-SHOULD-NEVER-APPEAR"


def fixture(family, now=NOW):
    start = (now + 8 * 3600) // 86400 * 86400 - 8 * 3600
    times = [start + i * s.STEP for i in range(29)]
    raw = {"metadata": {"modelrun_utc": [start - 3600, start - 7200],
                         "modelrun_updatetime_utc": start - 600, "apikey": SECRET},
           "units": {"temperature": "C", "relativehumidity": "percent", "precipitation": "mm",
                     "windspeed": "ms-1", "winddirection": "degree", "cloudcover": "percent"},
           "apikey": SECRET, "request_url": "https://example.invalid/?apikey=" + SECRET,
           "data_6h": {"time": times}, "data_day": {"time": times[::4]}}
    for fields, target in ((s.SIX_FIELDS[family], "data_6h"), (s.DAY_FIELDS[family], "data_day")):
        for name, source in fields.items():
            raw[target][source] = [20 if name.startswith("temperature") else 2
                                   for _ in raw[target]["time"]]
    return raw


class FakeClient:
    def __init__(self, outcomes=None):
        self.calls = []
        self.outcomes = outcomes or {}

    def fetch(self, family, key):
        self.calls.append(family)
        result = self.outcomes.get(family, (fixture(family), 4000))
        if isinstance(result, Exception):
            raise result
        return result


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / "state" / "hepo.json"
        self.cache = self.root / "cache" / "hepo.json"

    def tearDown(self):
        self.temp.cleanup()

    def run_slot(self, token, now=NOW, client=None):
        plan = s.reserve(self.state, token, now)
        client = client or FakeClient()
        result = s.fetch_reserved(self.state, self.cache, token, now, SECRET, client)
        return plan, result, client

    def test_four_basic_one_cloud_per_beijing_day_even_manual_duplicates(self):
        calls = []
        for slot in range(4):
            plan, _, client = self.run_slot("slot" + str(slot), NOW + slot * s.STEP)
            self.assertEqual(plan["reserved"], ["basic", "clouds"] if slot == 0 else ["basic"])
            calls.extend(client.calls)
            duplicate, _, client = self.run_slot("manual" + str(slot), NOW + slot * s.STEP + 60)
            self.assertEqual(duplicate["reserved"], [])
            self.assertEqual(client.calls, [])
        self.assertEqual(calls.count("basic"), 4)
        self.assertEqual(calls.count("clouds"), 1)
        state = s.load_state(self.state)
        self.assertEqual(state["accounting"]["reportedCredits"], 20000)
        self.assertEqual(state["accounting"]["unknownCreditRequests"], 0)

    def test_midnight_reopens_budgets_not_utc_midnight(self):
        self.run_slot("first")
        plan, _, _ = self.run_slot("utc-midnight", NOW + 8 * 3600)
        self.assertEqual(plan["reserved"], ["basic"])
        plan, _, _ = self.run_slot("next-local-day", NOW + 86400)
        self.assertEqual(plan["reserved"], ["basic", "clouds"])

    def test_partial_failure_preserves_cloud_success_timestamp_and_values(self):
        self.run_slot("yesterday", NOW - 86400)
        old = json.loads(self.cache.read_text(encoding="utf-8"))
        client = FakeClient({"clouds": s.FetchError("network_or_timeout")})
        _, result, _ = self.run_slot("today", client=client)
        cache = json.loads(self.cache.read_text(encoding="utf-8"))
        self.assertEqual(cache["packages"]["basic"]["fetchedAt"], NOW)
        self.assertEqual(cache["packages"]["clouds"]["fetchedAt"], NOW - 86400)
        self.assertEqual(cache["packages"]["clouds"]["latestAttempt"]["status"], "failed")
        self.assertEqual(cache["packages"]["clouds"]["modelrunUtc"], old["packages"]["clouds"]["modelrunUtc"])
        self.assertEqual(result["accounting"]["unknownCreditRequests"], 1)
        _, _, repeated = self.run_slot("retry-cloud-not-allowed", NOW + 60)
        self.assertEqual(repeated.calls, [])

    def test_unknown_failure_full_cost_reserved_and_known_http_header_recorded(self):
        client = FakeClient({"basic": s.FetchError("network_or_timeout"), "clouds": s.FetchError("http_429", 1234)})
        _, result, _ = self.run_slot("failure", client=client)
        self.assertEqual(result["accounting"], {"reportedCredits": 1234, "conservativeCredits": 5234,
                                                "unknownCreditRequests": 1})
        cache = json.loads(self.cache.read_text(encoding="utf-8"))
        self.assertEqual(cache["sixHourly"], [])
        self.assertEqual(cache["packages"]["basic"]["status"], "unavailable")

    def test_duplicate_run_and_rerun_attempt_cannot_reuse_durable_reservation(self):
        s.reserve(self.state, "run-1", NOW)
        with self.assertRaises(s.ServiceError):
            s.reserve(self.state, "run-1", NOW)
        plan = s.reserve(self.state, "run-2", NOW + 60)
        self.assertEqual(plan["reserved"], [])
        client = FakeClient()
        s.fetch_reserved(self.state, self.cache, "run-2", NOW + 60, SECRET, client)
        self.assertEqual(client.calls, [])
        self.assertEqual(s.load_state(self.state)["accounting"]["conservativeCredits"], 8000)

    def test_fetch_twice_never_reissues_attempted_request(self):
        _, _, client = self.run_slot("same-process")
        s.fetch_reserved(self.state, self.cache, "same-process", NOW + 10, SECRET, client)
        self.assertEqual(client.calls, ["basic", "clouds"])

    def test_delayed_old_claim_cannot_add_fifth_basic_or_second_cloud_to_new_day(self):
        s.reserve(self.state, "old", NOW)
        client = FakeClient()
        result = s.fetch_reserved(self.state, self.cache, "old", NOW + 86400, SECRET, client)
        self.assertEqual(client.calls, [])
        self.assertTrue(all(row["status"] == "expired" for row in result["results"]))

    def test_missing_clouds_are_null_not_zero_and_null_is_not_dry(self):
        raw = fixture("basic")
        raw["data_6h"]["precipitation"][2] = None
        raw["data_6h"]["relativehumidity_instant"][2] = -999
        client = FakeClient({"basic": (raw, 4000), "clouds": s.FetchError("http_500")})
        self.run_slot("partial", client=client)
        cache = json.loads(self.cache.read_text(encoding="utf-8"))
        self.assertIsNone(cache["sixHourly"][2]["precipitation"])
        self.assertIsNone(cache["sixHourly"][2]["relativeHumidity"])
        self.assertTrue(all(row["totalCloudCover"] is None for row in cache["sixHourly"]))

    def test_wrong_units_invalid_axes_or_incomplete_response_retain_previous(self):
        self.run_slot("good", NOW - s.STEP)
        old = s.load_state(self.state)["packages"]["basic"]
        for kind in ("units", "axis", "field"):
            raw = fixture("basic")
            if kind == "units": raw["units"]["temperature"] = "F"
            if kind == "axis": raw["data_6h"]["time"][1] += 3600
            if kind == "field": del raw["data_6h"]["precipitation"]
            # Independent temporary ledger; same known successful previous package.
            state = s.load_state(self.state)
            state["ledger"] = {}
            s.atomic_json(self.state, state)
            self.run_slot("bad-" + kind, client=FakeClient({"basic": (raw, 4000)}))
            self.assertEqual(s.load_state(self.state)["packages"]["basic"], old)

    def test_public_and_persisted_values_allowlist_secret_out(self):
        self.run_slot("secret")
        self.assertNotIn(SECRET, self.state.read_text(encoding="utf-8"))
        text = self.cache.read_text(encoding="utf-8")
        self.assertNotIn(SECRET, text)
        self.assertNotIn("request_url", text)
        cache = json.loads(text)
        self.assertEqual(cache["source"], "meteoblue")
        self.assertEqual(cache["units"], s.UNITS)
        self.assertEqual(cache["packages"]["basic"]["modelrunUtc"], fixture("basic")["metadata"]["modelrun_utc"])

    def test_unexpected_transport_exception_does_not_log_secret_url(self):
        client = FakeClient({"basic": RuntimeError("https://host.invalid/?apikey=" + SECRET)})
        _, result, _ = self.run_slot("bad-library", client=client)
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertEqual(result["results"][0]["error"], "unexpected_fetch_failure")

    def test_missing_key_cli_creates_no_ledger_or_cache(self):
        stderr, stdout = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {}, clear=True), redirect_stderr(stderr), redirect_stdout(stdout):
            code = s.main(["reserve", "--run-id", "no-key", "--state-dir", str(self.state.parent)])
        self.assertEqual(code, 1)
        self.assertFalse(self.state.exists())
        self.assertIn("missing_METEOBLUE_API_KEY", stderr.getvalue())

    def test_lock_and_corrupt_ledger_stop_before_network(self):
        with s.exclusive_lock(self.state.parent):
            with self.assertRaises(s.ServiceError):
                with s.exclusive_lock(self.state.parent): pass
        self.state.write_text("not json", encoding="utf-8")
        client = FakeClient()
        with self.assertRaises(s.ServiceError):
            s.fetch_reserved(self.state, self.cache, "corrupt", NOW, SECRET, client)
        self.assertEqual(client.calls, [])

    def test_credit_header_zero_is_real_when_received_but_example_not_used(self):
        self.assertIsNone(s.credit_header({}))
        self.assertIsNone(s.credit_header({"MB-Credits-Accounted": "unknown"}))
        self.assertEqual(s.credit_header({"MB-Credits-Accounted": "0"}), 0)
        _, result, _ = self.run_slot("actual", client=FakeClient({"basic": (fixture("basic"), 0)}))
        self.assertEqual(result["accounting"]["reportedCredits"], 4000)
        self.assertEqual(result["accounting"]["conservativeCredits"], 4000)
        self.assertIsNone(result["paused"])

    def test_higher_tariff_persists_pause_and_prevents_same_run_and_future_calls(self):
        client = FakeClient({"basic": (fixture("basic"), 5000)})
        _, result, _ = self.run_slot("tariff-changed", client=client)
        self.assertEqual(client.calls, ["basic"])
        self.assertEqual(result["paused"]["code"], "unexpected_provider_tariff")
        self.assertEqual(result["accounting"]["reportedCredits"], 5000)
        self.assertEqual(result["accounting"]["conservativeCredits"], 9000)
        self.assertEqual(result["results"][1]["status"], "paused")
        state = s.load_state(self.state)
        self.assertEqual(state["paused"]["accountedCredits"], 5000)
        self.assertEqual(state["ledger"]["2026-11-09/basic/0"]["accountedCredits"], 5000)
        with self.assertRaisesRegex(s.ServiceError, "^unexpected_provider_tariff$"):
            s.reserve(self.state, "tomorrow", NOW + 86400)
        with self.assertRaisesRegex(s.ServiceError, "^unexpected_provider_tariff$"):
            s.fetch_reserved(self.state, self.cache, "tariff-changed", NOW + 1, SECRET, client)
        self.assertEqual(client.calls, ["basic"])

    def test_high_tariff_on_http_error_also_pauses(self):
        client = FakeClient({"basic": s.FetchError("http_500", 8000)})
        _, result, _ = self.run_slot("expensive-error", client=client)
        self.assertEqual(client.calls, ["basic"])
        self.assertEqual(result["paused"]["code"], "unexpected_provider_tariff")
        self.assertEqual(result["accounting"]["reportedCredits"], 8000)

    def test_all_unknown_future_clouds_does_not_overwrite_valid_cache(self):
        self.run_slot("good-clouds", NOW - 86400)
        old = s.load_state(self.state)["packages"]["clouds"]
        raw = fixture("clouds")
        raw["data_6h"]["totalcloudcover_mean"] = [None] * len(raw["data_6h"]["time"])
        self.run_slot("unknown-clouds", client=FakeClient({"clouds": (raw, 4000)}))
        state = s.load_state(self.state)
        self.assertEqual(state["packages"]["clouds"], old)
        entry = state["ledger"]["2026-11-09/clouds/daily"]
        self.assertEqual(entry["status"], "failed")
        self.assertEqual(entry["error"], "no_usable_future_forecast_values")
        self.assertEqual(entry["accountedCredits"], 4000)

    def test_http_failure_sanitizes_url_and_keeps_actual_accounting_header(self):
        class BadOpener:
            def open(self, req, timeout):
                raise HTTPError(req.full_url, 403, "secret=" + SECRET,
                                {"MB-Credits-Accounted": "5000"}, None)
        client = s.MeteoblueClient()
        client.opener = BadOpener()
        with self.assertRaises(s.FetchError) as caught:
            client.fetch("basic", SECRET)
        self.assertEqual(str(caught.exception), "http_403")
        self.assertEqual(caught.exception.credits, 5000)
        self.assertNotIn(SECRET, str(caught.exception))

    def test_wire_request_uses_only_selected_packages_and_explicit_units(self):
        class Response:
            headers = {"MB-Credits-Accounted": "4000"}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, maximum): return json.dumps(fixture("basic")).encode("utf-8")
        class Opener:
            def open(self, req, timeout):
                self.request = req
                return Response()
        client = s.MeteoblueClient()
        client.opener = Opener()
        _, credits = client.fetch("basic", SECRET)
        url = urlsplit(client.opener.request.full_url)
        params = parse_qs(url.query)
        self.assertEqual(url.hostname, "my.meteoblue.com")
        self.assertEqual(url.path, "/packages/basic-6h,basic-day")
        self.assertEqual(params["timeformat"], ["timestamp_utc"])
        self.assertEqual(params["tz"], ["Asia/Shanghai"])
        self.assertEqual(params["windSpeedUnit"], ["m/s"])
        self.assertEqual(params["precipitationUnit"], ["metric"])
        self.assertEqual(params["forecastDays"], ["7"])
        self.assertNotIn("domain", params)
        self.assertNotIn("raw", params)
        self.assertEqual(credits, 4000)

    def test_clouds_join_by_timestamp_not_array_position(self):
        state = s.load_state(self.state)
        state["packages"]["basic"] = s.normalize(fixture("basic"), "basic", NOW, 4000)
        cloud = fixture("clouds")
        cloud["data_6h"]["time"] = [stamp + s.STEP for stamp in cloud["data_6h"]["time"]]
        state["packages"]["clouds"] = s.normalize(cloud, "clouds", NOW, 4000)
        cache = s.public_cache(state, NOW)
        self.assertIsNone(cache["sixHourly"][0]["totalCloudCover"])
        self.assertEqual(cache["sixHourly"][1]["totalCloudCover"], 2)
        self.assertIsNone(cache["sixHourly"][-1]["temperature"])


if __name__ == "__main__":
    unittest.main()
