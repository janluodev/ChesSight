import test from 'node:test';
import assert from 'node:assert/strict';

import { placementToBoard, removedFromBoard, recognizePosition, compressImageFile } from '../js/recognition.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

// 只模拟浏览器图像/画布边界，通过公开压缩入口验证尺寸、白底与格式选择。
async function compressWithCanvas({ width = 640, height = 480, jpeg, png }) {
  const calls = [];
  const context = {
    fillRect(...args) { calls.push({ method: 'fill', style: this.fillStyle, args }); },
    drawImage(_image, ...args) { calls.push({ method: 'draw', args }); },
  };
  const canvas = {
    getContext(type) { assert.equal(type, '2d'); return context; },
    toDataURL(type, quality) {
      calls.push({ method: 'encode', type, quality });
      return type === 'image/png' ? png : jpeg;
    },
  };
  const runtime = {
    document: { createElement(tag) { assert.equal(tag, 'canvas'); return canvas; } },
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/png;base64,source'; this.onload(); }
    },
    Image: class {
      constructor() { this.naturalWidth = width; this.naturalHeight = height; }
      set src(value) { assert.equal(value, 'data:image/png;base64,source'); this.onload(); }
    },
  };
  const original = Object.fromEntries(Object.keys(runtime).map((name) => [
    name, Object.getOwnPropertyDescriptor(globalThis, name),
  ]));
  try {
    for (const [name, value] of Object.entries(runtime)) {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    const result = await compressImageFile({ type: 'image/png' });
    return { result, canvas, calls };
  } finally {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('image compression selects smaller PNG or JPEG data URLs and keeps JPEG on ties', async () => {
  const jpeg = 'data:image/jpeg;base64,AAAA';
  for (const [png, expected] of [
    ['data:image/png;base64,AA', 'data:image/png;base64,AA'],
    ['data:image/png;base64,AAAAAAAA', jpeg],
    ['data:image/png;base64,AAAAA', jpeg],
  ]) {
    const { result, calls } = await compressWithCanvas({ jpeg, png });
    assert.equal(result, expected);
    assert.deepEqual(calls.slice(2), [
      { method: 'encode', type: 'image/jpeg', quality: 0.82 },
      { method: 'encode', type: 'image/png', quality: undefined },
    ]);
  }
});

test('image compression preserves aspect ratio within 1120px and paints white before drawing', async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [2240, 1120, 1120, 560],
    [1120, 2240, 560, 1120],
    [320, 200, 320, 200],
  ]) {
    const { canvas, calls } = await compressWithCanvas({
      width, height, jpeg: 'data:image/jpeg;base64,AA', png: 'data:image/png;base64,AA',
    });
    assert.equal(canvas.width, expectedWidth);
    assert.equal(canvas.height, expectedHeight);
    assert.deepEqual(calls.slice(0, 2), [
      { method: 'fill', style: '#fff', args: [0, 0, expectedWidth, expectedHeight] },
      { method: 'draw', args: [0, 0, expectedWidth, expectedHeight] },
    ]);
  }
});

test('placementToBoard converts the initial position with correct colors and squares', () => {
  const board = placementToBoard(START);
  assert.equal(board.length, 8);
  assert.ok(board.every((row) => row.length === 8));
  assert.deepEqual(board[0][0], { type: 'r', color: 'b' }); // a8 黑车
  assert.deepEqual(board[0][4], { type: 'k', color: 'b' }); // e8 黑王
  assert.deepEqual(board[7][4], { type: 'k', color: 'w' }); // e1 白王
  assert.deepEqual(board[6][3], { type: 'p', color: 'w' }); // d2 白兵
  assert.equal(board[3][0], null); // a5 空格
  const pieces = board.flat().filter(Boolean);
  assert.equal(pieces.length, 32);
});

test('placementToBoard expands digit runs and rejects malformed input', () => {
  // 全空棋盘 '8/8/8/8/8/8/8/8'
  const empty = placementToBoard('8/8/8/8/8/8/8/8');
  assert.ok(empty.flat().every((cell) => cell === null));
  // 混合数字与棋子：'3k4' = 3 空 + 黑王 + 4 空
  const custom = placementToBoard('3k4/8/8/8/8/8/8/3K4');
  assert.deepEqual(custom[0][3], { type: 'k', color: 'b' });
  assert.deepEqual(custom[7][3], { type: 'k', color: 'w' });

  for (const bad of [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP', // 7 行
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR/8', // 9 行
    '9/8/8/8/8/8/8/8', // 非法字符
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP/RNBQKBNR', // 某行只有 7 格
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPPP/RNBQKBNR', // 某行 9 格
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX', // 非法棋子字母
    '', null, undefined, 42,
  ]) {
    assert.throws(() => placementToBoard(bad), /invalid placement/);
  }
});

