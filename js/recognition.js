// 图片识别摆盘客户端：上传/拍照 → canvas 压缩（仅内存，不写任何持久存储）
// → Worker /recognize → 结构化结果 → 摆棋模式校对。图片引用用完即弃，刷新自然清除。
import { ENDPOINT } from './commentary.js';
import { t } from './i18n.js';

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

// 统一图片压缩出口：最长边 ≤ maxEdge、JPEG（先填白底，避免透明 PNG 转 JPEG 发黑）。
function sourceToDataUrl(source, width, height, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

// File → 压缩后的 data URL。文件只经 FileReader/Image/canvas 内存路径，不落地。
export async function compressImageFile(file, { maxEdge = 1120, quality = 0.82 } = {}) {
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
  return sourceToDataUrl(img, img.naturalWidth, img.naturalHeight, maxEdge, quality);
}

// 调 Worker 识别。返回 {placement, turn, uncertain[]}；placement 结构本地再校验一次。
// 网络层错误（Safari "Load failed"、Chrome "Failed to fetch"）与超时/5xx 自动重试 retries 次：
// 移动网络/弱网下这类失败多为瞬时，重试可显著降低用户感知的"识别失败"。
export async function recognizePosition(dataUrl, {
  endpoint = RECOGNIZE_ENDPOINT,
  lang = 'zh',
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = 120000, // 与 Worker 的 max 推理超时预算一致
  retries = 1,
} = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Recognition timeout', 'TimeoutError')), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, lang }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      const result = await response.json();
      placementToBoard(result.placement);
      return result;
    } catch (error) {
      const retryable = error instanceof TypeError
        || error?.name === 'TimeoutError'
        || (error?.status >= 500 && error?.status < 600);
      if (!retryable || attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1))); // 简单退避后重试
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('unreachable');
}

// 摄像头拍照：getUserMedia 弹层预览 → 截帧压缩 → 立即停流。
// 无设备/权限拒绝抛 'camera_unavailable'；用户取消抛 AbortError。
export async function capturePhoto({ maxEdge = 1120, quality = 0.82 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera_unavailable');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    throw new Error('camera_unavailable');
  }
  try {
    return await new Promise((resolve, reject) => {
      const modal = document.createElement('div');
      modal.className = 'rec-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', t('rec.cameraTitle'));

      const video = document.createElement('video');
      video.className = 'rec-video';
      video.playsInline = true; // iOS 必须内联播放，否则全屏且无法截帧
      video.muted = true;
      video.srcObject = stream;

      const actions = document.createElement('div');
      actions.className = 'rec-actions';
      const captureBtn = document.createElement('button');
      captureBtn.type = 'button';
      captureBtn.className = 'btn btn-primary';
      captureBtn.textContent = t('rec.capture');
      captureBtn.disabled = true; // 首帧渲染前禁拍（iOS 上 videoWidth 有值时画面可能仍是黑帧）
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn';
      cancelBtn.textContent = t('rec.cancel');
      actions.append(captureBtn, cancelBtn);
      modal.append(video, actions);
      document.body.appendChild(modal);
      video.addEventListener('loadeddata', () => { captureBtn.disabled = false; }, { once: true });
      video.play().catch(() => {});
      captureBtn.focus();

      const cleanup = () => modal.remove();
      captureBtn.addEventListener('click', () => {
        if (!video.videoWidth) return; // 元数据未就绪：忽略这次点击
        const dataUrl = sourceToDataUrl(video, video.videoWidth, video.videoHeight, maxEdge, quality);
        cleanup();
        resolve(dataUrl);
      });
      cancelBtn.addEventListener('click', () => {
        cleanup();
        reject(new DOMException('Cancelled', 'AbortError'));
      });
      modal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelBtn.click();
        }
      });
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop()); // 拍照/取消/出错都立即释放摄像头
  }
}
