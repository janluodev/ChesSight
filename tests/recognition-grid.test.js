import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBoardGrid, detectOccupiedCells } from '../experiments/recognition/grid.js';

const LIGHT = [235, 236, 208];
const DARK = [115, 149, 82];

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...pixel(x, y), 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

function board({ pitch = 32, margin = 0, cropTop = 0, colors = [LIGHT, DARK], highlights = [], pieces = false, outerInset = 0, columns = 8, rows = 8 } = {}) {
  const width = pitch * columns + margin * 2;
  const height = pitch * rows + margin * 2 - cropTop;
  return image(width, height, (x, y) => {
    const bx = x - margin, by = y - margin + cropTop;
    if (bx < outerInset || by < outerInset || bx >= pitch * columns - outerInset || by >= pitch * rows - outerInset) return [8, 8, 8];
    const column = Math.floor(bx / pitch), row = Math.floor(by / pitch);
    if (pieces && (row < 2 || row >= 6) && bx % pitch > pitch * 0.23 && bx % pitch < pitch * 0.76
        && by % pitch > pitch * 0.18 && by % pitch < pitch * 0.84) return row < 2 ? [14, 14, 14] : [250, 250, 250];
    if (highlights.includes(row * 8 + column)) return [247, 246, 123];
    return colors[(row + column) % 2];
  });
}

test('detects all 64 cells with a border, highlights and pieces covering cell centers', () => {
  const result = detectBoardGrid(board({ pitch: 40, margin: 12, highlights: [54, 63], pieces: true, outerInset: 3 }));
  assert.ok(result);
  assert.deepEqual(result.xEdges, Array.from({ length: 9 }, (_, index) => 12 + index * 40));
  assert.deepEqual(result.yEdges, result.xEdges);
  assert.equal(result.cellWidth, 40);
  assert.equal(result.cellHeight, 40);
  assert.ok(result.confidence >= 0.94);
  assert.ok(result.supportedCells >= 48);
});

test('preserves the lattice pitch with a mildly clipped first rank', () => {
  const result = detectBoardGrid(board({ pitch: 40, cropTop: 12 }));
  assert.ok(result);
  assert.deepEqual(result.xEdges, Array.from({ length: 9 }, (_, index) => index * 40));
  assert.deepEqual(result.yEdges, [0, 28, 68, 108, 148, 188, 228, 268, 308]);
  assert.equal(result.origin.y, -12);
  assert.equal(result.cellHeight, 40);
});

test('refuses large outer clipping instead of guessing a different rank origin', () => {
  assert.equal(detectBoardGrid(board({ pitch: 40, cropTop: 24 })), null);
});

test('grid coordinates do not depend on orientation or square-color ordering', () => {
  const original = board({ pitch: 36, margin: 5, highlights: [9, 48], pieces: true });
  const rotated = image(original.width, original.height, (x, y) => {
    const index = ((original.height - y - 1) * original.width + original.width - x - 1) * 4;
    return [...original.data.subarray(index, index + 3)];
  });
  const a = detectBoardGrid(original), b = detectBoardGrid(rotated);
  assert.ok(a && b);
  assert.deepEqual(a.xEdges, b.xEdges);
  assert.deepEqual(a.yEdges, b.yEdges);
  const swapped = detectBoardGrid(board({ pitch: 36, margin: 5, colors: [DARK, LIGHT] }));
  assert.deepEqual(a.xEdges, swapped.xEdges);
  assert.deepEqual(a.yEdges, swapped.yEdges);
});

test('supports light and dark themes without hardcoded board colors', () => {
  for (const colors of [[[36, 39, 44], [77, 83, 92]], [[190, 199, 212], [235, 239, 245]], [[157, 104, 63], [230, 192, 143]]]) {
    const result = detectBoardGrid(board({ colors }));
    assert.ok(result, JSON.stringify(colors));
    assert.deepEqual(result.xEdges, [0, 32, 64, 96, 128, 160, 192, 224, 256]);
  }
});

test('tolerates small compression-like color variation within flat squares', () => {
  const source = board({ pitch: 32, pieces: true });
  for (let i = 0; i < source.data.length; i += 4) {
    const variation = ((i / 4) % 7) - 3;
    for (let channel = 0; channel < 3; channel++) source.data[i + channel] += variation;
  }
  assert.ok(detectBoardGrid(source));
});

test('rejects gradients, stripes, line grids and non-8x8 checkerboards', () => {
  const candidates = [
    image(256, 256, (x, y) => [x, y, (x + y) / 2]),
    image(256, 256, (x) => Math.floor(x / 32) % 2 ? LIGHT : DARK),
    image(256, 256, (x, y) => x % 32 < 2 || y % 32 < 2 ? DARK : LIGHT),
    board({ columns: 9, rows: 9 }),
    board({ pitch: 64, columns: 4, rows: 4 }),
  ];
  for (const candidate of candidates) assert.equal(detectBoardGrid(candidate), null);
});

