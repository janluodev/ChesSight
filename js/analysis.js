// 控制格与子力安全状态计算（F1/F2 共用同一口径：几何控制 / 伪合法）。
// 对局模式用 chess.js 的 attackers(square, color)；自由摆棋模式下局面可能
// 无法载入 chess.js（如缺王），改用本文件自研的几何遍历（口径完全一致：
// 兵仅斜吃、滑子止于首个阻挡格且含该格、含对己方子的保护、含王）。
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ALL_SQUARES = [];
for (let rank = 1; rank <= 8; rank++) {
  for (let f = 0; f < 8; f++) ALL_SQUARES.push(FILES[f] + rank);
}

let cachedFen = null;
let cachedResult = null;

// 对局模式：chess.js 口径（含被牵制子），按 FEN 记忆化
export function analyze(chess) {
  const fen = chess.fen();
  if (fen === cachedFen) return cachedResult;

  const control = {}; // sq -> 'w' | 'b' | 'wb'（无人控制则不设键）
  const counts = {};
  for (const sq of ALL_SQUARES) {
    const w = chess.attackers(sq, 'w').length;
    const b = chess.attackers(sq, 'b').length;
    counts[sq] = { w, b };
    if (w && b) control[sq] = 'wb';
    else if (w) control[sq] = 'w';
    else if (b) control[sq] = 'b';
  }

  // 安全标记规则（产品决策 2026-07-25）：
  //   被攻击 + 无保护 → attacked（红）；被攻击 + 有保护 → contested（黄）；
  //   未被攻击 + 有保护 → defended（绿）；未被攻击 + 无保护 → 不标记
  const safety = {}; // sq -> 'attacked' | 'contested' | 'defended'（仅有子格）
  const rows = chess.board();
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const cell = rows[i][j];
      if (!cell) continue;
      const name = FILES[j] + (8 - i);
      if (cell.type === 'k') {
        // 王不参与绿/黄判定；被将军时标红（只有行棋方的王可能处于被将军状态）
        if (cell.color === chess.turn() && chess.inCheck()) safety[name] = 'attacked';
        continue;
      }
      const c = counts[name];
      const enemy = cell.color === 'w' ? c.b : c.w;
      const own = cell.color === 'w' ? c.w : c.b;
      if (enemy >= 1) safety[name] = own >= 1 ? 'contested' : 'attacked';
      else if (own >= 1) safety[name] = 'defended';
    }
  }

  cachedFen = fen;
  cachedResult = { control, safety };
  return cachedResult;
}

// ---- 自研几何遍历（X-Ray 与摆棋模式共用） ----
const SLIDE_DIRS = {
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
};
const KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_OFFSETS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const sq = (f, r) => FILES[f] + r;
const on = (f, r) => f >= 0 && f < 8 && r >= 1 && r <= 8;

// rows: chess.board() 同形的 8×8 数组（行0=第8横排，元素 {type,color}|null）
function boardPieces(rows) {
  const occ = new Set();
  const pieces = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const cell = rows[i][j];
      if (!cell) continue;
      const name = FILES[j] + (8 - i);
      occ.add(name);
      pieces.push({ name, f: j, r: 8 - i, type: cell.type, color: cell.color });
    }
  }
  return { pieces, occ };
}

// 枚举棋子 p 攻击的每一个格子（滑子逐格直至首个阻挡格，含该格）
function eachAttack(p, occ, cb) {
  if (p.type === 'q' || p.type === 'r' || p.type === 'b') {
    const dirs = p.type === 'q' ? [...SLIDE_DIRS.r, ...SLIDE_DIRS.b] : SLIDE_DIRS[p.type];
    for (const [df, dr] of dirs) {
      let f = p.f + df;
      let r = p.r + dr;
      while (on(f, r)) {
        const name = sq(f, r);
        cb(name);
        if (occ.has(name)) break;
        f += df;
        r += dr;
      }
    }
  } else if (p.type === 'n' || p.type === 'k') {
    for (const [df, dr] of (p.type === 'n' ? KNIGHT_OFFSETS : KING_OFFSETS)) {
      const f = p.f + df;
      const r = p.r + dr;
      if (on(f, r)) cb(sq(f, r));
    }
  } else if (p.type === 'p') {
    const dr = p.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) {
      const f = p.f + df;
      const r = p.r + dr;
      if (on(f, r)) cb(sq(f, r));
    }
  }
}

// 摆棋模式：不依赖 chess.js 的控制格 + 安全状态（王被攻击即标红，双方皆判）
export function analyzeBoard(rows) {
  const { pieces, occ } = boardPieces(rows);
  const counts = {};
  for (const p of pieces) {
    eachAttack(p, occ, (name) => {
      const c = counts[name] || (counts[name] = { w: 0, b: 0 });
      c[p.color]++;
    });
  }
  const control = {};
  for (const name in counts) {
    const c = counts[name];
    if (c.w && c.b) control[name] = 'wb';
    else if (c.w) control[name] = 'w';
    else if (c.b) control[name] = 'b';
  }
  const safety = {};
  for (const p of pieces) {
    const c = counts[p.name] || { w: 0, b: 0 };
    const enemy = p.color === 'w' ? c.b : c.w;
    const own = p.color === 'w' ? c.w : c.b;
    if (p.type === 'k') {
      if (enemy >= 1) safety[p.name] = 'attacked';
      continue;
    }
    // 与对局模式同一规则（见 analyze）：红=被攻击无保护，黄=被攻击有保护，
    // 绿=未被攻击有保护，未被攻击无保护不标记
    if (enemy >= 1) safety[p.name] = own >= 1 ? 'contested' : 'attacked';
    else if (own >= 1) safety[p.name] = 'defended';
  }
  return { control, safety };
}

// X-Ray 杀伤线：滑子每方向合并为一条线（终点=首个阻挡格或棋盘边缘），
// 马/王/兵为逐目标短线
export function attackLinesForBoard(rows) {
  const { pieces, occ } = boardPieces(rows);
  const lines = [];
  for (const p of pieces) {
    if (p.type === 'q' || p.type === 'r' || p.type === 'b') {
      const dirs = p.type === 'q' ? [...SLIDE_DIRS.r, ...SLIDE_DIRS.b] : SLIDE_DIRS[p.type];
      for (const [df, dr] of dirs) {
        let f = p.f + df;
        let r = p.r + dr;
        let last = null;
        while (on(f, r)) {
          last = sq(f, r);
          if (occ.has(last)) break;
          f += df;
          r += dr;
        }
        if (last) lines.push({ from: p.name, to: last, color: p.color });
      }
    } else {
      eachAttack(p, occ, (name) => lines.push({ from: p.name, to: name, color: p.color }));
    }
  }
  return lines;
}

export function attackLines(chess) {
  return attackLinesForBoard(chess.board());
}
