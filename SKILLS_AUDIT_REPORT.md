> 归档说明（2026-10-29）：本文件是2026-07-21 的技能审计历史快照，其中版本、默认设置、未解决项和测试数量不代表现状。当前状态与验证见 [AUDIT_REPORT.md](./AUDIT_REPORT.md)，vendor 来源见 [VENDOR.md](./VENDOR.md)。Stockfish glue 已于 2026-07-23 替换为官方产物，来源差异已闭环；当前 CI 使用 5 个固定 SHA 的 Actions。

# ChesSight 全量 Skills 工程审计、修复与验收报告

> 审计日期：2026-07-21
> 审计范围：当前 ChesSight 项目目录中的源代码、配置、文档、脚本、CI、环境变量忽略规则、PWA 元数据、静态资源与第三方 vendor 文件。
> 执行原则：最小必要修改；不部署、不提交、不调用生产 DeepSeek；不读取 `DS.env`、`.env*`、`.dev.vars*` 或 `worker/.wrangler/**` 的内容。
> 结论性质：工程审计结果，不构成法律合规认证或正式 WCAG 认证。

> 后续产品变更（2026-07-21）：项目负责人要求持续提示恢复为默认开启，因此首次载入会初始化 Stockfish；安全标记取消线型差异并统一为状态色单线框，同时保留屏幕阅读器文本。AUD-021、FIX-007、FIX-011 与 ACC-012 保留的是本报告审计完成时的历史状态。

# 1. Skills 识别结果

## 已安装 Skills

- 在当前环境的用户级、Agent 级、项目级和已安装插件目录中，共识别出 **528 个唯一 Skill 名称**。
- 每个 Skill 的名称、用途、适用判定、原因和来源均记录在 [SKILLS_INVENTORY.md](./SKILLS_INVENTORY.md)。
- 分类结果：已使用 15 个；部分适用但受工具限制 1 个；由环境优先工具替代 1 个；与已用专门 Skill 重叠 265 个；技术栈或任务领域不适用 246 个。
- 重复安装的同名 Skill 按名称去重；项目级版本优先用于本项目特定规则。

## 本次实际使用的 Skills

| Skill | 用途 | 实际作用 |
|---|---|---|
| `audit-context-building` | 深入建立架构和文件上下文 | 建立全量文件清单、入口、数据流和信任边界 |
| `dispatching-parallel-agents` | 并行处理独立审查面 | 并行完成前端质量、Worker 安全、文档/供应链只读复审 |
| `javascript-pro` | 现代 JavaScript、异步、Fetch、Worker | 指导 commentary、engine、board、main 的修复 |
| `ui-sound-design` | Web Audio 设计与资源生命周期 | 修复节点清理、调度基准、禁用和降级行为 |
| `code-review` | 正确性、设计、性能、可维护性 | 形成逐模块问题清单并约束最小修改 |
| `accessibility` | WCAG 2.2 与键盘/语义审查 | 修复缩放、网格、对话框、焦点、对比度和非颜色表达 |
| `security-best-practices` | JavaScript 安全最佳实践 | 形成安全专项报告并落实 CSP、输入边界和秘密处理 |
| `security-threat-model` | 资产、边界、攻击能力和滥用路径 | 形成仓库级威胁模型 |
| `supply-chain-risk-auditor` | 依赖来源、哈希和接管风险 | 核验 chess.js、Stockfish、CI Action 和许可证 |
| `workers-best-practices` | Cloudflare Workers 生产规范 | 修复流式输入、超时、CORS、日志、secret 和 Wrangler 配置 |
| `pwa-expert` | Manifest、图标和安装体验 | 补齐 raster/maskable 图标并校正能力声明 |
| `documentation` | 技术文档结构和事实一致性 | 重写 README，增加安全、供应链和运行说明 |
| `test-driven-development` | 修复前建立失败回归测试 | 先复现异步、安全、音频和业务缺陷，再修复 |
| `control-in-app-browser` | 真实浏览器交互验证 | 验证键盘、升变、摆棋、响应式、网络和控制台 |
| `verification-before-completion` | 结论前重新验证 | 以测试、静态检查、HTTP 探测和 diff 检查支持结论 |

