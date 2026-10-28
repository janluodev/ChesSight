import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { get } from 'node:http';

import { createDevServer, resolvePublicPath } from '../scripts/serve.mjs';

// fileURLToPath 而非 URL.pathname：后者在含空格路径下是百分号编码伪路径、
// 在 Windows 下带 /C:/ 前导斜杠，均不是合法文件系统路径。
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('the development server exposes only public application files', () => {
  assert.equal(resolvePublicPath('/', root), path.join(root, 'index.html'));
  assert.equal(resolvePublicPath('/css/style.css', root), path.join(root, 'css/style.css'));
  assert.equal(resolvePublicPath('/js/main.js', root), path.join(root, 'js/main.js'));
  assert.equal(resolvePublicPath('/assets/icon.svg', root), path.join(root, 'assets/icon.svg'));
  assert.equal(resolvePublicPath('/DS.env', root), null);
  assert.equal(resolvePublicPath('/worker/src/index.js', root), null);
  assert.equal(resolvePublicPath('/.git/config', root), null);
  assert.equal(resolvePublicPath('/../DS.env', root), null);
  assert.equal(resolvePublicPath('/%2e%2e/DS.env', root), null);
});

async function startServer(t, directory) {
  const server = createDevServer(directory);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return server.address().port;
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    get({ hostname: '127.0.0.1', port, path: pathname }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    }).on('error', reject);
  });
}

test('malformed request targets are rejected without stopping the HTTP server', async (t) => {
  const port = await startServer(t, root);
  assert.equal((await request(port, '//[')).status, 404);
  assert.equal((await request(port, '/js/%ZZ')).status, 404);
  assert.equal((await request(port, '/')).status, 200);
});

test('public symlinks cannot expose nonpublic files inside or outside the root', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chessight-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const publicRoot = path.join(directory, 'site');
  await mkdir(path.join(publicRoot, 'js'), { recursive: true });
  await writeFile(path.join(publicRoot, 'DS.env'), 'SYNTHETIC_PRIVATE_MARKER');
  await writeFile(path.join(directory, 'outside.txt'), 'SYNTHETIC_OUTSIDE_MARKER');
  await writeFile(path.join(publicRoot, 'js', 'public.js'), 'export const publicValue = true;');
  try {
    await symlink('../DS.env', path.join(publicRoot, 'js', 'secret.txt'));
    await symlink('../../outside.txt', path.join(publicRoot, 'js', 'outside.txt'));
    await symlink('public.js', path.join(publicRoot, 'js', 'alias.js'));
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip('This Windows account cannot create file symlinks');
    return;
  }
  const port = await startServer(t, publicRoot);
  assert.deepEqual(await request(port, '/js/secret.txt'), { status: 404, body: 'Not Found' });
  assert.deepEqual(await request(port, '/js/outside.txt'), { status: 404, body: 'Not Found' });
  assert.deepEqual(await request(port, '/js/alias.js'), { status: 200, body: 'export const publicValue = true;' });
});
