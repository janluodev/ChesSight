# 第三方组件清单

本文件记录仓库内直接分发的第三方文件、来源和 SHA-256。自动校验位于 `scripts/check.mjs`。

| 本地文件 | 版本 / 许可 | 来源 | SHA-256 | 状态 |
|---|---|---|---|---|
| `js/vendor/chess.js` | chess.js 1.4.0 / BSD-2-Clause | [npm 发行包](https://www.npmjs.com/package/chess.js/v/1.4.0) 的 `dist/esm/chess.js` | `76c7c34f0e2e9ab076521a5d6fe786a9cce537bb1b6f29d32a9c9970b5b232d2` | 与上游发行物逐字节一致；许可正文位于文件头。 |
| `js/vendor/stockfish-18-lite-single.wasm` | Stockfish.js 18.0.0 / GPL-3.0 | [v18.0.0 release](https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0) | `a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1` | 与上游 release asset 逐字节一致。 |
| `js/vendor/stockfish-18-lite-single.js` | Stockfish.js 18.0.0 / GPL-3.0 | [v18.0.0 release](https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0) 同名 asset | `2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe` | 2026-07-23 已用官方 release asset 覆盖此前来源不明的本地副本，与上游逐字节一致（历史差异见 git 记录）；Corresponding Source 即上游仓库对应 tag。 |
| `assets/pieces/*.svg`、图标中的马形 | cburnett / CC-BY-SA 3.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces) | 12 个 SVG 的固定哈希见下表并由 `scripts/check.mjs` 强制校验 | 初次审计逐文件比对 Wikimedia cburnett 原文件一致；页面页脚与 README 保留作者、来源及许可链接。 |

### 棋子 SVG 固定 SHA-256

所有 SVG 统一为 LF 行尾后计算（仓库已由 `.gitattributes` 强制 `eol=lf`；其中 bB/bN/wB/wN/wR 五个文件早期曾以 CRLF 入库，本轮已归一化并同步更新哈希，内容无其他差异）。

| 文件 | SHA-256 |
|---|---|
| `bB.svg` | `3ed2bb19629a70ddb8d0f971caa7251b0ab9bf01bcebaa4bac83f7aec0c6dd7a` |
| `bK.svg` | `025eea92e0ef8eb1fd06b1c58d0d112948f08bf66cea6b5d003659569949b41c` |
| `bN.svg` | `9b836351ecb399c64163b5e5083d17b67c1b7273728a369847ba8b1332ca243d` |
| `bP.svg` | `4413bf7c18a341f9723d97e6f92c985e30b6167b037e80842cea59b7541bb074` |
| `bQ.svg` | `70191a3fbc729ef629661e2419a66ab8024c49277aab8ccae3a5ef61372ab802` |
| `bR.svg` | `6abf617a9e26902e0734d85897c9ca55e29d7be2928142aa21032c38967e34ba` |
| `wB.svg` | `30612a7aec659cd417d9bf258281c9d681896d7eacc3066fe1808cbb180d588a` |
| `wK.svg` | `56f55c784843b1ac272b8745d740aa2a3e6c585513ef889978916f88e5d0b70b` |
| `wN.svg` | `3b5d668e3caf7856d3c9c496d73c4b36d095cfda482929097defd7dbade20bc4` |
| `wP.svg` | `cc7de30708dcec8f4d593a89d10893d5f9c063682039a1c441e86c44cf2096db` |
| `wQ.svg` | `b72b864e2a5b6c8f8afb7f260130c10e649ff063f4ef58190c00a35c56364327` |
| `wR.svg` | `20d8dfd35151c288db1696630e16f5c25d6ead3f93dd65d776f162866b223dbb` |

`js/engine-worker.js` 是本项目自有的同源引擎入口，只为指定 WASM 读取版本化 Cache Storage，再加载上述未改动的官方 glue；不属于 vendor 文件，也不改变上述 15 个固定哈希。

## 验证

```bash
npm run check
shasum -a 256 js/vendor/chess.js js/vendor/stockfish-18-lite-single.js js/vendor/stockfish-18-lite-single.wasm
```

## 分发注意事项

- 项目自有源码为 MIT；第三方文件继续受其各自许可约束。
- Stockfish/Stockfish.js 为 GPL-3.0；许可全文保存在 `licenses/GPL-3.0.txt`。本地 glue 与 wasm 均与 [v18.0.0 官方 release](https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0) 同名 asset 逐字节一致（哈希门强制校验），Corresponding Source 由上游仓库对应 tag 提供；本文件不构成法律意见。
- `js/vendor/chess.js` 文件末尾引用了未随仓库分发的 source map；不影响运行，但调试时会出现缺失映射，后续可补同版本官方 map 或在重新 vendor 时移除声明并更新哈希。
