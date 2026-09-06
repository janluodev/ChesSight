import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HTML preserves zoom, uses local assets, and exposes landmarks and AI disclosure', async () => {
  const html = await read('index.html');
  // 产品决策（2026-07-23）：移动端锁定缩放（负责人在无障碍取舍上选择锁定）
  assert.match(html, /user-scalable=no/);
  assert.match(html, /maximum-scale=1/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<main\b/);
  // 双语披露：HTML 内置中文（默认语言），英文在 i18n 字典
  assert.match(html, /棋谱与局面发送到 ChesSight Worker/);
  const i18n = await read('js/i18n.js');
  assert.match(i18n, /Sends moves and position to the ChesSight Worker/);
});

test('title stays ChesSight and the language switch defaults to Chinese', async () => {
  const [html, i18n] = await Promise.all([read('index.html'), read('js/i18n.js')]);
  // 产品决策（2026-09-06）：标题恒为 ChesSight·See the Threats，不随中/英切换；每次打开默认中文，不持久化
  assert.match(html, /<title>ChesSight·See the Threats<\/title>/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<button id="btn-lang-zh" class="lang-btn active"/);
  assert.match(html, /<button id="btn-lang-en" class="lang-btn"/);
  assert.match(i18n, /let lang = 'zh'/);
  assert.doesNotMatch(i18n, /localStorage\./);
});

test('responsive policy has no 1025px board-size cliff or forced orientation lock', async () => {
  const [css, main, board] = await Promise.all([
    read('css/style.css'),
    read('js/main.js'),
    read('js/board.js'),
  ]);
  assert.match(css, /@media \(max-width: 1600px\)/);
  assert.doesNotMatch(main, /orientation\?\.lock|orientation\.lock/);
  assert.match(main, /innerWidth <= 1600/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(board, /classList\.toggle\('has-piece',\s*Boolean\(cell\)\)/);
  assert.match(css, /\.square\.has-piece\s*\{\s*touch-action:\s*none/);
  assert.match(css, /\.tray-slot\s*\{[^}]*touch-action:\s*none/s);
});

test('secret-file variants are ignored and local docs use the allowlisted server', async () => {
  const [ignore, readme, packageRaw] = await Promise.all([
    read('.gitignore'),
    read('README.md'),
    read('package.json'),
  ]);
  const packageJson = JSON.parse(packageRaw);
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^\.dev\.vars\*$/m);
  assert.equal(packageJson.scripts.serve, 'node scripts/serve.mjs');
  assert.match(readme, /npm run serve/);
  assert.match(readme, /不要[\s\S]*python3 -m http\.server/);
  assert.match(readme, /DS\.env/);
});

test('manifest and Worker config declare delivery and runtime safeguards', async () => {
  const [manifestRaw, wrangler] = await Promise.all([read('manifest.json'), read('worker/wrangler.jsonc')]);
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.description);
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.match(wrangler, /enable_request_signal/);
  assert.match(wrangler, /observability/);
});

