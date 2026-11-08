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

    def test_secret_or_external_script_is_rejected_before_creating_an_envelope(self):
        for extra in ('<script src="https://example.invalid/a.js"></script>',
                      '<p>https://example.invalid/?apikey=not-a-real-key</p>'):
            with self.assertRaises(ValueError):
                transport.envelope(self.client.replace(b"</body>", extra.encode()+b"</body>"))


if __name__ == "__main__":
    unittest.main()