## 不适用或未独立使用的 Skills

- `web-perf`：页面性能审计方向适用，但该 Skill 强制依赖 Chrome DevTools MCP trace；当前环境没有该能力，因此未虚构 Core Web Vitals 数值，列入后续项。
- `webapp-testing`：方向适用，但本环境的 in-app Browser 插件具有浏览器操作优先级，已由 `control-in-app-browser` 完成同类验收，未重复执行第二套浏览器流程。
- 与审查相关但能力重叠的 265 个 Skills：没有额外独立约束，已被上表更专门的 Skills 覆盖，因此不重复调用，避免相互冲突和形式化堆叠。
- 其余 246 个 Skills：面向广告、内容创作、办公文档、原生移动端、其他语言/链、部署发布等；仓库没有相应文件、框架或本轮授权目标。
- 逐项理由见完整 [Skills 清单](./SKILLS_INVENTORY.md)，没有虚构未安装 Skill。

# 2. 项目扫描结果

## 目录/模块概览

| 区域 | 内容 | 审查重点 |
|---|---|---|
| 根目录 | `index.html`、`manifest.json`、`CNAME`、`README.md`、`LICENSE` | 页面入口、PWA、域名、文档、许可 |
| `js/` | 主控制器、棋盘、分析、历史、开局、引擎、解说、音效 | 业务正确性、异步生命周期、键盘、性能、可维护性 |
| `worker/` | DeepSeek SSE 代理与 Wrangler 配置 | 信任边界、输入、CORS、限流、秘密、超时、日志 |
| `css/` | 全站布局和状态样式 | 响应式、缩放、对比度、焦点和非颜色表达 |
| `assets/` | 图标与 12 个棋子 SVG | 引用、尺寸、SVG 主动内容、PWA 适配 |
| `js/vendor/` | chess.js、Stockfish glue/WASM | 哈希、来源、许可证和可重现性 |
| `scripts/` | 本地静态服务器与静态检查 | 目录穿越、秘密暴露、MIME、检查覆盖 |
| `tests/` | 7 组 Node 回归测试 | Worker、commentary、engine、sound、业务、静态策略、服务器 |
| `.github/workflows/` | CI | 最小权限、Action SHA 固定、测试入口 |
| 文档报告 | Threat model、安全报告、供应链结果、vendor 清单 | 风险可追溯性和交接信息 |

## 关键入口文件

- 浏览器入口：`index.html` → `js/main.js`。
- 棋盘与规则入口：`js/board.js`、`js/analysis.js`、本地 `js/vendor/chess.js`。
- 引擎入口：`js/engine.js` → Stockfish Worker glue/WASM。
- AI 解说入口：`js/commentary.js` → 固定 Cloudflare Worker URL。
- 服务端入口：`worker/src/index.js`，部署配置为 `worker/wrangler.jsonc`。
- 本地开发入口：`npm run serve`；质量入口：`npm test`、`npm run check`。

## 文件类型覆盖情况

- 已覆盖：HTML、CSS、JavaScript/ESM、Worker JavaScript、JSON/JSONC、YAML、Markdown、纯文本许可证、SVG、PNG、WASM、CNAME、Git ignore 规则。
- 基线仓库的 34 个 tracked 文件已全部归类；所有第一方源码/配置/文档均逐文件阅读，二进制资源以格式、尺寸、魔数、引用和 SHA-256 验证。
- 新增测试、脚本、CI 和报告也纳入最终静态检查与工作树复核。

## 审查边界说明

- 应用审查仅处理当前项目目录。Step 1 为识别已安装 Skills，按任务要求只读取了 Skills 元数据/指令目录。
- `.git/**` 只用于只读状态和差异检查；`worker/.wrangler/**`、秘密文件内容及依赖缓存未读取。
- 预先存在的未跟踪 `.agents/` 保持原样，没有删除、忽略或纳入提交。
- 未进行生产部署、真实 DeepSeek 调用、Cloudflare 账户设置修改或外部写操作。

