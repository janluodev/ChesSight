// ChesSight AI 解说代理：浏览器 → 本 Worker（持有 DEEPSEEK_API_KEY secret）→ DeepSeek API。
// 浏览器 Origin 白名单只提供 CORS 隔离，不等同身份认证；费用级防护仍需 Cloudflare WAF/限流。
const ALLOWED_ORIGINS = new Set([
  'https://chessight.art',
  'https://www.chessight.art',
  'http://localhost:8173',
  'http://127.0.0.1:8173',
]);

const OPENINGS = new Map([
  ['italian', ['意大利开局 · Italian Game', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']]],
  ['ruylopez', ['西班牙开局（鲁伊·洛佩兹）· Ruy López', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']]],
  ['sicilian', ['西西里防御 · Sicilian Defence', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6']]],
  ['french', ['法兰西防御 · French Defence', ['e4', 'e6', 'd4', 'd5']]],
  ['carokann', ['卡罗-卡恩防御 · Caro-Kann Defence', ['e4', 'c6', 'd4', 'd5']]],
  ['queensgambit', ['后翼弃兵 · Queen\'s Gambit', ['d4', 'd5', 'c4']]],
  ['kingsgambit', ['王翼弃兵 · King\'s Gambit', ['e4', 'e5', 'f4']]],
  ['kingsindian', ['王翼印度防御 · King\'s Indian Defence', ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6']]],
  ['nimzoindian', ['尼姆佐-印度防御 · Nimzo-Indian Defence', ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4']]],
  ['english', ['英国开局 · English Opening', ['c4']]],
  ['scotch', ['苏格兰开局 · Scotch Game', ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4']]],
  ['petrov', ['彼得罗夫防御（俄罗斯防御）· Petrov Defence', ['e4', 'e5', 'Nf3', 'Nf6']]],
  ['dutch', ['荷兰防御 · Dutch Defence', ['d4', 'f5']]],
  ['london', ['伦敦体系 · London System', ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4']]],
]);

const SYSTEM_PROMPT_ZH =
  '你是一位国际象棋解说员，用中文解说，风格清晰而富有诗意。' +
  '针对给出的最新一步棋，点出它的意图、制造的威胁或与前着的呼应。' +
  '棋谱每步已标注（白）/（黑）执子方，并附有双方现存子力及其所在格的清单；' +
  '解说必须与这些标注一致：不得说错棋子颜色归属，不得提及清单中不存在或已被吃掉的棋子，' +
  '不得把棋子说在清单标注之外的格子上。' +
  '严格限制在两句话以内（不超过60字为佳）。' +
  '直接输出解说正文：不要复述着法记号、不要编号、不要引号、不要提及你是AI或解说员。';

const SYSTEM_PROMPT_EN =
  'You are a chess commentator writing in English, in a clear and poetic style. ' +
  'For the latest move given, point out its idea, the threat it creates, or how it connects with the previous moves. ' +
  'Each half-move in the score is annotated (White)/(Black), and a list of both sides\' remaining material with squares is provided; ' +
  'your commentary must stay consistent with these annotations: never misstate which side a piece belongs to, never mention pieces that are not in the list or have been captured, ' +
  'and never place a piece on a square other than the one listed. ' +
  'Strictly at most two sentences (about 60 words or fewer is best). ' +
  'Output the commentary directly: do not repeat the move notation, do not number anything, do not use quotation marks, and do not mention that you are an AI or a commentator.';

const LANGS = new Set(['zh', 'en']);

const MAX_BODY_BYTES = 8192;
const MAX_MOVES = 400;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;
const MAX_RATE_KEYS = 5000;
const UPSTREAM_TIMEOUT_MS = 15000;
const UPSTREAM_URL = 'https://api.deepseek.com/chat/completions';
const ALLOWED_FIELDS = new Set(['moves', 'lastMove', 'fen', 'opening', 'piece', 'captured', 'lang']);

// ---- 图片识别摆盘（POST /recognize）：独立限制与上游模型，与解说路径互不影响 ----
const RECOGNIZE_MAX_BODY_BYTES = 4 * 1024 * 1024; // 压缩图片 base64 通常 <500KB，留足余量
const RECOGNIZE_MAX_BASE64_CHARS = 4000000; // 解码后约 3MB，配合 body 上限双保险
const RECOGNIZE_RATE_LIMIT = 10; // 图像请求更贵：独立更严限流（与解说分开计数）
const RECOGNIZE_TIMEOUT_MS = 120000; // max 推理 + 复杂局面可能超过 60s，非流式覆盖到 body 读完
const RECOGNIZE_MODEL = 'deepseek-flash'; // DeepSeek 官方 API 当前即 V4.1-Flash-1017（官方仅接受 deepseek-flash / deepseek-v4-pro 两个模型名）
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const RECOGNIZE_FIELDS = new Set(['image', 'lang']);
// 易位分支同样允许将军/将杀后缀：chess.js 对造成将军的易位产出 'O-O+' / 'O-O-O#'，
// 且前端传的是整盘历史，漏掉该后缀会使此后整局的解说请求全部 400。
const SAN = /^(?:O-O(?:-O)?[+#]?|[KQRBN]?(?:[a-h]|[1-8]|[a-h][1-8])?x?[a-h][1-8](?:=[QRBN])?[+#]?)$/;

class RequestProblem extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

// Isolate 内的 O(1) 后备限流仅用于降噪；生产费用保护应在 Cloudflare 边缘层配置。
const hits = new Map();
function locallyRateLimited(key, limit = RATE_LIMIT, now = Date.now()) {
  let entry = hits.get(key);
  if (!entry || now - entry.startedAt >= RATE_WINDOW_MS) {
    if (!entry && hits.size >= MAX_RATE_KEYS) hits.delete(hits.keys().next().value);
    entry = { startedAt: now, count: 0 };
    hits.set(key, entry);
  }
  if (entry.count >= limit) return true;
  entry.count++;
  return false;
}

function logEvent(event, requestId, details = {}) {
  // 不记录 IP、Authorization、Prompt、FEN、棋谱或 secret。
  console.log(JSON.stringify({ event, requestId, ...details }));
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(body, status, cors, extra = {}) {
  return new Response(body, { status, headers: { ...cors, ...extra } });
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const contentType = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestProblem(415, 'unsupported_media_type');

  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestProblem(413, 'body_too_large');
  if (!request.body) throw new RequestProblem(400, 'empty_body');

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel('body_too_large').catch(() => {});
        throw new RequestProblem(413, 'body_too_large');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestProblem(400, 'invalid_json');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// FEN 棋盘段结构校验（8 行、每行合计 8 格、字符集合法），isFenShape 与识别结果共用
function isPlacementShape(placement) {
  if (typeof placement !== 'string' || placement.length > 90) return false;
  const ranks = placement.split('/');
  if (ranks.length !== 8) return false;
  for (const rank of ranks) {
    let count = 0;
    for (const char of rank) {
      if (/[1-8]/.test(char)) count += Number(char);
      else if (/[prnbqkPRNBQK]/.test(char)) count++;
      else return false;
    }
    if (count !== 8) return false;
  }
  return true;
}

function isFenShape(fen) {
  if (typeof fen !== 'string' || fen.length > 100) return false;
  const fields = fen.split(' ');
  if (fields.length !== 6) return false;
  if (!isPlacementShape(fields[0])) return false;
  return /^[wb]$/.test(fields[1])
    && /^(?:-|(?=[KQkq])K?Q?k?q?)$/.test(fields[2]) // 前瞻强制非空：易位段只能是 '-' 或至少一个权利字母
    && /^(?:-|[a-h][36])$/.test(fields[3])
    && /^\d+$/.test(fields[4])
    && /^[1-9]\d*$/.test(fields[5]);
}

function sameMoves(actual, expected) {
  return actual.length === expected.length && actual.every((move, index) => move === expected[index]);
}

function validatePayload(body) {
  if (!isPlainObject(body)) throw new RequestProblem(400, 'invalid_object');
  if (Object.keys(body).some((field) => !ALLOWED_FIELDS.has(field))) {
    throw new RequestProblem(400, 'unknown_field');
  }
  // 可选解说语言：默认中文（旧客户端不发送该字段，行为不变）
  let lang = 'zh';
  if (body.lang !== undefined) {
    if (typeof body.lang !== 'string' || !LANGS.has(body.lang)) throw new RequestProblem(400, 'invalid_lang');
    lang = body.lang;
  }
  if (!Array.isArray(body.moves) || body.moves.length < 1 || body.moves.length > MAX_MOVES) {
    throw new RequestProblem(400, 'invalid_moves');
  }
  if (!body.moves.every((move) => typeof move === 'string' && move.length <= 8 && SAN.test(move))) {
    throw new RequestProblem(400, 'invalid_san');
  }

  if (body.opening !== undefined) {
    if (typeof body.opening !== 'string' || !OPENINGS.has(body.opening)) {
      throw new RequestProblem(400, 'unknown_opening');
    }
    if (body.piece !== undefined || body.captured !== undefined) throw new RequestProblem(400, 'unknown_field');
    const [name, expectedMoves] = OPENINGS.get(body.opening);
    if (!sameMoves(body.moves, expectedMoves)) throw new RequestProblem(400, 'opening_moves_mismatch');
    return { kind: 'opening', name, moves: body.moves, lang };
  }

  if (typeof body.lastMove !== 'string' || body.lastMove !== body.moves.at(-1) || !SAN.test(body.lastMove)) {
    throw new RequestProblem(400, 'invalid_last_move');
  }
  if (!isFenShape(body.fen)) throw new RequestProblem(400, 'invalid_fen');
  // 可选：最新一步的动子与被吃子（chess.js 单字母记号）。SAN 不含被吃子信息，
  // 由客户端显式提供，prompt 中明示给模型，杜绝"吃掉的是什么"解说错。
  if (body.piece !== undefined && !(typeof body.piece === 'string' && /^[pnbrqk]$/.test(body.piece))) {
    throw new RequestProblem(400, 'invalid_piece');
  }
  if (body.captured !== undefined && !(typeof body.captured === 'string' && /^[pnbrq]$/.test(body.captured))) {
    throw new RequestProblem(400, 'invalid_captured');
  }
  return { kind: 'move', moves: body.moves, lastMove: body.lastMove, fen: body.fen, piece: body.piece, captured: body.captured, lang };
}

function fmtMoves(moves, lang = 'zh') {
  // 每个半着显式标注执子方（偶数下标=白、奇数下标=黑）：
  // 非思考模式的小模型难以从裸 SAN 自行推算颜色归属，标注后不再解说错方。
  const white = lang === 'en' ? ' (White)' : '（白）';
  const black = lang === 'en' ? ' (Black)' : '（黑）';
  let text = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) text += (i / 2 + 1) + '. ';
    text += moves[i] + (i % 2 === 0 ? white : black) + ' ';
  }
  return text.trim();
}

const PIECE_CN = { k: '王', q: '后', r: '车', b: '象', n: '马', p: '兵' };
const PIECE_EN = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };
const PIECE_ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];

// 从 FEN 棋盘段生成带格位的双方子力清单（FEN 已过 isFenShape 校验），
// 供模型对照实况：既防说错归属/数量，也防把棋子说到不存在的格子上
// （如把已随吃子离场的 e4 兵当作仍在 e4）。同型多子以 / 连接，如 车a1/h1。
function materialFromFen(fen, lang = 'zh') {
  const bySide = { w: new Map(), b: new Map() };
  const ranks = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const char of ranks[r]) {
      if (/[1-8]/.test(char)) { file += Number(char); continue; }
      const side = char === char.toUpperCase() ? 'w' : 'b';
      const type = char.toLowerCase();
      const squares = bySide[side].get(type) || [];
      squares.push('abcdefgh'[file] + (8 - r));
      bySide[side].set(type, squares);
      file++;
    }
  }
  const names = lang === 'en' ? PIECE_EN : PIECE_CN;
  const gap = lang === 'en' ? ' ' : ''; // 英文棋子名与格位分写（King e1），中文连写（王e1）
  const list = (side) => PIECE_ORDER
    .filter((type) => bySide[side].has(type))
    .map((type) => names[type] + gap + bySide[side].get(type).join('/'))
    .join(lang === 'en' ? ', ' : '、');
  return lang === 'en'
    ? `Remaining material (with squares; every square not listed is empty) — White: ${list('w')}; Black: ${list('b')}`
    : `双方现存子力（含所在格，此清单之外的格子均为空）——白方：${list('w')}；黑方：${list('b')}`;
}

// 开局名同时含「中文 · English」两段（如 意大利开局 · Italian Game），英文 prompt 只取英文段
const openingNameEn = (name) => name.split('·')[1]?.trim() || name;

// ---- 图片识别摆盘 ----
// 输出契约：{placement, turn, uncertain[]}，不让模型写完整 FEN（易位权/过路兵由前端推断与确认）
function validateRecognizePayload(body) {
  if (!isPlainObject(body)) throw new RequestProblem(400, 'invalid_object');
  if (Object.keys(body).some((field) => !RECOGNIZE_FIELDS.has(field))) {
    throw new RequestProblem(400, 'unknown_field');
  }
  let lang = 'zh';
  if (body.lang !== undefined) {
    if (typeof body.lang !== 'string' || !LANGS.has(body.lang)) throw new RequestProblem(400, 'invalid_lang');
    lang = body.lang;
  }
  if (typeof body.image !== 'string') throw new RequestProblem(400, 'invalid_image');
  const match = body.image.match(IMAGE_DATA_URL);
  if (!match) throw new RequestProblem(400, 'invalid_image');
  if (match[2].length % 4 !== 0) throw new RequestProblem(400, 'invalid_image');
  if (match[2].length > RECOGNIZE_MAX_BASE64_CHARS) throw new RequestProblem(413, 'image_too_large');
  return { image: body.image, lang };
}

const RECOGNIZE_SYSTEM_ZH = '你是国际象棋棋盘识别助手，只输出 JSON，不输出任何解释。';
const RECOGNIZE_SYSTEM_EN = 'You are a chess board recognition assistant. Output JSON only, with no explanation.';

function recognizePrompt(lang) {
  return lang === 'en'
    ? 'Read the chess position in this image and output a single JSON object, with no other text or Markdown.\n'
      + 'Rules:\n'
      + '1. Locate the 8x8 board and determine its orientation: in the standard White view a1 is the bottom-left square, and White pieces usually occupy the two ranks nearest the camera/viewer. If the board is rotated or photographed from the Black side, infer the correct rank order accordingly.\n'
      + '2. Scan rank by rank from 8 down to 1, and within each rank file by file from a to h. Confirm each square\'s coordinates BEFORE recording its piece; never shift a piece into a neighbouring file because of an empty square next to it.\n'
      + '3. "pieces" lists every occupied square as {"square":"e4","piece":"P"}: White pieces use uppercase P N B R Q K, Black pieces lowercase p n b r q k. Do not list empty squares and do not omit any piece.\n'
      + '4. "turn" must be "w" or "b" ONLY if the image explicitly shows whose turn it is (e.g. a UI label); otherwise use null. Never guess.\n'
      + '5. "uncertain" lists square names you are unsure about (standard White view coordinates, e.g. ["e4"]); use [] when fully confident.\n'
      + 'Output exactly: {"pieces":[...],"turn":...,"uncertain":[...]}'
    : '识别这张图片中的国际象棋局面，只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown。\n'
      + '要求：\n'
      + '1. 找到 8×8 棋盘并确定朝向：标准白方视角下 a1 在左下角，白方棋子通常位于靠近观察者的一侧两排；若棋盘旋转或从黑方一侧拍摄，据此推断正确的 rank 顺序。\n'
      + '2. 按 rank 从 8 到 1 逐行、每行按 file 从 a 到 h 逐格识别。先确认每个格子的坐标，再记录棋子；空格不记录，但绝不能因为有空格就把后面的棋子写到前一列。\n'
      + '3. pieces 数组逐格列出所有非空格子：{"square":"e4","piece":"P"}。白方 P N B R Q K 大写，黑方 p n b r q k 小写，不要遗漏任何棋子。\n'
      + '4. turn 仅当图片中有明确回合指示（如界面显示"白方走"/"White to move"）时填 "w" 或 "b"，否则填 null，不要猜测。\n'
      + '5. uncertain 为不确定格子的名称数组（标准白方视角坐标，如 ["e4"]），完全确定则为 []。\n'
      + '只输出：{"pieces":[...],"turn":...,"uncertain":[...]}';
}

// pieces 逐格清单 → FEN 棋盘段：由代码确定性拼接，不让模型自己拼 FEN（空格计数/列对齐最易错）
function placementFromPieces(pieces) {
  if (!Array.isArray(pieces) || pieces.length > 64) return null;
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  const seen = new Set();
  for (const entry of pieces) {
    if (!isPlainObject(entry)) return null;
    const { square, piece } = entry;
    if (typeof square !== 'string' || !/^[a-h][1-8]$/.test(square)) return null;
    if (typeof piece !== 'string' || !/^[prnbqkPRNBQK]$/.test(piece)) return null;
    if (seen.has(square)) return null;
    seen.add(square);
    grid[8 - Number(square[1])]['abcdefgh'.indexOf(square[0])] = piece;
  }
  return grid.map((row) => {
    let s = '';
    let run = 0;
    for (const cell of row) {
      if (!cell) { run++; continue; }
      if (run) { s += run; run = 0; }
      s += cell;
    }
    if (run) s += run;
    return s;
  }).join('/');
}

// 解析模型输出：容忍 markdown fence；turn 非法一律降级为 null（由用户确认）
function parseRecognizeContent(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { return null; }
  if (!isPlainObject(parsed)) return null;
  const placement = placementFromPieces(parsed.pieces);
  if (!placement) return null;
  const turn = parsed.turn === 'w' || parsed.turn === 'b' ? parsed.turn : null;
  const uncertain = Array.isArray(parsed.uncertain)
    ? [...new Set(parsed.uncertain.filter((s) => typeof s === 'string' && /^[a-h][1-8]$/.test(s)))].slice(0, 64)
    : [];
  return { placement, turn, uncertain };
}

function promptFor(payload) {
  const lang = payload.lang === 'en' ? 'en' : 'zh';
  if (payload.kind === 'opening') {
    return lang === 'en'
      ? `The board has just been set up with the opening "${openingNameEn(payload.name)}" (moves: ${fmtMoves(payload.moves, lang)}). In at most two sentences, describe this opening's core idea and character.`
      : `棋盘刚按开局库摆出「${payload.name}」（着法：${fmtMoves(payload.moves, lang)}）。请用不超过两句话整体解说这个开局的核心意图与棋风气质。`;
  }
  const names = lang === 'en' ? PIECE_EN : PIECE_CN;
  const sideJustMoved = payload.moves.length % 2 === 1
    ? (lang === 'en' ? 'White' : '白方')
    : (lang === 'en' ? 'Black' : '黑方');
  // SAN 不含被吃子信息，被吃子由客户端提供并在此明示，模型不必（也不许）自行猜测
  let moveNote = '';
  if (payload.captured) {
    const opponent = lang === 'en'
      ? (sideJustMoved === 'White' ? 'Black' : 'White')
      : (sideJustMoved === '白方' ? '黑方' : '白方');
    moveNote = lang === 'en'
      ? ` (in this move ${sideJustMoved}'s ${names[payload.piece || 'p']} captured ${opponent}'s ${names[payload.captured]})`
      : `（这一步是${sideJustMoved}用${names[payload.piece || 'p']}吃掉了${opponent}的${names[payload.captured]}）`;
  }
  return lang === 'en'
    ? `Current score (each half-move annotated with the moving side): ${fmtMoves(payload.moves, lang)}\n${materialFromFen(payload.fen, lang)}\n${sideJustMoved} just played the latest move: ${payload.lastMove}${moveNote}. Comment on this move.\n(Current position FEN for reference: ${payload.fen})`
    : `当前棋谱（每步已标注执子方）：${fmtMoves(payload.moves, lang)}\n${materialFromFen(payload.fen, lang)}\n${sideJustMoved}刚走了最新一步：${payload.lastMove}${moveNote}。请解说这一步。\n（当前局面 FEN 供参考：${payload.fen}）`;
}

// 图片识别端点：非流式（识别只需一次完整 JSON），超时覆盖到响应 body 读完。
// 日志只记事件/状态/耗时，绝不记录图片或 base64。
async function handleRecognize(request, env, { cors, requestId, ip }) {
  if (locallyRateLimited('rec:' + ip, RECOGNIZE_RATE_LIMIT)) {
    logEvent('request_rejected', requestId, { reason: 'rate_limit', status: 429 });
    return reply('Too Many Requests', 429, cors, { 'Retry-After': '60' });
  }

  let payload;
  try {
    payload = validateRecognizePayload(await readJson(request, RECOGNIZE_MAX_BODY_BYTES));
  } catch (error) {
    const status = error instanceof RequestProblem ? error.status : 400;
    const reason = error instanceof RequestProblem ? error.reason : 'bad_request';
    logEvent('request_rejected', requestId, { reason, status });
    return reply(status === 413 ? 'Payload Too Large' : 'Bad Request', status, cors);
  }

  const timeoutCtl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtl.abort(), RECOGNIZE_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeoutCtl.signal]);
  const startedAt = Date.now();
  let upstream;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: RECOGNIZE_MODEL,
        stream: false,
        thinking: { type: 'enabled' },
        // 推理强度（2026-10-28 实测）：max 在复杂局面会反复思考到 token 耗尽（reasoning 超 16k
        // 仍未产出正文 → 502）；high 深度推理同图 23/23 全对且 token 可控，固定用 high。
        reasoning_effort: 'high',
        // 推理的 reasoning 在复杂局面可达 8–10k tokens，必须给足额度：
        // 限额过小会只输出思考、正文为空（上游 finish_reason=length，表现为 502）
        max_tokens: 16000,
        temperature: 0.2, // 识别任务要确定性，不要文采
        messages: [
          { role: 'system', content: payload.lang === 'en' ? RECOGNIZE_SYSTEM_EN : RECOGNIZE_SYSTEM_ZH },
          { role: 'user', content: [
            { type: 'text', text: recognizePrompt(payload.lang) },
            { type: 'image_url', image_url: { url: payload.image } },
          ] },
        ],
      }),
    });
  } catch {
    clearTimeout(timeoutId);
    logEvent('upstream_failed', requestId, {
      reason: signal.aborted ? 'aborted_or_timeout' : 'network',
      status: 502,
      durationMs: Date.now() - startedAt,
    });
    return reply('Upstream error', 502, cors);
  }

  let data = null;
  try {
    if (upstream.ok) data = await upstream.json().catch(() => null);
  } finally {
    clearTimeout(timeoutId);
  }
  const result = data ? parseRecognizeContent(data.choices?.[0]?.message?.content ?? '') : null;
  if (!result) {
    logEvent('upstream_failed', requestId, {
      reason: 'response',
      upstreamStatus: upstream.status,
      status: 502,
      durationMs: Date.now() - startedAt,
    });
    return reply('Upstream error', 502, cors);
  }

  logEvent('request_completed', requestId, { status: 200, durationMs: Date.now() - startedAt });
  return reply(JSON.stringify(result), 200, cors, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.has(origin);
    const cors = corsHeaders(origin);
    const requestId = request.headers.get('CF-Ray') || crypto.randomUUID();

    if (request.method === 'OPTIONS') {
      return okOrigin ? reply(null, 204, cors) : reply('Forbidden', 403, cors);
    }
    if (request.method !== 'POST') return reply('Method Not Allowed', 405, cors, { Allow: 'POST, OPTIONS' });
    if (!okOrigin) {
      logEvent('request_rejected', requestId, { reason: 'origin', status: 403 });
      return reply('Forbidden', 403, cors);
    }
    if (typeof env?.DEEPSEEK_API_KEY !== 'string' || !env.DEEPSEEK_API_KEY.trim()) {
      logEvent('service_unavailable', requestId, { reason: 'configuration', status: 503 });
      return reply('Service unavailable', 503, cors, { 'Retry-After': '60' });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (new URL(request.url).pathname === '/recognize') {
      return handleRecognize(request, env, { cors, requestId, ip });
    }

    if (locallyRateLimited(ip)) {
      logEvent('request_rejected', requestId, { reason: 'rate_limit', status: 429 });
      return reply('Too Many Requests', 429, cors, { 'Retry-After': '60' });
    }

    let payload;
    try {
      payload = validatePayload(await readJson(request));
    } catch (error) {
      const status = error instanceof RequestProblem ? error.status : 400;
      const reason = error instanceof RequestProblem ? error.reason : 'bad_request';
      logEvent('request_rejected', requestId, { reason, status });
      return reply(status === 413 ? 'Payload Too Large' : 'Bad Request', status, cors);
    }

    // 15s 超时仅覆盖「到响应头返回」（首字之前）：响应一旦开始，clearTimeout 解除闹钟，
    // 流不再因超时被中途截断（产品决策 2026-07-23：开始出字就让它说完）。
    // 流阶段的取消只跟随客户端断连（request.signal 仍在 signal 组合内）。
    const timeoutCtl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtl.abort(), UPSTREAM_TIMEOUT_MS);
    const signal = AbortSignal.any([request.signal, timeoutCtl.signal]);
    const startedAt = Date.now();
    let upstream;
    try {
      upstream = await fetch(UPSTREAM_URL, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          stream: true,
          thinking: { type: 'disabled' },
          max_tokens: 120,
          temperature: 0.7, // 1.0 时开局理论型幻觉概率明显偏高（如把已离场的 e4 兵当仍在场）；0.7 收紧事实、保留文采
          messages: [
            { role: 'system', content: payload.lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH },
            { role: 'user', content: promptFor(payload) },
          ],
        }),
      });
    } catch (error) {
      clearTimeout(timeoutId);
      logEvent('upstream_failed', requestId, {
        reason: signal.aborted ? 'aborted_or_timeout' : 'network',
        status: 502,
        durationMs: Date.now() - startedAt,
      });
      return reply('Upstream error', 502, cors);
    }
    clearTimeout(timeoutId); // 响应头已到：解除首字超时，流式阶段不再截断

    const upstreamType = upstream.headers.get('Content-Type') || '';
    if (!upstream.ok || !upstream.body || !upstreamType.toLowerCase().startsWith('text/event-stream')) {
      logEvent('upstream_failed', requestId, {
        reason: 'response',
        upstreamStatus: upstream.status,
        status: 502,
        durationMs: Date.now() - startedAt,
      });
      return reply('Upstream error', 502, cors);
    }

    logEvent('request_completed', requestId, { status: 200, durationMs: Date.now() - startedAt });
    return new Response(upstream.body, {
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  },
};
