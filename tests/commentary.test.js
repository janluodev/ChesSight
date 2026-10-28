import test from 'node:test';
import assert from 'node:assert/strict';

function sse(text = '好棋') {
  const event = JSON.stringify({ choices: [{ delta: { content: text } }] });
  return new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function client(options = {}) {
  const module = await import(`../js/commentary.js?test=${crypto.randomUUID()}`);
  assert.equal(typeof module.createCommentaryClient, 'function');
  return module.createCommentaryClient(options);
}

function waitForJob(clientApi, payload = {}) {
  return new Promise((resolve) => {
    clientApi.enqueueCommentary(payload, {
      onText() {},
      onDone: (text) => resolve({ kind: 'done', text }),
      onError: () => resolve({ kind: 'error' }),
    });
  });
}

function fakeStreamResponse(reader) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    body: { getReader: () => reader },
  };
}

test('does not retry permanent 4xx failures', async () => {
  let calls = 0;
  const api = await client({
    fetchImpl: async () => { calls++; return new Response('bad', { status: 400 }); },
    sleepImpl: async () => {},
  });
  assert.deepEqual(await waitForJob(api), { kind: 'error' });
  assert.equal(calls, 1);
});

test('retries one transient failure and parses a completed SSE stream', async () => {
  let calls = 0;
  const api = await client({
    fetchImpl: async () => (++calls === 1 ? new Response('busy', { status: 503 }) : sse()),
    sleepImpl: async () => {},
  });
  assert.deepEqual(await waitForJob(api), { kind: 'done', text: '好棋' });
  assert.equal(calls, 2);
});

test('a timed-out request cannot permanently block the next queued job', async () => {
  let calls = 0;
  const api = await client({
    fetchImpl: async (_url, { signal }) => {
      calls++;
      if (calls === 1) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return sse('下一条');
    },
    totalTimeoutMs: 20,
    retryLimit: 0,
    sleepImpl: async () => {},
  });
  const first = waitForJob(api, { id: 1 });
  const second = waitForJob(api, { id: 2 });
  assert.deepEqual(await Promise.race([
    Promise.all([first, second]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue deadline')), 250)),
  ]), [{ kind: 'error' }, { kind: 'done', text: '下一条' }]);
});

test('parses multiline SSE and a UTF-8 tail without a final newline', async () => {
  const encoded = new TextEncoder().encode(
    'data: {"choices":[{"delta":\ndata: {"content":"尾声"}}]}',
  );
  const multibyte = encoded.findIndex((byte) => byte >= 0x80);
  const chunks = [encoded.slice(0, multibyte + 1), encoded.slice(multibyte + 1)];
  let released = 0;
  const reader = {
    async read() {
      return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
    },
    async cancel() {},
    releaseLock() { released++; },
  };
  const api = await client({ fetchImpl: async () => fakeStreamResponse(reader), retryLimit: 0 });
  assert.deepEqual(await waitForJob(api), { kind: 'done', text: '尾声' });
  assert.equal(released, 1);
});

test('idle streams are cancelled and released without poisoning the queue', async () => {
  let cancelled = 0;
  let released = 0;
  let calls = 0;
  const stalledReader = {
    read: async () => new Promise(() => {}),
    async cancel() { cancelled++; },
    releaseLock() { released++; },
  };
  const api = await client({
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? fakeStreamResponse(stalledReader) : sse('恢复');
    },
    idleTimeoutMs: 15,
    totalTimeoutMs: 100,
    retryLimit: 0,
  });
  const first = waitForJob(api, { id: 1 });
  const second = waitForJob(api, { id: 2 });
  assert.deepEqual(await Promise.all([first, second]), [
    { kind: 'error' },
    { kind: 'done', text: '恢复' },
  ]);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('an early DONE event cancels and releases the remaining stream', async () => {
  const chunk = new TextEncoder().encode('data: [DONE]\n\n');
  let cancelled = 0;
  let released = 0;
  const reader = {
    async read() { return { done: false, value: chunk }; },
    async cancel() { cancelled++; },
    releaseLock() { released++; },
  };
  const api = await client({ fetchImpl: async () => fakeStreamResponse(reader), retryLimit: 0 });
  assert.deepEqual(await waitForJob(api), { kind: 'done', text: '' });
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('clearing the queue during a final token suppresses the stale completion', async () => {
  const events = [];
  const api = await client({ fetchImpl: async () => sse('旧局面'), retryLimit: 0 });
  await new Promise((resolve) => {
    api.enqueueCommentary({}, {
      onText() { api.clearCommentaryQueue(); },
      onDone() { events.push('done'); resolve(); },
      onCancel() { events.push('cancel'); resolve(); },
      onError() { events.push('error'); resolve(); },
    });
  });
  assert.deepEqual(events, ['cancel']);
});

test('total deadline interrupts a reader even when its stream ignores fetch abort', async () => {
  let cancelled = 0;
  let released = 0;
  let calls = 0;
  const reader = {
    read: async () => new Promise(() => {}),
    cancel() { cancelled++; return new Promise(() => {}); },
    releaseLock() { released++; },
  };
  const api = await client({
    fetchImpl: async () => (++calls === 1 ? fakeStreamResponse(reader) : sse('下一局')),
    totalTimeoutMs: 15,
    idleTimeoutMs: 1000,
    retryLimit: 0,
  });
  assert.deepEqual(await Promise.race([
    Promise.all([waitForJob(api), waitForJob(api)]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue deadline')), 200)),
  ]), [{ kind: 'error' }, { kind: 'done', text: '下一局' }]);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('an excessive Retry-After cannot block the queue beyond the retry wait budget', async () => {
  let calls = 0;
  const waits = [];
  const api = await client({
    fetchImpl: async () => (++calls === 1
      ? new Response('busy', { status: 429, headers: { 'Retry-After': '86400' } })
      : sse('恢复')),
    sleepImpl: async (ms) => { waits.push(ms); },
    totalTimeoutMs: 100,
  });
  assert.deepEqual(await waitForJob(api), { kind: 'done', text: '恢复' });
  assert.deepEqual(waits, [100]);
});