test('board and promotion controls expose state and accessible names', async () => {
  const [board, main, i18n] = await Promise.all([
    read('js/board.js'),
    read('js/main.js'),
    read('js/i18n.js'),
  ]);
  // 双语 aria 文案：board/main 不再持有中文棋子名表，统一从 i18n 字典取值
  assert.match(board, /from '\.\/i18n\.js'/);
  assert.match(board, /setAttribute\('aria-label'/);
  assert.match(i18n, /'piece\.k'/);
  assert.match(main, /role', 'dialog'/);
  assert.match(main, /aria-modal/);
  assert.match(main, /Escape/);
  assert.match(main, /备选.*tabIndex|tabIndex.*备选/s);
  assert.match(main, /btnStartPos[\s\S]*setupTurnSel\.value = 'w'/);
  // 回归防护：t 是 i18n 取词函数，main.js 不得用 for (const t of …) 将其遮蔽（曾致整页初始化崩溃）
  assert.doesNotMatch(main, /for \(const t of/);
});

test('safety markers use uniform state-colored outlines and overlay defaults match the product decision', async () => {
  const [css, html, main] = await Promise.all([
    read('css/style.css'),
    read('index.html'),
    read('js/main.js'),
  ]);
  const safetyStyles = css.match(
    /\.square\.safety-attacked\s+\.ly\.safety,[\s\S]*?\/\* 选中描边/,
  )?.[0] ?? '';

  assert.match(safetyStyles, /border:\s*6px solid var\(--state-color\)/);
  // 产品决策（2026-07-23）：状态色带由 1px 深色分离线（--safe-edge）包夹，
  // 保证任意格底上 ≥3:1 非文本对比；线型差异（double/dashed）仍禁止。
  assert.match(safetyStyles, /outline:\s*1px solid var\(--safe-edge\)/);
  assert.match(safetyStyles, /box-shadow:\s*inset 0 0 0 1px var\(--safe-edge\)/);
  assert.doesNotMatch(safetyStyles, /border-(?:style|width)|\b(?:double|dashed)\b/);
  assert.match(safetyStyles, /\.square\.safety-attacked\s+\.ly\.safety\s*\{\s*--state-color:\s*var\(--safe-red\);\s*\}/);
  assert.match(safetyStyles, /\.square\.safety-defended\s+\.ly\.safety\s*\{\s*--state-color:\s*var\(--safe-green\);\s*\}/);
  assert.match(safetyStyles, /\.square\.safety-contested\s+\.ly\.safety\s*\{\s*--state-color:\s*var\(--safe-yellow\);\s*\}/);
  assert.match(css, /\.square\.sel \.ly\.sel\s*\{[^}]*inset:\s*7px/s);
  // 产品决策（2026-09-06）：持续提示、安全标记默认开启，攻击范围与 X-Ray 默认关闭；
  // 引擎打开页面即后台预热并写入 Cache Storage（见 engine.js 的 ENGINE_CACHE）
  assert.match(html, /<input\s+type="checkbox"\s+id="chk-auto"\s+checked>/);
  assert.match(main, /let autoHint = true;/);
  assert.match(main, /let showControl = false;/);
  assert.match(main, /let showSafety = true;/);
  assert.match(main, /let showXray = false;/);
  assert.match(html, /id="btn-control" class="btn btn-toggle" aria-pressed="false"/);
  assert.match(html, /id="btn-xray" class="btn btn-toggle" aria-pressed="false"/);
  assert.match(html, /id="btn-safety" class="btn btn-toggle active" aria-pressed="true"/);
  assert.match(main, /engine\.preload\(/);
  // 产品决策（2026-07-23）：开局首着不预跑引擎分析——载入时不调用 runEngineHint，
  // 持续提示仅在勾选且棋谱非空时自动分析；「电脑自己对弈」默认不勾选
  assert.doesNotMatch(main, /renderAll\(\);\s*if \(autoHint\) runEngineHint\(\);/);
  assert.match(main, /autoHint && chess\.history\(\)\.length > 0\) runEngineHint\(\);/);
  assert.match(html, /<input type="checkbox" id="chk-selfplay">/);
});

test('vendor provenance and automated delivery checks are documented', async () => {
  const [vendor, workflow] = await Promise.all([read('VENDOR.md'), read('.github/workflows/ci.yml')]);
  assert.match(vendor, /SHA-256/);
  assert.match(vendor, /chess\.js.*1\.4\.0/s);
  assert.match(vendor, /Stockfish\.js.*18/s);
  assert.match(workflow, /npm test/);
});

test('AI worker endpoint stays consistent between the CSP and the commentary client', async () => {
  // CSP（index.html）与 ENDPOINT（js/commentary.js）是同一 Worker 域名的两份真相；
  // 换域名漏改任何一处都会让解说在生产静默失效，此断言把两处锁定为一致。
  const [html, commentary] = await Promise.all([read('index.html'), read('js/commentary.js')]);
  const endpoint = commentary.match(/const ENDPOINT = '([^']+)'/)?.[1];
  assert.ok(endpoint, 'js/commentary.js must declare const ENDPOINT');
  const csp = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)?.[1];
  assert.ok(csp, 'index.html must declare a CSP meta tag');
  const connectSrc = csp.match(/connect-src([^;]*)/)?.[1] ?? '';
  assert.ok(
    connectSrc.split(/\s+/).includes(new URL(endpoint).origin),
    `CSP connect-src must list the commentary worker origin ${new URL(endpoint).origin}`,
  );
});
