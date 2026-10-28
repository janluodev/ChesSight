// 非生产实验；识别候选未通过准确率门槛，参见同目录 README.md。
// 数字棋盘截图的保守网格检测：只定位格子，不识别棋子或判断棋盘朝向。
// 不支持照片、透视或大幅裁切；不确定时返回 null，由调用方保留整图识别路径。
const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const median = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

function dominantColors(data) {
  const buckets = new Map();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 240) continue;
    opaque++;
    const key = (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
    let entry = buckets.get(key);
    if (!entry) { entry = { count: 0, sums: [0, 0, 0] }; buckets.set(key, entry); }
    entry.count++;
    for (let channel = 0; channel < 3; channel++) entry.sums[channel] += data[i + channel];
  }
  const clusters = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, 48)) {
    const color = bucket.sums.map((sum) => sum / bucket.count);
    const cluster = clusters.find((item) => distance2(item.color, color) <= 400);
    if (cluster) {
      cluster.color = cluster.color.map((value, channel) => (value * cluster.count + bucket.sums[channel]) / (cluster.count + bucket.count));
      cluster.count += bucket.count;
    } else clusters.push({ color, count: bucket.count });
  }
  return { colors: clusters.sort((a, b) => b.count - a.count).slice(0, 5), opaque };
}

function boundaryPeaks(profile, radius) {
  let maximum = 0;
  for (const score of profile) maximum = Math.max(maximum, score);
  if (!maximum) return null;
  const groups = [];
  for (let coordinate = 0; coordinate < profile.length; coordinate++) {
    if (profile[coordinate] < maximum * 0.28) continue;
    const last = groups.at(-1);
    if (last && coordinate - last.at(-1) <= radius * 3) last.push(coordinate);
    else groups.push([coordinate]);
  }
  // 斜边/透视会把同一条格线铺成宽峰，不能当作精确轴向边界。
  if (groups.length < 3 || groups.some((group) => group.at(-1) - group[0] > radius * 3 + 2)) return null;
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length + 0.5);
}

function fitAxis(peaks, low, high) {
  if (!peaks) return null;
  const roughPitch = (high - low + 1) / 8;
  // 圆角透明截图填白后，外沿阴影可能产生一次颜色跳变；它不是内部格线。
  peaks = peaks.filter((peak) => peak > low + roughPitch * 0.45 && peak < high - roughPitch * 0.45);
  if (peaks.length < 3) return null;
  const candidates = [];
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const gap = peaks[j] - peaks[i];
      const multiple = Math.round(gap / roughPitch);
      const pitch = gap / multiple;
      if (multiple >= 1 && multiple <= 7 && pitch >= roughPitch * 0.8 && pitch <= roughPitch * 1.25) candidates.push(pitch);
    }
  }
  if (!candidates.length) return null;
  const pitch = median(candidates);
  if (pitch < 12) return null;
  let best = null;
  for (const peak of peaks) {
    for (let index = 1; index <= 7; index++) {
      const origin = peak - index * pitch;
      const residuals = peaks.map((value) => Math.abs(value - origin - Math.round((value - origin) / pitch) * pitch));
      const loss = Math.abs(origin - low) + Math.abs(origin + 8 * pitch - high - 1)
        + residuals.reduce((sum, value) => sum + value, 0) * 3;
      if (!best || loss < best.loss) best = { origin, pitch, loss, residual: Math.max(...residuals) };
    }
  }
  if (best.residual > Math.max(2, pitch * 0.025)
      || Math.abs(best.origin - low) > pitch * 0.4
      || Math.abs(best.origin + 8 * pitch - high - 1) > pitch * 0.4) return null;
  return best;
}

function verifyAlternatingCells(codes, width, height, x, y) {
  let supported = 0;
  let votes = 0;
  let firstPhase = 0;
  const rows = Array(8).fill(0);
  const columns = Array(8).fill(0);
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      let positive = 0;
      let negative = 0;
      // 多点读取格内底色，避免棋子遮住中心或边框覆盖外沿造成误判。
      for (let sy = 0; sy < 7; sy++) {
        const py = Math.floor(y.origin + (row + 0.12 + sy * 0.126) * y.pitch);
        if (py < 0 || py >= height) continue;
        for (let sx = 0; sx < 7; sx++) {
          const px = Math.floor(x.origin + (column + 0.12 + sx * 0.126) * x.pitch);
          if (px < 0 || px >= width) continue;
          const code = codes[py * width + px];
          if (code === 1) positive++;
          else if (code === -1) negative++;
        }
      }
      const count = positive + negative;
      if (count < 6) continue; // 少量高亮/遮挡格允许没有已知底色。
      if (Math.max(positive, negative) / count < 0.8) return null;
      supported++;
      rows[row]++;
      columns[column]++;
      votes += count;
      firstPhase += (row + column) % 2 ? negative : positive;
    }
  }
  const agreement = votes ? Math.max(firstPhase, votes - firstPhase) / votes : 0;
  if (supported < 48 || rows.some((count) => count < 2) || columns.some((count) => count < 2) || agreement < 0.94) return null;
  return { supported, agreement };
}

