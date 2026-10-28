# 棋盘分格识别实验（非生产）

这些零依赖模块保留 2026-10-29 的分格识别候选方案，供离线研究与单元测试使用。**该方案未通过模型准确率门槛，不接入生产上传流程或 Worker 入口。** 不应从 `js/recognition.js`、`worker/src/index.js` 导入本目录，也不应为它新增公开 HTTP 路由。当前静态服务器的公开目录白名单不包括 `experiments/`。

## 结果与限制

浏览器内纯像素网格定位与占用检测在 12 张冻结合成图及 4 张旧图上均成功，共 1024 格：311 个有图案格和 713 个空格的占用判断全部正确。`boardBounds`、棋子真值及朝向仅用于检测完成后的离线评分，从未提供给检测算法。该结果只证明这组图上的分格与占用判断，不能证明棋种、颜色、朝向或完整局面识别可靠。

后续 LLM 分类仍失败：E 候选在 12 张开发图上完整棋子分类正确 7 张，包含王/后混淆、棋子颜色错误及返回索引不完整。单格独立请求 F 的针对性诊断仅 1/4 完整正确；提高推理强度的 E-high 三图门槛只通过 2/3，因此未继续释放最终六张独立图。E 复用了 D 失败后已见过的开发图，不能将它描述为新的独立验证集。

## API

`grid.js` 仅处理像素，不执行网络请求、不识别棋种，也不推断朝向：

- `detectBoardGrid({ data, width, height })`：输入 RGBA 像素，每个尺寸须在 96–720 之间，最长边应由调用者提前缩至不超过 720。成功返回 `xEdges`、`yEdges`（各 9 个输入坐标）、`origin`、`cellWidth`、`cellHeight`、`confidence`、`supportedCells`；不支持或证据不足返回 `null`。`confidence` 是格子底色奇偶一致率，不是校准后的成功概率。
- `detectOccupiedCells(imageData, grid)`：返回按图像从上到下、从左到右排列的 64 个布尔值，或在输入/网格无效时返回 `null`。`true` 表示有底色以外的图案，可能包含箭头、标注或其他遮挡；背景无法可靠估计时保守保留该格。`false` 只表示取样区域近乎纯色，不是语义上的棋子识别。禁止把 `null` 当作全空棋盘。

支持范围是轴向对齐、近正方形、两种主要纯底色的数字棋盘截图，可以容忍少量高亮、坐标文字、边框、颜色压缩误差和轻微外沿裁切。照片、明显透视、大幅裁切、大面积遮挡、过大界面留白、低对比或复杂纹理不在保证范围内。占用检测会主动排除左上行号与底部字母，但不能识别不可见或与背景极为接近的图案。

`cells.js` 保留候选 E 的纯解析、坐标映射和请求对象构造函数，不自行发送请求：

- `parseObject(text)`、`parseIndexedCells(text, occupied?)`：解析 JSON 和 1–64 的显式格索引；传入占用数组时要求索引集合匹配，判空但有图案的格子转为 `?`。
- `parseOrientation(text)`：只接受印刷左上行号的精确 `1`/`8` 数值或字符串；无证据时朝向为 `null`。
- `resultFromCells(cells, { orientation, turn })`：将 64 格映射为 FEN 棋盘段和不确定格列表。
- `classificationBody({ image, cells, occupied })`、`orientationBody({ image, corners })`：构造冻结候选的模型请求体，保留作复现参考，不代表生产配置。

## 验证记录

现有原始记录保持在 `output/` 下；该目录可能被 Git 忽略，不是公开服务入口。本次检测记录只保存代码、坐标和数值元数据，未另存用户图片或其 base64：

- [`occupancy-browser-metadata.json`](../../output/playwright/recognition-v2/occupancy-browser-metadata.json)：16 图的自动网格、扫描尺寸、原图尺寸、占用索引与耗时，不包含真值边界。
- [`occupancy-scoring.json`](../../output/playwright/recognition-v2/occupancy-scoring.json)：独立评分，16 图均无漏报、无多报。
- [`grid-browser-metadata.json`](../../output/playwright/recognition-v2/grid-browser-metadata.json)、[`grid-browser-fallback-metadata.json`](../../output/playwright/recognition-v2/grid-browser-fallback-metadata.json)：真实 Chromium 预处理和不支持图片的回退记录；它们记录的是当时原型，不是当前生产流程性能。
- [`summary.json`](../../output/recognition-v2/summary.json)：A–F、E-high 的模型实验汇总；同目录 `10-D-*`、`20-E-*`、`30-F-*`、`40-Ehigh-*` 为逐次请求结果，`candidate-*-frozen.json` 保留冻结配置。
- [`prototype-worker-tests.txt`](../../output/recognition-v2/prototype-worker-tests.txt)：未通过候选的集成测试审阅快照，保留当时源码和相对引用。它不是当前产品测试，不可直接用于验证当前 Worker，也不会进入 Node 的默认测试发现。

纯算法与解析器单元测试仍保留在 `tests/`，可执行：

```sh
node --test --test-reporter=spec tests/recognition-grid.test.js tests/recognition-cells.test.js
```

这些单元测试通过不改变候选模型未通过上线门槛的结论。后续研究应先建立新的独立评估集，并验证完整局面正确率，再考虑新的生产接入。
