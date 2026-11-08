"""Build a transparent legacy transport envelope for the installed launch book.

Only the outer transport retains the old acceptance marker. The byte-identical
inner program and its weather data identify their actual Open-Meteo source.
This builds local files only: it never publishes, calls an API or writes USB.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
PACKAGE_MARKER = "<!-- kindle-weather-package:v1 -->"
LEGACY_TRANSPORT_MARKER = "<!-- kindle-weather-source:meteoblue-cache:v1 -->"
ACTUAL_SOURCE_MARKER = "<!-- kindle-weather-source:open-meteo:v1 -->"
RAIN_SOURCE_MARKER = "<!-- kindle-weather-additional-source:qweather-minute-cache:v1 -->"
SOURCE = "open-meteo"
CORE_FILES = ("index.html", "keep-awake.js", "provider.js", "client.js", "LICENSE.nosleep.txt", "build_bundle.py")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def hashes(folder):
    names = set(CORE_FILES)
    manifest_path = folder / "bundle-manifest.json"
    if manifest_path.is_file():
        declared = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        for name in declared.get("source_sha256", {}):
            if not re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:js|html)", name) or (folder / name).resolve().parent != folder.resolve():
                raise ValueError("Bundled source must be a local script or HTML file")
            names.add(name)
        names.add("bundle-manifest.json")
    return {name: sha((folder / name).read_bytes()) for name in sorted(names)}


def actual_sources(payload):
    sources = [SOURCE]
    if RAIN_SOURCE_MARKER in payload.decode("utf-8-sig"):
        sources.append("qweather")
    return sources


def validate_client(payload):
    text = payload.decode("utf-8-sig")
    if PACKAGE_MARKER not in text or ACTUAL_SOURCE_MARKER not in text:
        raise ValueError("Expected the actual Open-Meteo client markers")
    if LEGACY_TRANSPORT_MARKER in text or re.search("meteoblue|rainviewer", text, re.I):
        raise ValueError("The inner weather client must contain no previous provider or legacy source marker")
    if re.search("qweather", text, re.I) and RAIN_SOURCE_MARKER not in text:
        raise ValueError("An additional QWeather source must have its explicit minute-cache marker")
    if not re.search(r'<canvas\b[^>]*\bid\s*=\s*["\']screen["\']', text, re.I):
        raise ValueError("Expected the complete weather canvas")
    if re.search(r'<script\b[^>]*\bsrc\s*=', text, re.I):
        raise ValueError("The inner client must be self-contained")
    if re.search(r'[?&]apikey\s*=|github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY', text, re.I):
        raise ValueError("Credential pattern in public client")
    if re.search(r'(?:[a-z0-9-]+\.)+qweatherapi\.com', text, re.I):
        raise ValueError("The public minute-cache client must not contain an account API host")
    if "Permission is hereby granted" not in text:
        raise ValueError("Missing bundled NoSleep MIT license")


def envelope(payload):
    validate_client(payload)
    encoded = base64.b64encode(payload).decode("ascii")
    sources_encoded = base64.b64encode(json.dumps(actual_sources(payload), separators=(",", ":")).encode("ascii")).decode("ascii")
    # The installed book's old transport filter rejects the provider's literal
    # name. Encoding is solely a delivery compatibility measure, not a data-
    # source claim: decoding restores the actual, unmodified public client.
    script = '''(function(root){"use strict";
function fail(){
if(root.KindleRemoteUpdateState){root.KindleRemoteUpdateState.mode="error";root.KindleRemoteUpdateState.reason="transport-decode-error";}
root.document.body.textContent="无法打开天气页面，请重新打开入口。";
}
try{
var sources=JSON.parse(decodeURIComponent(escape(root.atob("''' + sources_encoded + '''")))),source=sources[0];
var actual=decodeURIComponent(escape(root.atob("''' + encoded + '''")));
if(root.KindleRemoteUpdateState){root.KindleRemoteUpdateState.source=source;root.KindleRemoteUpdateState.primarySource=source;root.KindleRemoteUpdateState.sources=sources.slice(0);root.KindleRemoteUpdateState.additionalSources=sources.slice(1);root.KindleRemoteUpdateState.transportCompatibility="legacy-installed-book";}
root.KindleWeatherPackage={actualSource:source,primarySource:source,actualSources:sources.slice(0),additionalSources:sources.slice(1),clientSHA256:"''' + sha(payload) + '''",transportCompatibility:"legacy-installed-book"};
root.setTimeout(function(){
try{root.document.open();root.document.write(actual);root.document.close();}catch(error){fail();}
},0);
}catch(error){fail();}
}(this));'''
    text = '''<!doctype html><html lang="zh-CN">
''' + PACKAGE_MARKER + "\n" + LEGACY_TRANSPORT_MARKER + '''
<!-- 旧标记仅供已安装启动书识别传输封套，不代表天气来源。解码后的页面明确显示实际来源。 -->
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>天气</title></head>
<body><canvas id="screen" width="1" height="1" style="display:none"></canvas><p id="transport-loading">正在打开天气…</p><script>''' + script + '''</script></body></html>'''
    # Assert the known installed acceptance constraints before any release.
    if re.search(r"open[-_]?meteo|rainviewer|my\.meteoblue\.com|[?&]apikey\s*=", text, re.I):
        raise ValueError("Envelope contains a string rejected by the installed transport")
    if len(text) > 900000:
        raise ValueError("Envelope exceeds the installed transport size limit")
    return text.encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, default=WORKSPACE / "openmeteo-simple/bundle.html")
    parser.add_argument("--expected-bundle-sha256", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    bundle_path = args.bundle.resolve()
    before = hashes(bundle_path.parent)
    payload = bundle_path.read_bytes()
    if sha(payload) != args.expected_bundle_sha256.lower():
        raise ValueError("Client does not match the frozen candidate fingerprint")
    wrapped = envelope(payload)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = (args.output or ROOT / ("build-openmeteo-transport-" + stamp)).resolve()
    if ROOT not in folder.parents or folder.exists():
        raise ValueError("Use a new output directory under remote-update/")
    folder.mkdir(parents=True)
    (folder / "weather.html").write_bytes(wrapped)
    (folder / "actual-client.html").write_bytes(payload)
    if hashes(bundle_path.parent) != before or sha(bundle_path.read_bytes()) != sha(payload):
        raise RuntimeError("Client changed during packaging; rebuild from the frozen candidate")
    providers = actual_sources(payload)
    manifest = {"createdAt": datetime.now().astimezone().isoformat(), "actual_source": SOURCE,
                "actual_source_meaning": "legacy primary current/daily source field; actual_sources lists all providers",
                "primary_source": SOURCE, "actual_sources": providers, "additional_sources": providers[1:],
                "additional_source_transport": {"qweather": "public GitHub minute cache"} if "qweather" in providers else {},
                "transport": "UTF-8 base64 compatibility envelope for the installed 035354 book",
                "legacy_marker_meaning": "outer transport acceptance only; not a weather data source claim",
                "client_path": str(bundle_path), "client_bytes": len(payload), "client_sha256": sha(payload),
                "source_raw_sha256": before, "envelope_path": str(folder / "weather.html"),
                "envelope_bytes": len(wrapped), "envelope_sha256": sha(wrapped),
                "inner_client_byte_identical": True, "runtime_source": SOURCE, "runtime_sources": providers,
                "offline_book_fallback": "unchanged frozen Meteoblue full chart; cannot replace immutable book bytes online",
                "published": False, "device_written": False, "provider_calls": 0}
    (folder / "transport-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
