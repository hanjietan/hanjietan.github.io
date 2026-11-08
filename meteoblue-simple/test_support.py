"""Synthetic OFFLINE weather through the real service; never publish fixtures."""
from datetime import datetime, timezone
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("meteoblue_service", ROOT.parent / "meteoblue-service/service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
NOW = int(datetime(2026, 11, 8, 2, 30, tzinfo=timezone.utc).timestamp())
BASE = int(datetime(2026, 11, 7, 16, tzinfo=timezone.utc).timestamp())  # CST midnight


def fixture():
    state = {"packages": {}, "ledger": {}, "accounting": {"reportedCredits": 0}}
    for family in ("basic", "clouds"):
        times = [BASE + i * service.STEP for i in range(29)]
        units = ({"temperature": "C", "relativehumidity": "percent", "precipitation": "mm", "windspeed": "ms-1", "winddirection": "degree"}
                 if family == "basic" else {"cloudcover": "percent"})
        raw = {"units": units, "metadata": {"modelrun_utc": NOW-21600,
                "modelrun_updatetime_utc": [NOW-7200, NOW-3600]},
               "data_6h": {"time": times}, "data_day": {"time": [BASE+21600+i*86400 for i in range(7)]},
               "apikey": "SYNTHETIC_SECRET_MUST_NEVER_PASS_ALLOWLIST"}
        for display, source in service.SIX_FIELDS[family].items():
            if display == "temperature": values = [round(23+4*math.sin(i/2), 1) for i in range(29)]
            elif display == "relativeHumidity": values = [65]*29
            elif display == "windSpeed": values = [2]*29
            elif display == "windDirection": values = [90]*29
            elif display == "precipitation": values = [0]*29
            elif display == "weatherCode": values = [1]*29
            else: values = [30]*29
            raw["data_6h"][source] = values
        for display, source in service.DAY_FIELDS[family].items():
            values = {"temperatureMin": [20,13,10,11,15,17,18],
                      "temperatureMax": [29,23,20,24,26,27,28],
                      "temperatureMean": [24,19,15,17,20,22,23],
                      "weatherCode": [3,1,6,22,4,2,3],
                      "precipitation": [0,0,8.2,1,0,0,0],
                      "relativeHumidity": [65]*7, "windSpeed": [2]*7,
                      "windDirection": [90]*7, "totalCloudCover": [40]*7}[display]
            raw["data_day"][source] = values
        state["packages"][family] = service.normalize(raw, family, NOW-600, 4000)
    full = service.public_cache(state, NOW)
    legacy = json.loads(json.dumps(full))
    legacy.pop("weatherCodeSystem", None)
    for row in legacy["sixHourly"]+legacy["daily"]:
        row.pop("weatherCode", None)
    partial = json.loads(json.dumps(full))
    partial["sixHourly"][2]["temperature"] = None
    partial["daily"][1]["temperatureMin"] = None
    partial["daily"][2]["precipitation"] = None
    partial["daily"][2]["weatherCode"] = None
    empty = service.public_cache({**state, "packages": {}}, NOW)
    assert "SYNTHETIC_SECRET" not in json.dumps(full)
    return {"synthetic_test_only": True, "now": NOW, "full": full, "legacy": legacy, "partial": partial, "empty": empty}


if __name__ == "__main__":
    print(json.dumps(fixture(), ensure_ascii=True, allow_nan=False))