# 3. 审查计划

## 模块优先级

| 优先级 | 核心对象 | 原因 |
|---|---|---|
| P0 | Worker、AI 解说、秘密与供应链 | 可造成费用滥用、数据外发、无限挂起或许可风险 |
| P0 | 棋盘键盘操作、升变、摆棋、缩放 | 直接影响核心功能与 WCAG A/AA 可操作性 |
| P1 | Stockfish 初始化、Web Audio、响应式布局 | 影响稳定性、资源泄漏和关键页面可用性 |
| P1 | PWA、CSP、文档、CI/测试 | 影响交付安全、安装质量和回归能力 |
| P2 | 模块拆分、重复扫描、source map | 维护性或开发体验问题，需避免本轮大重构 |

## 高风险区域

1. 浏览器 → Cloudflare Worker → DeepSeek 的数据和费用边界。
2. 串行 SSE 队列与 Stockfish WASM/Worker 的超时、取消和资源回收。
3. 棋盘的 ARIA grid、仅拖拽交互、升变焦点管理。
4. 本地 vendor 的精确来源、修改记录和 GPL Corresponding Source。
5. 本地开发服务器是否会暴露仓库秘密和 Git 元数据。

## 审查顺序

1. 建立文件/架构上下文和秘密边界。
2. 并行审查前端质量、Worker 安全、文档/供应链。
3. 先写失败回归测试；按 P0 → P1 → P2 实施最小修复。
4. 运行模块测试和静态策略检查。
5. 使用真实浏览器逐项验收交互、响应式、网络和控制台。
6. 使用真实 HTTP 请求验证本地服务器边界。
7. 汇总剩余风险，重新执行最终验证。

# 4. 问题清单

