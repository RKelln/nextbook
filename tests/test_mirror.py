import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import serve


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'app').mkdir()
        (self.root / 'app/index.html').write_text('<html><head></head><body></body></html>')
        self.servers = []

    def tearDown(self):
        for server, thread in self.servers:
            server.shutdown(); server.server_close(); thread.join()
        self.tmp.cleanup()

    def server(self, enabled):
        server = serve.make_server(self.root / 'app', port=0, mirror=enabled, verbose=False, reload=False)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start(); self.servers.append((server, thread))
        return server

    def request(self, server, method, route, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', server.server_port)
        conn.request(method, route, body, headers or {})
        res = conn.getresponse(); status, data = res.status, res.read()
        conn.close(); return status, data

    def test_off_and_guarded_write(self):
        server = self.server(False)
        self.assertNotIn(b'AI sharing', self.request(server, 'GET', '/')[1])
        self.assertEqual(404, self.request(server, 'POST', '/__shelf', '{}')[0])
        server = self.server(True)
        token = server.RequestHandlerClass.func.mirror_token
        host = '127.0.0.1:%d' % server.server_port
        headers = {'Origin': 'http://' + host, 'X-Nextbook-Token': token}
        body = json.dumps({'schema': 'nextbook/shelf-1', 'which': 'practice', 'entries': [
            {'key': 'w:piranesi', 'title': 'Piranesi', 'state': 'read'}]})
        self.assertIn(b'AI sharing', self.request(server, 'GET', '/')[1])
        self.assertEqual(403, self.request(server, 'GET', '/', headers={'Host': 'other.example'})[0])
        for bad in [{}, dict(headers, Origin='https://other.example'),
                    dict(headers, Host='other.example'), dict(headers, **{'X-Nextbook-Token':'wrong'})]:
            self.assertEqual(403, self.request(server, 'POST', '/__shelf', body, bad)[0])
        self.assertFalse((self.root / serve.MIRROR_FILE).exists())
        self.assertEqual(400, self.request(server, 'POST', '/__shelf', '{}', headers)[0])
        self.assertEqual(204, self.request(server, 'POST', '/__shelf', body, headers)[0])
        path = self.root / serve.MIRROR_FILE
        self.assertEqual('Piranesi', json.loads(path.read_text())['entries'][0]['title'])
        self.assertEqual(0o600, path.stat().st_mode & 0o777)
        self.assertEqual(404, self.request(server, 'GET', '/nextbook-live.json')[0])
        self.assertEqual(404, self.request(server, 'GET', '/../nextbook-live.json')[0])
        reader = Path(serve.__file__).parent / 'read-shelf.py'
        out = subprocess.check_output([sys.executable, str(reader), '--file', str(path), '--find', 'piranesi'])
        self.assertEqual(1, json.loads(out)['matched'])
        self.assertEqual(204, self.request(server, 'POST', '/__shelf', body.replace('Piranesi', 'Changed'), headers)[0])
        self.assertEqual('Changed', json.loads(path.read_text())['entries'][0]['title'])

    def test_validation(self):
        for value in [b'bad', b'\xff', b'[]', b'{"entries": []}', b'x' * (serve.MIRROR_MAX + 1)]:
            self.assertIsNone(serve.mirror_text(value))

    def test_browser_retries_and_tracks_active_shelf(self):
        # Run the injected browser helper, including failed-response retries and shelf switching.
        script = serve.MIRROR_JS % json.dumps('token')
        harness = '''
const vm = require('node:vm'), assert = require('node:assert/strict');
let load, next, posts = [], ok = false;
let shelf = {schema:'nextbook/shelf-1', which:'practice', entries:[]};
const ctx = {window:{addEventListener:(name, cb)=>load=cb},
 document:{createElement:()=>({setAttribute(){}}), body:{insertBefore(){}}},
 setTimeout:cb=>next=cb,
 fetch:async(url, opts)=>{posts.push(JSON.parse(opts.body));return {ok}},
 Nextbook:{shell:{shelfSnapshot:()=>shelf}}};
ctx.window.Nextbook=ctx.Nextbook;
vm.runInNewContext(SCRIPT,ctx);
(async()=>{load(); await new Promise(setImmediate);
 assert.equal(posts.length,1); ok=true; next(); await new Promise(setImmediate);
 assert.equal(posts.length,2); next(); await new Promise(setImmediate);
 assert.equal(posts.length,2); shelf={...shelf,which:'own'};next(); await new Promise(setImmediate);
 assert.equal(posts[2].which,'own');
})().catch(e=>{console.error(e);process.exitCode=1});
'''.replace('SCRIPT', json.dumps(script))
        subprocess.run(['node', '-e', harness], check=True)
