# Security Best Practices Report

> 该报告保留早期审计结构；2026-10-29 已更正失效结论。最新修复与验证数量见 [AUDIT_REPORT.md](./AUDIT_REPORT.md)，下方旧证据属于历史批次。

## Executive summary

审计未发现前端硬编码 secret、动态上游 URL、可利用 HTML 注入或服务端数据越权面。本轮已修复根目录开发服务器泄密、Worker 无界 JSON/弱 schema、缺 secret 仍出站、挂起请求、无 CSP、环境文件漏忽略和 CI 供应链漂移。公开 AI Worker 的账户级费用防护仍需账户配置证据。Stockfish glue 来源差异已于 2026-07-23 通过替换为官方产物闭环。

## Critical findings

没有确认的 critical finding。`DEEPSEEK_API_KEY` 仅从 Worker 环境读取，未在报告中读取或输出其值；前端模型文本使用 `textContent`，并受 CSP 约束。

## High findings

### SEC-001 — 公开 AI 代理缺少强身份/账户级费用防护（未完成）

- **位置**：`worker/src/index.js:3-8, 51-63, 195-219`
- **问题**：Origin 白名单是浏览器 CORS 控制，不是请求身份。脚本客户端可伪造允许 Origin；模块 Map 只在单 isolate 内生效，不能提供全局、精确的配额保护。
- **影响**：攻击者可持续消耗付费 DeepSeek 配额，造成费用和正常 AI 解说不可用。
- **已有控制**：每 IP/每 isolate 30 次/分钟后备限制、8 KiB body、合法 SAN/FEN/开局 ID、受限 token 预算、15 秒首响应体字节截止、结构化无敏日志。
- **必须措施**：在 Cloudflare 账户层配置 WAF/Rate Limiting 和费用告警/熔断；评估 Turnstile、短期服务端证明或用户会话；使用自定义域时确认是否禁用未保护的 `workers.dev`。
- **验收**：伪造 Origin 但无证明的请求在到达 Worker/DeepSeek 前被 401/403/429；负载测试跨位置仍满足预算；费用阈值触发告警与熔断。

### SEC-002 — Stockfish JavaScript glue 的供应链来源（已修复）

早期本地 JS 与官方资产不同；2026-07-23 已替换为 Stockfish.js v18.0.0 官方同名资产。当前 JS 哈希为 `2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe`，WASM 与许可来源见 `VENDOR.md`，由固定哈希门持续验证。本次新增自有缓存入口，未修改 vendor。

## Medium findings

### SEC-003 — AI 解说默认开启的数据披露（既定产品决策）

- **位置**：`index.html:71-79`，`js/main.js` 的 `showCommentary`
- **问题**：页面已明确披露棋谱/FEN 会经 Worker 发给 DeepSeek，用户可关闭；但默认状态仍是开启。棋谱通常低敏感，但这仍是第三方数据传输。
- **当前约定**：保留默认开启与可见披露，允许随时关闭；语言及用户数据不持久化。不得沿用早期“本地保存选择”的建议。
- **验收**：隐私文案、默认状态和实际网络行为一致；关闭时不创建请求，取消时不残留排队占位。

### SEC-004 — FEN 只做结构校验，未由服务端从棋谱重放派生（剩余风险）

- **位置**：`worker/src/index.js:124-175`
- **问题**：Worker 验证 SAN 格式、lastMove 一致和 FEN 结构，但没有重放整段棋谱证明 FEN 与 moves 语义一致。输入不能改变系统 prompt、上游 URL 或 Authorization，因此不是代码注入，但可让解说基于矛盾局面并扩张模型用途。
- **建议**：若代理滥用持续发生，在 Worker bundle 中使用同版本规则引擎重放 SAN，并服务端派生 FEN/lastMove；同时评估 bundle/CPU 成本。
- **验收**：不一致 FEN、非法棋谱和 lastMove 被 400 拒绝；合法 400 步以内棋谱通过性能预算。

## Low findings

### SEC-005 — chess.js 引用缺失 source map（未修复）

- **位置**：`js/vendor/chess.js` 文件末尾
- **问题**：`sourceMappingURL=chess.js.map` 指向未分发文件；不影响运行安全，但造成 DevTools 404 和调试来源不完整。
- **建议**：下次 vendor 更新时加入同版本官方 map，或移除注释并同步更新固定哈希。

## Remediated findings

### SEC-F01 — 根目录静态服务器会暴露 secret/Git 文件（已修复）

- 旧 README 指示从仓库根运行通用 HTTP server。
- `scripts/serve.mjs:17-72` 现在只绑定 `127.0.0.1`，仅允许 `index.html`、manifest 与三个公开目录；真实 HTTP 验证 `/DS.env`、`/.git/config`、`/worker/src/index.js` 和编码 traversal 均为 404。

### SEC-F02 — Worker body/schema/secret 错误路径不安全（已修复）

- `worker/src/index.js:85-175` 在 JSON 解析期间实施真实 8 KiB 字节上限，拒绝错误 Content-Type、null/数组、未知字段、非法 SAN/FEN/开局。
- `worker/src/index.js:210-213` 在任何上游调用前验证 secret，缺失时返回泛化 503。
- 回归测试覆盖 400/413/415/429/503 和“upstream 调用次数必须为 0”。

### SEC-F03 — 解说/引擎可无限挂起（已修复）

- `js/commentary.js:46-228` 添加总截止、流读取空闲截止、有限瞬态重试、`Retry-After`、队列上限和 reader finally 清理。
- `js/engine.js:20-139` 把 deadline 扩展到 WASM preload 与 UCI 握手，传播 AbortSignal，监听 Worker error/messageerror 并允许失败后重试。

### SEC-F04 — 前端外部字体与缺失 CSP（已修复）

- `index.html:5-13` 删除 Google Fonts，使用本地系统字体；CSP 将脚本、对象、连接和 Worker 限定到业务所需来源。
- 真实浏览器验证控制台无 CSP/资源错误，首屏没有 Google 或 AI 网络请求。审计完成时 Stockfish 为按需加载；后续按产品要求恢复默认持续提示后，首屏会加载本地 Stockfish WASM。

### SEC-F05 — Secret 变体、日志和 CI 供应链（已修复）

- `.gitignore:3-10` 覆盖 `.env*`、`.dev.vars*`、`.wrangler/`、日志和 node_modules，并保留 example 反向规则。
- `worker/wrangler.jsonc:5-19` 声明 required secret、请求取消和采样 observability；`worker/src/index.js:65-68` 日志不包含 IP、prompt、FEN、棋谱、Authorization 或 secret。
- `.github/workflows/ci.yml:7-20` 使用最小权限并固定 Action 完整 SHA。

## Historical verification evidence（早期批次，非当前数量）

- `npm test`：32/32 通过；所有 outbound fetch 均 mock。
- `npm run check`：13 个 JS/MJS、JSON、内部引用、SVG 主动内容、WASM magic 与 vendor SHA-256 通过。
- 浏览器：CSP 无错误；64 gridcells/8 rows；键盘走子、摆棋、升变焦点与 Escape 通过；1024/1025/1280/1340/1341/1440/390 视口无横向溢出。
- 本地 HTTP：公开文件 200；secret、Git、Worker 源码与 traversal 404；监听地址仅 `127.0.0.1:8173`。

本报告不是法律意见。详细攻击路径和风险校准见 `ChesSight-threat-model.md`，依赖健康度见 `.supply-chain-risk-auditor/results.md`。