test('removedFromBoard counts missing pieces against the standard set, clamped at zero', () => {
  const initial = placementToBoard(START);
  const removed = removedFromBoard(initial);
  for (const color of ['w', 'b']) {
    for (const type of ['k', 'q', 'r', 'b', 'n', 'p']) {
      assert.equal(removed[color][type], 0);
    }
  }

  // 只有双王的局面：每色缺 1 后 2 车 2 象 2 马 8 兵
  const kingsOnly = placementToBoard('4k3/8/8/8/8/8/8/4K3');
  const sparse = removedFromBoard(kingsOnly);
  assert.deepEqual(sparse.w, { k: 0, q: 1, r: 2, b: 2, n: 2, p: 8 });
  assert.deepEqual(sparse.b, { k: 0, q: 1, r: 2, b: 2, n: 2, p: 8 });

  // 盘上 3 个白后：不得出现负数（无限调色板允许超出标准集）
  const extraQueens = placementToBoard('4k3/8/8/8/8/8/QQQ5/4K3');
  assert.equal(removedFromBoard(extraQueens).w.q, 0);
});

test('recognizePosition posts the payload and validates the placement locally', async () => {
  const seen = [];
  const result = await recognizePosition('data:image/jpeg;base64,AAAA', {
    endpoint: 'https://worker.test/recognize',
    lang: 'en',
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return new Response(JSON.stringify({ placement: START, turn: 'w', uncertain: [] }));
    },
  });
  assert.equal(result.turn, 'w');
  assert.equal(seen[0].url, 'https://worker.test/recognize');
  const body = JSON.parse(seen[0].options.body);
  assert.deepEqual(body, { image: 'data:image/jpeg;base64,AAAA', lang: 'en' });

  // HTTP 错误携带状态码
  await assert.rejects(
    recognizePosition('data:image/jpeg;base64,AAAA', {
      fetchImpl: async () => new Response('Too Many Requests', { status: 429 }),
    }),
    (error) => error.status === 429,
  );

  // 上游返回非法 placement：本地校验必须拦截
  await assert.rejects(
    recognizePosition('data:image/jpeg;base64,AAAA', {
      fetchImpl: async () => new Response(JSON.stringify({ placement: 'garbage', turn: null, uncertain: [] })),
    }),
    /invalid placement/,
  );
});

test('recognizePosition retries transient network failures once, then succeeds', async () => {
  let calls = 0;
  const result = await recognizePosition('data:image/jpeg;base64,AAAA', {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new TypeError('Load failed'); // Safari 风格的瞬时网络错误
      return new Response(JSON.stringify({ placement: START, turn: 'w', uncertain: [] }));
    },
  });
  assert.equal(result.turn, 'w');
  assert.equal(calls, 2);
});

test('recognizePosition gives up after the retry budget and never retries 4xx', async () => {
  let calls = 0;
  await assert.rejects(
    recognizePosition('data:image/jpeg;base64,AAAA', {
      fetchImpl: async () => { calls++; throw new TypeError('Load failed'); },
    }),
    /Load failed/,
  );
  assert.equal(calls, 2); // 首次 + 一次重试

  let clientCalls = 0;
  await assert.rejects(
    recognizePosition('data:image/jpeg;base64,AAAA', {
      fetchImpl: async () => { clientCalls++; return new Response('Bad Request', { status: 400 }); },
    }),
    (error) => error.status === 400,
  );
  assert.equal(clientCalls, 1); // 4xx 是请求问题，不重试
});

test('recognition cancellation stops a pending body and prevents retries', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = recognizePosition('data:image/jpeg;base64,AAAA', {
    signal: controller.signal,
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: () => {
        queueMicrotask(() => controller.abort());
        return new Promise(() => {});
      } };
    },
  });
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('recognition cancellation interrupts retry backoff and pre-aborted calls never fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  const options = {
    signal: controller.signal,
    fetchImpl: async () => {
      calls++;
      setTimeout(() => controller.abort(), 10);
      throw new TypeError('Load failed');
    },
  };
  await assert.rejects(recognizePosition('image', options), { name: 'AbortError' });
  await assert.rejects(recognizePosition('image', options), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('recognition keeps its deadline while JSON reading is stalled', async () => {
  await assert.rejects(recognizePosition('image', {
    timeoutMs: 15,
    retries: 0,
    fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }),
  }), { name: 'TimeoutError' });
});

test('recognition rejects malformed result fields without treating them as network failures', async () => {
  for (const payload of [null, { placement: START, turn: 'x', uncertain: [] },
    { placement: START, turn: 'w', uncertain: 'e4' },
    { placement: START, turn: null, uncertain: ['a9'] }]) {
    let calls = 0;
    await assert.rejects(recognizePosition('image', {
      fetchImpl: async () => { calls++; return new Response(JSON.stringify(payload)); },
    }), /invalid recognition result/);
    assert.equal(calls, 1);
  }
});