function detectColorPair(data, width, height, colors) {
  const codes = new Int8Array(width * height);
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (data[index * 4 + 3] < 240) continue;
      const color = [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]];
      const a = distance2(color, colors[0]), b = distance2(color, colors[1]);
      if (Math.min(a, b) >= 900) continue;
      codes[index] = a < b ? 1 : -1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  const radius = Math.max(1, Math.round(Math.min(width, height) / 250));
  const vertical = new Uint32Array(width), horizontal = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = radius; x < width - radius; x++) {
      if (codes[y * width + x - radius] * codes[y * width + x + radius] === -1) vertical[x]++;
    }
  }
  for (let y = radius; y < height - radius; y++) {
    for (let x = 0; x < width; x++) {
      if (codes[(y - radius) * width + x] * codes[(y + radius) * width + x] === -1) horizontal[y]++;
    }
  }
  const x = fitAxis(boundaryPeaks(vertical, radius), minX, maxX);
  const y = fitAxis(boundaryPeaks(horizontal, radius), minY, maxY);
  if (!x || !y || x.pitch / y.pitch < 0.9 || x.pitch / y.pitch > 1.1) return null;
  const structure = verifyAlternatingCells(codes, width, height, x, y);
  if (!structure) return null;
  // 外沿轻微裁切时第一/最后格可短一些；返回值始终位于实际图像范围内。
  const edges = (axis, limit) => Array.from({ length: 9 }, (_, index) => Math.max(0, Math.min(limit, Math.round(axis.origin + index * axis.pitch))));
  return {
    xEdges: edges(x, width), yEdges: edges(y, height),
    origin: { x: x.origin, y: y.origin }, cellWidth: x.pitch, cellHeight: y.pitch,
    confidence: structure.agreement, supportedCells: structure.supported,
  };
}

/**
 * 检测最长边不超过 720px 的 RGBA 图像；边界坐标属于该输入图像。
 * @returns {{xEdges:number[], yEdges:number[], origin:{x:number,y:number}, cellWidth:number, cellHeight:number, confidence:number, supportedCells:number}|null}
 */
export function detectBoardGrid(input = {}) {
  const { data, width, height } = input || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 96 || height < 96
      || width > 720 || height > 720 || !data || data.length !== width * height * 4) return null;
  const { colors, opaque } = dominantColors(data);
  if (opaque < width * height * 0.7) return null;
  const pairs = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const count = colors[i].count + colors[j].count;
      if (count >= opaque * 0.45 && distance2(colors[i].color, colors[j].color) >= 900) {
        pairs.push({ colors: [colors[i].color, colors[j].color], count });
      }
    }
  }
  for (const pair of pairs.sort((a, b) => b.count - a.count)) {
    const result = detectColorPair(data, width, height, pair.colors);
    if (result) return result;
  }
  return null;
}

/**
 * 仅判断每格中央是否存在底色以外的图案，不判断棋种、颜色或棋盘朝向。
 * false 只用于中央区域近乎纯色的格子；细小或低对比图案也保守保留为 true。
 * 网格不可靠时返回 null；单格背景被遮挡时保守保留为 true，不能当作空格。
 * @returns {boolean[]|null} 按图像从上到下、从左到右排列的 64 个值。
 */
export function detectOccupiedCells(input, grid) {
  const { data, width, height } = input || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 96 || height < 96
      || width > 720 || height > 720 || !data || data.length !== width * height * 4) return null;
  const validEdges = (edges, limit) => Array.isArray(edges) && edges.length === 9
    && edges.every((edge, i) => Number.isFinite(edge) && edge >= 0 && edge <= limit
      && (!i || edge - edges[i - 1] >= 8));
  if (!grid || !validEdges(grid.xEdges, width) || !validEdges(grid.yEdges, height)) return null;
  const occupied = [];
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const left = grid.xEdges[column], top = grid.yEdges[row];
      const cellWidth = grid.xEdges[column + 1] - left, cellHeight = grid.yEdges[row + 1] - top;
      const pixel = (u, v) => {
        const x = Math.min(width - 1, Math.floor(left + u * cellWidth));
        const y = Math.min(height - 1, Math.floor(top + v * cellHeight));
        const index = (y * width + x) * 4;
        return [data[index], data[index + 1], data[index + 2], data[index + 3]];
      };
      // 左右窄边中段估计本格背景。避开左上行号、底部列字母与格界抗锯齿。
      const samples = [];
      const buckets = new Map();
      for (let y = 0; y < 16; y++) {
        for (const u of [0.06, 0.10, 0.14, 0.86, 0.90, 0.94]) {
          const color = pixel(u, 0.30 + y * 0.03);
          if (color[3] < 240) return null;
          samples.push(color);
          const key = (color[0] >> 4) * 256 + (color[1] >> 4) * 16 + (color[2] >> 4);
          let entry = buckets.get(key);
          if (!entry) { entry = { count: 0, sums: [0, 0, 0] }; buckets.set(key, entry); }
          entry.count++;
          for (let channel = 0; channel < 3; channel++) entry.sums[channel] += color[channel];
        }
      }
      const mode = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
      const background = mode.sums.map((sum) => sum / mode.count);
      if (samples.filter((color) => distance2(color, background) <= 400).length < samples.length * 0.55) {
        occupied.push(true);
        continue;
      }
      // 超大的实心图案可能占据多数取样点；近边缘仍有不同底色时不能把它删掉。
      let edgeDifferences = 0;
      for (const u of [0.025, 0.975]) {
        for (const v of [0.35, 0.50, 0.65]) {
          if (distance2(pixel(u, v), background) > 400) edgeDifferences++;
        }
      }
      if (edgeDifferences >= 2) { occupied.push(true); continue; }
      let different = 0;
      let opaque = 0;
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          const color = pixel(0.22 + x * 0.56 / 23, 0.20 + y * 0.58 / 23);
          if (color[3] < 240) return null;
          opaque++;
          if (distance2(color, background) > 225) different++;
        }
      }
      // 约 0.5% 的微小差异视为压缩噪声；超过阈值的任何图案都送模型判定。
      occupied.push(different > Math.max(2, opaque * 0.005));
    }
  }
  return occupied;
}
