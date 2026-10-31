const { test, expect } = require('@playwright/test');
const { navigateAndWait, clickPlay } = require('./helpers/metronome');

// Practice mode (landscape) -----------------------------------------------------------

async function timingOn(page) {
  await page.click('#timingBtn');
  await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
  // the fake capture device beeps; keep only synthetic onsets / wave messages
  await page.evaluate(() => { timingMuteOnsets = true; timingNode.port.onmessage = null; updateBpm(250); });
}

test.describe('Practice mode - shell', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 844, height: 390 }); await navigateAndWait(page); });

  test('the Practice button exists only while Timing is on; Timing off leaves practice mode', async ({ page }) => {
    await expect(page.locator('#practiceBtn')).toBeHidden();
    await timingOn(page);
    await expect(page.locator('#practiceBtn')).toBeVisible();
    await page.click('#practiceBtn');
    await expect(page.locator('body')).toHaveClass(/wm-practice/);
    await page.evaluate(() => timingStop());
    await expect(page.locator('body')).not.toHaveClass(/wm-practice/);
    expect(await page.evaluate(() => practice.on)).toBe(false);
  });

  test('enter / exit puts every moved element back at its original parent and index; portrait boxes are unchanged', async ({ page }) => {
    await timingOn(page);
    const snap = () => page.evaluate(() => {
      const ids = ['playBtn', 'accelStopBtn', 'decreaseBpm5', 'decreaseBpm', 'increaseBpm', 'increaseBpm5', 'bpmDisplay', 'bpmSlider', 'tapBtn', 'accelStatus',
        'rhythmTrigger', 'rhythmMenu', 'beatCountDisplay', 'timerTrigger', 'volumeTrigger', 'timingSetBtn', 'beatContainer', 'timingTimeline', 'timingStatus', 'timingAvg', 'timerDisplayContainer'];
      const where = {}, boxes = {};
      ids.forEach(id => {
        const el = document.getElementById(id);
        where[id] = [el.parentElement.id || el.parentElement.className, Array.prototype.indexOf.call(el.parentNode.childNodes, el)];
        const r = el.getBoundingClientRect();
        boxes[id] = [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10);
      });
      return { where, boxes, comments: (() => { const it = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT); let n = 0, c; while ((c = it.nextNode())) if (c.data === 'practice') n++; return n === 0; })() };
    });
    await page.setViewportSize({ width: 600, height: 1100 }); // portrait
    const before = await snap();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.click('#practiceBtn');
    // while in practice mode the controls live in the header / footer and there is no page scroll
    expect(await page.evaluate(() => document.querySelector('#prPlay').contains(document.getElementById('playBtn')))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.getElementById('prRoot').querySelector('.pr-hdr').getBoundingClientRect().height)).toBeLessThan(70); // one line
    await page.click('#prExit');
    await page.setViewportSize({ width: 600, height: 1100 });
    const after = await snap();
    expect(after.where).toEqual(before.where);
    expect(after.boxes).toEqual(before.boxes);
    expect(after.comments).toBe(true); // no placeholder left behind
    expect(await page.evaluate(() => timingLsGet('wm.timing.view'))).toBeNull(); // the forced Timeline view is not persisted
  });

  test('the stored On beats view comes back on exit', async ({ page }) => {
    await timingOn(page);
    await page.evaluate(() => timingSetView('beats', true));
    await page.click('#practiceBtn');
    expect(await page.evaluate(() => timingView)).toBe('timeline');
    await page.click('#prExit');
    expect(await page.evaluate(() => timingView)).toBe('beats');
    await expect(page.locator('#timingBeatsStrip')).toBeVisible();
  });

  test('Bars 2 / 4 / 8 change the Timeline scale and the summary window; the choice is saved', async ({ page }) => {
    await timingOn(page);
    await page.click('#practiceBtn');
    const pps = () => page.evaluate(() => timingTl.pps);
    const p4 = await pps();
    await page.click('#prMoreBtn');
    await page.click('#prBarsSeg button[data-v="8"]');
    expect(await pps()).toBeCloseTo(p4 / 2, 3);
    await page.click('#prBarsSeg button[data-v="2"]');
    expect(await pps()).toBeCloseTo(p4 * 2, 3);
    expect(await page.evaluate(() => timingLsGet('wm.practice.bars'))).toBe('2');
    await expect(page.locator('#timingAvgLabel')).toHaveText('Avg');
  });

  test('overlays open one at a time and close on outside click / Escape; the header stays on one line', async ({ page }) => {
    await timingOn(page);
    await page.click('#practiceBtn');
    await page.click('#prBpmBtn');
    await expect(page.locator('#prBpmOv')).toBeVisible();
    await page.click('#prMoreBtn');
    await expect(page.locator('#prBpmOv')).toBeHidden();
    await expect(page.locator('#prMoreOv')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#prMoreOv')).toBeHidden();
    await page.click('#prChip');
    await expect(page.locator('#prRhythmOv')).toBeVisible();
    await page.click('#prRhythmOv #rhythmMenu .dropdown-item[data-value="2"]');
    expect(await page.evaluate(() => subdivision)).toBe('2');
    await page.mouse.click(300, 250);
    await expect(page.locator('#prRhythmOv')).toBeHidden();
    // 640 wide: still one line
    await page.setViewportSize({ width: 640, height: 360 });
    const h = await page.evaluate(() => { const r = document.querySelector('.pr-hdr'); return [r.getBoundingClientRect().height, r.scrollWidth - r.clientWidth]; });
    expect(h[0]).toBeLessThan(70);
    expect(h[1]).toBeLessThanOrEqual(0);
  });

  test('worklet config carries the wave flag only after practice mode was used', async ({ page }) => {
    await timingOn(page);
    const msgs = await page.evaluate(async () => {
      const got = [];
      const orig = timingNode.port.postMessage.bind(timingNode.port);
      timingNode.port.postMessage = (m) => { got.push(m); orig(m); };
      timingPostConfig();
      practiceSetMode(true);
      practiceSetMode(false);
      return got.filter(m => m.type === 'config').map(m => m.wave);
    });
    expect(msgs).toEqual([undefined, true, false]);
  });
});