| 编号 | 文件路径 | 问题描述 | 类别 | 严重程度 | 对应 Skill / 规范 | 是否已修复 |
|---|---|---|---|---|---|---|
| AUD-001 | `README.md` | `python -m http.server` 默认可暴露仓库秘密与 `.git` | 安全/运行 | 高 | security-best-practices / Python server 边界 | 是 |
| AUD-002 | `worker/src/index.js` | CORS 不是身份认证，脚本可伪造 Origin 滥用付费代理 | 滥用/费用 | 高 | security-threat-model / workers-best-practices | 否，需账户级控制 |
| AUD-003 | `worker/src/index.js` | JSON 在限制前解析；null、数组、未知字段和错误媒体类型处理不足 | 输入验证 | 中 | workers-best-practices | 是 |
| AUD-004 | `worker/src/index.js` | 棋谱/FEN/lastMove/opening 只截长，存在 prompt 扩张与语义伪造 | LLM 输入 | 中 | security-best-practices | 部分；仍需完整棋谱重放 |
| AUD-005 | `worker/src/index.js` | 原本 isolate Map 无界且 O(n²)，也不能提供全局强限流 | 稳定性/费用 | 中 | workers-best-practices | 部分；本地已 O(1) 有界 |
| AUD-006 | `.gitignore`、`worker/wrangler.jsonc` | secret 变体未覆盖，缺失 secret 只会在上游失败 | 秘密管理 | 中 | workers-best-practices | 是 |
| AUD-007 | `worker/src/index.js`、`worker/wrangler.jsonc` | 客户端取消未传播，缺少结构化无敏感日志和响应硬化 | 可观测性/稳定性 | 中 | workers-best-practices | 是 |
| AUD-008 | `js/commentary.js` | fetch/reader 可无限挂起并永久阻塞串行队列 | 异步稳定性 | 高 | javascript-pro | 是 |
| AUD-009 | `js/commentary.js` | SSE 尾块/多行解析、reader 清理、永久 4xx 重试和 handler 异常处理不足 | 协议/资源 | 中 | javascript-pro | 是 |
| AUD-010 | `js/engine.js` | WASM 预加载在超时建立前可无限挂起 | 异步稳定性 | 高 | javascript-pro | 是 |
| AUD-011 | `js/engine.js` | Worker error/messageerror 与队列取消能力不足 | 稳定性 | 中 | javascript-pro | 部分；错误即时处理，队列无外部 AbortSignal |
| AUD-012 | `js/sound.js` | 音频节点未断开、多击时基重复读取、禁用后可能补播 | 资源/音频 | 高 | ui-sound-design | 是 |
| AUD-013 | `index.html`、`js/main.js` | 禁止页面缩放且强制竖屏 | 无障碍/响应式 | 高 | accessibility / WCAG 1.4.4、1.3.4 | 是 |
| AUD-014 | `css/style.css` | 1024/1025 附近棋盘宽度骤降到不可用 | 响应式 | 高 | accessibility / code-review | 是 |
| AUD-015 | `css/style.css` | 绿色按钮文字对比不足，安全状态主要依赖颜色 | 无障碍 | 高 | accessibility / WCAG 1.4.1、1.4.3、1.4.11 | 是 |
| AUD-016 | `index.html` | 缺主 landmark、aside 名称、skip link；品牌 alt 重复 | 语义 | 中 | accessibility | 是 |
| AUD-017 | `js/board.js` | ARIA grid 缺 row 层，格子名称未暴露棋子和状态 | 无障碍 | 高 | accessibility / ARIA APG | 是 |
| AUD-018 | `js/main.js` | 摆棋托盘和放置/移动/删除仅支持拖拽 | 键盘操作 | 高 | accessibility / WCAG 2.1.1、2.5.7 | 是 |
| AUD-019 | `js/main.js` | 升变弹层无 dialog 语义、完整名称、焦点陷阱与恢复 | 焦点管理 | 高 | accessibility | 是 |
| AUD-020 | `js/main.js`、`js/commentary.js` | 流式 token 频繁写 live region；取消/撤回残留占位 | 性能/体验 | 中 | accessibility / javascript-pro | 是 |
| AUD-021 | `index.html`、`js/main.js` | 持续提示默认开启，首屏即下载约 7.3MB WASM | 性能/隐私 | 中 | web-perf（静态部分）/ pwa-expert | 是 |
| AUD-022 | `js/main.js` | 电脑引擎失败时静默，界面可能停在对方回合 | 错误恢复 | 中 | code-review | 是 |
| AUD-023 | `manifest.json`、`assets/`、`README.md` | 缺 192/512 raster、maskable 图标，方向限制和离线能力不清 | PWA | 中 | pwa-expert | 是 |
| AUD-024 | 项目根目录 | 缺测试、质量脚本和 CI | 质量保障 | 中 | test-driven-development | 是 |
| AUD-025 | `README.md`、`index.html` | 升变、备用地址、AI 数据外发等说明与现实不一致/缺失 | 文档/隐私 | 中 | documentation | 是 |
| AUD-026 | `js/vendor/stockfish-18-lite-single.js`、`.wasm` | JS glue 与官方 v18 产物哈希不一致，来源/补丁和 GPL 对应源码未闭环 | 供应链/许可 | 高 | supply-chain-risk-auditor | 部分；仍需人工闭环 |
| AUD-027 | `index.html` | 外部 Google Fonts 增加第三方请求；缺页面级 CSP | 安全/隐私 | 中 | security-best-practices | 是 |
| AUD-028 | `js/vendor/chess.js` | 文件尾引用不存在的 `chess.js.map` | 开发体验 | 低 | supply-chain-risk-auditor | 否；避免改动已核验 vendor |
| AUD-029 | `js/main.js`、`js/analysis.js`、`js/history.js` | 主文件职责过多、射线扫描重复、未消费的历史 FEN | 可维护性 | 低 | code-review | 否；大重构超出最小修复 |
| AUD-030 | `js/main.js` | 从摆棋恢复初始局面时回合选择没有重置为白方 | 功能 Bug | 中 | test-driven-development | 是 |
| AUD-031 | `package.json`、`README.md` | 文档/报告声明 `npm run serve`，但缺少对应 package script | 交付一致性 | 中 | verification-before-completion / documentation | 是 |
| AUD-032 | `css/style.css`、`js/board.js` | 棋盘 `pan-y` 会让移动端纵向拖子触发 `pointercancel` | 触控交互 | 高 | accessibility / Pointer Events | 是 |

