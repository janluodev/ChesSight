// 界面双语（中文/English）字典与语言状态。
// 产品决策（2026-09-06）：每次打开默认中文，不持久化选择；
// 网页标题恒为 "ChesSight·See the Threats"，不随语言切换。
// 静态文本经 index.html 的 data-i18n / data-i18n-aria 属性绑定，动态文本在 JS 里用 t() 取值。
// 本模块保持 DOM 依赖可选，以便在 Node 测试中直接 import（无 document/window 时仅退化为纯函数）。
const DICT = {
  'skip': { zh: '跳到棋盘', en: 'Skip to board' },
  'h1': { zh: 'ChesSight · 国际象棋攻防可视化训练器', en: 'ChesSight · Chess Attack & Defence Visual Trainer' },

  'tray.head': { zh: '备选棋子', en: 'Piece Tray' },
  'setup.turn': { zh: '轮到', en: 'Turn' },
  'side.w': { zh: '白方', en: 'White' },
  'side.b': { zh: '黑方', en: 'Black' },
  'setup.clear': { zh: '清空棋盘', en: 'Clear Board' },
  'setup.startPos': { zh: '初始局面', en: 'Start Position' },
  'setup.done': { zh: '完成', en: 'Done' },

  'status.loading': { zh: '加载中…', en: 'Loading…' },
  'status.mateW': { zh: '将杀！白方获胜', en: 'Checkmate! White wins' },
  'status.mateB': { zh: '将杀！黑方获胜', en: 'Checkmate! Black wins' },
  'status.stalemate': { zh: '逼和 — 和棋', en: 'Stalemate — draw' },
  'status.turnW': { zh: '轮到白方', en: 'White to move' },
  'status.turnB': { zh: '轮到黑方', en: 'Black to move' },
  'status.check': { zh: ' — 将军！', en: ' — check!' },
  'status.draw': { zh: '（可判和）', en: ' (draw claimable)' },

  'hint.button': { zh: '💡 提示最佳走法', en: '💡 Hint Best Move' },
  'chk.auto': { zh: '持续提示（每步走完自动分析）', en: 'Auto-hint after every move' },
  'chk.vscpu': { zh: '与电脑对弈（Stockfish）', en: 'Play vs Computer (Stockfish)' },
  'chk.selfplay': { zh: '电脑自己对弈（双方均由 Stockfish 走）', en: 'Computer self-play (both sides)' },
  'btn.new': { zh: '新对局', en: 'New Game' },
  'btn.flip': { zh: '🔄 翻转棋盘', en: '🔄 Flip Board' },
  'btn.undo': { zh: '上一步', en: 'Back' },
  'btn.pause': { zh: '⏸ 暂停', en: '⏸ Pause' },
  'btn.resume': { zh: '▶ 继续', en: '▶ Resume' },
  'btn.redo': { zh: '下一步', en: 'Forward' },
  'btn.control': { zh: '攻击范围', en: 'Attack Range' },
  'btn.safety': { zh: '安全标记', en: 'Safety Markers' },
  'btn.xray': { zh: 'X-Ray 杀伤线', en: 'X-Ray Lines' },
  'btn.sound': { zh: '🔊 音效', en: '🔊 Sound' },
  'btn.setup': { zh: '♟ 自由摆棋', en: '♟ Set Up Board' },
  'btn.setupActive': { zh: '完成摆棋', en: 'Finish Setup' },

  'openings.title': { zh: '开局库', en: 'Opening Library' },
  'openings.placeholder': { zh: '— 选择开局自动摆盘 —', en: '— Pick an opening to set up —' },
  'openings.prosLabel': { zh: '优点：', en: 'Pros: ' },
  'openings.consLabel': { zh: '缺点：', en: 'Cons: ' },
  'opening.sideW': { zh: '执白 · 白方开局', en: 'White · opening' },
  'opening.sideB': { zh: '执黑 · 黑方防御', en: 'Black · defence' },

  'cmt.title': { zh: 'AI 实时解说', en: 'AI Live Commentary' },
  'cmt.toggle': { zh: '自动解说', en: 'Auto Commentary' },
  'cmt.disclosure': {
    zh: '开启后会把当前棋谱与局面发送到 ChesSight Worker，并由 DeepSeek AI 生成解说；可随时关闭。',
    en: 'Sends moves and position to the ChesSight Worker for DeepSeek AI commentary. Turn off anytime.',
  },
  'cmt.empty': { zh: '走一步棋，听听 AI 怎么说 ♟', en: 'Make a move and hear what the AI says ♟' },
  'cmt.none': { zh: '（暂无解说）', en: '(No commentary yet)' },
  'cmt.unavailable': { zh: '解说暂不可用', en: 'Commentary unavailable' },
  'cmt.done': { zh: '{label} 的 AI 解说已完成', en: 'AI commentary for {label} is ready' },
  'cmt.fail': { zh: '{label} 的 AI 解说暂不可用', en: 'AI commentary for {label} is unavailable' },

  'legend.title': { zh: '图例', en: 'Legend' },
  'legend.ctrlW': { zh: '仅白方控制', en: 'Controlled by White only' },
  'legend.ctrlB': { zh: '仅黑方控制', en: 'Controlled by Black only' },
  'legend.ctrlBoth': { zh: '双方均控制', en: 'Contested by both sides' },
  'legend.safeRed': { zh: '被攻击 · 无保护', en: 'Attacked · undefended' },
  'legend.safeGreen': { zh: '未被攻击 · 有保护', en: 'Not attacked · defended' },
  'legend.safeYellow': { zh: '被攻击 · 有保护', en: 'Attacked · defended' },
  'legend.note': {
    zh: 'X-Ray 虚线箭头 = 各棋子的杀伤路线（蓝 = 白方、红 = 黑方）；橙色粗箭头 = 引擎提示的最佳走法。',
    en: 'Dashed X-Ray arrows = attacking lines (blue = White, red = Black); thick orange arrow = engine best move.',
  },
  'footer.pieces': { zh: '棋子素材：', en: 'Pieces: ' },
  'footer.rules': { zh: '规则引擎：', en: 'Rules: ' },
  'footer.engine': { zh: '分析引擎：', en: 'Engine: ' },

  'aria.tray': { zh: '自由摆棋备选棋子', en: 'Board editor piece tray' },
  'aria.menu': { zh: '对局控制', en: 'Game controls' },
  'aria.board': { zh: '棋盘', en: 'Chess board' },
  'aria.openingSelect': { zh: '选择开局', en: 'Choose an opening' },

  'setup.statusKb': {
    zh: '自由摆棋中 — 用方向键选择格子，按 Enter 放置或移动；Delete 删除；Esc 取消选择',
    en: 'Board editor — use arrow keys to pick a square, Enter to place or move, Delete to remove, Esc to cancel',
  },
  'setup.statusIdle': {
    zh: '自由摆棋中 — 可拖动，或先选择备选棋子再用键盘放置；完成后点「完成」',
    en: 'Board editor — drag pieces, or pick a tray piece and place it with the keyboard; click "Done" when finished',
  },
  'setup.invalid': { zh: '局面不合法，无法完成：', en: 'Illegal position — cannot finish: ' },

  'rec.upload': { zh: '📷 上传图片识别', en: '📷 Recognize from image' },
  'rec.disclosure': {
    zh: '图片将发送至 ChesSight Worker 并由 DeepSeek 识别；本地不保存，刷新即清除。',
    en: 'Images are sent to the ChesSight Worker for DeepSeek recognition. Nothing is stored locally; everything is discarded on refresh.',
  },
  'rec.working': { zh: '正在识别棋盘…', en: 'Recognizing the board…' },
  'rec.done': { zh: '识别完成：请核对棋子与回合，确认无误后点「完成」', en: 'Review the pieces and side to move, then click "Done"' },
  'rec.uncertain': { zh: '；请重点核对格子：{squares}', en: '; double-check squares: {squares}' },
  'rec.failed': { zh: '识别失败，请重试或手动摆棋：', en: 'Recognition failed — retry or set up manually: ' },
  'rec.network': { zh: '网络连接失败，请检查网络后重试', en: 'Network error — check your connection and try again' },
  'rec.imageType': { zh: '图片格式不支持，请使用 JPEG/PNG/WebP 图片', en: 'Unsupported image format — please use JPEG/PNG/WebP' },
  'rec.previewAlt': { zh: '识别原图预览', en: 'Recognition source image' },

  'hint.thinking': { zh: '💡 引擎思考中…', en: '💡 Engine thinking…' },
  'hint.loading': { zh: '💡 正在加载引擎 {p}（首次使用需下载约 7MB）…', en: '💡 Loading engine {p} (first use downloads ~7 MB)…' },
  'engine.warming': { zh: '⚙️ 后台加载引擎 {p}（约 7MB，仅首次下载）…', en: '⚙️ Loading engine in background {p} (~7 MB, first visit only)…' },
  'cpu.loading': { zh: '正在加载引擎 {p}（首次使用需下载约 7MB）…', en: 'Loading engine {p} (first use downloads ~7 MB)…' },
  'hint.none': { zh: '当前局面无可走着法', en: 'No legal moves in this position' },
  'hint.best': { zh: '💡 Stockfish 18 最佳走法：{san}（{from} → {to}）', en: '💡 Stockfish 18 best move: {san} ({from} → {to})' },
  'hint.retry': { zh: ' — 点击💡或按 F1 重试', en: ' — click 💡 or press F1 to retry' },
  'cpu.unavailable': { zh: '电脑引擎暂不可用，已切回手动对弈：', en: 'Computer engine unavailable — switched back to manual play: ' },
  'cpu.retryLater': { zh: '请稍后重试', en: 'please try again later' },

  'promo.title': { zh: '选择升变棋子', en: 'Choose a promotion piece' },
  'promo.promoteTo': { zh: '升变为{color}{piece}', en: 'Promote to {color} {piece}' },
  'promo.cancel': { zh: '取消升变', en: 'Cancel promotion' },
  'tray.pick': { zh: '选择{color}{piece}', en: 'Pick {color} {piece}' },

  'piece.k': { zh: '王', en: 'King' },
  'piece.q': { zh: '后', en: 'Queen' },
  'piece.r': { zh: '车', en: 'Rook' },
  'piece.b': { zh: '象', en: 'Bishop' },
  'piece.n': { zh: '马', en: 'Knight' },
  'piece.p': { zh: '兵', en: 'Pawn' },
  'colorShort.w': { zh: '白', en: 'White' },
  'colorShort.b': { zh: '黑', en: 'Black' },
  'punct.comma': { zh: '，', en: ', ' },

  'board.empty': { zh: '空格', en: 'Empty square' },
  'board.check': { zh: '被将军', en: 'In check' },
  'board.selected': { zh: '已选中', en: 'Selected' },
  'board.hintCapture': { zh: '可吃子落点', en: 'Capture square' },
  'board.hintMove': { zh: '合法落点', en: 'Legal move' },
  'safety.attacked': { zh: '被攻击 · 无保护', en: 'Attacked · undefended' },
  'safety.defended': { zh: '未被攻击 · 有保护', en: 'Not attacked · defended' },
  'safety.contested': { zh: '被攻击 · 有保护', en: 'Attacked · defended' },
  'control.w': { zh: '白方控制', en: 'Controlled by White' },
  'control.b': { zh: '黑方控制', en: 'Controlled by Black' },
  'control.wb': { zh: '双方控制', en: 'Contested' },
  'end.mate': { zh: '被将杀', en: 'Checkmated' },
  'end.win': { zh: '获胜', en: 'Winner' },
  'end.draw': { zh: '和棋', en: 'Draw' },
};

// 默认中文（产品决策 2026-09-06：每次打开都重置为中文，不写 localStorage）
let lang = 'zh';

export function getLang() {
  return lang;
}

export function t(key, vars) {
  const entry = DICT[key];
  let s = entry ? entry[lang] : undefined;
  if (s === undefined) return key;
  // 替换值走函数形式：避免值中出现 `$&`、`$'` 等序列被 replaceAll 当作特殊模式展开
  if (vars) for (const k in vars) s = s.replaceAll('{' + k + '}', () => vars[k]);
  return s;
}

// 把 data-i18n / data-i18n-aria 绑定的静态文本刷新为当前语言（index.html 内置中文作为首屏默认值）
export function applyLang(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

export function setLang(next) {
  if (next !== 'zh' && next !== 'en') return;
  lang = next;
  applyLang();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('chessight:lang'));
}

export { DICT };