test.describe('Practice mode - session statistics', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await navigateAndWait(page);
    await timingOn(page);
  });

  const hits = (page, offsetsMs) => page.evaluate((offs) => {
    const done = timingBeats.filter(b => b.dur > 0);
    return offs.map((o, i) => !!timingHandleOnset(done[done.length - 1 - offs.length + i].time + timingLatencyMs / 1000 + o / 1000, -20 + i));
  }, offsetsMs);

  test('count, mean and spread over accepted hits; a louder hit in the same cell replaces the old one; START resets', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length)).toBeGreaterThan(6);
    await page.evaluate(() => { timingRes = '4'; timingApplyDetect(); });
    expect(await hits(page, [-10, 10, 4])).toEqual([true, true, true]);
    let st = await page.evaluate(() => practiceSessionStats());
    expect(st.n).toBe(3);
    expect(st.mean).toBeCloseTo(4 / 3, 1);
    const vals = [-10, 10, 4], mean = 4 / 3, sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / 3);
    expect(st.sd).toBeCloseTo(sd, 1);
    // a louder hit in the same cell as an existing one replaces it: n grows by one hit, not two
    const rep = await page.evaluate(() => {
      const done = timingBeats.filter(b => b.dur > 0), b = done[done.length - 2];
      const n0 = practiceSessionStats().n;
      const first = timingHandleOnset(b.time + timingLatencyMs / 1000 + 0.003, -30);   // a fresh quiet hit
      const n1 = practiceSessionStats().n;
      const second = timingHandleOnset(b.time + timingLatencyMs / 1000 + 0.001, 10);   // louder, same cell: replaces
      return { n0, n1, n2: practiceSessionStats().n, ok: !!second, first: !!first };
    });
    expect(rep.ok).toBe(true);
    expect(rep.n2).toBe(rep.n1);
    expect(st.secs).toBeGreaterThan(0);
    await clickPlay(page); // stop: time frozen
    const a = await page.evaluate(() => practiceSessionStats().secs);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => practiceSessionStats().secs)).toBe(a);
    await clickPlay(page); // START resets
    st = await page.evaluate(() => practiceSessionStats());
    expect(st.n).toBe(0);
    expect(st.secs).toBeLessThan(1);
  });

  test('the Session box and footer show the numbers in practice mode', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length)).toBeGreaterThan(6);
    await page.click('#practiceBtn');
    await hits(page, [5, 5, 5]);
    await page.evaluate(() => timingUpdateSummary());
    await expect(page.locator('#prSessSub')).toContainText('3 hits');
    await expect(page.locator('#timingHitCount')).toHaveText('3');
    await expect(page.locator('#prHint')).toBeHidden();
  });
});

