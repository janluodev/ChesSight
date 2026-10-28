// AI 实时解说客户端：固定串行队列，SSE 流式接收；每次请求有总截止与读空闲截止。
const ENDPOINT = 'https://chessight-commentary.swyu17.workers.dev/';
export { ENDPOINT };
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class HttpError extends Error {
  constructor(status, retryAfterMs = 0) {
    super('HTTP ' + status);
    this.status = status;
    this.retryable = RETRYABLE_STATUS.has(status);
    this.retryAfterMs = retryAfterMs;
  }
}

function abortError(message = 'Aborted') {
  return new DOMException(message, 'AbortError');
}

function timeoutError(message) {
  return new DOMException(message, 'TimeoutError');
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason || abortError()); return; }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// 截止/取消也覆盖已取得 Response 的读流阶段，不依赖 fetch 实现代为拒绝。
function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function retryAfterMs(response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function safeCall(handler, ...args) {
  try { handler?.(...args); } catch { /* UI handler failure must not poison the queue */ }
}

export function createCommentaryClient({
  endpoint = ENDPOINT,
  fetchImpl = (...args) => fetch(...args),
  sleepImpl = defaultSleep,
  randomImpl = Math.random,
  totalTimeoutMs = 20000,
  idleTimeoutMs = 8000,
  retryLimit = 1,
  queueLimit = 50,
} = {}) {
  let queue = [];
  let processing = false;
  let currentAbort = null;

  function clearCommentaryQueue() {
    const abandoned = queue;
    queue = [];
    for (const job of abandoned) safeCall(job.handlers.onCancel);
    if (currentAbort) currentAbort.abort(abortError('Commentary queue cleared'));
  }

  function enqueueCommentary(payload, handlers = {}) {
    if (queue.length >= queueLimit) {
      safeCall(handlers.onError);
      return false;
    }
    queue.push({ payload, handlers });
    void pump();
    return true;
  }

  async function readWithIdleDeadline(reader, controller) {
    let timer;
    try {
      return await Promise.race([
        withAbort(reader.read(), controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = timeoutError('Commentary stream idle timeout');
            controller.abort(error);
            reject(error);
          }, idleTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function streamOnce(payload, outerSignal, onText) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(outerSignal.reason || abortError());
    if (outerSignal.aborted) forwardAbort();
    else outerSignal.addEventListener('abort', forwardAbort, { once: true });
    const totalTimer = setTimeout(() => {
      controller.abort(timeoutError('Commentary request timeout'));
    }, totalTimeoutMs);

    let reader = null;
    let completedNaturally = false;
    try {
      const response = await withAbort(fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }), controller.signal);
      if (!response.ok || !response.body) throw new HttpError(response.status, retryAfterMs(response));

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let eventData = [];
      let text = '';
      let receivedDone = false;

      const dispatch = () => {
        if (controller.signal.aborted) throw controller.signal.reason || abortError();
        if (!eventData.length) return;
        const data = eventData.join('\n');
        eventData = [];
        if (data === '[DONE]') { receivedDone = true; return; }
        try {
          const token = JSON.parse(data).choices?.[0]?.delta?.content;
          if (token) {
            text += token;
            safeCall(onText, text);
          }
        } catch { /* 非 JSON keepalive/不完整事件不污染后续事件 */ }
      };

      const processLine = (line) => {
        if (line === '') { dispatch(); return; }
        if (line.startsWith(':')) return;
        if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /, ''));
      };

      const consume = (chunk, final = false) => {
        lineBuffer += chunk;
        let newline;
        while ((newline = lineBuffer.indexOf('\n')) >= 0) {
          const line = lineBuffer.slice(0, newline).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(newline + 1);
          processLine(line);
          if (receivedDone) return;
        }
        if (final) {
          if (lineBuffer) processLine(lineBuffer.replace(/\r$/, ''));
          lineBuffer = '';
          dispatch();
        }
      };

      for (;;) {
        const { done, value } = await readWithIdleDeadline(reader, controller);
        if (done) {
          consume(decoder.decode(), true);
          completedNaturally = true;
          break;
        }
        consume(decoder.decode(value, { stream: true }));
        if (receivedDone) break;
      }
      return text;
    } finally {
      clearTimeout(totalTimer);
      outerSignal.removeEventListener('abort', forwardAbort);
      if (reader) {
        // 清理不能继续等待一个挂起的底层 cancel，否则串行队列仍会被永久阻塞。
        if (!completedNaturally) void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }

  async function runJob(job) {
    const controller = new AbortController();
    currentAbort = controller;
    try {
      for (let attempt = 0; attempt <= retryLimit; attempt++) {
        try {
          const text = await streamOnce(job.payload, controller.signal, job.handlers.onText);
          if (controller.signal.aborted) throw controller.signal.reason || abortError();
          if (text.trim()) {
            safeCall(job.handlers.onDone, text);
            return;
          }
          if (attempt === retryLimit) {
            safeCall(job.handlers.onDone, '');
            return;
          }
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') {
            safeCall(job.handlers.onCancel);
            return;
          }
          const retryable = error instanceof HttpError ? error.retryable : error?.name === 'TimeoutError';
          if (!retryable || attempt === retryLimit) {
            safeCall(job.handlers.onError);
            return;
          }
          const backoff = Math.min(totalTimeoutMs, error.retryAfterMs
            || Math.round(400 * (2 ** attempt) * (0.8 + randomImpl() * 0.4)));
          safeCall(job.handlers.onText, '');
          try {
            await sleepImpl(backoff, controller.signal);
          } catch {
            safeCall(job.handlers.onCancel);
            return;
          }
        }
      }
    } finally {
      if (currentAbort === controller) currentAbort = null;
    }
  }

  async function pump() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) await runJob(queue.shift());
    } finally {
      processing = false;
      if (queue.length) void pump();
    }
  }

  return { enqueueCommentary, clearCommentaryQueue };
}

const defaultClient = createCommentaryClient();
export const enqueueCommentary = defaultClient.enqueueCommentary;
export const clearCommentaryQueue = defaultClient.clearCommentaryQueue;
