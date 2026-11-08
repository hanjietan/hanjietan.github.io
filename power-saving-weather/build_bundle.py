"""Build only the isolated weather/low-rate-media candidate, never deploy it."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
SCRIPTS = ("keep-awake-media.js", "keep-awake.js", "provider.js", "client.js")


def main():
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    hashes = {"index.html": hashlib.sha256(source.encode()).hexdigest()}
    used = []

    def inline(match):
        name = match.group(1)
        if name not in SCRIPTS:
            raise ValueError("Unexpected script")
        used.append(name)
        code = (ROOT / name).read_text(encoding="utf-8")
        hashes[name] = hashlib.sha256(code.encode()).hexdigest()
        return "<script>\n" + re.sub(r"</script", r"<\\/script", code, flags=re.I) + "\n</script>"

    bundled = re.sub(r'<script src="([^"]+)"></script>', inline, source)
    if tuple(used) != SCRIPTS:
        raise ValueError("Unexpected source order")
    license_text = (ROOT / "LICENSE.nosleep.txt").read_text(encoding="utf-8")
    bundled = bundled.replace("</body>", "<!-- NoSleep technique MIT license\n" + license_text.replace("--", "—") + "\n-->\n</body>", 1)
    for marker in ("<!-- kindle-weather-package:v1 -->", "<!-- kindle-weather-source:open-meteo:v1 -->", "<!-- kindle-weather-candidate:power-saving:v1 -->"):
        if marker not in bundled:
            raise ValueError("Missing source/candidate marker")
    for forbidden in ("qweather", "QWeather", "和风", "rain_cache", "KindleRainHint", "meteoblue.com", "rainviewer.com", "localhost", "127.0.0.1", "apikey=", "Authorization", "Bearer "):
        if forbidden in bundled:
            raise ValueError("Unexpected data-source, credential or local-server dependency")
    payload = bundled.encode("utf-8")
    (ROOT / "bundle.html").write_bytes(payload)
    video = (ROOT / "assets/keep-awake-1fps-60s.mp4").read_bytes()
    report = {"variant": "power-saving-weather-candidate", "source": "open-meteo", "additional_sources": [],
              "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "source_sha256": hashes,
              "minute_rain_requests": False, "automatic_weather_interval_hours": 6,
              "keep_awake": {"method": "legacy-low-rate-video", "video_sha256": hashlib.sha256(video).hexdigest(),
                             "encoded_dimensions": [16, 16], "fps": 1, "duration_seconds": 60,
                             "audio": False, "watchdog_ms": 61000, "per_frame_javascript": False, "manual_seeks": False},
              "credentials_embedded": False, "synthetic_data_embedded": False, "external_script_dependencies": [],
              "requires_kindletest_12minutes": True, "requires_battery_test_hours": "1–2",
              "deep_sleep_verified": False, "month_battery_life_verified": False, "published": False}
    (ROOT / "bundle-manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
