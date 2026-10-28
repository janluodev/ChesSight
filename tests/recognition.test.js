import test from 'node:test';
import assert from 'node:assert/strict';

const SIMPLE_PLACEMENT = '4k3/8/8/4p3/4P3/8/8/4K3';
const SIMPLE_PIECES = [
  { square: 'e8', piece: 'k' },
  { square: 'e5', piece: 'p' },
  { square: 'e4', piece: 'P' },
  { square: 'e1', piece: 'K' },
];
const JPEG_B64 = Buffer.from('fake-jpeg-bytes').toString('base64');
const IMAGE = `data:image/jpeg;base64,${JPEG_B64}`;

async function loadWorker() {
  return (await import(`../worker/src/index.js?test=${crypto.randomUUID()}`)).default;
}

function postRecognize(body, { origin = 'https://chessight.art', ip = crypto.randomUUID(), headers = {} } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://worker.test/recognize', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      ...headers,
    },
    body: raw,
  });
}

function okVision(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ENV = { DEEPSEEK_API_KEY: 'test-only' };

test('recognize validates origin, fields, and image data URL before any upstream call', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return okVision('{}'); });
  const worker = await loadWorker();

  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }, { origin: 'https://attacker.example' }), ENV)).status, 403);
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }, { headers: { 'Content-Type': 'text/plain' } }), ENV)).status, 415);
  assert.equal((await worker.fetch(postRecognize({}), ENV)).status, 400); // 缺 image
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE, extra: 1 }), ENV)).status, 400); // 未知字段
  assert.equal((await worker.fetch(postRecognize({ image: 'https://x.test/a.jpg' }), ENV)).status, 400); // 非 data URL
  assert.equal((await worker.fetch(postRecognize({ image: 'data:image/svg+xml;base64,PHN2Zz4=' }), ENV)).status, 400); // 非位图格式
  assert.equal((await worker.fetch(postRecognize({ image: 'data:image/jpeg;base64,!!!' }), ENV)).status, 400); // 非法 base64
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE, lang: 'fr' }), ENV)).status, 400);
  assert.equal(calls, 0);
});

test('recognize rejects oversized bodies and images without contacting upstream', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return okVision('{}'); });
  const worker = await loadWorker();
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(4000004); // base64 超 4M 字符
  assert.equal((await worker.fetch(postRecognize({ image: huge }), ENV)).status, 413);
  assert.equal((await worker.fetch(postRecognize({ image: 'A'.repeat(4 * 1024 * 1024) }), ENV)).status, 413);
  assert.equal(calls, 0);
});

test('recognize forwards the image to the vision model and validates the structured result', async (t) => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push({ url, options });
    return okVision(JSON.stringify({ pieces: SIMPLE_PIECES, turn: 'w', uncertain: ['e4'] }));
  });
  const worker = await loadWorker();
  const response = await worker.fetch(postRecognize({ image: IMAGE, lang: 'en' }), ENV);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { placement: SIMPLE_PLACEMENT, turn: 'w', uncertain: ['e4'] });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.deepseek.com/chat/completions');
  const body = JSON.parse(seen[0].options.body);
  assert.equal(body.model, 'deepseek-flash'); // 视觉模型，官方 API 当前即 V4.1-Flash-1017
  assert.equal(body.stream, false);
  assert.equal(body.thinking.type, 'enabled'); // 固定 high 推理强度（2026-10-28 实测：max 会思考到 token 耗尽）
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.max_tokens, 16000); // high 推理在复杂局面 reasoning 可达 8–10k，限额必须留足
  const user = body.messages.at(-1);
  assert.equal(user.content[0].type, 'text');
  assert.match(user.content[0].text, /JSON/);
  assert.match(user.content[0].text, /standard White view/); // 英文 prompt
  assert.deepEqual(user.content[1], { type: 'image_url', image_url: { url: IMAGE } });
  assert.match(body.messages[0].content, /recognition assistant/);
});

test('recognize defaults to a Chinese prompt and tolerates markdown fences and bad turn values', async (t) => {
  const worker = await loadWorker();
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push(options);
    return okVision('```json\n' + JSON.stringify({ pieces: SIMPLE_PIECES, turn: 'maybe', uncertain: ['e4', 'zz', 'e4', 7] }) + '\n```');
  });
  const response = await worker.fetch(postRecognize({ image: IMAGE }), ENV);
  assert.equal(response.status, 200);
  // turn 非法降级为 null；uncertain 过滤非法项并去重
  assert.deepEqual(await response.json(), { placement: SIMPLE_PLACEMENT, turn: null, uncertain: ['e4'] });
  const body = JSON.parse(seen[0].body);
  assert.match(body.messages[0].content, /棋盘识别助手/);
  assert.match(body.messages.at(-1).content[0].text, /标准白方视角/);
});

test('recognize returns 502 for malformed upstream output and never logs image data', async (t) => {
  const logs = [];
  t.mock.method(console, 'log', (line) => logs.push(String(line)));
  const worker = await loadWorker();
  const duplicated = [{ square: 'e4', piece: 'P' }, { square: 'e4', piece: 'p' }]; // 同格重复

  t.mock.method(globalThis, 'fetch', async () => okVision('not json at all'));
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }), ENV)).status, 502);

  t.mock.method(globalThis, 'fetch', async () => okVision(JSON.stringify({ pieces: duplicated, turn: 'w' })));
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }), ENV)).status, 502);

  t.mock.method(globalThis, 'fetch', async () => okVision(JSON.stringify({ pieces: [{ square: 'e9', piece: 'P' }] }))); // 非法格名
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }), ENV)).status, 502);

  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }), ENV)).status, 502);

  t.mock.method(globalThis, 'fetch', async () => new Response('server error', { status: 500 }));
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }), ENV)).status, 502);

  const serialized = logs.join('\n');
  assert.match(serialized, /"event":"upstream_failed"/);
  assert.doesNotMatch(serialized, new RegExp(JPEG_B64)); // 日志不含 base64
  assert.doesNotMatch(serialized, /data:image/);
});

test('recognize rate limit is independent from commentary and returns Retry-After', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return okVision(JSON.stringify({ pieces: [], turn: null, uncertain: [] })); });
  const worker = await loadWorker();
  const ip = '203.0.113.99';
  let response;
  for (let i = 0; i < 11; i++) {
    response = await worker.fetch(postRecognize({ image: IMAGE }, { ip }), ENV);
  }
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(calls, 10);
  // 同一 IP 的识别额度耗尽不应占用解说额度。
  t.mock.method(globalThis, 'fetch', async () => new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  const commentary = new Request('https://worker.test/', {
    method: 'POST',
    headers: { Origin: 'https://chessight.art', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ moves: ['e4'], lastMove: 'e4', fen: `${SIMPLE_PLACEMENT} b - - 0 1` }),
  });
  assert.equal((await worker.fetch(commentary, ENV)).status, 200);
});

test('recognize timeout covers reading the response body and cancels rejected bodies', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'log', () => {});
  const worker = await loadWorker();
  let signal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  });
  const pending = worker.fetch(postRecognize({ image: IMAGE }), ENV);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(119999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal((await pending).status, 502);
  assert.equal(signal.aborted, true);

  let canceled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 500 }));
  assert.equal((await worker.fetch(postRecognize({ image: IMAGE }), ENV)).status, 502);
  assert.equal(canceled, true);
});
