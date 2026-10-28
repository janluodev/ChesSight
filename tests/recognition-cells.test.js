import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIndexedCells, parseOrientation, resultFromCells } from '../experiments/recognition/cells.js';

const completeCells = () => Array.from({ length: 64 }, (_, index) => ({ index: index + 1, piece: '.' }));
const encode = (cells) => JSON.stringify({ cells });

test('indexed recognition uses explicit indices rather than response order and accepts null empty cells', () => {
  const entries = completeCells();
  entries[0].piece = 'R';
  entries[7].piece = 'k';
  entries[10].piece = null; // Explicit null is a supported spelling for an empty cell.
  entries[31].piece = '?';
  entries[63].piece = 'q';
  const result = parseIndexedCells(encode(entries.reverse()));
  const expected = Array(64).fill('.');
  expected[0] = 'R'; expected[7] = 'k'; expected[31] = '?'; expected[63] = 'q';
  assert.deepEqual(result, expected);
  assert.deepEqual(parseIndexedCells('```json\n' + encode(entries) + '\n```'), expected);
  assert.deepEqual(parseIndexedCells('```\n' + encode(entries) + '\n```'), expected);
});

test('sparse indexed recognition treats unlisted cells as empty and rejects extra or duplicate entries', () => {
  assert.deepEqual(parseIndexedCells(encode([])), Array(64).fill('.'));
  const expected = Array(64).fill('.');
  expected[0] = 'R'; expected[7] = '?'; expected[63] = 'k';
  assert.deepEqual(parseIndexedCells(encode([
    { index: 64, piece: 'k' }, { index: 8, piece: '?' }, { index: 1, piece: 'R' },
  ])), expected);
  assert.equal(parseIndexedCells(encode([...completeCells(), { index: 65, piece: '.' }])), null);
  const repeated = completeCells();
  repeated[63] = { index: 1, piece: 'K' };
  assert.equal(parseIndexedCells(encode(repeated)), null);
});

test('indexed recognition rejects wrong index types, invalid pieces and malformed objects', () => {
  for (const index of [0, 65, -1, 1.5, '1', null, true, {}, []]) {
    const cells = completeCells();
    cells[0].index = index;
    assert.equal(parseIndexedCells(encode(cells)), null, `index ${JSON.stringify(index)}`);
  }
  for (const piece of ['', ' ', 'KK', 'X', 1, true, {}, []]) {
    const cells = completeCells();
    cells[0].piece = piece;
    assert.equal(parseIndexedCells(encode(cells)), null, `piece ${JSON.stringify(piece)}`);
  }
  for (const entry of [null, [], '.', 1, { index: 1 }, { piece: 'K' }]) {
    const cells = completeCells();
    cells[0] = entry;
    assert.equal(parseIndexedCells(encode(cells)), null);
  }
  for (const text of [null, {}, '', 'not JSON', 'null', '[]', '{}', '{"cells":{}}']) {
    assert.equal(parseIndexedCells(text), null);
  }
});

test('orientation comes from the observed upper-left rank, accepting only exact numeric or string labels', () => {
  for (const topLeftRank of [8, '8']) {
    assert.deepEqual(parseOrientation(JSON.stringify({ topLeftRank, turn: 'b' })), { orientation: 'w', turn: 'b' });
  }
  for (const topLeftRank of [1, '1']) {
    assert.deepEqual(parseOrientation(JSON.stringify({ topLeftRank, turn: 'w' })), { orientation: 'b', turn: 'w' });
  }
  assert.deepEqual(parseOrientation('```json\n{"topLeftRank":"1","turn":null}\n```'), { orientation: 'b', turn: null });
});

test('ambiguous rank labels never become an invented orientation or side to move', () => {
  for (const topLeftRank of [null, 0, 2, 7, 9, ' 8', '8 ', '08', '8.0', '1st', 'eight', '', true, [8], {}]) {
    assert.deepEqual(parseOrientation(JSON.stringify({ topLeftRank, turn: 'white' })), { orientation: null, turn: null });
  }
  for (const turn of [undefined, 'W', 'black', 1, true, {}, []]) {
    assert.deepEqual(parseOrientation(JSON.stringify({ topLeftRank: 8, turn })), { orientation: 'w', turn: null });
  }
  // A model's guessed orientation field is not a substitute for visible rank evidence.
  assert.deepEqual(parseOrientation('{"orientation":"w","turn":"b"}'), { orientation: null, turn: 'b' });
  for (const text of [null, '', 'invalid', 'null', '[]', '{}']) {
    assert.deepEqual(parseOrientation(text), { orientation: null, turn: null });
  }
});

function diagram() {
  const cells = Array(64).fill('.');
  cells[0] = 'R'; cells[7] = 'k'; cells[18] = 'P'; cells[31] = '?';
  cells[42] = 'n'; cells[56] = 'K'; cells[63] = 'q';
  return cells;
}

test('white mapping deterministically constructs FEN and locates uncertain cells', () => {
  const cells = diagram();
  assert.deepEqual(resultFromCells(cells, { orientation: 'w', turn: 'b' }), {
    placement: 'R6k/8/2P5/8/8/2n5/8/K6q',
    turn: 'b', uncertain: ['h5'], orientation: 'w',
  });
  assert.deepEqual(cells, diagram(), 'mapping must not mutate image-order observations');
});

test('black mapping rotates both axes while preserving piece colors and uncertainty', () => {
  const cells = diagram();
  assert.deepEqual(resultFromCells(cells, { orientation: 'b', turn: 'w' }), {
    placement: 'q6K/8/5n2/8/8/5P2/8/k6R',
    turn: 'w', uncertain: ['a4'], orientation: 'b',
  });
  assert.deepEqual(cells, diagram(), 'black mapping must not reverse the caller array');
});

test('unknown orientation preserves provisional white mapping and remains explicitly unknown', () => {
  assert.deepEqual(resultFromCells(diagram()), {
    placement: 'R6k/8/2P5/8/8/2n5/8/K6q',
    turn: null, uncertain: ['h5'], orientation: null,
  });
  assert.deepEqual(resultFromCells(Array(64).fill('?')), {
    placement: '8/8/8/8/8/8/8/8', turn: null, orientation: null,
    uncertain: Array.from({ length: 64 }, (_, index) => 'abcdefgh'[index % 8] + (8 - Math.floor(index / 8))),
  });
});

test('mapping rejects incomplete, sparse or invalid classification arrays', () => {
  for (const cells of [null, {}, [], Array(63).fill('.'), Array(65).fill('.'), Array(64)]) {
    assert.equal(resultFromCells(cells), null);
  }
  for (const piece of [null, undefined, '', ' ', 'pp', 'X', 8, true]) {
    const cells = Array(64).fill('.'); cells[8] = piece;
    assert.equal(resultFromCells(cells), null);
  }
});
