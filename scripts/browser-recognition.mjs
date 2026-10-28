// Start npm run serve, then use an isolated Playwright CLI session:
// playwright-cli -s=recognition-v2-ui open http://127.0.0.1:8173
// playwright-cli -s=recognition-v2-ui run-code --filename scripts/browser-recognition.mjs
// Uses deterministic synthetic PNGs generated in memory; no fixture download is needed.
// All AI requests are mocked/blocked; image data stays in browser memory.
async (page) => {
  const results = [];
  const errors = [];
  const recordError = (error) => errors.push(error.message);
  page.on('pageerror', recordError);
  const check = (value, message) => { if (!value) throw new Error(message); };
  const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const placement = '4k3/8/8/2n5/8/6P1/8/R3K3';
  const edited = '4k3/8/8/2nN4/8/6P1/8/R3K3';
  const fen = () => page.evaluate(() => window.app.chess.fen());
  const loadInitial = () => page.evaluate((value) => window.app.loadFen(value), initial);
  const isSetup = () => page.locator('.app').evaluate((el) => el.classList.contains('setup'));
  const square = (name) => page.locator(`[data-square="${name}"]`);
  const displayedPlacement = () => page.evaluate(() => {
    const rows = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = '', empty = 0;
      for (const file of 'abcdefgh') {
        const piece = document.querySelector(`[data-square="${file}${rank}"] .piece.show`);
        if (!piece) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        const [, color, type] = piece.getAttribute('src').match(/\/([wb])([KQRBNP])\.svg$/);
        row += color === 'w' ? type : type.toLowerCase();
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  });
  await page.route('https://chessight-commentary.swyu17.workers.dev/**', (route) => route.abort());
  try {
    await page.reload();
    await page.waitForFunction(() => Boolean(window.app));
    await page.locator('#chk-auto').uncheck();
    await page.locator('#btn-commentary').click();
    await page.evaluate(() => {
      window.uiRecJobs = [];
      const original = window.fetch;
      window.fetch = (url, options) => String(url).endsWith('/recognize')
        ? new Promise((resolve, reject) => window.uiRecJobs.push({
          resolve, reject, signal: options.signal, payload: JSON.parse(options.body),
        }))
        : original(url, options);
    });
    const syntheticImage = async (noisy) => {
      const dataUrl = await page.evaluate((noisy) => {
        const canvas = document.createElement('canvas');
        canvas.width = noisy ? 2240 : 64;
        canvas.height = noisy ? 1120 : 64;
        const context = canvas.getContext('2d');
        if (noisy) {
          const image = context.createImageData(canvas.width, canvas.height);
          let state = 1729;
          for (let i = 0; i < image.data.length; i += 4) {
            for (let channel = 0; channel < 3; channel++) {
              state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
              image.data[i + channel] = state >>> 24;
            }
            image.data[i + 3] = 255;
          }
          context.putImageData(image, 0, 0);
        } else {
          for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
            context.fillStyle = (row + col) % 2 ? '#769656' : '#eeeed2';
            context.fillRect(col * 8, row * 8, 8, 8);
          }
        }
        return canvas.toDataURL('image/png');
      }, noisy);
      return { name: noisy ? 'synthetic-noise.png' : 'synthetic-board.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
    };
    const flatImage = await syntheticImage(false);
    const noisyImage = await syntheticImage(true);
    const upload = async (file = flatImage) => {
      const index = await page.evaluate(() => window.uiRecJobs.length);
      await page.locator('#rec-file').setInputFiles(file);
      await page.waitForFunction((count) => window.uiRecJobs.length === count, index + 1);
      return index;
    };
    const answer = async (index, resultPlacement = placement, uncertain = []) => {
      await page.evaluate(({ index, placement, uncertain }) => {
        window.uiRecJobs[index].resolve(Response.json({ placement, turn: null, uncertain }));
      }, { index, placement: resultPlacement, uncertain });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    };

    const payloads = [];
    for (const [file, format, width, height] of [[flatImage, 'png', 64, 64], [noisyImage, 'jpeg', 1120, 560]]) {
      await loadInitial();
      const index = await upload(file);
      const payload = await page.evaluate(async (index) => {
        const body = window.uiRecJobs[index].payload;
        const image = new Image();
        image.src = body.image;
        await image.decode();
        return {
          fields: Object.keys(body).sort().join(','),
          format: body.image.match(/^data:image\/(\w+);base64,/)[1],
          width: image.naturalWidth, height: image.naturalHeight,
          bytes: new TextEncoder().encode(JSON.stringify(body)).length,
        };
      }, index);
      check(payload.fields === 'image,lang', 'production request contains only the full image and language');
      check(payload.format === format, 'compression selects the smaller image encoding');
      check(payload.width === width && payload.height === height, 'compression preserves aspect ratio within 1120px');
      check(payload.bytes < 4 * 1024 * 1024, 'compressed payload stays below Worker limit');
      payloads.push(payload);
      await answer(index);
      check(await displayedPlacement() === placement, 'recognized placement appears in the board editor');
      check(await fen() === initial, 'recognition never modifies the game before Done');
      await page.locator('#setup-turn').selectOption('b');
      await page.locator('#btn-done').click();
      check((await fen()).startsWith(placement + ' b '), 'recognition applies after user confirmation');
      check(await page.locator('#rec-preview').getAttribute('src') === null, 'Done releases the image preview');
    }
    results.push('PNG/JPEG compression choice, size limit and explicit confirmation');

    await loadInitial();
    let index = await upload();
    await answer(index, placement, ['h5', 'b2']);
    for (const turn of ['b', 'w']) {
      await page.locator('#setup-turn').selectOption(turn);
      check((await page.locator('#status').textContent()).includes('h5 b2'), 'changing side to move preserves uncertain cells');
    }
    for (const lang of ['en', 'zh']) {
      await page.locator('#btn-lang-' + lang).click();
      const status = await page.locator('#status').textContent();
      check(status.includes('h5 b2') && status.includes(lang === 'en' ? 'double-check squares' : '请重点核对格子'), 'translated uncertainty survives language changes');
    }
    await page.locator('.tray-slot[data-color="w"][data-type="n"]').focus();
    await page.keyboard.press('Enter');
    await square('d5').focus();
    await page.keyboard.press('Enter');
    check(await displayedPlacement() === edited, 'manual edits remain possible after recognition');
    check((await page.locator('#status').textContent()).includes('h5 b2'), 'manual editing preserves uncertainty warnings');
    check(await fen() === initial, 'manual edits do not change the game before confirmation');
    await page.locator('#btn-done').click();
    check((await fen()).startsWith(edited + ' w '), 'edited position applies after confirmation');
    check(!(await page.locator('#status').textContent()).includes('h5 b2'), 'Done releases uncertainty warnings');
    results.push('uncertain cells survive turn, language and manual changes until Done');

    await loadInitial();
    index = await upload();
    await answer(index, placement, ['h5']);
    const previousPreview = await page.locator('#rec-preview').getAttribute('src');
    const failed = await upload();
    await page.evaluate((index) => window.uiRecJobs[index].reject(new Error('fixture_failure')), failed);
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('fixture_failure'));
    check(await displayedPlacement() === placement, 'failed upload preserves previous review board');
    check(await page.locator('#rec-preview').getAttribute('src') === previousPreview, 'failed upload preserves previous review image');
    check((await page.locator('#status').textContent()).includes('h5'), 'failed upload preserves previous uncertainty');
    check(await fen() === initial, 'failed recognition never changes the original game');
    index = await upload();
    await answer(index, placement, ['c6']);
    const replacementStatus = await page.locator('#status').textContent();
    check(replacementStatus.includes('c6') && !replacementStatus.includes('h5'), 'successful upload replaces previous uncertainty');
    await page.locator('#btn-done').click();
    results.push('failed uploads preserve review state and new results replace it');

    for (const button of ['#btn-clear', '#btn-start-pos']) {
      await loadInitial();
      index = await upload();
      await answer(index, placement, ['h5']);
      await page.locator(button).click();
      check(await page.locator('#rec-preview').getAttribute('src') === null, `${button} clears preview`);
      check(!(await page.locator('#status').textContent()).includes('h5'), `${button} clears uncertainty warnings`);
      if (button === '#btn-clear') await page.locator('#btn-start-pos').click();
      await page.locator('#btn-done').click();
      check(!(await isSetup()) && await fen() === initial, `${button} leaves the editor confirmable`);
    }
    results.push('clear and initial-position actions release recognition state');

    await loadInitial();
    const old = await upload();
    await page.locator('#btn-done').click();
    check(await page.evaluate((index) => window.uiRecJobs[index].signal.aborted, old), 'leaving setup aborts pending recognition');
    check(await page.locator('#rec-preview').getAttribute('src') === null, 'leaving pending request keeps image released');
    await page.locator('#btn-setup').click();
    const fresh = await upload();
    await answer(old, edited, ['a4']);
    check(await displayedPlacement() === initial.split(' ')[0], 'old response cannot replace reentered setup board');
    check(await page.locator('#rec-preview').getAttribute('src') === null, 'old response cannot restore a released image');
    await answer(fresh, placement, ['c6']);
    check(await displayedPlacement() === placement, 'new request survives old cleanup');
    check(!(await page.locator('#status').textContent()).includes('a4'), 'old response cannot restore stale warnings');
    await page.locator('#btn-done').click();
    check((await fen()).startsWith(placement + ' w '), 'fresh result remains confirmable');
    results.push('cancel, reentry and stale-response isolation');

    await loadInitial();
    index = await upload();
    await answer(index, placement, ['h5', 'b2']);
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      for (const lang of ['zh', 'en']) {
        await page.locator('#btn-lang-' + lang).click();
        await page.locator('#status').scrollIntoViewIfNeeded();
        const geometry = await page.evaluate(() => {
          const status = document.getElementById('status');
          const bounds = status.getBoundingClientRect();
          return {
            text: status.textContent,
            visible: bounds.width > 0 && bounds.height > 0,
            pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          };
        });
        check(geometry.visible && geometry.pageFits, `review state overflows at ${width} ${lang}`);
        check(geometry.text.includes('h5 b2'), 'narrow-screen uncertainty remains visible');
        await page.screenshot({ path: `output/playwright/recognition-v2/ui-production-${width}-${lang}.png` });
      }
    }
    results.push('Chinese and English narrow-screen review reminders');
    check(errors.length === 0, 'unexpected browser exceptions: ' + errors.join('; '));
    return { passed: results.length, results, payloads, pageErrors: errors };
  } finally {
    page.off('pageerror', recordError);
  }
}
