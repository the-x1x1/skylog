import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { DEFAULT_PORT, isAppRunningOn, resolvePort, startDesktopServer } from '../../server/desktop';
import { APP_ID, createAppServer, directoryFiles, type StaticFiles } from '../../server/http';

const memoryFiles = (files: Record<string, string>): StaticFiles => ({
  read: (rel) => (rel in files ? Buffer.from(files[rel]!) : null),
});

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

describe('static file sources', () => {
  it('reads files inside the folder and nothing outside it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-files-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'ok');
    fs.writeFileSync(`${dir}-sibling.txt`, 'secret');
    const files = directoryFiles(dir);
    assert.equal(files.read('assets/a.js')?.toString(), 'ok');
    assert.equal(files.read('assets'), null, 'directories are not files');
    assert.equal(files.read(`../${path.basename(dir)}-sibling.txt`), null);
    assert.equal(files.read('missing.js'), null);
  });

  it('serves an embedded file source with SPA fallback and blocks backslash paths', async () => {
    const server = createAppServer({
      files: memoryFiles({ 'index.html': '<!doctype html><div id="root"></div>', 'assets/app-ABCDEFGH.js': 'console.log(1)' }),
      env: {},
      version: '9.9.9',
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const js = await fetch(`${base}/assets/app-ABCDEFGH.js`);
      assert.equal(js.status, 200);
      assert.match(js.headers.get('content-type') ?? '', /javascript/);
      assert.match(js.headers.get('cache-control') ?? '', /immutable/);
      const deep = await fetch(`${base}/entry/abc`);
      assert.match(await deep.text(), /id="root"/);
      assert.ok(deep.headers.get('content-security-policy'));
      assert.equal((await fetch(`${base}/..%5C..%5Csecret`)).status, 403);
      const head = await fetch(`${base}/`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    } finally {
      server.close();
    }
  });

  it('needs a folder or a file source', () => {
    assert.throws(() => createAppServer({ env: {} }), /root folder or a file source/);
  });
});

describe('desktop program', () => {
  const servers: http.Server[] = [];
  after(() => servers.forEach((s) => s.close()));

  it('uses the fixed default port unless PORT is set, and rejects bad values', () => {
    assert.equal(resolvePort({}), DEFAULT_PORT);
    assert.equal(resolvePort({ PORT: ' 4180 ' }), 4180);
    assert.throws(() => resolvePort({ PORT: 'abc' }), /PORT must be a number/);
    assert.throws(() => resolvePort({ PORT: '70000' }), /PORT must be a number/);
  });

  it('starts once, and a second launch finds the running copy instead of failing', async () => {
    const port = await freePort();
    const files = memoryFiles({ 'index.html': 'hi' });
    const first = await startDesktopServer({ files, env: { PUBLIC_APP_NAME: 'Test' }, port, version: '1.2.3' });
    assert.equal(first.kind, 'started');
    if (first.kind === 'started') servers.push(first.server);
    assert.equal(first.kind === 'started' && first.url, `http://localhost:${port}`);

    const info = await fetch(`http://127.0.0.1:${port}/api/app`, { headers: { 'x-journal-client': '1' } });
    assert.deepEqual(await info.json(), { app: APP_ID, name: 'Test', version: '1.2.3' });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/app`)).status, 403, 'needs the app header');

    const second = await startDesktopServer({ files, env: {}, port, version: '1.2.3' });
    assert.deepEqual(second, { kind: 'already-running', url: `http://localhost:${port}` });
  });

  it('reports a port held by another program instead of opening the wrong page', async () => {
    const other = http.createServer((_req, res) => res.end('someone else'));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    servers.push(other);
    const { port } = other.address() as AddressInfo;
    assert.equal(await isAppRunningOn(port), false);
    const result = await startDesktopServer({ files: memoryFiles({}), env: {}, port, version: '1' });
    assert.deepEqual(result, { kind: 'port-busy', port });
  });
});
