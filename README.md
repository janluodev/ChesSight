# ChesSight · 国际象棋攻防可视化训练器

把双方的“控制格”火力版图与每个棋子的安全状态实时画在棋盘上的纯前端训练工具，帮助训练控制格意识、子力安全意识与复盘习惯。

**在线使用：<https://chessight.art>**。GitHub Pages 项目地址为 <https://swyu22.github.io/ChesSight/>；配置自定义域后，该地址会跳转到主域名，并非独立故障切换站点。

## 功能

- **完整规则走子**（chess.js）：王车易位、吃过路兵、后/马/象/车升变选择、将军、将杀与逼和检测；支持点击、拖拽和键盘走子。
- **攻击范围与安全状态**：控制格覆盖层与安全状态标记（红 = 被攻击无保护、黄 = 被攻击有保护、绿 = 未被攻击有保护，未被攻击且无保护不标记），以及 X-Ray 杀伤线（均默认开启，可单独关闭）。安全状态使用单线框和屏幕阅读器文本表达。
- **回放训练**：上一步、下一步；回退后走新着法会截断重做分支。
- **Stockfish 18**：使用约 7 MB 的单线程 lite WASM，打开页面即后台预载并写入本地缓存（之后访问免重新下载）；持续提示默认开启，自走出第一步起逐着自动分析（开局首着不预跑），也可点击 💡、按 F1 触发。
- **与电脑对弈**：勾选后对方回合由 Stockfish 自动应对；引擎异常时自动切回手动对弈并提示。
- **电脑自弈**：勾选「电脑自己对弈」后双方均由 Stockfish 连续走子，将杀/逼和/无子力可杀时自动停止（三次重复、50 步等可判和不停，引擎会主动避开重复局面尽量分出胜负）；期间锁定人工输入，取消勾选随时接管。
- **落子过场动画**：电脑落子先以黄色箭头预告（1.2 秒），随后棋子以拖拽动效滑向目标格（1.8 秒）；遵循系统「减少动态效果」设置。
- **棋盘翻转**：一键切换白方 / 黑方视角，坐标与箭头同步翻转；对弈模式下翻转即交换阵营。
- **AI 实时解说**：把当前棋谱和 FEN 发送到 ChesSight Cloudflare Worker，再由 DeepSeek 生成中文解说；可在界面中随时关闭。队列有超时、有限重试和长度上限。
- **WebAudio 音效**：实时合成走子、吃子、易位、将军、升变和终局音效，不分发第三方采样素材。
- **自由摆棋**：支持拖拽；键盘可选择备选棋子，使用方向键移动，Enter/Space 放置或移动，Delete/Backspace 删除，Escape 取消。
- **开局库**：14 个经典开局一键摆盘，并提供历史、优点和缺点简介。
- **添加到主屏幕**：提供 Web App Manifest、常规与 maskable 图标，可用独立窗口打开；当前没有 Service Worker，因此不承诺离线运行。

控制格采用几何控制口径：兵只计算斜吃方向，滑子止于首个阻挡格且包含该格，被牵制的子仍计入，并包含对己方棋子的保护。

## 本地运行

要求 Node.js 22 或更高版本。项目零构建，但必须通过 HTTP 访问 ES Modules：

```bash
npm run serve
# 仅监听 http://127.0.0.1:8173
```

仓库根目录可能含有被 Git 忽略的 `DS.env`、`.env*`、`.dev.vars*` 或 `.git/`。**不要**在根目录使用 `python3 -m http.server`、`npx serve .` 等通用目录服务器；它们可能把秘密文件或 Git 元数据暴露给本机网络。仓库自带服务器只允许访问 `index.html`、`manifest.json`、`assets/`、`css/` 和 `js/`。

本地服务器端口固定为 8173 时，才匹配解说 Worker 的开发 Origin 白名单。摆题钩子：浏览器控制台执行 `app.loadFen('<FEN>')` 可载入局面。

## 自动验证

```bash
npm test       # Node 单元/安全/静态策略测试
npm run check  # 语法、JSON、资源引用、SVG、WASM 与 vendor 哈希
```

GitHub Actions 会在 push 与 pull request 上执行两项命令。测试中的所有外部 `fetch` 均使用 mock，不调用线上 DeepSeek 或生产 Worker。

## AI Worker

Worker 位于 `worker/`，API Key 只允许通过 Cloudflare secret 注入；不要写入前端、配置文件或 `DS.env`：

```bash
cd worker
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy --dry-run
```

`wrangler.jsonc` 声明所需 secret、请求取消兼容标志和采样可观测性。运行时会校验 Origin、Content-Type、请求字节数、字段集合、SAN/FEN 基本结构和开局 ID，并限制单 isolate 的请求频率。

重要边界：CORS Origin 白名单不是身份认证，脚本客户端可以伪造 Origin。正式环境仍应在 Cloudflare 账户层配置 WAF/Rate Limiting、费用告警/熔断，并评估 Turnstile 或用户会话证明；如启用自定义域，还应确认是否关闭未受保护的 `workers.dev` 入口。

## 隐私与安全

- AI 解说开启时会发送 SAN 棋谱与 FEN，不发送账户资料；项目本身没有登录或用户数据库。
- 浏览器只把模型输出写入 `textContent`，不作为 HTML 执行。
- 页面使用 Content Security Policy 限制脚本、对象、连接和 Worker 来源；WebAssembly 仅允许本地 Stockfish 运行所需能力。
- 安全假设、信任边界和剩余风险见 `ChesSight-threat-model.md`；工程审计结果见 `SKILLS_AUDIT_REPORT.md`。

## 素材与许可

- 棋子图形：**cburnett** 棋子集，作者 Colin M.L. Burnett，[CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)，来自 [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces)。
- 规则引擎：[chess.js](https://github.com/jhlywa/chess.js) 1.4.0，BSD-2-Clause。
- 分析引擎：[Stockfish.js](https://github.com/nmrugg/stockfish.js) 18 / [Stockfish](https://github.com/official-stockfish/Stockfish)，GPL-3.0。
- 项目自有代码：MIT。

精确版本与 SHA-256 记录在 [`VENDOR.md`](./VENDOR.md)。本地 Stockfish JavaScript glue 与 wasm 均与 [v18.0.0 官方 release](https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0) 同名文件逐字节一致，由 `npm run check` 的固定哈希强制校验。
