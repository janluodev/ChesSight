// 同源经典 Worker 入口：只为指定 WASM 读取版本化缓存，vendor 文件保持上游原样。
// 在 importScripts 之前安装 fetch，且同步加载 glue，避免提前发送的 UCI 指令丢失。
(() => {
  const config = new URL(self.location.href);
  const source = new URL(config.searchParams.get('source'));
  const wasmUrl = new URL(decodeURIComponent(config.hash.slice(1)));
  if (source.origin !== config.origin || wasmUrl.origin !== config.origin) {
    throw new Error('Engine assets must be same-origin');
  }
  const cacheName = config.searchParams.get('cache');
  const networkFetch = self.fetch.bind(self);
  self.fetch = async (input, options) => {
    const requestedUrl = new URL(typeof input === 'string' ? input : input.url || String(input), config).href;
    if (requestedUrl === wasmUrl.href && self.caches && cacheName) {
      try {
        const cache = await self.caches.open(cacheName);
        const hit = await cache.match(wasmUrl.href);
        if (hit) return hit;
      } catch { /* 隐私模式/缓存不可用时交回正常网络加载 */ }
    }
    return networkFetch(input, options);
  };
  self.importScripts(source.href);
})();
