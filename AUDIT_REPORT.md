# ChesSight 接手审校报告

日期：2026-10-29（Asia/Singapore）。审阅基线：`main` / `2080d03`，开始时工作区干净。

本轮完成代码、测试与文档审校及本地修复。早期审校阶段尚未发布；用户随后明确授权提交、推送及部署，最终发布验收记录见本文末尾。未引入框架、打包器或项目 npm 依赖，未改 vendor、固定哈希、CSP 或 AI 端点。

## 审阅覆盖

完整阅读第一方 HTML/CSS、所有 `js/` 自有模块、Worker 源码与配置、全部 Node 测试、本地服务/检查/哈希脚本、CI、manifest、Git 属性与忽略规则，以及 README、VENDOR、威胁模型、历史安全/技能/供应链报告。另审阅仓库内 2 份开发技能与 10 份引用文档，并补上项目约束，防止通用模板引入 Jest、Tone.js、CDN 或用户数据持久化。

vendor 按上游来源记录、15 个固定哈希、SVG 安全、WASM magic 与真实浏览器加载核验；未逐行重审压缩 Stockfish glue 或反汇编 WASM。本轮不等于重新扫描全部上游漏洞，也未审计 Cloudflare/GitHub 账户控制台。

## 发现、根因与修复

| 项目 | 根因与影响 | 修复与验证 |
|---|---|---|
| 引擎旧结果与错误污染状态 | 仅检查 FEN/当前模式，无法区分同 FEN 重开、离开后重入；失败和进度缺校验 | 提示/电脑请求增加版本与 FEN/模式联合校验，覆盖进度、成功、失败和动画；失效请求释放后重启当前循环。Playwright deferred Promise 验证。 |
| 动画取消后电脑停走 | 新对局在动画中触发的续走被 cpuThinking 挡回，旧动画结束未补启动 | 取消后的出口重新启动循环；导航同时清理拖拽。浏览器验证动画中新对局仍能继续，电脑对弈成对悔棋正确。 |
| 识别退出/重入与编辑竞态 | setupMode 布尔值无法区分请求所属轮次，旧请求还阻止新上传或覆盖编辑 | 每次识别独立 AbortController/身份；退出、回合确认、拖拽/键盘选子、清空/初始局面取消旧请求；旧 finally 不清新请求。浏览器验证人工确认前不修改对局。 |
| 解说清空后仍报告完成 | 最终 token 已分发与 onDone 之间发生取消 | 分发和完成回调前检查取消。新增能在旧实现复现失败的单测。 |
| 解说总截止/清理可能卡住队列 | 读流未显式监听总截止；等待底层 reader.cancel 可永久不返回；Retry-After 无上限 | 总截止覆盖 fetch/读取，清理不阻塞队列，重试等待有上限；挂起读取、挂起 cancel 与后续任务恢复单测。 |
| WASM 缓存没有被实际引擎读取 | 主线程写 Cache Storage，vendor Worker 自行 fetch，不会自动命中该缓存 | 增加同源 `engine-worker.js` 在加载官方 glue 前读取同一版本缓存；真实浏览器冷载 1 次 WASM 请求，热载 0 次，两次均返回合法 bestmove。 |
| Worker 未限制未知路径 | 除 recognize 外全部路径进入解说 | 仅 `/`、`/recognize`；未知 POST/OPTIONS 返回 404，单测确认不出站。 |
| Worker 首数据截止提前解除 | 收到响应头即取消 15 秒定时器，body 仍可挂起 | 截止保留到首个非空 body 数据块，拒绝空流和错误 MIME；失败上游 body 释放。单测覆盖超时、完整多块传输及取消。SSE 心跳算首数据，并非正文首 token 保证。 |
| 自定义黑方开局的解说反色/回合错误 | 前端和 Worker 都以棋谱长度假定白方第 1 回合起步 | UI 使用 move.before 与 move.color，Worker 从最终 FEN 反推起点；黑方第 23 回合、中英文 prompt 单测。 |
| 识别响应与取消边界 | 无外部取消；turn/uncertain 未完整校验，坏数据可在 UI 抛错 | signal 覆盖 fetch/body/退避，主动取消不重试；校验完整返回契约。另验证 120 秒涵盖 body、4MB 上限、独立额度和限流窗口。 |
| 本地服务器两条安全边界 | 畸形 URL 在 try 外导致进程退出；公开路径内 symlink 可读根目录 DS.env 或根外文件 | URL 解析受控；对 realpath 目标重新验证白名单；实际 HTTP 测试只使用临时合成 marker，未读取真实 secret。 |
| 发布产物范围过宽 | Pages 原来上传整个仓库根目录 | CI staging 只保留 index/manifest/CNAME/assets/css/js/LICENSE/VENDOR/licenses；双平台闸门与 Action SHA 保持。实际 staging 命令在临时目录验证。 |
| 可访问性与窄横屏 | 升变浅底白色焦点描边被裁切；王被将军文本混用普通子无保护；语言按钮超出窄顶栏 | 深色内描边、专用被将军文本、顶栏空间不足时换行。键盘升变/焦点返回、读屏标签、中英 4 种尺寸实测。 |
| 文档与内容漂移 | 识别还写 45 秒；旧供应链阻断已闭环；默认设置和技能模板不适配；部分开局介绍不准确 | 更新为 120 秒和准确截止语义，归档历史快照，修正密钥注入说明与项目技能约束；中英开局文本同步修订。 |