test('rejects a perspective trapezoid even though its rows are evenly spaced', () => {
  const candidate = image(340, 300, (x, y) => {
    if (y < 20 || y >= 276) return [8, 8, 8];
    const t = (y - 20) / 256;
    const left = 52 - t * 40;
    const rowWidth = 236 + t * 80;
    const u = (x - left) / rowWidth;
    if (u < 0 || u >= 1) return [8, 8, 8];
    return (Math.floor(t * 8) + Math.floor(u * 8)) % 2 ? LIGHT : DARK;
  });
  assert.equal(detectBoardGrid(candidate), null);
});

test('unsupported or malformed image buffers return null', () => {
  for (const input of [undefined, null, {}, { data: new Uint8ClampedArray(4), width: 1, height: 1 },
    { data: new Uint8ClampedArray(256 * 256 * 4), width: 256, height: 256 },
    { data: new Uint8ClampedArray(3), width: 256, height: 256 },
    { data: [], width: Infinity, height: 256 }]) {
    assert.equal(detectBoardGrid(input), null);
  }
});

test('ignores outer color transitions around a mildly cropped board', () => {
  const source = board({ pitch: 40, margin: 8, cropTop: 12 });
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i] === 8) source.data.set(LIGHT, i);
  }
  const result = detectBoardGrid(source);
  assert.ok(result);
  assert.deepEqual(result.xEdges, Array.from({ length: 9 }, (_, index) => 8 + index * 40));
  assert.deepEqual(result.yEdges, [0, 36, 76, 116, 156, 196, 236, 276, 316]);
});

test('occupied mask preserves center figures and treats uniform highlights as empty', () => {
  const source = board({ pitch: 40, pieces: true, highlights: [24, 40] });
  const grid = detectBoardGrid(source);
  const mask = detectOccupiedCells(source, grid);
  assert.ok(mask);
  assert.deepEqual(mask, Array.from({ length: 64 }, (_, index) => index < 16 || index >= 48));
});

test('empty occupancy ignores coordinate corners, bottom letters and small color noise', () => {
  const source = image(320, 320, (x, y) => {
    const column = Math.floor(x / 40), row = Math.floor(y / 40), u = x % 40, v = y % 40;
    if ((column === 0 && u < 6 && v < 7) || (row === 7 && u > 28 && v > 34)) return [12, 12, 12];
    const variation = (x + y) % 7 - 3;
    return [LIGHT, DARK][(column + row) % 2].map((value) => value + variation);
  });
  assert.deepEqual(detectOccupiedCells(source, detectBoardGrid(source)), Array(64).fill(false));
});

test('small low-contrast figures and oversized silhouettes are conservatively occupied', () => {
  const source = image(320, 320, (x, y) => {
    const column = Math.floor(x / 40), row = Math.floor(y / 40), u = x % 40, v = y % 40;
    const background = [[36, 39, 44], [77, 83, 92]][(column + row) % 2];
    if (row === 3 && column === 3 && u >= 19 && u <= 21 && v > 13 && v < 28) return background.map((value) => value + 10);
    if (row === 4 && column === 4 && u > 1 && u < 38 && v > 1 && v < 38) return [225, 225, 225];
    return background;
  });
  const mask = detectOccupiedCells(source, detectBoardGrid(source));
  assert.ok(mask);
  assert.equal(mask[27], true);
  assert.equal(mask[36], true);
  assert.equal(mask.filter(Boolean).length, 2);
});

test('occupancy uses image order and remains usable with mild outer cropping', () => {
  const source = board({ pitch: 40, cropTop: 12, pieces: true });
  const mask = detectOccupiedCells(source, detectBoardGrid(source));
  assert.deepEqual(mask, Array.from({ length: 64 }, (_, index) => index < 16 || index >= 48));
  const rotated = image(source.width, source.height, (x, y) => {
    const index = ((source.height - y - 1) * source.width + source.width - x - 1) * 4;
    return [...source.data.subarray(index, index + 3)];
  });
  assert.deepEqual(detectOccupiedCells(rotated, detectBoardGrid(rotated)), [...mask].reverse());
});

test('occupancy returns null for missing or invalid geometry instead of assuming empty', () => {
  const source = board();
  for (const grid of [null, {}, { xEdges: Array(9).fill(0), yEdges: Array(9).fill(0) },
    { xEdges: Array.from({ length: 9 }, (_, i) => i * 32), yEdges: Array(9).fill(Infinity) }]) {
    assert.equal(detectOccupiedCells(source, grid), null);
  }
  assert.equal(detectOccupiedCells(null, detectBoardGrid(source)), null);
});
