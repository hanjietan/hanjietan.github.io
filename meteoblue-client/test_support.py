"""OFFLINE SYNTHETIC fixtures through the real service; never upload this output."""
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
BASE = int(datetime(2026, 11, 8, tzinfo=timezone.utc).timestamp())


def fixture():
    state = {"packages": {}, "ledger": {}, "accounting": {"reportedCredits": 0}}
    for family in ("basic", "clouds"):
        beginning = BASE if family == "basic" else BASE - 86400
        times = [beginning + i * service.STEP for i in range(29)]
        units = ({"temperature": "C", "relativehumidity": "percent", "precipitation": "mm", "windspeed": "ms-1", "winddirection": "degree"}
                 if family == "basic" else {"cloudcover": "percent"})
        raw = {"units": units, "metadata": {"modelrun_utc": NOW - (21600 if family == "basic" else 108000),
                                             "modelrun_updatetime_utc": [NOW-7200,NOW-3600] if family == "basic" else NOW-90000}, "data_6h": {"time": times},
               "apikey": "SYNTHETIC_SECRET_MUST_NEVER_PASS_ALLOWLIST"}
        for display, source in service.SIX_FIELDS[family].items():
            if display == "temperature": values = [round(23 + 4 * math.sin(i / 2), 1) for i in range(29)]
            elif display == "relativeHumidity": values = [round(65 + 20 * math.cos(i / 3)) for i in range(29)]
            elif display == "windSpeed": values = [round(2 + 1.3 * math.sin(i), 1) for i in range(29)]
            elif display == "windDirection": values = [(i * 45) % 360 for i in range(29)]
            elif display == "precipitation": values = [0, 0.2, 1.5, 3, 0, 0.1, None, 2] * 4
            else: values = [None if i == 7 else round(55 + 35 * math.sin(i / 2)) for i in range(29)]
            raw["data_6h"][source] = values[:29]
        fetched = NOW - (600 if family == "basic" else 86400)
        state["packages"][family] = service.normalize(raw, family, fetched, 4000)
    full = service.public_cache(state, NOW)
    partial = service.public_cache({**state, "packages": {"basic": state["packages"]["basic"]}}, NOW)
    empty = service.public_cache({**state, "packages": {}}, NOW)
    assert "SYNTHETIC_SECRET" not in json.dumps(full)
    return {"synthetic_test_only": True, "now": NOW, "full": full, "partial": partial, "empty": empty}


if __name__ == "__main__":
    print(json.dumps(fixture(), ensure_ascii=True, allow_nan=False))
