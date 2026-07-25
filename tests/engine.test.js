import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../js/engine.js';

test('the initialization deadline includes a stalled WASM preload', async () => {
  const engine = createEngine('./engine.js', {
    fetchImpl: async () => new Promise(() => {}),
    WorkerCtor: class {},
    initTimeoutMs: 20,
  });
  await assert.rejects(
    Promise.race([
      engine.bestMove('8/8/8/8/8/8/8/K6k w - - 0 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('test deadline')), 250)),
    ]),
    /初始化超时/,
  );
});

test('a stalled WASM reader is cancelled and released at the initialization deadline', async () => {
  let cancelled = 0;
  let released = 0;
  const engine = createEngine('./engine.js', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => new Promise(() => {}),
          async cancel() { cancelled++; },
          releaseLock() { released++; },
        }),
      },
    }),
    WorkerCtor: class {},
    initTimeoutMs: 20,
  });
  await assert.rejects(engine.bestMove('8/8/8/8/8/8/8/K6k w - - 0 1'), /初始化超时/);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('Worker failures reject immediately and reset the engine', async () => {
  class FakeWorker {
    static last = null;
    constructor() {
      FakeWorker.last = this;
      this.listeners = new Map();
      this.terminated = false;
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    emit(type, event) { for (const handler of this.listeners.get(type) || []) handler(event); }
    postMessage(command) {
      if (command === 'uci') queueMicrotask(() => this.emit('message', { data: 'uciok' }));
      if (command.startsWith('go ')) queueMicrotask(() => this.emit('error', new Event('error')));
    }
    terminate() { this.terminated = true; }
  }

  const engine = createEngine('./engine.js', {
    fetchImpl: async () => new Response(null, { status: 200 }),
    WorkerCtor: FakeWorker,
    initTimeoutMs: 200,
  });
  await assert.rejects(engine.bestMove('8/8/8/8/8/8/8/K6k w - - 0 1'), /Worker 运行失败/);
  assert.equal(FakeWorker.last.terminated, true);
});

test('a warmed Cache Storage serves the WASM without a second network download', async () => {
  // Cache Storage 命中：第二次 preload 不再 fetch（回归防护：每次打开都重新下载 7MB）
  const store = new Map();
  const cache = {
    match: async (url) => store.get(url),
    put: async (url, response) => store.set(url, response),
  };
  globalThis.caches = { open: async () => cache };
  class FakeWorker {
    addEventListener(type, fn) { (this._listeners ??= {})[type] = fn; }
    removeEventListener() {}
    postMessage(message) {
      if (message === 'uci') setTimeout(() => this._listeners.message?.({ data: 'uciok' }), 0);
    }
  }
  const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 2, 3]);
  let fetches = 0;
  const options = {
    fetchImpl: async () => { fetches++; return new Response(wasmBytes, { status: 200 }); },
    WorkerCtor: FakeWorker,
  };
  try {
    const first = createEngine('./engine.js', options);
    await first.preload(() => {});
    assert.equal(fetches, 1);
    assert.ok(store.has('./engine.wasm'), 'downloaded WASM should be written into Cache Storage');

    const second = createEngine('./engine.js', options);
    await second.preload(() => {});
    assert.equal(fetches, 1, 'cache hit should avoid any network fetch');
  } finally {
    delete globalThis.caches;
  }
});
