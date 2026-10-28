// 图片识别摆盘客户端：上传图片 → canvas 压缩（仅内存，不写任何持久存储）
// → Worker /recognize → 结构化结果 → 摆棋模式校对。图片引用用完即弃，刷新自然清除。
import { ENDPOINT } from './commentary.js';

const RECOGNIZE_ENDPOINT = ENDPOINT + 'recognize';

// FEN 棋盘段 → 与 chess.board() 同形的 8×8 数组（行0=第8横排，{type,color}|null）。
// 非法输入一律抛错：Worker 已校验结构，这里再兜一层，绝不让坏数据进摆棋盘。
export function placementToBoard(placement) {
  if (typeof placement !== 'string') throw new Error('invalid placement');
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error('invalid placement');
  const board = [];
  for (const rank of ranks) {
    const row = [];
    for (const char of rank) {
      if (/[1-8]/.test(char)) {
        for (let i = 0; i < Number(char); i++) row.push(null);
      } else if (/[prnbqk]/.test(char)) {
        row.push({ type: char, color: 'b' });
      } else if (/[PRNBQK]/.test(char)) {
        row.push({ type: char.toLowerCase(), color: 'w' });
      } else {
        throw new Error('invalid placement');
      }
    }
    if (row.length !== 8) throw new Error('invalid placement');
    board.push(row);
  }
  return board;
}

// 备选框计数：标准棋子集（K1 Q1 R2 B2 N2 P8/色）减去盘上数量，下限 0。
// 与 main.js emptyCounts() 同形，识别后重算 removed，缺子在备选框徽章上可见，方便补回。
const STANDARD_COUNTS = { k: 1, q: 1, r: 2, b: 2, n: 2, p: 8 };
export function removedFromBoard(rows) {
  const removed = {
    w: { k: 0, q: 0, r: 0, b: 0, n: 0, p: 0 },
    b: { k: 0, q: 0, r: 0, b: 0, n: 0, p: 0 },
  };
  for (const color of ['w', 'b']) {
    const onBoard = { k: 0, q: 0, r: 0, b: 0, n: 0, p: 0 };
    for (const row of rows) {
      for (const cell of row) {
        if (cell && cell.color === color) onBoard[cell.type]++;
      }
    }
    for (const type of Object.keys(STANDARD_COUNTS)) {
      removed[color][type] = Math.max(0, STANDARD_COUNTS[type] - onBoard[type]);
    }
  }
  return removed;
}

// 统一图片压缩出口：最长边 ≤ maxEdge，先填白底，再选 data URL 更短的 PNG/JPEG。
// 扁平截图可保留更小的无损 PNG；照片通常选 JPEG，相同长度也保留 JPEG。
function sourceToDataUrl(source, width, height, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL('image/jpeg', quality);
  const png = canvas.toDataURL('image/png');
  return png.length < jpeg.length ? png : jpeg;
}

// File → 解码图像。文件只经 FileReader/Image 内存路径，不落地。
async function readImageFile(file) {
  if (!file || (file.type && !file.type.startsWith('image/'))) throw new Error('unsupported_image_type');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('unsupported_image_type')); // HEIC 等无法解码的格式在此拒绝
    el.src = dataUrl;
  });
  return img;
}

export async function compressImageFile(file, { maxEdge = 1120, quality = 0.82 } = {}) {
  const img = await readImageFile(file);
  return sourceToDataUrl(img, img.naturalWidth, img.naturalHeight, maxEdge, quality);
}

// 调 Worker 识别。返回 {placement, turn, uncertain[]}；placement 结构本地再校验一次。
// 网络层错误（Safari "Load failed"、Chrome "Failed to fetch"）与超时/5xx 自动重试 retries 次：
// 移动网络/弱网下这类失败多为瞬时，重试可显著降低用户感知的"识别失败"。
function abortReason(signal) {
  return signal.reason || new DOMException('Recognition cancelled', 'AbortError');
}

function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function waitToRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortReason(signal)); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal)); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function recognizePosition(dataUrl, {
  endpoint = RECOGNIZE_ENDPOINT,
  lang = 'zh',
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = 120000, // 与 Worker 的 120 秒上游超时预算一致
  retries = 1,
  signal,
} = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw abortReason(signal);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(abortReason(signal));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Recognition timeout', 'TimeoutError')), timeoutMs);
    try {
      const response = await withAbort(fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, lang }),
        signal: controller.signal,
      }), controller.signal);
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      const result = await withAbort(response.json(), controller.signal);
      if (controller.signal.aborted) throw abortReason(controller.signal);
      if (!result || typeof result !== 'object' || Array.isArray(result)
          || !['w', 'b', null].includes(result.turn) || !Array.isArray(result.uncertain)
          || result.uncertain.length > 64
          || result.uncertain.some((square) => typeof square !== 'string' || !/^[a-h][1-8]$/.test(square))) {
        throw new Error('invalid recognition result');
      }
      placementToBoard(result.placement);
      return result;
    } catch (error) {
      // 外部取消永不重试；部分浏览器把带 TimeoutError reason 的 fetch 中止仍报为 AbortError。
      if (signal?.aborted) throw abortReason(signal);
      if (controller.signal.aborted) error = abortReason(controller.signal);
      const retryable = error instanceof TypeError
        || error?.name === 'TimeoutError'
        || (error?.status >= 500 && error?.status < 600);
      if (!retryable || attempt === retries) throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
    await waitToRetry(800 * (attempt + 1), signal);
  }
  throw new Error('unreachable');
}
