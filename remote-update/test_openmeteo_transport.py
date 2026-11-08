"""Offline transport tests against the actual frozen installed-loader source."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("transport", ROOT / "make_openmeteo_transport.py")
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.client = ("<!doctype html><html>" + transport.PACKAGE_MARKER +
                       transport.ACTUAL_SOURCE_MARKER +
                       '<body><canvas id="screen"></canvas><p>揭西河婆 · Open-Meteo</p>'
                       '<!-- NoSleep MIT: Permission is hereby granted -->'
                       '<script>window.actualWeatherSource="open-meteo";</script></body></html>').encode("utf-8")

    def test_real_installed_acceptance_and_lossless_utf8_transition(self):
        wrapped = transport.envelope(self.client)
        with zipfile.ZipFile(ROOT.parent / "runtime/frozen/weather-full-20261108-032139z/weather-full.zip") as z:
            loader = z.read("local/remote-update/meteoblue-loader.js").decode("utf-8")
        scripts = re.findall(r"<script\b[^>]*>(.*?)</script\s*>", wrapped.decode("utf-8"), re.S | re.I)
        self.assertEqual(len(scripts), 1)
        code = r'''
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const p=JSON.parse(fs.readFileSync(0,'utf8')),writes=[],calls=[],timers=[];
const root={atob:s=>Buffer.from(s,'base64').toString('binary'),escape,decodeURIComponent,
KindleRemoteUpdateState:{source:'meteoblue-cache',mode:'remote'},
setTimeout(fn,delay){assert.equal(delay,0);timers.push(fn);},
document:{body:{textContent:''},open(){calls.push('open')},write(s){writes.push(s)},close(){calls.push('close')}}};
vm.runInNewContext(p.loader,root);
assert.equal(root.KindleRemoteLoader.validHTML(p.client),false,'Direct new source must fail the legacy filter');
assert.equal(root.KindleRemoteLoader.validHTML(p.envelope),true,'Transparent envelope must pass the real installed filter');
vm.runInNewContext(p.script,root);
assert.equal(writes.length,0,'Wait for the outer parser to finish before destructive replacement');assert.equal(timers.length,1);timers[0]();
assert.deepEqual(calls,['open','close']);assert.deepEqual(writes,[p.client]);
assert.equal(root.KindleRemoteUpdateState.source,'open-meteo');assert.equal(root.KindleWeatherPackage.actualSource,'open-meteo');
assert.equal(root.KindleWeatherPackage.clientSHA256,p.sha256);assert.ok(!writes[0].includes('transport-loading'));
process.stdout.write('PASS');
'''
        run = subprocess.run(["node", "-e", code], input=json.dumps({"loader": loader,
                             "client": self.client.decode("utf-8"), "envelope": wrapped.decode("utf-8"),
                             "script": scripts[0], "sha256": hashlib.sha256(self.client).hexdigest()}),
                             text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(run.stdout, "PASS")

    def test_inner_source_and_marker_cannot_masquerade_as_the_previous_provider(self):
        for modified in (self.client.replace(transport.ACTUAL_SOURCE_MARKER.encode(), b""),
                         self.client.replace(b"</body>", transport.LEGACY_TRANSPORT_MARKER.encode()+b"</body>"),
                         self.client.replace(b"</body>", b"<p>meteoblue</p></body>")):
            with self.assertRaises(ValueError):
                transport.envelope(modified)

    def test_additional_rain_source_is_declared_without_changing_the_primary(self):
        both = self.client.replace(b"</body>", transport.RAIN_SOURCE_MARKER.encode()+b"</body>")
        self.assertEqual(transport.actual_sources(both), ["open-meteo", "qweather"])
        self.assertEqual(transport.actual_sources(self.client), ["open-meteo"])
        self.assertIn(b"sources.slice(0)", transport.envelope(both))
        with self.assertRaises(ValueError):
            transport.envelope(self.client.replace(b"</body>", b"<p>qweather</p></body>"))

    def test_schema3_qualitative_periods_roundtrip_through_the_installed_transport(self):
        """The transport must preserve derived states without imposing schema2."""
        with zipfile.ZipFile(ROOT.parent / "runtime/frozen/weather-full-20261108-032139z/weather-full.zip") as archive:
            loader = archive.read("local/remote-update/meteoblue-loader.js").decode("utf-8")
        cases = []
        for kind, strength in (("dry", None), ("unknown", None), ("snow", None),
                               ("rain", "light"), ("rain", "moderate"),
                               ("rain", "heavy"), ("rain", "violent")):
            outlook = {"schemaVersion": 3, "source": "qweather", "fetchedAt": 1794112200,
                       "updatedAt": 1794111480, "validUntil": 1794112800,
                       "outlook": {"periods": [{"from": 1794112200, "to": 1794119400,
                                                "kind": kind, "strength": strength}]}}
            addition = (transport.RAIN_SOURCE_MARKER + '<script type="application/json" id="fixture">' +
                        json.dumps(outlook, ensure_ascii=False) + '</script>').encode("utf-8")
            client = self.client.replace(b"</body>", addition + b"</body>")
            wrapped = transport.envelope(client).decode("utf-8")
            script = re.findall(r"<script\b[^>]*>(.*?)</script\s*>", wrapped, re.S | re.I)
            self.assertEqual(len(script), 1)
            cases.append({"client": client.decode("utf-8"), "envelope": wrapped,
                          "script": script[0], "sha256": hashlib.sha256(client).hexdigest()})
        code = r'''
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const p=JSON.parse(fs.readFileSync(0,'utf8'));
for(const c of p.cases){
  const writes=[],timers=[],root={atob:s=>Buffer.from(s,'base64').toString('binary'),escape,decodeURIComponent,
    KindleRemoteUpdateState:{source:'meteoblue-cache',mode:'remote'},setTimeout(fn,delay){assert.equal(delay,0);timers.push(fn);},
    document:{body:{textContent:''},open(){},write(s){writes.push(s)},close(){}}};
  vm.runInNewContext(p.loader,root);assert.equal(root.KindleRemoteLoader.validHTML(c.envelope),true);
  vm.runInNewContext(c.script,root);assert.equal(writes.length,0);assert.equal(timers.length,1);timers[0]();
  assert.deepEqual(writes,[c.client]);assert.equal(root.KindleWeatherPackage.clientSHA256,c.sha256);
  assert.equal(root.KindleRemoteUpdateState.source,'open-meteo');
  assert.equal(JSON.stringify(root.KindleRemoteUpdateState.sources),'["open-meteo","qweather"]');
  assert.equal(JSON.stringify(root.KindleWeatherPackage.actualSources),'["open-meteo","qweather"]');
  const payload=JSON.parse(writes[0].match(/<script type="application\/json" id="fixture">(.*?)<\/script>/s)[1]);
  assert.equal(payload.schemaVersion,3);assert.equal(payload.source,'qweather');
  assert.equal(payload.outlook.periods.length,1);assert.ok(!('raw' in payload));
}
process.stdout.write('PASS');
'''
        run = subprocess.run(["node", "-e", code], input=json.dumps({"loader": loader, "cases": cases}),
                             text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(run.stdout, "PASS")

    def test_secret_or_external_script_is_rejected_before_creating_an_envelope(self):
        for extra in ('<script src="https://example.invalid/a.js"></script>',
                      '<p>https://example.invalid/?apikey=not-a-real-key</p>',
                      '<p>synthetic.region.qweatherapi.com</p>',
                      '<p>eyJhbGciOiJFZERTQSJ9.dGVzdA.c2lnbmF0dXJl</p>'):
            with self.assertRaises(ValueError):
                transport.envelope(self.client.replace(b"</body>", extra.encode()+b"</body>"))


if __name__ == "__main__":
    unittest.main()