统计：32 项问题中，25 项完整修复、4 项部分缓解、3 项保留为人工/后续处理。

# 5. 修复记录

| 编号 | 修改文件 | 修复内容 | 修复原因 | 影响范围 | 风险说明 |
|---|---|---|---|---|---|
| FIX-001 | `scripts/serve.mjs`、`README.md`、`tests/server.test.js` | 新增仅绑定 127.0.0.1、白名单路径、拒绝穿越和秘密文件的本地服务器 | 消除仓库根目录任意文件暴露 | 仅本地开发 | 不替代生产 Web 服务器 |
| FIX-002 | `worker/src/index.js` | 加入精确 Origin、媒体类型、8KiB 流式体积、普通对象、字段白名单、SAN/FEN/opening 校验 | 在上游调用前收紧信任边界 | AI Worker 请求 | FEN 仍仅做结构校验 |
| FIX-003 | `worker/src/index.js`、`worker/wrangler.jsonc` | 有界 O(1) 降级限流、429、secret 预检、15 秒超时、入站取消、SSE 类型检查、无敏感结构化日志 | 稳定性、费用与可观测性 | Worker 运行时 | isolate 限流不等于全局强限流 |
| FIX-004 | `js/commentary.js` | 可注入客户端、总/空闲超时、50 项队列、瞬态重试、Retry-After、完整 SSE parser、finally 清理、取消回调 | 防止挂死、泄漏和错误重试 | AI 解说 | 超时时间需在真实网络调优 |
| FIX-005 | `js/engine.js` | 总初始化 deadline 覆盖 WASM、reader 取消/释放、Worker error/messageerror、搜索清理与 reset | 防止引擎永久挂起 | Stockfish 提示/电脑模式 | 排队任务尚无调用方 AbortSignal |
| FIX-006 | `js/sound.js` | AudioContext 安全降级、禁用清 pending、统一 currentTime、所有节点 onended disconnect | 避免异常、补播和资源累积 | 所有音效 | 无听感自动化，音色需人工试听 |
| FIX-007 | `index.html`、`css/style.css` | 恢复缩放、移除方向锁、系统字体/CSP、skip link、landmark、1340px 响应式、对比度与当时的线型状态（后续产品变更已取消线型差异；2026-07-23 负责人拍板**重新锁定移动端缩放**，安全标记改为深色分离线方案达 3:1） | WCAG、隐私和窄屏可用性 | 全页面 | CSP 保留 `unsafe-inline` 以兼容现有动态样式 |
| FIX-008 | `js/board.js` | 建立 8×8 ARIA row/gridcell、翻转索引、动态名称、selected 和装饰 SVG 隐藏 | 让屏幕阅读器理解核心棋盘 | 棋盘渲染 | 尚未做真实读屏软件人工测试 |
| FIX-009 | `js/main.js` | 摆棋托盘 button 化；支持键盘选择、放置、移动、删除、Escape；修复初始局面回合 | 消除 drag-only 并修复浏览器发现的状态 Bug | 自由摆棋 | 复杂摆棋流程仍建议人工探索 |
| FIX-010 | `js/main.js` | 升变 dialog 语义、完整按钮名、首项焦点、Tab trap、Escape 和焦点恢复 | 修复焦点与名称 | 兵升变 | 未改变原有升变业务选择 |
| FIX-011 | `index.html`、`js/main.js` | 持续提示默认关闭、独立状态区、取消清理、AI opening 仅传 ID、引擎失败可见并退出 CPU 模式 | 降低首屏成本与外发，改善错误恢复 | 提示/解说/电脑模式 | AI 解说默认开启仍需产品决定 |
| FIX-012 | `manifest.json`、`assets/icon-*`、`README.md` | 增加 192/512 PNG 与 maskable 图标，补 id/scope/lang/description，移除 portrait，明确无离线承诺 | PWA 安装一致性和诚实能力声明 | 可安装体验 | 真机安装外观需人工确认 |
| FIX-013 | `VENDOR.md`、`licenses/GPL-3.0.txt`、`.supply-chain-risk-auditor/results.md`、`scripts/check.mjs` | 记录精确版本/哈希/来源和差异，加入 GPL 文本，并固定 12 个棋子 SVG 与 3 个 vendor 产物哈希 | 供应链可追溯 | 第三方分发 | 不能替代对应源码与法律审查 |
| FIX-014 | `ChesSight-threat-model.md`、`security_best_practices_report.md` | 固化资产、边界、攻击路径、缓解、剩余风险 | 后续负责人可直接接手 | 安全治理 | 假设需要业务负责人确认 |
| FIX-015 | `package.json`、`tests/**`、`scripts/check.mjs`、`.github/workflows/ci.yml` | 新增 32 个回归测试、语法/引用/SVG/WASM/vendor 检查和最小权限 CI，Action 固定完整 SHA | 防止修复回归 | 开发与 CI | 未加入重型浏览器 CI 依赖 |
| FIX-016 | `.gitignore` | 覆盖 `.env*`、`.dev.vars*`、`.wrangler/`、node_modules 和日志并放行模板 | 防止秘密/构建产物误提交 | Git 工作树 | `.agents/` 的归属刻意留给人工决定 |
| FIX-017 | `package.json`、`README.md`、`tests/static-policy.test.js` | 先以失败测试复现缺失入口，再加入 `serve` script 并统一 README | 保证文档命令可直接执行 | 本地开发入口 | 无业务逻辑影响 |
| FIX-018 | `js/board.js`、`css/style.css`、`tests/static-policy.test.js` | 有棋子的格子/备选槽禁用浏览器触控接管，空格保留滚动与缩放 | 同时保留拖子和页面手势 | 移动端触控 | 真机纵向拖子仍列人工复核 |