开局内容核对依据：[Chess.com 西西里防御](https://www.chess.com/openings/Sicilian-Defense)、[尼姆佐印度防御](https://www.chess.com/openings/Nimzo-Indian-Defense)、[彼得罗夫防御](https://www.chess.com/openings/Petrovs-Defense)。模型命名核对：[DeepSeek 官方文档](https://api-docs.deepseek.com/)仍明确接受旧 deepseek-v4-flash 别名，识别继续使用 deepseek-flash/high/16000，未调整模型策略。

## 验证证据

| 验证 | 结果 |
|---|---|
| 基线 `npm test` | 54/54，通过 |
| 修复后 `npm test` | 73/73，通过；外部 fetch 全 mock |
| `npm run check` | 18 个 JS/MJS、JSON、引用、SVG、WASM、15 固定 SHA-256，通过 |
| Node 22 兼容性 | 同套 73 个测试及 check 通过；本机默认 Node 26.5.0 也通过 |
| Playwright Chromium | `scripts/browser-regressions.mjs` 12 组通过；包含真实 WASM、点击/拖拽/键盘走子、悔棋重做、易位/吃过路兵/升变、重复局面不锁盘、50 步自弈不停/无子力停止、摆棋校验、识别 mock、异步竞态、电脑循环 |
| 中英布局 | 1920×1080、390×844、844×390、320×568，无页面横向溢出；棋盘保持正方形，语言控件留在顶栏内 |
| 引擎缓存 | 冷缓存 WASM 网络请求 1 次；刷新热缓存 0 次；两次实际返回 e2e4 |
| 本地 HTTP | 畸形请求返回 404 后服务继续；公开文件 200；根内非公开及根外 symlink 404 |
| 发布包 | staging 命令通过；仅 9 个指定顶层条目；未执行线上部署 |

浏览器脚本可按 README 重跑，不依赖已存在的图片。它生成的棋盘测试图、截图和运行日志在 gitignored 的 `output/playwright/` 中；这是测试产物，不是产品对用户上传图片的持久化。

本次本地证据：`audit-unit-tests.log`、`audit-static-check.log`、`audit-node22-tests.log`、`audit-node22-check.log`、`audit-browser-regressions.log`、`audit-1920x1080.png`、`audit-390x844.png`、`audit-844x390.png`、`audit-320x568.png`。

## 真实识别验证与限制

按授权将现有旋转棋盘测试图 `recognition-test-userpos.png` POST 至生产 `/recognize`，未读取密钥。Node 直连首次在 TLS 建连阶段失败；curl 随后成功，HTTP 200，用时 66.20 秒。此验证针对**尚未部署修改的生产 Worker**；本地 Worker 修改由 mock 测试验证。

逐格对照共 **25 枚棋子，24 枚位置正确**；模型将 g2 白兵放到了 h2，且 `uncertain` 为空。图中没有回合指示，返回 `turn: null` 符合契约。这说明接口和结构契约正常，不能宣称图片识别百分百正确。浏览器已验证结果必须人工校对、确认回合并点击完成后才应用；本轮没有用一次模型误识别擅自调整推理参数或引入自动应用。

完整比较保存在 `output/playwright/audit-live-recognition.json`：

- 预期：`r2qk1nr/1p3ppp/p7/2b5/P4P2/2Np1B1P/1P2P1P1/R1BQK2R`
- 实际：`r2qk1nr/1p3ppp/p7/2b5/P4P2/2Np1B1P/1P2P2P/R1BQK2R`

## 发布前状态与剩余边界

本节保留早期审校阶段的发布前记录，后续决策与验收见下节。

2026-10-29 后续按用户新图开展了 64 次识别对照实验，详见 [识别实验报告](RECOGNITION_BENCHMARK.md)。新图生产结果 15/15 全对，但浏览器首次请求 502 后重试导致总等待约 121 秒。新增 PNG/JPEG 自适应编码并移除 thinking 模式忽略的 temperature 参数；最新本地测试为 75/75，通过静态检查与真实浏览器压缩验证。快速拆格方案尚未接入产品；默认提示词与 high 保留，仍未发布。

- 当前改动可审阅，未提交、push 或部署。建议提交标题：`fix: harden async state, worker boundaries and delivery checks`；提交正文说明修复与验证，协作者署名按实际模型填写。
- 用户确认后：重新确认工作区和测试 → commit → push origin main → 等待 Ubuntu/Windows CI 及 Pages 发布 → 部署 Worker → 对比线上文件与本地、核验 Worker 路由。远端 CI、生产文件一致性和新 Worker 行为尚不能记为通过。
- 账户级费用防护是否已配置，仍需账户证据；本轮未更改 WAF、身份认证或费用设置。引擎旧搜索会被丢弃但未增加外部 stop API。单个识别样例不构成整体准确率估计；详见威胁模型。

## 后续识别优化与发布验收

用户已明确授权验证完成后提交、推送 main 与部署 Worker。后续共 194 次模型调用，详情见 [拆格优化报告](RECOGNITION_OPTIMIZATION.md)。朝向读取、网格定位和占用检测可分离实现，但跨主题棋子分类仍出现王/后及颜色错误，连 E-high 都未通过发布门槛。因此新模型路线已撤出产品，纯算法与冻结协议隔离保存在 `experiments/recognition/`，不进入 Pages 产物或生产 Worker。

正式发布内容包括此前审校修复、PNG/JPEG 较小者选择、移除 thinking 模式忽略的 temperature，以及持续保存不确定格子提醒。更换语言、回合、编辑或识别失败不会静默丢失旧提醒；完成、清空或初始局面会释放预览与提醒。生产默认提示词与 high/16000 保持。

最终本地验收：99/99 Node 测试（包括 24 项实验纯算法/解析测试），Node 22 同样 99/99；19 个 JS/MJS 静态检查与 15 个固定哈希通过；主浏览器回归 12/12、正式识别补充回归 6/6。模型实验的正确率单独报告，不能用单元测试通过率替代。

发布中的远端 CI、线上文件一致性与 Worker 验收将于实际完成后补录。
