import test from 'node:test';
import assert from 'node:assert/strict';

import { placementToBoard, removedFromBoard, recognizePosition } from '../js/recognition.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

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
      fetchImpl: async () => new Response(JSON.stringify({ placement: 'garbage', turn: null })),
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