# 6. 验收结果

| 验收编号 | 验收对象 | 验收标准 | 验收方法 | 验收结论 | 是否通过 | 备注 |
|---|---|---|---|---|---|---|
| ACC-001 | 全部自动回归 | 所有测试无失败且不访问生产网络 | `npm test` | 32/32 通过，0 fail | 是 | 最终报告后再次重跑 |
| ACC-002 | JS/JSON/资源/vendor | 语法、JSON、引用、SVG、WASM 魔数和固定哈希均有效 | `npm run check` | 13 个 JS/MJS、12 个棋子 SVG 和 3 个 vendor 固定哈希通过 | 是 | 任一固定产物变更会失败 |
| ACC-003 | Worker 输入与安全边界 | 非法 Origin/body/schema/secret 及上游网络/非 SSE 失败受控；日志不含 payload/secret | `tests/worker-security.test.js` mock fetch/console | 7 项拒绝、上游失败、日志与限流测试通过 | 是 | 未等待真实 15 秒 timeout，未调用 DeepSeek |
| ACC-004 | 解说队列 | 超时后继续、永久 4xx 不重试、SSE 尾块/多行完整、reader 释放 | `tests/commentary.test.js` fake reader/timer | 全部断言通过 | 是 | 有界一次瞬态重试 |
| ACC-005 | Stockfish 管理 | 初始化 deadline 覆盖 fetch/reader；超时清理 reader；Worker 错误即时 reject/reset | `tests/engine.test.js` fake Worker/fetch/reader | 3 项断言通过 | 是 | 搜索串行由实现约束；外部 queued abort 为后续项 |
| ACC-006 | Web Audio | 不支持时不抛错、禁用不补播、节点最终断开、时基只读取一次 | `tests/sound.test.js` mock AudioContext | 全部断言通过 | 是 | 听感需人工确认 |
| ACC-007 | 棋盘语义 | 8 row × 64 gridcell，名称含坐标/棋子/状态 | in-app Browser accessibility snapshot | 结构与动态名称符合预期 | 是 | 未做 VoiceOver/NVDA 人工测试 |
| ACC-008 | 正常棋局键盘路径 | 仅键盘可完成 e2→e4，状态/标签/撤回同步 | in-app Browser | e2→e4 与 undo 通过 | 是 | AI 在测试前关闭 |
| ACC-009 | 摆棋键盘路径 | 可选择棋子、放置、删除、Escape；恢复初始局面回合为白 | in-app Browser + 回归测试 | 白后放 d4、Delete、初始局面重置均通过 | 是 | AUD-030 由浏览器先发现再补测试 |
| ACC-010 | 升变对话框 | dialog 有名称/modal；四按钮完整；首项焦点、Escape、焦点恢复 | 构造升变局面并用 Browser 键盘验证 | 全部通过 | 是 | 不依赖鼠标 |
| ACC-011 | 响应式 | 棋盘至少 320px、无水平溢出、横竖屏可操作 | 390、1024、1025、1280、1340、1341、1440px viewport | 最小观察宽度 321px，无溢出 | 是 | 1340/1341 有布局切换但均可用 |
| ACC-012 | 首屏隐私/性能 | 未主动启用提示时不请求 WASM、Google Fonts、Worker/DeepSeek | Browser PerformanceResourceTiming 与 DOM 状态 | 首屏无上述请求，auto hint 为 false | 是 | 未生成 Core Web Vitals trace |
| ACC-013 | 浏览器运行质量 | 核心流程无 console error/warn | Browser console 复核 | 0 error、0 warn | 是 | 本地静态服务器环境 |
| ACC-014 | 本地服务器边界 | 仅 127.0.0.1；只允许发布文件；秘密/源码/穿越均 404 | lsof + curl 请求矩阵 | `/`/CSS 200；`DS.env`、`.git`、Worker 源码、穿越 404 | 是 | 服务验收后已停止 |
| ACC-015 | PWA 文件 | Manifest 图标引用存在，PNG 尺寸正确，SVG 无主动外链内容 | `npm run check` + 文件尺寸验证 | 192/512/maskable 与引用通过 | 是 | 真机安装需人工确认 |
| ACC-016 | 供应链 | chess.js/Stockfish 与 12 个棋子 SVG 均有固定哈希门禁 | SHA-256 + `VENDOR.md` + check 脚本 | 15 个固定哈希通过；JS glue 上游差异被明确阻断为风险 | 部分 | 对应源码/补丁需人工 |
| ACC-017 | Git ignore | 常见 secret 变体与产物均被忽略 | `git check-ignore` | `.dev.vars.production`、`.env.staging.local`、node_modules、log 均命中 | 是 | `.env.example` 保留可提交 |
| ACC-018 | 文档/CI | 报告存在、README 与实现一致、CI 语法可解析且 Action 固定 SHA | Markdown/JSON/YAML 解析、资源交叉引用、diff review | 结构和引用通过 | 是 | GitHub 托管执行需推送后观察 |
| ACC-019 | 本地启动入口 | `npm run serve` 必须实际启动受限服务器 | 失败回归测试 → 加脚本 → 重跑测试并实际启动 | 入口成功，监听 `127.0.0.1:8173`，HTTP 白名单矩阵通过 | 是 | 验收后服务已停止 |
| ACC-020 | 触控拖子策略 | 有棋子/备选槽必须阻止 `pointercancel`；空格仍支持 pan-y/pinch-zoom | 失败静态回归 → 渲染 class/CSS 规则检查 | 起点策略与 Pointer Events 要求一致 | 是（代码级） | iOS/Android 真机纵向拖子需人工确认 |

