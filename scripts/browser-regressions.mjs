// Run with playwright-cli run-code --filename scripts/browser-regressions.mjs.
// The CLI supplies page; no application or npm runtime dependency is added.
// Start npm run serve first. All AI requests are intercepted; no paid API calls.
async (page) => {
  const results = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  const square = (name) => page.locator(`[data-square="${name}"]`);
  const fen = () => page.evaluate(() => window.app.chess.fen());
  const load = (position) => page.evaluate((value) => window.app.loadFen(value), position);
  const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const kings = '4k3/8/8/8/8/8/8/4K3';
  const fixture = 'output/playwright/audit-fixture.png';
  await page.route('https://chessight-commentary.swyu17.workers.dev/**', (route) => route.fulfill({
    status: 200, contentType: 'text/event-stream',
    body: 'data: {"choices":[{"delta":{"content":"Mock commentary"}}]}\n\ndata: [DONE]\n\n',
  }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.app));
  await page.locator('#board').screenshot({ path: fixture });
  check(await page.locator('#chk-auto').isChecked(), 'auto hint defaults on');
  check(await page.locator('#btn-control').getAttribute('aria-pressed') === 'false', 'control defaults off');
  check(await page.locator('#btn-xray').getAttribute('aria-pressed') === 'false', 'xray defaults off');
  await page.locator('#chk-auto').uncheck();
  await page.locator('#btn-commentary').click();
  const move = await page.evaluate(() => window.app.engine.bestMove(window.app.chess.fen(), 60));
  check(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move), 'real WASM engine returns UCI move');
  check(await fen() === initial, 'initial engine preload does not move');
  results.push('defaults and real Stockfish');

  await square('e2').click(); await square('e4').click();
  await square('e7').focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => window.app.chess.history().join(' ')) === 'e4 e5', 'pointer and keyboard moves');
  const after = await fen();
  await page.locator('#btn-undo').click(); await page.locator('#btn-redo').click();
  check(await fen() === after, 'undo/redo roundtrip');
  results.push('pointer, keyboard, undo and redo');

  await load(initial);
  await square('e2').scrollIntoViewIfNeeded();
  const start = await square('e2').boundingBox();
  const end = await square('e4').boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  check(await page.evaluate(() => window.app.chess.history()[0]) === 'e4', 'pointer drag move');
  await load(initial);
  for (let round = 0; round < 2; round++) {
    for (const [from, to] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]) {
      await square(from).click(); await square(to).click();
    }
  }
  check(await page.evaluate(() => window.app.chess.isThreefoldRepetition()), 'threefold repetition reached');
  await square('e2').click(); await square('e4').click();
  check(await page.evaluate(() => window.app.chess.history().at(-1)) === 'e4', 'claimable draw does not lock board');
  results.push('dragging and repetition boundary');

  await load('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  await square('e1').click(); await square('g1').click();
  check(await page.evaluate(() => window.app.chess.get('f1')?.type === 'r'), 'castling moves rook');
  await load('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  await square('e5').click();
  check(await square('d6').evaluate((el) => el.classList.contains('hint-ring')), 'en passant capture ring');
  await square('d6').click();
  check(await page.evaluate(() => !window.app.chess.get('d5')), 'en passant removes pawn');
  await load('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  await square('a7').focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  check(await page.locator('.promo-cancel').evaluate((el) => el === document.activeElement), 'promotion focus trap');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  check(await page.evaluate(() => window.app.chess.get('a8')?.type === 'n'), 'keyboard knight promotion');
  check(await square('a8').evaluate((el) => el === document.activeElement), 'promotion returns focus');
  await load('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1');
  check((await square('e1').getAttribute('aria-label')).includes('被将军'), 'king check announced accurately');
  results.push('castling, en passant, promotion and focus');

  await load(initial);
  await page.locator('#btn-setup').click();
  await page.locator('#btn-clear').click(); await page.locator('#btn-done').click();
  check(await page.locator('.app').evaluate((el) => el.classList.contains('setup')), 'invalid setup remains editable');
  await page.locator('#btn-start-pos').click();
  await page.locator('.tray-slot[data-color="w"][data-type="n"]').focus();
  await page.keyboard.press('Enter');
  await square('d4').focus(); await page.keyboard.press('Enter');
  await page.locator('#btn-done').click();
  check(await page.evaluate(() => window.app.chess.get('d4')?.type === 'n'), 'keyboard setup palette placement');
  results.push('setup validation and keyboard editing');

  // Hold promises to force the precise mode-change races without timing guesses.
  await load(initial);
  await page.evaluate(() => {
    window.engineJobs = [];
    window.app.engine.bestMove = (position, time, moves, progress) => new Promise((resolve, reject) => {
      window.engineJobs.push({ position, resolve, reject, progress });
    });
  });
  await page.locator('#btn-hint').click();
  await page.locator('#btn-new').click();
  await page.evaluate(() => { window.engineJobs[0].progress('stale'); window.engineJobs[0].resolve('e2e4'); });
  await page.waitForFunction(() => !document.getElementById('btn-hint').disabled);
  check(await page.locator('#hint').isHidden(), 'same-FEN new game discards old hint');
  await page.locator('#btn-hint').click();
  await page.locator('#btn-setup').click();
  await page.evaluate(() => window.engineJobs[1].reject(new Error('OLD_HINT_ERROR')));
  await page.waitForFunction(() => document.getElementById('btn-done') !== null);
  check(!(await page.locator('#hint').textContent()).includes('OLD_HINT_ERROR'), 'old hint error suppressed');
  await page.locator('#btn-done').click();
  await page.locator('#chk-selfplay').check();
  await page.waitForFunction(() => window.engineJobs.length === 3);
  await page.locator('#btn-setup').click();
  await page.evaluate(() => { window.engineJobs[2].progress('stale'); window.engineJobs[2].reject(new Error('OLD_CPU_ERROR')); });
  check(await page.locator('#chk-selfplay').isChecked(), 'stale CPU failure does not disable new mode');
  check(!(await page.locator('#status').textContent()).includes('OLD_CPU_ERROR'), 'stale CPU error suppressed');
  await page.locator('#chk-selfplay').uncheck(); await page.locator('#btn-done').click();
  results.push('same-FEN hint and stale engine progress/error guards');

  await page.evaluate(() => { window.app.engine.bestMove = async () => 'e2e4'; });
  await page.locator('#chk-selfplay').check();
  await page.waitForFunction(() => Boolean(document.querySelector('.arrows > g:last-child .hint-arrow')));
  await page.locator('#btn-new').click();
  await page.waitForFunction(() => window.app.chess.history().length === 1, null, { timeout: 6000 });
  await page.locator('#chk-selfplay').uncheck();
  check(await page.evaluate(() => window.app.chess.history()[0]) === 'e4', 'computer loop restarts after cancelled animation');
  results.push('computer animation cancellation restarts loop');

  await load(initial);
  await page.locator('#btn-hint').click();
  await page.waitForFunction(() => Boolean(document.querySelector('.g-hint .hint-arrow')));
  await page.locator('#btn-flip').click();
  check(await page.locator('.g-hint .hint-arrow').count() === 1, 'flip preserves completed hint');
  await page.locator('#btn-flip').click();
  await page.locator('#chk-auto').check(); await page.locator('#chk-auto').uncheck();
  check(await page.locator('.g-hint .hint-arrow').count() === 0, 'auto hint off clears arrow');
  results.push('completed hint flip and toggle rendering');

  await load(initial);
  await page.evaluate(() => { window.app.engine.bestMove = async (position) => position.split(' ')[1] === 'b' ? 'e7e5' : 'e2e4'; });
  await page.locator('#chk-vscpu').check();
  await square('e2').click(); await square('e4').click();
  await page.waitForFunction(() => window.app.chess.history().length === 2, null, { timeout: 6000 });
  await page.locator('#btn-undo').click();
  check(await fen() === initial, 'vs CPU undo returns both plies');
  await page.locator('#chk-vscpu').uncheck();
  await load(initial.replace('0 1', '100 51'));
  await page.locator('#chk-selfplay').check();
  check(await page.locator('#chk-selfplay').isChecked(), 'fifty-move claim does not stop self-play');
  await page.locator('#chk-selfplay').uncheck();
  await load(kings + ' w - - 0 1');
  await page.locator('#chk-selfplay').click();
  check(!(await page.locator('#chk-selfplay').isChecked()), 'insufficient material stops self-play');
  results.push('vs CPU paired undo and self-play draw boundaries');

  await load(initial);
  await page.evaluate(() => {
    window.recJobs = [];
    const original = window.fetch;
    window.fetch = (url, options) => String(url).endsWith('/recognize')
      ? new Promise((resolve, reject) => window.recJobs.push({ resolve, reject, signal: options.signal }))
      : original(url, options);
  });
  await page.locator('#rec-file').setInputFiles(fixture);
  await page.waitForFunction(() => window.recJobs.length === 1);
  await page.locator('#btn-lang-en').click();
  check((await page.locator('#status').textContent()).includes('Recognizing'), 'language change retains recognition activity');
  await page.evaluate((placement) => window.recJobs[0].resolve(Response.json({ placement, turn: 'b', uncertain: ['e8'] })), kings);
  await page.waitForFunction(() => !document.getElementById('rec-preview-wrap').hidden);
  check(await fen() === initial, 'recognition does not apply before confirmation');
  check(await page.locator('#setup-turn').inputValue() === 'b', 'turn suggestion shown');
  await page.locator('#setup-turn').selectOption('w');
  await page.locator('#btn-done').click();
  check((await fen()).startsWith(kings + ' w - -'), 'user confirms turn and final position');
  check(await page.locator('#rec-preview').getAttribute('src') === null, 'preview released after setup');
  results.push('mock recognition, manual confirmation and image release');

  await load(initial);
  await page.locator('#rec-file').setInputFiles(fixture);
  await page.waitForFunction(() => window.recJobs.length === 2);
  await page.locator('#btn-done').click();
  await page.locator('#btn-setup').click();
  check(await page.evaluate(() => window.recJobs[1].signal.aborted), 'leaving setup aborts recognition');
  await page.evaluate((placement) => window.recJobs[1].resolve(Response.json({ placement, turn: 'b', uncertain: [] })), kings);
  await page.locator('#rec-file').setInputFiles(fixture);
  await page.waitForFunction(() => window.recJobs.length === 3);
  await page.evaluate((placement) => window.recJobs[2].resolve(Response.json({ placement, turn: 'w', uncertain: [] })), kings);
  await page.waitForFunction(() => !document.getElementById('rec-preview-wrap').hidden);
  await page.locator('#btn-done').click();
  check((await fen()).startsWith(kings), 'new recognition survives old request cleanup');
  await load(initial);
  await page.locator('#rec-file').setInputFiles(fixture);
  await page.waitForFunction(() => window.recJobs.length === 4);
  await square('e2').focus(); await page.keyboard.press('Enter');
  check(await page.evaluate(() => window.recJobs[3].signal.aborted), 'manual selection aborts recognition');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await page.locator('#btn-done').click();
  check(await page.evaluate(() => window.app.chess.get('e3')?.type === 'p'), 'manual edit remains intact');
  results.push('recognition exit/reentry and manual-edit races');

  for (const [width, height] of [[1920, 1080], [390, 844], [844, 390], [320, 568]]) {
    await page.setViewportSize({ width, height });
    for (const language of ['zh', 'en']) {
      await page.locator('#btn-lang-' + language).click();
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        board: document.getElementById('board').getBoundingClientRect().toJSON(),
      }));
      check(geometry.scroll <= geometry.width, `horizontal overflow at ${width} ${language}`);
      check(Math.abs(geometry.board.width - geometry.board.height) < 1, 'board stays square');
      if (width <= 1600) {
        check(await page.evaluate(() => {
          const bar = document.querySelector('.topbar').getBoundingClientRect();
          const languages = document.querySelector('.lang-switch').getBoundingClientRect();
          return languages.left >= bar.left - 1 && languages.right <= bar.right + 1;
        }), `language controls stay inside topbar at ${width}`);
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `output/playwright/audit-${width}x${height}.png` });
  }
  results.push('Chinese/English desktop, portrait and landscape layouts');
  return { passed: results.length, results };
}
