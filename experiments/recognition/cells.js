// Non-production experiment: the candidate failed its accuracy gate. See README.md.
// Pure parsing/mapping for the screenshot fast path. Image indices never depend
// on a model-generated chess coordinate; orientation is a separate observation.
export function parseObject(text) {
  if (typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export function parseIndexedCells(text, occupied) {
  const object = parseObject(text);
  if (!Array.isArray(object?.cells) || object.cells.length > 64) return null;
  const cells = Array(64).fill('.');
  const seen = new Set();
  for (const entry of object.cells) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !Number.isInteger(entry.index) || entry.index < 1 || entry.index > 64
        || seen.has(entry.index)) return null;
    const piece = entry.piece;
    if (piece !== null && (typeof piece !== 'string' || !/^[.?PNBRQKpnbrqk]$/.test(piece))) return null;
    seen.add(entry.index);
    cells[entry.index - 1] = piece ?? '.';
  }
  if (occupied && occupied.some((hasPiece, index) => hasPiece
    ? !seen.has(index + 1)
    : seen.has(index + 1))) return null;
  // 底色以外的图案被模型判空时仍提示人工核对（可能是箭头，也可能是漏子）。
  if (occupied) occupied.forEach((hasPattern, index) => {
    if (hasPattern && cells[index] === '.') cells[index] = '?';
  });
  return cells;
}

export function parseOrientation(text) {
  const object = parseObject(text);
  const rank = object?.topLeftRank;
  return {
    orientation: rank === 1 || rank === '1' ? 'b' : rank === 8 || rank === '8' ? 'w' : null,
    turn: ['w', 'b'].includes(object?.turn) ? object.turn : null,
  };
}

export function resultFromCells(cells, { orientation = null, turn = null } = {}) {
  if (!Array.isArray(cells) || cells.length !== 64
      || Array.from(cells).some((piece) => typeof piece !== 'string' || !/^[.?PNBRQKpnbrqk]$/.test(piece))) return null;
  const board = orientation === 'b' ? cells.slice().reverse() : cells;
  const uncertain = [];
  const rows = [];
  for (let row = 0; row < 8; row++) {
    let rank = '', empty = 0;
    for (let col = 0; col < 8; col++) {
      const piece = board[row * 8 + col];
      if (piece === '?') uncertain.push('abcdefgh'[col] + (8 - row));
      if (piece === '.' || piece === '?') { empty++; continue; }
      if (empty) { rank += empty; empty = 0; }
      rank += piece;
    }
    if (empty) rank += empty;
    rows.push(rank);
  }
  return { placement: rows.join('/'), turn, uncertain, orientation };
}

// Frozen prompts from the independent screenshot evaluation, 2026-10-29.
const CLASSIFICATION_SYSTEM = "你是国际象棋棋盘识别助手，只输出 JSON，不输出任何解释。";
const CLASSIFICATION_PROMPT = "这些单格图片由程序筛选，可能含有棋子，每张前的index是固定原始格号。必须为每个提供的index恰好输出一次，禁止省略、增加或更改index；只判断颜色和类型。白棋PNBRQK，黑棋pnbrqk，无法辨认用?，确认为空用.；不要输出null。完整棋盘只用于外观上下文，不分析棋局、不重算位置。只输出JSON对象，只有cells字段；cells为对象数组，每个对象恰好包含整数index和单字符piece。不输出朝向、回合、解释或其他字段。";
const CONTEXT_TEXT = "完整棋盘，仅提供棋子外观上下文；位置以后面单格图的index为准。";
const ORIENTATION_SYSTEM = "你执行图像分类任务，只输出符合要求的JSON对象。";
const ORIENTATION_PROMPT = "只读取棋盘上印刷的数字，不分析棋子或棋局。第一张是完整棋盘，第二张是它的左上角放大图。在topLeftRank中原样填写左上角印刷的行号：看到数字1填1，看到数字8填8；没有印刷数字或看不清填null。不要根据棋子分布猜数字。turn仅有明确回合文字才w或b，否则null。只输出JSON对象，仅含topLeftRank和turn，不输出方向、解释或其他字段。";

const picture = (url) => ({ type: 'image_url', image_url: { url } });
function visionBody(system, content, maxTokens) {
  return {
    model: 'deepseek-flash', stream: false, thinking: { type: 'disabled' },
    temperature: 0, max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
  };
}
export function classificationBody({ image, cells, occupied }) {
  const content = [
    { type: 'text', text: CLASSIFICATION_PROMPT },
    { type: 'text', text: CONTEXT_TEXT }, picture(image),
  ];
  cells.forEach((cell, index) => {
    if (occupied[index]) content.push({ type: 'text', text: 'index=' + (index + 1) }, picture(cell));
  });
  return visionBody(CLASSIFICATION_SYSTEM, content, 1024);
}
export function orientationBody({ image, corners }) {
  return visionBody(ORIENTATION_SYSTEM, [
    { type: 'text', text: ORIENTATION_PROMPT }, picture(image), picture(corners[0]),
  ], 128);
}
