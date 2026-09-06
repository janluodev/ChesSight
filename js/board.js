// 棋盘渲染与点击交互。渲染层级由每格内的 DOM 顺序保证（自下而上）：
// 格子底色 → 最后一步高亮 → 攻击范围覆盖 → 落点提示 → 棋子 → 安全状态框 → 选中描边
// 整盘之上另有一层 SVG 箭头层（X-Ray 杀伤线 + 引擎提示箭头）。
import { getLang, t } from './i18n.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const SVGNS = 'http://www.w3.org/2000/svg';

// 棋子可朗读名：中文连写（白后），英文分写（White Queen）
const pieceLabel = (color, type) => (getLang() === 'en'
  ? t('colorShort.' + color) + ' ' + t('piece.' + type)
  : t('colorShort.' + color) + t('piece.' + type));

export function createBoard(container) {
  let orientation = 'w'; // 'w' 白方视角 / 'b' 黑方视角
  const squares = new Map(); // 'e4' -> { el, img }
  const rows = new Map();

  container.setAttribute('role', 'grid'); // 键盘/辅助技术：整盘为 grid，格子为 gridcell
  container.setAttribute('aria-rowcount', '8');
  container.setAttribute('aria-colcount', '8');

  for (let rank = 8; rank >= 1; rank--) {
    const row = document.createElement('div');
    row.className = 'board-row';
    row.setAttribute('role', 'row');
    rows.set(rank, row);
    for (let f = 0; f < 8; f++) {
      const name = FILES[f] + rank;
      const el = document.createElement('div');
      el.className = 'square ' + ((f + rank) % 2 === 0 ? 'light' : 'dark');
      el.dataset.square = name;
      el.setAttribute('role', 'gridcell');
      el.setAttribute('aria-label', name); // 静态坐标名，供屏幕阅读器播报当前所在格
      el.setAttribute('aria-selected', 'false');
      el.tabIndex = -1; // 漫游 tabindex：默认不可 Tab 达，由 main.js 令其中一格为 0

      for (const layer of ['last', 'ctrl', 'hint']) {
        const ly = document.createElement('div');
        ly.className = 'ly ' + layer;
        el.appendChild(ly);
      }
      const img = document.createElement('img');
      img.className = 'piece';
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
      for (const layer of ['safety', 'sel', 'badge']) {
        const ly = document.createElement('div');
        ly.className = 'ly ' + layer;
        el.appendChild(ly);
      }
      row.appendChild(el);
      squares.set(name, { el, img });
    }
    container.appendChild(row);
  }

  // SVG 箭头层：置于所有格子之后（绝对定位兄弟节点，绘制在棋子之上）
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('arrows');
  svg.innerHTML = `
    <defs>
      <marker id="ah-w" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="rgba(52,120,246,0.7)"/></marker>
      <marker id="ah-b" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="rgba(235,64,52,0.7)"/></marker>
      <marker id="ah-hint" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#F7A600"/></marker>
    </defs>
    <g class="g-xray"></g>
    <g class="g-hint"></g>`;
  container.appendChild(svg);
  const gXray = svg.querySelector('.g-xray');
  const gHint = svg.querySelector('.g-hint');
  // 电脑落子过场箭头：独立于 render() 生命周期的图层（复用提示箭头样式），重绘不冲掉
  const gAnim = document.createElementNS(SVGNS, 'g');
  svg.appendChild(gAnim);

  function center(name) {
    const f = FILES.indexOf(name[0]);
    const r = +name[1];
    const x = orientation === 'w' ? f : 7 - f;
    const y = orientation === 'w' ? 8 - r : r - 1;
    return [x + 0.5, y + 0.5];
  }

  // 按视角摆放格子（grid 显式定位）并重建坐标标签（左缘 rank、下缘 file）
  function applyOrientation() {
    const orderedRanks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    for (const [visualRow, rank] of orderedRanks.entries()) {
      const row = rows.get(rank);
      row.setAttribute('aria-rowindex', String(visualRow + 1));
      container.insertBefore(row, svg);
      const files = orientation === 'w' ? FILES : [...FILES].reverse();
      for (const [visualColumn, file] of files.entries()) {
        const square = squares.get(file + rank).el;
        square.setAttribute('aria-colindex', String(visualColumn + 1));
        row.appendChild(square);
      }
    }
    for (const [name, { el }] of squares) {
      const f = FILES.indexOf(name[0]);
      const r = +name[1];
      el.style.gridColumnStart = (orientation === 'w' ? f : 7 - f) + 1;
      el.style.gridRowStart = (orientation === 'w' ? 8 - r : r - 1) + 1;
    }
    container.querySelectorAll('.coord').forEach((c) => c.remove());
    const leftFile = orientation === 'w' ? 'a' : 'h';
    const bottomRank = orientation === 'w' ? 1 : 8;
    for (let r = 1; r <= 8; r++) {
      const s = document.createElement('span');
      s.className = 'coord rank';
      s.textContent = r;
      squares.get(leftFile + r).el.appendChild(s);
    }
    for (let f = 0; f < 8; f++) {
      const s = document.createElement('span');
      s.className = 'coord file';
      s.textContent = FILES[f];
      squares.get(FILES[f] + bottomRank).el.appendChild(s);
    }
  }
  applyOrientation();

  // 视口坐标 → 格名（按当前视角），拖拽落点判定用；出界返回 null
  // rect 可选：拖拽期间传入起始时缓存的棋盘矩形，避免每次 pointermove 都强制回流
  function squareAt(clientX, clientY, rect = container.getBoundingClientRect()) {
    const fx = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const fy = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
    const f = orientation === 'w' ? fx : 7 - fx;
    const r = orientation === 'w' ? 8 - fy : fy + 1;
    return FILES[f] + r;
  }

  function drawLine(g, from, to, cls, marker, shorten) {
    const [x1, y1] = center(from);
    const [x2, y2] = center(to);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    const t = Math.max(0.1, (len - shorten) / len); // 终点回缩，给箭头留位置
    const el = document.createElementNS(SVGNS, 'line');
    el.setAttribute('x1', x1);
    el.setAttribute('y1', y1);
    el.setAttribute('x2', x1 + dx * t);
    el.setAttribute('y2', y1 + dy * t);
    el.setAttribute('class', cls);
    el.setAttribute('marker-end', `url(#${marker})`);
    g.appendChild(el);
  }

  // 全量幂等重绘：64 格 class 切换 + img src + 箭头层重建，无 diff
  function render({ position, lastMove, control, safety, hints, selected, xrayLines, hintMove, endBadges }) {
    const hintMap = new Map();
    if (hints) for (const h of hints) hintMap.set(h.to, h.capture);
    const last = new Set(lastMove || []);

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const name = FILES[j] + (8 - i);
        const { el, img } = squares.get(name);
        const cell = position[i][j];

        // Pointer Events 在手势开始前读取 touch-action；只有有棋子的起点禁止浏览器接管，
        // 空格仍保留页面纵向滚动与双指缩放。
        el.classList.toggle('has-piece', Boolean(cell));
        el.classList.toggle('last', last.has(name));
        el.classList.toggle('sel', selected === name);
        el.setAttribute('aria-selected', String(selected === name));

        el.classList.remove('ctrl-w', 'ctrl-b', 'ctrl-wb');
        if (control && control[name]) el.classList.add('ctrl-' + control[name]);

        el.classList.remove('hint-dot', 'hint-ring');
        if (hintMap.has(name)) el.classList.add(hintMap.get(name) ? 'hint-ring' : 'hint-dot');

        el.classList.remove('safety-attacked', 'safety-defended', 'safety-contested');
        if (safety && safety[name]) el.classList.add('safety-' + safety[name]);

        el.classList.remove('badge-mate', 'badge-win', 'badge-draw');

        if (cell) {
          const src = `./assets/pieces/${cell.color}${cell.type.toUpperCase()}.svg`;
          if (img.getAttribute('src') !== src) img.setAttribute('src', src);
          img.alt = '';
          img.classList.add('show');
        } else {
          img.classList.remove('show');
          img.alt = '';
        }

        const label = [name, cell ? pieceLabel(cell.color, cell.type) : t('board.empty')];
        if (selected === name) label.push(t('board.selected'));
        if (hintMap.has(name)) label.push(t(hintMap.get(name) ? 'board.hintCapture' : 'board.hintMove'));
        if (control?.[name]) label.push(t('control.' + control[name]));
        if (safety?.[name]) label.push(t('safety.' + safety[name]));
        el.setAttribute('aria-label', label.join(t('punct.comma')));
      }
    }

    if (endBadges) {
      for (const b of endBadges) {
        if (b.square) {
          const square = squares.get(b.square).el;
          square.classList.add('badge-' + b.kind);
          const result = t(b.kind === 'mate' ? 'end.mate' : b.kind === 'win' ? 'end.win' : 'end.draw');
          square.setAttribute('aria-label', square.getAttribute('aria-label') + t('punct.comma') + result);
        }
      }
    }

    gXray.replaceChildren();
    if (xrayLines) {
      for (const l of xrayLines) drawLine(gXray, l.from, l.to, 'xray-' + l.color, 'ah-' + l.color, 0.26);
    }
    gHint.replaceChildren();
    if (hintMove) drawLine(gHint, hintMove.from, hintMove.to, 'hint-arrow', 'ah-hint', 0.42);
  }

  function setOrientation(o) {
    if (o !== orientation) {
      orientation = o;
      applyOrientation();
    }
  }

  function drawAnimArrow(from, to) {
    gAnim.replaceChildren();
    drawLine(gAnim, from, to, 'hint-arrow', 'ah-hint', 0.42);
  }
  function clearAnimArrow() {
    gAnim.replaceChildren();
  }

  return { render, setOrientation, getOrientation: () => orientation, squareAt, drawAnimArrow, clearAnimArrow };
}