# 7. 未完成项 / 风险项 / 人工确认项

| 文件路径/系统 | 问题 | 原因 | 建议下一步 |
|---|---|---|---|
| `worker/src/index.js` + Cloudflare 账户 | CORS 无法阻止脚本伪造 Origin，仍有费用滥用风险 | 需要账户级身份/风控，不可仅由仓库代码可靠解决 | 加 Turnstile 或短期服务端证明、WAF/API Rate Limiting、费用告警/熔断，并按需关闭未保护的 `workers.dev` |
| `worker/src/index.js` | 当前限流为有界 per-isolate 降级方案 | 全局严格限流需 Cloudflare binding、Durable Object 或账户能力 | 配置 Rate Limiting binding；对费用上限再叠加 DO/预算熔断 |
| `worker/src/index.js` | FEN/SAN 只做格式和关联校验，未从初始局面完整重放 | 完整重放需把棋规库安全引入 Worker，修改面较大 | 引入经过锁定和测试的服务端 chess.js，服务端从 moves 派生 FEN/lastMove |
| `js/vendor/stockfish-18-lite-single.js` | JS glue 真实来源、补丁、修改者和日期未知 | 与官方 v18 同名资产哈希不一致 | 发布前取得精确源码/补丁和构建记录；由开源许可负责人确认 GPL Corresponding Source 交付 |
| `js/vendor/chess.js` | `sourceMappingURL` 指向缺失 map | 修改 vendor 会改变已核验哈希 | 取得官方同版本 map，或在更新 vendor 清单/哈希后移除注释 |
| `index.html`、产品策略 | AI 解说仍默认开启，用户首步后会向固定 Worker 发送 moves/FEN | 属于产品隐私选择，不能由工程审计擅自更改核心默认行为 | 确认是否改为显式 opt-in/首次同意；补隐私政策与保留期限 |
| `js/engine.js` | 排队的 `bestMove` 没有外部 AbortSignal | 完整取消可能需要改变主控制器 API | 后续增加 signal 和 UCI `stop`/Worker reset 的集成测试 |
| `js/main.js`、`js/analysis.js`、`js/history.js` | 主文件过长、射线计算重复、历史 FEN 未消费 | 本轮禁止无关大重构 | 单独立项拆分 setup/promotion/engine controller，并加属性测试 |
| `.agents/` | 预先存在的未跟踪项目 Skills 是否应提交未确定 | 归属是仓库治理决策 | 项目负责人决定纳入版本控制或加入 `.gitignore` |
| 页面性能 | 没有可靠的 LCP/INP/CLS trace | `web-perf` 所需 Chrome DevTools MCP 不可用 | 在 CI 或本机 Lighthouse/DevTools 运行移动/桌面 trace，并设性能预算 |
| PWA/辅助技术 | 未完成 Android/iOS 真机安装、纵向拖子、VoiceOver/NVDA 和音效听感测试 | 需要真实设备/人工感知 | 按设备矩阵执行人工验收并记录截图/版本 |
| 生产环境 | 未验证真实 Worker 部署、DeepSeek SSE、WAF、日志和告警 | 本轮明确不部署、不调用生产接口 | 在 staging 使用测试 secret 和费用上限执行集成测试，再灰度发布 |

