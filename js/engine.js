// Stockfish 引擎封装：Web Worker + UCI 协议。单线程 lite 构建适配静态托管。
// 初始化截止时间覆盖 WASM 预下载、流式读取与 Worker UCI 握手的完整链路。
// WASM 持久缓存（产品决策 2026-07-25）：下载完成后写入 Cache Storage，之后访问直接命中，
// 不再走网络或重验证；缓存名随 vendor 内容哈希版本化，升级 Stockfish 时旧缓存自然废弃。
const ENGINE_CACHE = 'chessight-engine-a8fbc05e'; // 后 8 位 = scripts/check.mjs 中 stockfish wasm 的固定哈希前缀，升级 vendor 时必须同步

export function createEngine(workerUrl, {
  fetchImpl = (...args) => fetch(...args),
  WorkerCtor = globalThis.Worker,
  initTimeoutMs = 90000,
} = {}) {
  let worker = null;
  let ready = null;
  const wasmUrl = workerUrl.replace(/\.js$/, '.wasm');

  function reset() {
    if (worker) {
      try { worker.terminate(); } catch { /* ignore */ }
    }
    worker = null;
    ready = null;
  }

  function withAbort(promise, signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }

  async function openEngineCache() {
    if (typeof caches === 'undefined') return null; // Node 测试 / 非安全上下文：退回普通 fetch
    try { return await caches.open(ENGINE_CACHE); } catch { return null; } // 隐私模式等：静默降级
  }

  async function preloadWasm(onProgress, signal) {
    const cache = await openEngineCache();
    if (cache) {
      try {
        const hit = await cache.match(wasmUrl);
        if (hit) {
          await hit.arrayBuffer(); // 读一遍验证缓存可读完整，坏缓存回源重下
          if (onProgress) onProgress('100%');
          return;
        }
      } catch { /* 缓存读取失败：回源 */ }
    }

    const response = await fetchImpl(wasmUrl, { signal });
    if (!response.ok) throw new Error('引擎文件下载失败（HTTP ' + response.status + '）');
    if (!response.body) return;
    const total = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    const chunks = []; // 边下载边留存，完整后一次性写入持久缓存
    let complete = false;
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await withAbort(reader.read(), signal);
        if (done) { complete = true; break; }
        received += value.length;
        chunks.push(value);
        if (onProgress) {
          const label = total
            ? Math.min(100, Math.round((received / total) * 100)) + '%'
            : (received / 1048576).toFixed(1) + ' MB';
          onProgress(label);
        }
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (complete && cache) {
      try {
        await cache.put(wasmUrl, new Response(new Blob(chunks), {
          headers: { 'Content-Type': 'application/wasm' },
        }));
      } catch { /* 缓存写失败（配额等）不影响功能 */ }
    }
  }

  function init(onProgress) {
    if (ready) return ready;
    ready = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error('引擎初始化超时（网络较慢可稍后重试）'));
      }, initTimeoutMs);
      try {
        try {
          await withAbort(preloadWasm(onProgress, controller.signal), controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          // 预下载不是硬依赖：普通网络错误时交由 Worker 自行加载同一 WASM URL。
        }

        if (typeof WorkerCtor !== 'function') throw new Error('当前浏览器不支持 Web Worker');
        worker = new WorkerCtor(workerUrl);
        await new Promise((resolve, reject) => {
            const onMessage = (event) => {
              if (event.data === 'uciok') { cleanup(); resolve(); }
            };
            const onError = () => { cleanup(); reject(new Error('引擎 Worker 加载失败')); };
            const onAbort = () => { cleanup(); reject(controller.signal.reason); };
            const cleanup = () => {
              worker?.removeEventListener('message', onMessage);
              worker?.removeEventListener('error', onError);
              worker?.removeEventListener('messageerror', onError);
              controller.signal.removeEventListener('abort', onAbort);
            };
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.addEventListener('messageerror', onError);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            worker.postMessage('uci');
          });
      } finally {
        clearTimeout(timeout);
      }
    })();
    ready.catch(reset);
    return ready;
  }

  // 单 Worker 串行搜索，避免多个 bestmove 响应互相串扰。
  let chain = Promise.resolve();
  function bestMove(fen, movetime = 1200, searchmoves = null, onProgress = null) {
    const task = () => rawBestMove(fen, movetime, searchmoves, onProgress);
    const result = chain.then(task, task);
    chain = result.then(() => {}, () => {});
    return result;
  }

  async function rawBestMove(fen, movetime, searchmoves, onProgress) {
    await init(onProgress);
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        worker?.removeEventListener('message', onMessage);
        worker?.removeEventListener('error', onWorkerError);
        worker?.removeEventListener('messageerror', onWorkerError);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => {
        finish(new Error('引擎响应超时'));
        reset();
      }, movetime + 20000);
      const onMessage = (event) => {
        if (typeof event.data !== 'string') return;
        const match = event.data.match(/^bestmove\s+(\S+)/);
        if (match) finish(null, match[1]);
      };
      const onWorkerError = () => {
        finish(new Error('引擎 Worker 运行失败'));
        reset();
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onWorkerError);
      worker.addEventListener('messageerror', onWorkerError);
      worker.postMessage('position fen ' + fen);
      const restrict = searchmoves?.length ? ' searchmoves ' + searchmoves.join(' ') : '';
      worker.postMessage('go movetime ' + movetime + restrict);
    });
  }

  return { bestMove, preload: init };
}
