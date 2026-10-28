import test from 'node:test';
import assert from 'node:assert/strict';

import { Chess } from '../js/vendor/chess.js';
import { analyze, analyzeBoard, attackLines } from '../js/analysis.js';
import { History } from '../js/history.js';
import { OPENINGS } from '../js/openings.js';

test('all bundled openings are legal from the initial position', () => {
  assert.equal(OPENINGS.length, 14);
  for (const opening of OPENINGS) {
    const chess = new Chess();
    for (const san of opening.moves) {
      assert.doesNotThrow(() => chess.move(san), `${opening.id}: ${san}`);
    }
    assert.equal(chess.history().length, opening.moves.length, opening.id);
  }
});

test('analysis is stable and classifies the initial position', () => {
  const chess = new Chess();
  const first = analyze(chess);
  assert.equal(analyze(chess), first, 'same FEN should use the memoized result');
  assert.equal(first.safety.a2, 'defended');
  // 新规则（2026-07-25）：未被攻击且无保护 → 不标记（a1 车不再显示黄框）
  assert.equal(first.safety.a1, undefined);
  assert.equal(first.control.e4, undefined);
  assert.ok(attackLines(chess).length > 0);
});

test('safety markers follow the attacked/defended matrix', () => {
  const chess = new Chess();
  // 未被攻击 + 无保护 → 无外框；未被攻击 + 有保护 → 绿
  assert.equal(analyze(chess).safety.a1, undefined);
  assert.equal(analyze(chess).safety.a2, 'defended');
  // 被攻击 + 无保护 → 红：1.e4 e5 2.Nf3 后 e5 兵被 f3 马攻击且无保护
  for (const san of ['e4', 'e5', 'Nf3']) chess.move(san);
  assert.equal(analyze(chess).safety.e5, 'attacked');
  // 被攻击 + 有保护 → 黄：3...Nc6 后 e5 兵有 c6 马保护
  chess.move('Nc6');
  assert.equal(analyze(chess).safety.e5, 'contested');
});

test('free-setup analysis works without requiring a legal chess position', () => {
  const rows = Array.from({ length: 8 }, () => Array(8).fill(null));
  rows[7][0] = { type: 'r', color: 'w' }; // a1
  rows[0][0] = { type: 'r', color: 'b' }; // a8
  const result = analyzeBoard(rows);
  assert.equal(result.safety.a1, 'attacked');
  assert.equal(result.safety.a8, 'attacked');
});

test('setup and game analysis agree around castling, en passant, promotion and pins', () => {
  const positions = [
    'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2',
    '4k3/P7/8/8/8/8/7p/4K3 w - - 0 1',
    '4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1',
    '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1',
  ];
  for (const fen of positions) {
    const chess = new Chess(fen);
    assert.deepEqual(analyzeBoard(chess.board()), analyze(chess), fen);
    // 每个合法后继也交叉核验，包括易位车位移、过路兵移除和四种升变。
    for (const move of chess.moves({ verbose: true })) {
      chess.move(move.san);
      assert.deepEqual(analyzeBoard(chess.board()), analyze(chess), `${fen}: ${move.san}`);
      chess.undo();
    }
  }
});

test('history truncates the redo branch after a new move', () => {
  const chess = new Chess();
  const history = new History(chess.fen());
  history.push(chess.move('e4'));
  history.push(chess.move('e5'));
  assert.equal(history.undo().san, 'e4');
  chess.load(history.current().fen);
  history.push(chess.move('c5'));
  assert.equal(history.canRedo(), false);
  assert.equal(history.current().san, 'c5');
});