test.describe('Practice mode - waveform', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await navigateAndWait(page);
    await timingOn(page);
    await page.evaluate(() => { updateBpm(100); });
    await page.click('#practiceBtn');
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(1);
  });

  // post one synthetic wave message whose 16 blocks all peak at `peak`, starting `ago` seconds before the context's now (compensated time = NOW - ago)
  const post = (page, peak, ago) => page.evaluate(({ peak, ago }) => {
    const step = 64 / audioCtx.sampleRate;
    const t = audioCtx.currentTime - ago + timingMatchLatencyMs() / 1000;
    const peaks = new Float32Array(16).fill(peak);
    timingOnWorkletMessage({ data: { type: 'wave', time: t, step, peaks } });
    // the message is stamped so that its compensated start is audioCtx.currentTime - ago
    return { x0: (audioCtx.currentTime - ago - timingTl.t0) * timingTl.pps };
  }, { peak, ago });

  // pixel rows (device px) of a tile that contain any ink, as [minY, maxY] or null
  const ink = (page, k) => page.evaluate((k) => {
    const t = practice.wave.tiles.get(k);
    if (!t) return null;
    practiceWaveFlush();
    const c = t.el, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let minY = 1e9, maxY = -1, any = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { any++; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return any ? { minY, maxY, h: c.height, any } : null;
  }, k);

  test('a loud block draws tiles with ink, a block below the quiet level stays flat on the centre line', async ({ page }) => {
    await page.evaluate(() => timingSetQuiet(-60));
    const loud = await post(page, 0.5, 0.5);                // about -6 dBFS: tall
    const k = Math.floor(loud.x0 / 256);
    const tall = await ink(page, k);
    expect(tall).not.toBeNull();
    expect(tall.maxY - tall.minY).toBeGreaterThan(tall.h * 0.5);
    await page.evaluate(() => { practice.wave.tiles.forEach(t => t.el.remove()); practice.wave.tiles = new Map(); practice.wave.chunks = []; });
    const quiet = await post(page, 0.0001, 0.5);            // -80 dBFS: below -60
    const flat = await ink(page, Math.floor(quiet.x0 / 256));
    expect(flat).not.toBeNull();
    expect(flat.maxY - flat.minY).toBeLessThanOrEqual(6);   // only the 1.5 px outline on the centre line
    // the ink sits near the expected x: the loud block starts at x0 (column of the first non-empty pixel)
    await page.evaluate(() => { practice.wave.tiles.forEach(t => t.el.remove()); practice.wave.tiles = new Map(); practice.wave.chunks = []; });
    const l2 = await post(page, 0.5, 0.3);
    const col = await page.evaluate(({ k }) => {
      const t = practice.wave.tiles.get(k); practiceWaveFlush();
      const c = t.el, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const cy = c.height / 2;
      for (let x = 0; x < c.width; x++) for (let y = 0; y < c.height; y++) if (d[(y * c.width + x) * 4 + 3] > 0 && Math.abs(y - cy) > 8) return x / (c.width / 256);
      return -1;
    }, { k: Math.floor(l2.x0 / 256) });
    expect(Math.abs(col + Math.floor(l2.x0 / 256) * 256 - l2.x0)).toBeLessThan(3);
  });

  test('no waveform in portrait: messages are ignored and no tiles exist', async ({ page }) => {
    await page.click('#prExit');
    await post(page, 0.5, 0.2);
    expect(await page.evaluate(() => [practice.wave.tiles.size, document.querySelectorAll('.pr-wave').length, practice.wave.chunks.length])).toEqual([0, 0, 0]);
  });

  test('changing the quiet level redraws the tiles', async ({ page }) => {
    await page.evaluate(() => timingSetQuiet(-30));
    const a = await post(page, 0.01, 0.4);                   // -40 dB: below -30 -> flat
    const k = Math.floor(a.x0 / 256);
    const flat = await ink(page, k);
    await page.evaluate(() => timingSetQuiet(-60));          // now -40 dB is 33 % of the height
    const tall = await ink(page, k);
    expect(tall.maxY - tall.minY).toBeGreaterThan(flat.maxY - flat.minY + 10);
  });
});

// Worklet: the 'wave' message --------------------------------------------------------------

test('worklet posts wave peaks per 64-sample block from the frame clock, only while the flag is on', async ({ page }) => {
  await navigateAndWait(page);
  const res = await page.evaluate(() => {
    const sr = 48000, msgs = [], G = { currentFrame: 0 };
    let Proc = null;
    class Base { constructor() { this.port = { postMessage: (m) => msgs.push(m) }; } }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'G', TIMING_WORKLET_SRC.replace(/\bcurrentFrame\b/g, 'G.currentFrame'))(Base, (n, c) => { Proc = c; }, sr, G);
    const p = new Proc();
    const run = (from, quanta, impulseAt) => {
      for (let q = from; q < from + quanta; q++) {
        const x = new Float32Array(128);
        if (impulseAt >= q * 128 && impulseAt < q * 128 + 128) x[impulseAt - q * 128] = 1;
        G.currentFrame = q * 128;
        p.process([[x]]);
      }
    };
    run(0, 40, 3000);                                        // flag off: nothing
    const off = msgs.filter(m => m.type === 'wave').length;
    p.port.onmessage({ data: { type: 'config', wave: true } });
    run(40, 40, 6000 + 0);                                   // impulse at sample 6000 (block 93)
    const waves = msgs.filter(m => m.type === 'wave');
    const hit = waves.find(w => Array.from(w.peaks).some(v => v === 1));
    const idx = hit ? Array.from(hit.peaks).indexOf(1) : -1;
    return { off, n: waves.length, step: waves[0] && waves[0].step, first: waves[0] && waves[0].time, len: waves[0] && waves[0].peaks.length, hitTime: hit ? hit.time + idx * hit.step : null, sr };
  });
  expect(res.off).toBe(0);
  expect(res.n).toBeGreaterThan(3);
  expect(res.len).toBe(16);
  expect(res.step).toBeCloseTo(64 / res.sr, 9);
  expect(res.first).toBeCloseTo(40 * 128 / res.sr, 6);       // first block starts at the first quantum after the flag
  expect(Math.abs(res.hitTime - (6000 - (6000 % 64)) / res.sr)).toBeLessThan(1e-6); // peak 1 sits in the block that contains the impulse
});