# 8. 最终结论

- **项目整体规范符合度：约 90%（本轮清单加权估算，不是第三方认证）**。核心前端、异步稳定性、Worker 输入边界、可访问性、PWA、测试、文档和本地开发安全已形成可运行闭环。
- **本轮修复完成度：**32 项问题中 25 项完整修复、4 项部分缓解、3 项保留；所有可在不改变业务架构前提下安全自动修复的项目均已处理。32 项自动回归与静态门禁全部通过。
- **当前剩余高风险：**公开 AI 代理的账户级滥用防护，以及 Stockfish JS glue 的来源/GPL 对应源码闭环。两项均不能仅靠本轮仓库内最小修改宣告解决。
- **建议下一步动作：**先完成 Cloudflare 账户级限流/Turnstile/费用熔断和 Stockfish 许可来源确认；随后在 staging 做真实 SSE 集成、移动端 Lighthouse、真机 PWA 与 VoiceOver/NVDA 验收；最后再决定是否重构 `main.js` 及提交 `.agents/`。

## 可交接成果

- 完整 Skills 盘点：`SKILLS_INVENTORY.md`
- 本总报告：`SKILLS_AUDIT_REPORT.md`
- 威胁模型：`ChesSight-threat-model.md`
- 安全最佳实践报告：`security_best_practices_report.md`
- 供应链报告：`.supply-chain-risk-auditor/results.md`
- Vendor 精确来源/哈希：`VENDOR.md`
- 自动验证入口：`npm test` 与 `npm run check`
