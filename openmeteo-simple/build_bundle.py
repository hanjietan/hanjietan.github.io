"""Create the credential-free self-contained Open-Meteo simple client, locally."""
from pathlib import Path
import base64
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
SCRIPTS = ("keep-awake.js", "rain_cache.js", "provider.js", "client.js")


def main():
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    hashes = {"index.html": hashlib.sha256(source.encode()).hexdigest()}
    used = []

    def inline(match):
        name = match.group(1)
        if name not in SCRIPTS:
            raise ValueError("Unexpected local script")
        used.append(name)
        code = (ROOT / name).read_text(encoding="utf-8")
        hashes[name] = hashlib.sha256(code.encode()).hexdigest()
        return "<script>\n" + re.sub(r"</script", r"<\\/script", code, flags=re.I) + "\n</script>"

    bundled = re.sub(r'<script src="([^"]+)"></script>', inline, source)
    if tuple(used) != SCRIPTS:
        raise ValueError("Unexpected source order")
    license_text = (ROOT / "LICENSE.nosleep.txt").read_text(encoding="utf-8")
    bundled = bundled.replace("</body>", "<!-- NoSleep.js MIT license\n" + license_text.replace("--", "—") + "\n-->\n</body>", 1)
    for marker in ("<!-- kindle-weather-package:v1 -->", "<!-- kindle-weather-source:open-meteo:v1 -->", "<!-- kindle-weather-additional-source:qweather-minute-cache:v1 -->"):
        if marker not in bundled:
            raise ValueError("Missing loader marker")
    for forbidden in ("meteoblue.com", "rainviewer.com", "localhost", "127.0.0.1", "192.168.", "apikey=", "Authorization", "qweatherapi.com", "/v7/minutely", "QWeatherPrivateConfig", "BEGIN PRIVATE KEY", "Bearer "):
        if forbidden in bundled:
            raise ValueError("Unexpected provider/credential/server dependency")
    if "KindleRainHint" in bundled:
        raise ValueError("Raw precipitation analyzer must remain server-only")
    payload = bundled.encode("utf-8")
    (ROOT / "bundle.html").write_bytes(payload)
    report = {"bytes": len(payload), "base64_bytes": len(base64.b64encode(payload)),
              "sha256": hashlib.sha256(payload).hexdigest(), "source_sha256": hashes,
              "source": "open-meteo", "additional_sources": ["qweather"],
              "runtime_transport": "direct public Open-Meteo Forecast API + public GitHub short-term cache",
              "source_transports": {"open-meteo": "direct public API", "qweather": "public GitHub cache only"},
              "qweather_cache_schema": 2, "qweather_public_data": "derived alert only",
              "direct_provider_calls": True, "credentials_embedded": False,
              "fallback_provider": None, "external_script_dependencies": [],
              "synthetic_data_embedded": False}
    (ROOT / "bundle-manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
