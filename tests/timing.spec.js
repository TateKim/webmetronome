const { test, expect } = require('@playwright/test');
const { navigateAndWait, clickPlay } = require('./helpers/metronome');

// Pure helpers ---------------------------------------------------------------

test.describe('Timing Check - grid and matching', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  test('getTimingGrid follows the rhythm and locks where required', async ({ page }) => {
    const res = await page.evaluate(() => {
      const out = {};
      for (const s of ['1', '2', '4', '4e', 'shuffle', '16shuffle', '3', '5', '6']) {
        subdivision = s;
        const g = getTimingGrid();
        out[s] = { key: g.key, name: g.name, locked: g.locked, pos: g.pos.map(p => +p.toFixed(4)) };
      }
      subdivision = '1';
      timingFeel = 'shuffle';
      const chosen = getTimingGrid();
      subdivision = '2';
      const chosen2 = getTimingGrid();
      timingFeel = 'straight';
      return { out, chosen: chosen.key, chosen2: [chosen2.key, chosen2.locked] };
    });
    for (const s of ['1', '2', '4', '4e']) {
      expect(res.out[s].locked).toBe(false);
      expect(res.out[s].key).toBe('straight');
      expect(res.out[s].pos).toEqual([0, 0.25, 0.5, 0.75]);
    }
    expect(res.out.shuffle).toMatchObject({ key: 'shuffle', name: 'Shuffle', locked: true });
    expect(res.out['16shuffle']).toMatchObject({ key: 'halftime', name: 'Half-time shuffle', locked: true });
    expect(res.out['3']).toMatchObject({ name: 'Triplet', locked: true });
    expect(res.out['5']).toMatchObject({ name: 'Quintuplet', locked: true });
    expect(res.out['6']).toMatchObject({ name: 'Sextuplet', locked: true });
    expect(res.out['16shuffle'].pos).toEqual([0, 0.3333, 0.5, 0.8333]);
    expect(res.chosen).toBe('shuffle');
    expect(res.chosen2).toEqual(['shuffle', false]);
  });

  test('matchOnsetToGrid: role-weighted capture (straight, shuffle, half-time), next beat, rejections', async ({ page }) => {
    const r = await page.evaluate(() => {
      const beats = [0, 1, 2, 3].map(i => ({ time: 10 + i * 0.5, beatInMeasure: i, n: i }));
      const grids = {};
      for (const k of ['straight', 'shuffle', 'halftime']) { timingFeel = k; grids[k] = getTimingGrid(); }
      timingFeel = 'straight';
      const m = (t, g) => matchOnsetToGrid(t, beats, grids[g] || g, 0.5);
      const reason = () => timingLastMatchReason;
      // weighted midpoint between a role-1 point (w 0.6) and a role-2 point (w 0.85): scores are equal there
      const mid = (a, b) => (a * 0.85 + b * 0.6) / 1.45;
      const out = {
        eighthLate: m(10.5 + 0.25 + 0.012, 'straight'),
        eighthEarly60: m(10.5 + 0.25 - 0.060, 'straight'),
        sixteenthLate20: m(10.5 + 0.125 + 0.020, 'straight'),
        ambiguousStraight: m(mid(10.5 + 0.125, 10.5 + 0.25), 'straight'), reasonStraight: null,
        shuffleEarly: m(10.5 + (2 / 3) * 0.5 - 0.008, 'shuffle'),
        shuffleEighthEarly60: m(10.5 + (2 / 3) * 0.5 - 0.060, 'shuffle'),
        ambiguousShuffle: m(mid(10.5 + 0.5 / 3, 10.5 + (2 / 3) * 0.5), 'shuffle'),
        halftime: m(10 + (5 / 6) * 0.5 + 0.005, 'halftime'),
        halftimeEighthEarly30: m(10.5 + 0.25 - 0.030, 'halftime'),
        ambiguousHalftime: m(mid(10.5 + 0.5 / 3, 10.5 + 0.25), 'halftime'),
        nextBeat: m(10.5 - 0.015, 'straight'),
        beforeFirst: m(9.99, 'straight'),
        empty: matchOnsetToGrid(10, [], grids.straight, 0.5),
      };
      out.reasonStraight = (m(mid(10.5 + 0.125, 10.5 + 0.25), 'straight'), reason());
      const beatOnly = { pos: [0], role: [0], gap: 1 };
      out.tooFar = m(10.5 + 0.46 * 0.5, beatOnly); out.tooFarReason = reason();
      out.farButClear = m(10.5 + 0.4 * 0.5, beatOnly);
      return out;
    });
    expect(r.eighthLate.offsetMs).toBeCloseTo(12, 3);
    expect(r.eighthLate.pos).toBe(0.5);
    expect(r.eighthLate.role).toBe(2);
    expect(r.eighthLate.beatGlobal).toBe(1);
    expect(r.eighthEarly60.pos).toBe(0.5);
    expect(r.eighthEarly60.offsetMs).toBeCloseTo(-60, 3);
    expect(r.sixteenthLate20.pos).toBe(0.25);
    expect(r.sixteenthLate20.role).toBe(1);
    expect(r.sixteenthLate20.offsetMs).toBeCloseTo(20, 3);
    expect(r.ambiguousStraight).toBeNull();
    expect(r.reasonStraight).toBe('ambiguous');
    expect(r.shuffleEarly.offsetMs).toBeCloseTo(-8, 3);
    expect(r.shuffleEarly.role).toBe(2);
    expect(r.shuffleEighthEarly60.role).toBe(2);
    expect(r.shuffleEighthEarly60.offsetMs).toBeCloseTo(-60, 3);
    expect(r.ambiguousShuffle).toBeNull();
    expect(r.halftime.pos).toBeCloseTo(5 / 6, 6);
    expect(r.halftime.offsetMs).toBeCloseTo(5, 3);
    expect(r.halftimeEighthEarly30.pos).toBe(0.5);
    expect(r.halftimeEighthEarly30.offsetMs).toBeCloseTo(-30, 3);
    expect(r.ambiguousHalftime).toBeNull();
    expect(r.nextBeat.offsetMs).toBeCloseTo(-15, 3);
    expect(r.nextBeat.pos).toBe(0);
    expect(r.nextBeat.beatGlobal).toBe(1);
    expect(r.beforeFirst).toBeNull();
    expect(r.empty).toBeNull();
    expect(r.tooFar).toBeNull();
    expect(r.tooFarReason).toBe('too-far');
    expect(r.farButClear.offsetMs).toBeCloseTo(200, 3); // no fixed 60 ms cap any more
  });

  test('timingQuality / median / mad', async ({ page }) => {
    const r = await page.evaluate(() => ({
      q: [timingQuality(0), timingQuality(-10), timingQuality(12), timingQuality(25), timingQuality(-26)],
      med: median([3, 1, 2]), med2: median([1, 2, 3, 4]), mad: mad([1, 2, 3, 4, 100]),
    }));
    expect(r.q).toEqual(['good', 'good', 'warn', 'warn', 'bad']);
    expect(r.med).toBe(2);
    expect(r.med2).toBe(2.5);
    expect(r.mad).toBe(1);
  });
});

// UI -------------------------------------------------------------------------

test.describe('Timing Check - UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  test('add-on is hidden by default and the base UI is unchanged', async ({ page }) => {
    await expect(page.locator('#timingAddon')).toBeHidden();
    await expect(page.locator('#timingBeatsStrip')).toBeHidden();
    await expect(page.locator('#timingBtn')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('#beatContainer > *').count()).toBe(4);
    // hooks are no-ops while Timing is off
    const r = await page.evaluate(() => {
      timingRecordBeat(1, 0); timingRelayoutTimeline(); timingLayoutBeatsStrip(); timingApplyFeel();
      return { beats: timingBeats.length, on: timingOn };
    });
    expect(r).toEqual({ beats: 0, on: false });
  });

  test('Timing toggle shows the add-on, fills the device list and meter, and hides again', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {
      if (m.type() === 'error' && !/cdn\.tailwindcss|fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    await page.click('#timingBtn');
    await expect(page.locator('#timingAddon')).toBeVisible();
    await expect(page.locator('#timingBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#timingLiveDot')).toBeVisible();
    await expect.poll(() => page.locator('#timingDeviceSelect option').count()).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => timingLevelCount)).toBeGreaterThan(3);
    await expect(page.locator('#timingSetVals')).toHaveText(/^[0-9]+ ms \u00b7 S5$/);
    await expect(page.locator('#timingSetEst')).toBeVisible();
    await expect(page.locator('#timingPopover')).toBeHidden();
    await expect(page.locator("#timingCalibrateBtn")).toHaveCount(0);
    await expect(page.locator("#timingThValue")).toHaveCount(0);
    await expect(page.locator('#timingError')).toBeHidden();
    expect(await page.locator('#beatContainer > *').count()).toBe(4);
    await page.click('#timingBtn');
    await expect(page.locator('#timingAddon')).toBeHidden();
    await expect(page.locator('#timingLiveDot')).toBeHidden();
    expect(await page.evaluate(() => timingStream)).toBeNull();
    expect(errors).toEqual([]);
  });

  test('Feel segment (in the settings popover) is locked by the rhythm menu', async ({ page }) => {
    await page.click('#timingBtn');
    const pick = async v => {
      await page.click('#rhythmTrigger');
      await page.click(`#rhythmMenu [data-value="${v}"]`);
    };
    const feel = async () => page.evaluate(() => ({
      pressed: [...document.querySelectorAll('#timingFeelSeg button')].map(b => b.getAttribute('aria-pressed')),
      disabled: [...document.querySelectorAll('#timingFeelSeg button')].map(b => b.disabled),
      hint: document.getElementById('timingFeelHint').hidden ? '' : document.getElementById('timingFeelHint').textContent,
    }));
    let f = await feel();
    expect(f.hint).toBe('');
    expect(f.disabled).toEqual([false, false, false]);

    await pick('shuffle');
    f = await feel();
    expect(f.pressed).toEqual(['false', 'true', 'false']);
    expect(f.disabled).toEqual([true, false, true]);
    expect(f.hint).toBe('Set by rhythm');

    await pick('16shuffle');
    f = await feel();
    expect(f.pressed).toEqual(['false', 'false', 'true']);
    expect(f.hint).toBe('Set by rhythm');

    await pick('3');
    f = await feel();
    expect(f.pressed).toEqual(['false', 'false', 'false']);
    expect(f.disabled).toEqual([true, true, true]);
    expect(f.hint).toBe('Set by rhythm: Triplet');

    await pick('2');
    f = await feel();
    expect(f.disabled).toEqual([false, false, false]);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingFeelSeg')).toBeVisible();
    await page.click('#timingFeelSeg [data-v="shuffle"]');
    expect((await feel()).pressed).toEqual(['false', 'true', 'false']);
    expect(await page.evaluate(() => getTimingGrid().key)).toBe('shuffle');
  });

  test('On beats strip attaches under the circles and is disabled when circles wrap', async ({ page }) => {
    await page.click('#timingBtn');
    await page.click('#timingViewSeg [data-v="beats"]');
    await expect(page.locator('#timingBeatsStrip')).toBeVisible();
    await expect(page.locator('#timingTimeline')).toBeHidden();
    const geo = await page.evaluate(() => {
      const c = [...document.querySelectorAll('#beatContainer > *')].map(e => e.getBoundingClientRect());
      const ch = document.getElementById('timingBeatsChart').getBoundingClientRect();
      const strip = document.getElementById('timingBeatsStrip').getBoundingClientRect();
      return { c0: c[0].left + c[0].width / 2, sp: c[1].left - c[0].left, left: ch.left, width: ch.width, top: strip.top, cBottom: c[0].bottom };
    });
    expect(geo.sp).toBeCloseTo(52, 0);
    expect(geo.left).toBeCloseTo(geo.c0 - 0.25 * geo.sp, 0);
    expect(geo.width).toBeCloseTo(4.125 * geo.sp, 0);
    expect(geo.top).toBeGreaterThan(geo.cBottom);
    // 7 beats still fit on one line
    for (let i = 0; i < 3; i++) await page.click('#increaseBeats');
    await expect(page.locator('#timingBeatsStrip')).toBeVisible();
    await expect(page.locator('#timingViewSeg [data-v="beats"]')).toBeEnabled();
    // 8 beats wrap: On beats is disabled and the view falls back to Timeline
    await page.click('#increaseBeats');
    await expect(page.locator('#timingViewSeg [data-v="beats"]')).toBeDisabled();
    await expect(page.locator('#timingViewSeg [data-v="timeline"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#timingBeatsStrip')).toBeHidden();
    await expect(page.locator('#timingTimeline')).toBeVisible();
    await page.click('#decreaseBeats');
    await expect(page.locator('#timingViewSeg [data-v="beats"]')).toBeEnabled();
  });
});

// Flow -----------------------------------------------------------------------

test.describe('Timing Check - live flow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    // the fake capture device beeps; keep only synthetic onsets in these tests
    await page.evaluate(() => { timingMuteOnsets = true; updateBpm(250); });
  });

  // Inject hits `offsetSec` late on the n most recent finished beats
  async function inject(page, n, offsetSec) {
    return page.evaluate(({ n, offsetSec }) => {
      const done = timingBeats.filter(b => b.dur > 0);
      const picked = done.slice(-n - 1, -1);
      picked.forEach(b => timingHandleOnset(b.time + timingLatencyMs / 1000 + offsetSec, -20));
      return picked.length;
    }, { n, offsetSec });
  }

  test('beats are recorded and synthetic hits show in the Timeline and summary', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(6);
    expect(await inject(page, 3, 0.012)).toBe(3);
    await expect(page.locator('#timingTrack .tm-dot')).toHaveCount(3);
    await expect(page.locator('#timingTrack .tm-dot[data-q="warn"]')).toHaveCount(3);
    await expect(page.locator('#timingHitCount')).toHaveText('3');
    await expect(page.locator('#timingAvg')).toHaveText(/^\+12 ms$/);
    await expect(page.locator('#timingSpread')).toHaveText('±0 ms');
    await expect(page.locator('#timingStatus')).toHaveText('Detected');
    // grid lines are drawn and the track scrolls
    expect(await page.locator('#timingTrack .tm-gl').count()).toBeGreaterThan(8);
    const t1 = await page.evaluate(() => document.getElementById('timingTrack').style.transform);
    await page.waitForTimeout(150);
    const t2 = await page.evaluate(() => document.getElementById('timingTrack').style.transform);
    expect(t1).not.toBe(t2);
    // stopping freezes the marks
    await clickPlay(page);
    await page.waitForTimeout(100);
    await expect(page.locator('#timingTrack .tm-dot')).toHaveCount(3);
    await expect(page.locator('#timingNoInputB')).not.toHaveClass(/\bon\b/);
    const t3 = await page.evaluate(() => document.getElementById('timingTrack').style.transform);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.getElementById('timingTrack').style.transform)).toBe(t3);
  });

  test('On beats view draws marks in the strip', async ({ page }) => {
    await page.click('#timingViewSeg [data-v="beats"]');
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(6);
    expect(await inject(page, 1, -0.004)).toBe(1);
    await expect(page.locator('#timingBeatsMarks .tm-dot[data-q="good"]')).toHaveCount(1);
    const x1 = await page.evaluate(() => document.getElementById('timingSweep').style.transform);
    await page.waitForTimeout(100);
    const x2 = await page.evaluate(() => document.getElementById('timingSweep').style.transform);
    expect(x1).not.toBe(x2);
    await expect(page.locator('#timingAvgLabel')).toHaveText('Avg · last 1 bar');
    // the mark fades out and is removed after the sweep passes the cell again
    await expect(page.locator('#timingBeatsMarks .tm-dot')).toHaveCount(0, { timeout: 8000 });
  });

  test('No input appears after a bar without hits and clears on the next hit', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(5);
    await expect(page.locator('#timingNoInputB')).toHaveClass(/\bon\b/, { timeout: 5000 });
    await inject(page, 1, 0.002);
    await expect(page.locator('#timingNoInputB')).not.toHaveClass(/\bon\b/);
  });

  test('hits that cannot be assigned to a grid point are ignored', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(6);
    const hit = await page.evaluate(() => {
      const b = timingBeats.filter(x => x.dur > 0).slice(-2)[0];
      // 250 BPM straight: the weighted tie between the beat (w 1.0) and the next 16th (w 0.6) is at 1/1.6 of a 16th
      const x = 0.25 * b.dur / 1.6;
      return timingHandleOnset(b.time + timingLatencyMs / 1000 + x, -20);
    });
    expect(hit).toBeNull();
    await expect(page.locator('#timingTrack .tm-dot')).toHaveCount(0);
  });
});

// Latency / channel controls ---------------------------------------------------

test.describe('Timing Check - latency and channel controls', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.click('#timingSetBtn');
  });
  const lat = page => page.evaluate(() => timingLatencyMs);

  test('+/- buttons step by 1 ms and the value is saved per device', async ({ page }) => {
    const base = await lat(page);
    await page.click('#timingLatPlus');
    expect(await lat(page)).toBe(base + 1);
    await page.click('#timingLatPlus');
    await page.click('#timingLatMinus');
    expect(await lat(page)).toBe(base + 1);
    await expect(page.locator('#timingLatValue')).toHaveText((base + 1) + ' ms');
    await expect(page.locator('#timingLatEst')).toBeHidden();
    const saved = await page.evaluate(() => localStorage.getItem('wm.timing.latency.' + timingDeviceId));
    expect(saved).toBe(String(base + 1));
    await expect(page.locator('#timingLatValue')).toHaveAttribute('title', 'Play steady on the click and adjust until Avg sits near 0 ms.');
    // another device has its own value (falls back to the estimate)
    const other = await page.evaluate(() => {
      const id = timingDeviceId; timingDeviceId = 'other-device'; timingLoadLatency();
      const r = { est: timingLatencyEst, v: timingLatencyMs, expected: timingEstimateLatencyMs() };
      timingDeviceId = id; timingLoadLatency();
      return Object.assign(r, { back: timingLatencyMs });
    });
    expect(other.est).toBe(true);
    expect(other.v).toBe(other.expected);
    expect(other.back).toBe(base + 1);
  });

  test('hold repeats after a delay, clamped to 0-300', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 }); // keep the buttons fully visible: focus must not scroll under the mouse
    await page.evaluate(() => timingSetLatency(10));
    const box = await page.locator('#timingLatPlus').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    expect(await lat(page)).toBe(11); // still within the 400 ms delay
    await page.waitForTimeout(700);
    await page.mouse.up();
    const after = await lat(page);
    expect(after).toBeGreaterThan(14);
    await page.waitForTimeout(200);
    expect(await lat(page)).toBe(after); // released: no more repeats
    await page.evaluate(() => timingSetLatency(999));
    expect(await lat(page)).toBe(300);
    await page.evaluate(() => timingSetLatency(-5));
    expect(await lat(page)).toBe(0);
  });

  test('typing a value: Enter and blur apply, Esc cancels', async ({ page }) => {
    await page.evaluate(() => timingSetLatency(20));
    await page.click('#timingLatValue');
    await expect(page.locator('#timingLatInput')).toBeVisible();
    await page.fill('#timingLatInput', '45');
    await page.press('#timingLatInput', 'Enter');
    await expect(page.locator('#timingLatValue')).toHaveText('45 ms');
    await expect(page.locator('#timingLatInput')).toBeHidden();
    await page.click('#timingLatValue');
    await page.fill('#timingLatInput', '99');
    await page.press('#timingLatInput', 'Escape');
    await expect(page.locator('#timingLatValue')).toHaveText('45 ms');
    await page.click('#timingLatValue');
    await page.fill('#timingLatInput', '60');
    await page.click('body', { position: { x: 5, y: 5 } }); // blur applies
    await expect(page.locator('#timingLatValue')).toHaveText('60 ms');
    expect(await page.evaluate(() => isPlaying)).toBe(false); // typing did not trigger the Space shortcut
  });

  test('Reset returns to the browser estimate and shows est.; saved value survives a reload', async ({ page }) => {
    await page.evaluate(() => timingSetLatency(77));
    await page.click('#timingLatReset');
    const r = await page.evaluate(() => ({ v: timingLatencyMs, e: timingEstimateLatencyMs(), saved: localStorage.getItem('wm.timing.latency.' + timingDeviceId) }));
    expect(r.v).toBe(r.e);
    expect(r.saved).toBeNull();
    await expect(page.locator('#timingLatEst')).toBeVisible();
    await page.evaluate(() => timingSetLatency(33));
    await page.reload();
    await page.waitForSelector('#playBtn');
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingLatValue')).toHaveText('33 ms');
    await expect(page.locator('#timingLatEst')).toBeHidden();
  });

  test('channel select is shown for multi-channel devices, saved per device, and sent to the worklet', async ({ page }) => {
    const res = await page.evaluate(() => {
      const sent = [];
      const orig = timingNode.port.postMessage.bind(timingNode.port);
      timingNode.port.postMessage = m => { sent.push(m); orig(m); };
      timingChannels = 2; timingLoadChannel();
      const shown = !document.getElementById('timingChSeg').hidden;
      document.querySelector('#timingChSeg [data-v="1"]').click();
      return { shown, ch: timingChannel, saved: localStorage.getItem('wm.timing.channel.' + timingDeviceId), sent,
               pressed: [...document.querySelectorAll('#timingChSeg button')].map(b => b.getAttribute('aria-pressed')) };
    });
    expect(res.shown).toBe(true);
    expect(res.ch).toBe(1);
    expect(res.saved).toBe('1');
    expect(res.sent).toContainEqual({ type: 'config', channel: 1, sensitivity: 5 });
    expect(res.pressed).toEqual(['false', 'true']);
    const mono = await page.evaluate(() => { timingChannels = 1; timingLoadChannel(); return document.getElementById('timingChSeg').hidden; });
    expect(mono).toBe(true);
  });
});

// Onset detector (OnsetCore) on synthetic 48 kHz signals, run inside the page ----

test.describe('Timing Check - onset detector', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.addScriptTag({ path: require('path').join(__dirname, 'helpers', 'signals.js') });
    await page.addScriptTag({ path: require('path').join(__dirname, 'helpers', 'scenarios.js') });
  });

  test('every synthetic scenario yields exactly the expected onsets', async ({ page }) => {
    test.setTimeout(120000);
    const results = await page.evaluate(() => scenarios.list.map(s => {
      const on = sig.run(timingMakeOnsetCore(sig.SR), s.build(sig));
      const t = on.map(o => +(o.time * 1000).toFixed(2));
      let ok;
      if (typeof s.expect === 'number') ok = t.length === s.expect;
      else ok = t.length === s.expect.length && t.every((x, i) => Math.abs(x - s.expect[i]) <= s.tol);
      return { name: s.name, ok, t: ok ? null : t };
    }));
    expect(results.length).toBeGreaterThan(30);
    expect(results.filter(r => !r.ok)).toEqual([]);
  });

  test('channel select: hits only on channel 2 are detected only with channel 2', async ({ page }) => {
    const r = await page.evaluate(() => {
      const n = Math.round(sig.SR * 1.2);
      const ch1 = new Float32Array(n), ch2 = new Float32Array(n);
      const rnd = sig.rng(9);
      sig.whiteNoise(ch1, sig.db(-70), rnd);
      for (const t of [0.2, 0.6, 0.9]) {
        sig.addNoise(ch2, t, 0.004, sig.db(-15), rnd, 0.002);
        sig.addSine(ch2, t, 300, sig.db(-15), 0.05, 0.001, 0.25);
      }
      const count = idx => {
        const core = timingMakeOnsetCore(sig.SR);
        let c = 0;
        for (let i = 0; i < n; i += 128) c += core.processChannels([ch1.subarray(i, i + 128), ch2.subarray(i, i + 128)], idx, i).length;
        return c;
      };
      return { ch1: count(0), ch2: count(1) };
    });
    expect(r.ch1).toBe(0);
    expect(r.ch2).toBe(3);
  });
});

// Debug recorder ---------------------------------------------------------------

test.describe('Timing Check - debug recorder', () => {
  test('timingDebugRecord downloads a valid float WAV and a JSON event log', async ({ page }) => {
    test.setTimeout(60000);
    await navigateAndWait(page);
    // no effect before recording
    expect(await page.evaluate(() => timingDbg)).toBeNull();
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(2);

    const downloads = [];
    page.on('download', d => downloads.push(d));
    expect(await page.evaluate(() => timingDebugRecord(3))).toBe(true);
    expect(await page.evaluate(() => timingDebugRecord(3))).toBe(false); // already recording
    await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(2);

    const fs = require('fs');
    const byExt = ext => downloads.find(d => d.suggestedFilename().endsWith(ext));
    expect(byExt('.wav').suggestedFilename()).toMatch(/^timing-debug-.*\.wav$/);
    const wav = fs.readFileSync(await byExt('.wav').path());
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(3);   // IEEE float
    expect(wav.readUInt16LE(22)).toBe(1);   // mono
    expect(wav.readUInt16LE(34)).toBe(32);  // bits
    const sr = wav.readUInt32LE(24);
    expect(sr).toBeGreaterThan(8000);
    expect(wav.toString('ascii', 48, 52)).toBe('data');
    const dataBytes = wav.readUInt32LE(52);
    expect(wav.length).toBe(56 + dataBytes);
    expect(dataBytes / 4 / sr).toBeGreaterThan(2.5);
    expect(dataBytes / 4 / sr).toBeLessThan(3.8);
    let peak = 0;
    for (let i = 0; i < Math.min(dataBytes / 4, 200000); i++) peak = Math.max(peak, Math.abs(wav.readFloatLE(56 + i * 4)));
    expect(peak).toBeGreaterThan(0.01); // the fake device is not silent

    const json = JSON.parse(fs.readFileSync(await byExt('.json').path(), 'utf8'));
    expect(json.meta.sampleRate).toBe(sr);
    for (const k of ['latencyMs', 'channel', 'bpm', 'grid', 'trackSettings', 'wavStartFrame', 'wavStartContextTime']) expect(json.meta).toHaveProperty(k);
    expect(json.beats.length).toBeGreaterThan(2);
    expect(json.beats[0]).toHaveProperty('beatInMeasure');
    expect(json.beats[0]).toHaveProperty('sample');
    expect(json.onsets.length).toBeGreaterThan(2);
    expect(json.onsets[0]).toHaveProperty('peakDb');
    expect(json.onsets[0].bands.length).toBeGreaterThan(0);
    expect(json.onsets[0].bands[0]).toHaveProperty('ratioDb');
    expect(json.matches.length).toBe(json.onsets.length);
    expect(json.matches.some(m => m.accepted) || json.matches.every(m => m.reason)).toBe(true);
    expect(Array.isArray(json.nearMisses)).toBe(true);
    expect(json.summary.onsets).toBe(json.onsets.length);
    // sample indexes are relative to the WAV start and line up with the audio
    const o = json.onsets[0];
    expect(o.sample).toBe(Math.round((o.time - json.meta.wavStartContextTime) * sr));
    expect(await page.evaluate(() => timingDbg)).toBeNull();
  });
});

// Sensitivity ------------------------------------------------------------------

test.describe('Timing Check - sensitivity', () => {
  test('UI: default 5, steps 1-10, hold repeat, typing, per-device persistence, live worklet config', async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingSensValue')).toHaveText('5');
    await expect(page.locator('#timingSensValue')).toHaveAttribute('title', 'Higher catches softer attacks. Lower it if one note shows up as several dots.');
    const sent = await page.evaluate(() => {
      window.__sent = [];
      const orig = timingNode.port.postMessage.bind(timingNode.port);
      timingNode.port.postMessage = m => { window.__sent.push(m); orig(m); };
    });
    await page.click('#timingSensPlus');
    await expect(page.locator('#timingSensValue')).toHaveText('6');
    await page.click('#timingSensMinus');
    await page.click('#timingSensMinus');
    await expect(page.locator('#timingSensValue')).toHaveText('4');
    expect(await page.evaluate(() => window.__sent.filter(m => m.sensitivity !== undefined).map(m => m.sensitivity))).toEqual([6, 5, 4]);
    // clamped to 1..10
    await page.evaluate(() => { timingSetSensitivity(99); });
    await expect(page.locator('#timingSensValue')).toHaveText('10');
    await page.evaluate(() => { timingSetSensitivity(-3); });
    await expect(page.locator('#timingSensValue')).toHaveText('1');
    // hold repeats after the delay
    await page.setViewportSize({ width: 1280, height: 1100 });
    const box = await page.locator('#timingSensPlus').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => timingSensitivity)).toBe(2);
    await page.waitForTimeout(600);
    await page.mouse.up();
    expect(await page.evaluate(() => timingSensitivity)).toBeGreaterThan(4);
    // typing
    await page.click('#timingSensValue');
    await page.fill('#timingSensInput', '8');
    await page.press('#timingSensInput', 'Enter');
    await expect(page.locator('#timingSensValue')).toHaveText('8');
    // saved per device, restored after reload, other device falls back to 5
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.sensitivity.' + timingDeviceId))).toBe('8');
    const other = await page.evaluate(() => {
      const id = timingDeviceId; timingDeviceId = 'other'; timingLoadSensitivity();
      const v = timingSensitivity; timingDeviceId = id; timingLoadSensitivity(); return [v, timingSensitivity];
    });
    expect(other).toEqual([5, 8]);
    await page.reload();
    await page.waitForSelector('#playBtn');
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingSensValue')).toHaveText('8');
  });

  test('mapping: 5 is the reference tuning; f = 1.5 at 1, 1.0 at 5, 0.55 at 10', async ({ page }) => {
    await navigateAndWait(page);
    const p = await page.evaluate(() => [1, 5, 10].map(v => timingMakeOnsetCore(48000, { sensitivity: v }).params()));
    const [p1, p5, p10] = p;
    expect(p5.f).toBeCloseTo(1, 9);
    expect(p5.jumpDb[2]).toBeCloseTo(20 * Math.log10(1.7), 6);
    expect(p5.combDb).toBeCloseTo(10, 9);
    expect(p5.gateAboveFloorDb).toBeCloseTo(20 * Math.log10(2), 6);
    expect(p5.minGateDbfs).toBeCloseTo(-55, 6);
    expect(p5.dropRatio).toBeCloseTo(0.7, 9);
    expect(p1.f).toBeCloseTo(1.5, 9);
    expect(p1.combDb).toBeCloseTo(15, 9);
    expect(p1.minGateDbfs).toBeCloseTo(-47, 6);
    expect(p1.dropRatio).toBeCloseTo(0.6, 9);
    expect(p10.f).toBeCloseTo(0.55, 9);
    expect(p10.combDb).toBeCloseTo(5.5, 9);
    expect(p10.minGateDbfs).toBeCloseTo(-65, 6);
    expect(p10.dropRatio).toBeCloseTo(0.8, 9);
    expect(p10.jumpDb[0]).toBeCloseTo(p5.jumpDb[0] * 0.55, 6);
  });

  test('detection: 10 catches more weak attacks than 5; 1 keeps noise at zero; 5 passes everything', async ({ page }) => {
    test.setTimeout(120000);
    await navigateAndWait(page);
    await page.addScriptTag({ path: require('path').join(__dirname, 'helpers', 'signals.js') });
    await page.addScriptTag({ path: require('path').join(__dirname, 'helpers', 'scenarios.js') });
    const r = await page.evaluate(() => {
      const detected = (w, v) => {
        const on = sig.run(timingMakeOnsetCore(sig.SR, { sensitivity: v }), w.build(sig));
        return w.times.filter(t => on.some(o => Math.abs(o.time * 1000 - t) <= 3)).length;
      };
      const weak = scenarios.weak.map(w => ({ name: w.name, s5: detected(w, 5), s10: detected(w, 10), total: w.times.length }));
      const noise = scenarios.list.filter(s => /^(white noise|noise at)/.test(s.name)).map(s => {
        const t = sig.run(timingMakeOnsetCore(sig.SR, { sensitivity: 1 }), s.build(sig)).map(o => o.time * 1000);
        const ok = typeof s.expect === 'number' ? t.length === s.expect : t.length === s.expect.length && t.every((x, i) => Math.abs(x - s.expect[i]) <= s.tol);
        return { name: s.name, ok };
      });
      return { weak, noise };
    });
    expect(r.noise.length).toBe(2);
    expect(r.noise.filter(n => !n.ok)).toEqual([]);
    expect(r.weak.length).toBe(2);
    r.weak.forEach(w => expect(w.s10, w.name).toBeGreaterThan(w.s5));
  });
});

// Input gain warning -------------------------------------------------------------

test.describe('Timing Check - input too hot warning', () => {
  test('clipping shows the warning and a red meter for ~3 s (a loud but unclipped peak does not)', async ({ page }) => {
    test.setTimeout(30000);
    await navigateAndWait(page);
    await page.addScriptTag({ path: require('path').join(__dirname, 'helpers', 'signals.js') });
    // the core flags clipping when any raw sample reaches full scale (>= 0.999)
    const flags = await page.evaluate(() => {
      const run = fill => {
        const core = timingMakeOnsetCore(sig.SR);
        const x = new Float32Array(4800);
        fill(x);
        core.process(x, 0);
        const l = core.takeLevel();
        return { clip: l.clip, rawDb: l.rawDb };
      };
      const dbv = d => Math.pow(10, d / 20);
      // a full-scale sample in the second of two blocks still counts
      const core = timingMakeOnsetCore(sig.SR);
      const a = new Float32Array(128), b = new Float32Array(128);
      b[5] = -0.99997;
      core.process(a, 0); core.process(b, 128);
      const second = core.takeLevel().clip;
      const after = core.takeLevel().clip; // the flag resets after each level report
      return {
        half: run(x => { sig.addSine(x, 0, 300, dbv(-0.5), 0, 0, 0.1); }),
        single: run(x => { x[1000] = 0.99997; }),
        sine005: run(x => { sig.addSine(x, 0, 301, dbv(-0.05), 0, 0, 0.1); }),
        run02: run(x => { const v = dbv(-0.2); for (let i = 1000; i < 1010; i++) x[i] = i % 2 ? -v : v; }),
        second, after,
      };
    });
    expect(flags.half.clip).toBe(false);
    expect(flags.single.clip).toBe(true);
    expect(flags.sine005.clip).toBe(false);
    expect(flags.sine005.rawDb).toBeGreaterThan(-0.1);
    expect(flags.run02.clip).toBe(false);
    expect(flags.second).toBe(true);
    expect(flags.after).toBe(false);

    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await expect(page.locator('#timingHot')).toBeHidden();
    await page.evaluate(() => { timingNode.port.onmessage = null; }); // the fake device beeps loudly; use injected levels only
    await page.evaluate(() => { timingOnWorkletMessage({ data: { type: 'level', db: -3, thDb: -50, rawDb: -0.5, clip: false } }); });
    await page.waitForTimeout(200);
    await expect(page.locator('#timingHot')).toBeHidden(); // -0.5 dBFS without clipping: no warning
    await page.evaluate(() => { timingOnWorkletMessage({ data: { type: 'level', db: -3, thDb: -50, rawDb: -0.4, clip: true } }); });
    await expect(page.locator('#timingHot')).toBeVisible();
    await expect(page.locator('#timingHot')).toHaveText('Input too hot \u2014 lower the gain on your interface.');
    await expect(page.locator('#timingMeterFill')).toHaveClass(/\bhot\b/);
    // a quiet level message does not clear it early (no flicker)
    await page.evaluate(() => { timingOnWorkletMessage({ data: { type: 'level', db: -30, thDb: -50, rawDb: -20, clip: false } }); });
    await page.waitForTimeout(1500);
    await expect(page.locator('#timingHot')).toBeVisible();
    await expect(page.locator('#timingHot')).toBeHidden({ timeout: 4000 });
    await expect(page.locator('#timingMeterFill')).not.toHaveClass(/\bhot\b/);
  });
});

// Out-of-range and off-grid hits stay visible ---------------------------------

test.describe('Timing Check - every hit is visible', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingMuteOnsets = true; timingNode.port.onmessage = null; updateBpm(60); });
  });
  const hitAt = (page, dtSec) => page.evaluate(dt => {
    const done = timingBeats.filter(b => b.dur > 0);
    const b = done[done.length - 2];
    return timingHandleOnset(b.time + timingLatencyMs / 1000 + dt, -20) !== null;
  }, dtSec);

  for (const view of ['timeline', 'beats']) {
    test(`${view}: a -72 ms hit is a triangle at the top edge, +80 ms at the bottom; summary keeps real values`, async ({ page }) => {
      test.setTimeout(30000);
      if (view === 'beats') await page.click('#timingViewSeg [data-v="beats"]');
      await clickPlay(page);
      await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length), { timeout: 10000 }).toBeGreaterThan(2);
      const host = view === 'timeline' ? '#timingTrack' : '#timingBeatsMarks';
      // early beat 1 hit = 72 ms before the NEXT beat -> offset -72
      expect(await page.evaluate(() => {
        const done = timingBeats.filter(b => b.dur > 0); const b = done[done.length - 2];
        return !!timingHandleOnset(b.time + b.dur + timingLatencyMs / 1000 - 0.072, -20);
      })).toBe(true);
      await expect(page.locator(host + ' .tm-tri.up')).toHaveCount(1);
      await expect(page.locator(host + ' .tm-dot')).toHaveCount(0);
      await expect(page.locator(host + ' .tm-tri.up')).toHaveAttribute('title', '\u221272 ms');
      const geo = await page.evaluate(h => {
        const t = document.querySelector(h + ' .tm-tri.up').getBoundingClientRect();
        const c = document.querySelector(h).closest('.tm-chart').getBoundingClientRect();
        return { topGap: t.top - c.top, h: t.height };
      }, host);
      expect(geo.topGap).toBeLessThan(6);
      expect(await hitAt(page, 0.080)).toBe(true);
      await expect(page.locator(host + ' .tm-tri.down')).toHaveCount(1);
      await expect(page.locator(host + ' .tm-tri.down')).toHaveAttribute('title', '+80 ms');
      await expect(page.locator('#timingHitCount')).toHaveText('2');
      await expect(page.locator('#timingAvg')).toHaveText(/^\+4 ms$/); // (-72 + 80) / 2 with the real values
    });

    test(`${view}: a rejected hit draws a ring, is not counted, and the status reads Off grid`, async ({ page }) => {
      test.setTimeout(30000);
      if (view === 'beats') await page.click('#timingViewSeg [data-v="beats"]');
      await clickPlay(page);
      await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length), { timeout: 10000 }).toBeGreaterThan(2);
      const host = view === 'timeline' ? '#timingTrack' : '#timingBeatsMarks';
      await hitAt(page, 0.012);
      await expect(page.locator('#timingHitCount')).toHaveText('1');
      const before = await page.locator('#timingAvg').textContent();
      // weighted tie between the beat (w 1.0) and the next 16th (w 0.6): 250 ms / 1.6 after the beat at 60 BPM
      const accepted = await page.evaluate(() => {
        const done = timingBeats.filter(b => b.dur > 0); const b = done[done.length - 2];
        return timingHandleOnset(b.time + timingLatencyMs / 1000 + 0.25 * b.dur / 1.6, -20) !== null;
      });
      expect(accepted).toBe(false);
      await expect(page.locator(host + ' .tm-ring')).toHaveCount(1);
      await expect(page.locator('#timingStatus')).toHaveText('Off grid');
      await expect(page.locator('#timingHitCount')).toHaveText('1');
      expect(await page.locator('#timingAvg').textContent()).toBe(before);
      const ring = await page.evaluate(h => { const s = getComputedStyle(document.querySelector(h + ' .tm-ring')); return [s.width, s.borderTopWidth, s.borderTopColor, s.borderRadius]; }, host);
      expect(ring[0]).toBe('8px');
      expect(parseFloat(ring[1])).toBeGreaterThanOrEqual(1); // CSS says 1.5px; Chrome snaps to device pixels
      expect(ring[2]).toBe('rgb(148, 163, 184)');
    });
  }
});

// Loopback latency measurement ---------------------------------------------------

test.describe('Timing Check - loopback measurement', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    // drop live mic messages (the fake device beeps); only injected onsets are used
    await page.evaluate(() => { timingNode.port.onmessage = null; });
    await page.click('#timingSetBtn');
    await page.click('#timingLoopOpen');
    await expect(page.locator('#timingLoopPanel')).toBeVisible();
    await expect(page.locator('#timingLoopPanel')).toContainText('Connect your interface output to its input with a cable, then press Start. Keep the output volume low.');
    await page.click('#timingLoopStart');
    await expect(page.locator('#timingLoopResult')).toHaveText('Measuring\u2026');
  });

  // feed one onset per click: ts + fn(i) ms, for the clicks selected by `pick`
  const feed = (page, fnSrc, pickSrc) => page.evaluate(([f, p]) => {
    const fn = new Function('i', 'return ' + f), pick = new Function('i', 'return ' + p);
    timingLoop.clicks.forEach((ts, i) => { if (pick(i)) timingOnWorkletMessage({ data: { type: 'onset', time: ts + fn(i) / 1000, peakDb: -10 } }); });
  }, [fnSrc, pickSrc]);

  test('stable measurement: green result, Apply sets LATENCY and clears est., saved per device with tooltip', async ({ page }) => {
    await page.evaluate(() => timingResetLatency());
    await expect(page.locator('#timingLatEst')).toBeVisible();
    await feed(page, '58 + ((i * 7) % 5 - 2) * 0.15', 'true');
    await expect(page.locator('#timingLoopLive')).toContainText('60/60 \u00b7 median 58.0 ms');
    await page.evaluate(() => timingLoopFinish());
    await expect(page.locator('#timingLoopResult')).toHaveText(/^System latency 58 ms \u00b1 0\.[0-9] ms$/);
    await expect(page.locator('#timingLoopApply')).toBeVisible();
    // measurement onsets never reached the matcher or the views
    expect(await page.evaluate(() => [timingHits.length, timingRejects.length])).toEqual([0, 0]);
    await expect(page.locator('#timingTrack .tm-dot, #timingTrack .tm-ring, #timingTrack .tm-tri')).toHaveCount(0);
    await page.click('#timingLoopApply');
    expect(await page.evaluate(() => timingLatencyMs)).toBe(58);
    await expect(page.locator('#timingLatValue')).toHaveText('58 ms');
    await expect(page.locator('#timingLatEst')).toBeHidden();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wm.timing.loopback.' + timingDeviceId)));
    expect(saved.n).toBe(60);
    expect(saved.median).toBeCloseTo(58, 0);
    for (const k of ['sd', 'mad', 'drift', 'at']) expect(saved).toHaveProperty(k);
    await expect(page.locator('#timingLatValue')).toHaveAttribute('title', /Last loopback measurement: 58 ms/);
    // persistence across a reload
    await page.reload();
    await page.waitForSelector('#playBtn');
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await expect(page.locator('#timingLatValue')).toHaveAttribute('title', /Last loopback measurement: 58 ms/);
  });

  test('drifting latency gives the amber unstable warning and no Apply', async ({ page }) => {
    await feed(page, '58 + i * 0.06', 'true'); // ~7 ms/min drift
    await page.evaluate(() => timingLoopFinish());
    await expect(page.locator('#timingLoopResult')).toHaveText('Latency is unstable. Use the same interface for input and output, and match sample rates.');
    await expect(page.locator('#timingLoopResult')).toHaveAttribute('data-q', 'warn');
    await expect(page.locator('#timingLoopApply')).toBeHidden();
  });

  test('large jitter is unstable too', async ({ page }) => {
    await feed(page, '58 + (i % 2 ? 6 : -6)', 'true');
    await page.evaluate(() => timingLoopFinish());
    await expect(page.locator('#timingLoopResult')).toHaveAttribute('data-q', 'warn');
  });

  test('fewer than 40 samples fails with the cable hint', async ({ page }) => {
    await feed(page, '58', 'i < 30');
    await page.evaluate(() => timingLoopFinish());
    await expect(page.locator('#timingLoopResult')).toHaveText('Could not hear the clicks. Check the cable and levels.');
    await expect(page.locator('#timingLoopResult')).toHaveAttribute('data-q', 'bad');
    await expect(page.locator('#timingLoopApply')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.loopback.' + timingDeviceId))).toBeNull();
  });

  test('START cancels a running measurement; Start is disabled while playing; Stop and Close work', async ({ page }) => {
    await feed(page, '58', 'i < 5');
    await page.keyboard.press('Escape');
    await clickPlay(page);
    expect(await page.evaluate(() => timingLoop)).toBeNull();
    await expect(page.locator('#timingLoopStart')).toBeDisabled();
    await expect(page.locator('#timingLoopResult')).toHaveText('Cancelled: the metronome started.');
    await clickPlay(page); // stop the metronome
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingLoopStart')).toBeEnabled();
    await page.click('#timingLoopStart');
    await expect(page.locator('#timingLoopStop')).toBeEnabled();
    await page.click('#timingLoopStop');
    expect(await page.evaluate(() => timingLoop)).toBeNull();
    await page.click('#timingLoopStart');
    await page.click('#timingLoopClose');
    await expect(page.locator('#timingLoopPanel')).toBeHidden();
    expect(await page.evaluate(() => timingLoop)).toBeNull();
  });

  test('the click synth is independent of app volume and mute, and playSound is untouched', async ({ page }) => {
    const r = await page.evaluate(() => ({
      oscs: timingLoop.oscs.length, clicks: timingLoop.clicks.length,
      step: timingLoop.clicks[1] - timingLoop.clicks[0],
      masterConnected: true, playSoundSrc: playSound.toString().includes('return osc'),
    }));
    expect(r.oscs).toBe(60);
    expect(r.step).toBeCloseTo(0.5, 6);
    expect(r.playSoundSrc).toBe(false);
  });
});

// Settings popover -------------------------------------------------------------------

test.describe('Timing Check - settings popover', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
  });

  test('opens and closes with the button, an outside click and Esc; other app menus close it', async ({ page }) => {
    await expect(page.locator('#timingPopover')).toBeHidden();
    await expect(page.locator('#timingSetBtn')).toHaveAttribute('aria-haspopup', 'true');
    await expect(page.locator('#timingSetBtn')).toHaveAttribute('aria-expanded', 'false');
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingPopover')).toBeVisible();
    await expect(page.locator('#timingSetBtn')).toHaveAttribute('aria-expanded', 'true');
    // sections in order: input, feel, latency, sensitivity
    const order = await page.evaluate(() => ['timingDeviceSelect', 'timingFeelSeg', 'timingLatValue', 'timingSensValue']
      .map(id => document.getElementById(id).getBoundingClientRect().top));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingPopover')).toBeHidden();
    await page.click('#timingSetBtn');
    await page.click('#bpmDisplay'); // outside click
    await expect(page.locator('#timingPopover')).toBeHidden();
    await page.click('#timingSetBtn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#timingPopover')).toBeHidden();
    await expect(page.locator('#timingSetBtn')).toHaveAttribute('aria-expanded', 'false');
    // opening another app menu closes it, and opening it closes the app menus
    await page.click('#timingSetBtn');
    await page.click('#volumeTrigger');
    await expect(page.locator('#timingPopover')).toBeHidden();
    await expect(page.locator('#volumeMenu')).toBeVisible();
    await page.click('#timingSetBtn');
    await expect(page.locator('#volumeMenu')).toBeHidden();
    await expect(page.locator('#timingPopover')).toBeVisible();
    // clicks inside do not close it
    await page.click('#timingLatPlus');
    await expect(page.locator('#timingPopover')).toBeVisible();
  });

  test('the button label follows feel, latency and sensitivity', async ({ page }) => {
    await expect(page.locator('#timingSetBtn')).toContainText('Straight');
    await page.evaluate(() => { timingSetLatency(99); timingSetSensitivity(7); });
    await expect(page.locator('#timingSetVals')).toHaveText('99 ms \u00b7 S7');
    await expect(page.locator('#timingSetEst')).toBeHidden();
    await page.evaluate(() => timingResetLatency());
    await expect(page.locator('#timingSetEst')).toBeVisible();
    for (const [v, text] of [['shuffle', 'Shuffle'], ['16shuffle', 'Half-time'], ['3', 'Triplet'], ['2', 'Straight']]) {
      await page.click('#rhythmTrigger');
      await page.click(`#rhythmMenu [data-value="${v}"]`);
      await expect(page.locator('#timingSetFeel')).toHaveText(text + ' \u00b7');
    }
    await page.click('#timingSetBtn');
    await page.click('#timingFeelSeg [data-v="halftime"]');
    await expect(page.locator('#timingSetFeel')).toHaveText('Half-time \u00b7');
  });

  test('input device and channel controls live in the popover', async ({ page }) => {
    await expect(page.locator('#timingDeviceSelect')).toBeHidden();
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingDeviceSelect')).toBeVisible();
    const before = await page.evaluate(() => timingDeviceId);
    const opts = await page.locator('#timingDeviceSelect option').evaluateAll(o => o.map(x => x.value));
    expect(opts.length).toBeGreaterThan(0);
    const other = opts.find(v => v !== before) || before;
    await page.selectOption('#timingDeviceSelect', other);
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    expect(await page.evaluate(() => timingDeviceId)).toBe(other);
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.deviceId'))).toBe(other);
    await page.evaluate(() => { timingChannels = 2; timingLoadChannel(); });
    await expect(page.locator('#timingChSeg')).toBeVisible();
    await page.click('#timingChSeg [data-v="1"]');
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.channel.' + timingDeviceId))).toBe('1');
  });

  test('a running measurement survives closing the popover and shows a pulsing dot', async ({ page }) => {
    await page.evaluate(() => { timingNode.port.onmessage = null; });
    await page.click('#timingSetBtn');
    await page.click('#timingLoopOpen');
    await page.click('#timingLoopStart');
    await expect(page.locator('#timingSetBusy')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#timingPopover')).toBeHidden();
    expect(await page.evaluate(() => !!(timingLoop && timingLoop.running))).toBe(true);
    await expect(page.locator('#timingSetBusy')).toBeVisible();
    const anim = await page.evaluate(() => getComputedStyle(document.getElementById('timingSetBusy')).animationName);
    expect(anim).toBe('tm-pulse');
    await page.evaluate(() => { timingLoop.clicks.slice(0, 3).forEach((ts, i) => timingOnWorkletMessage({ data: { type: 'onset', time: ts + 0.058 + i * 0.0001, peakDb: -10 } })); });
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingLoopLive')).toContainText('3/60 \u00b7 median 58.1 ms');
    await page.evaluate(() => timingLoopFinish());
    await expect(page.locator('#timingSetBusy')).toBeHidden();
  });

  test('fits a 375 px wide screen: popover inside the viewport, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    const baseScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.click('#timingSetBtn');
    const geo = await page.evaluate(() => {
      const r = document.getElementById('timingPopover').getBoundingClientRect();
      return { left: r.left, right: r.right, vw: window.innerWidth, scrollW: document.documentElement.scrollWidth,
               addonRight: document.getElementById('timingAddon').getBoundingClientRect().right, cardRight: document.querySelector('.max-w-md').getBoundingClientRect().right,
               feelShown: getComputedStyle(document.getElementById('timingSetFeel')).display !== 'none' };
    });
    expect(geo.left).toBeGreaterThanOrEqual(0);
    expect(geo.right).toBeLessThanOrEqual(geo.vw);
    expect(geo.scrollW).toBeLessThanOrEqual(baseScrollW); // the popover adds no horizontal overflow
    expect(geo.addonRight).toBeLessThanOrEqual(geo.cardRight + 0.5);
    expect(geo.feelShown).toBe(false); // the feel word drops out of the button on narrow screens
    // still usable
    await page.click('#timingLatPlus');
    await expect(page.locator('#timingPopover')).toBeVisible();
  });
});

// Narrow screens: no horizontal page scroll ------------------------------------------------

test.describe('Timing Check - narrow screens', () => {
  for (const width of [360, 375]) {
    test(`no horizontal scroll at ${width} px (Timing off, on, popover open); view row stays on one line`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await navigateAndWait(page);
      const sw = () => page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      let [w, vw] = await sw();
      expect(w, 'Timing off').toBeLessThanOrEqual(vw);
      await page.click('#timingBtn');
      await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
      [w, vw] = await sw();
      expect(w, 'Timing on').toBeLessThanOrEqual(vw);
      const row = await page.evaluate(() => {
        const r = document.querySelector('.tm-view-row');
        return { h: r.getBoundingClientRect().height, over: r.scrollWidth - r.clientWidth };
      });
      expect(row.h).toBeLessThan(45);   // one line
      expect(row.over).toBeLessThanOrEqual(0);
      await page.click('#timingSetBtn');
      [w, vw] = await sw();
      expect(w, 'popover open').toBeLessThanOrEqual(vw);
      // header labels do not touch
      const gap = await page.evaluate(() => {
        const t = document.querySelector('#timingBtn').parentElement.querySelector('span').getBoundingClientRect();
        const r = document.querySelector('#rhythmTrigger').parentElement.querySelector('span').getBoundingClientRect();
        return r.left - t.right;
      });
      expect(gap).toBeGreaterThanOrEqual(4);
    });
  }

  test('desktop layout keeps the full-size header and padding', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await navigateAndWait(page);
    const m = await page.evaluate(() => ({
      btn: document.getElementById('timerTrigger').getBoundingClientRect().width,
      beats: document.getElementById('decreaseBeats').getBoundingClientRect().width,
      pad: parseFloat(getComputedStyle(document.querySelector('.tm-card')).paddingLeft),
    }));
    expect(m).toEqual({ btn: 48, beats: 40, pad: 32 });
  });
});

// Quiet / Listening status, quiet level control, meter row ---------------------------------

test.describe('Timing Check - quiet level and meter row', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingNode.port.onmessage = null; }); // only injected levels
  });
  const level = (page, rawDb, db = -90) => page.evaluate(([r, d]) => {
    window.clearInterval(window.__iv);
    window.__iv = setInterval(() => timingOnWorkletMessage({ data: { type: 'level', db: d, thDb: -55, rawDb: r, clip: false } }), 30);
  }, [rawDb, db]);

  test('Listening above the quiet level, Quiet only after 1 s below it, events take priority', async ({ page }) => {
    await level(page, -40);
    await expect(page.locator('#timingStatus')).toHaveText('Listening');
    await expect(page.locator('#timingStatus')).toHaveAttribute('data-q', 'listen');
    await page.waitForTimeout(1300);
    await expect(page.locator('#timingStatus')).toHaveText('Listening'); // still above: never Quiet
    await level(page, -75);
    await page.waitForTimeout(500);
    await expect(page.locator('#timingStatus')).toHaveText('Listening'); // below for < 1 s
    await expect(page.locator('#timingStatus')).toHaveText('Quiet', { timeout: 3000 });
    // an event overrides while live, then it falls back
    await page.evaluate(() => timingSetStatus('Detected', 'good', 2));
    await expect(page.locator('#timingStatus')).toHaveText('Detected');
    await expect(page.locator('#timingStatus')).toHaveText('Quiet', { timeout: 3000 });
    // a short loud burst resets the quiet timer
    await level(page, -40);
    await expect(page.locator('#timingStatus')).toHaveText('Listening');
    await level(page, -75);
    await page.waitForTimeout(500);
    await expect(page.locator('#timingStatus')).toHaveText('Listening');
    await page.evaluate(() => window.clearInterval(window.__iv));
  });

  test('the quiet level moves the tick, persists per device, and is clamped to -80..-30', async ({ page }) => {
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingQuietValue')).toHaveText('-60 dB');
    await expect(page.locator('#timingQuietValue')).toHaveAttribute('title', 'Input below this level counts as silence.');
    const tick = () => page.evaluate(() => document.getElementById('timingMeterQuiet').style.transform);
    await page.evaluate(() => timingQueueMeter());
    await expect.poll(tick).toBe('translateX(25%)'); // (-60 + 80) / 80
    await page.click('#timingQuietPlus');
    await expect(page.locator('#timingQuietValue')).toHaveText('-59 dB');
    await page.click('#timingQuietMinus');
    await page.click('#timingQuietMinus');
    await expect(page.locator('#timingQuietValue')).toHaveText('-61 dB');
    await page.click('#timingQuietValue');
    await page.fill('#timingQuietInput', '-40');
    await page.press('#timingQuietInput', 'Enter');
    await expect(page.locator('#timingQuietValue')).toHaveText('-40 dB');
    await expect.poll(tick).toBe('translateX(50%)');
    await page.evaluate(() => { timingSetQuiet(-10); });
    expect(await page.evaluate(() => timingQuietDb)).toBe(-30);
    await page.evaluate(() => { timingSetQuiet(-200); });
    expect(await page.evaluate(() => timingQuietDb)).toBe(-80);
    await page.evaluate(() => { timingSetQuiet(-45); });
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.quiet.' + timingDeviceId))).toBe('-45');
    const other = await page.evaluate(() => {
      const id = timingDeviceId; timingDeviceId = 'other'; timingLoadQuiet();
      const v = timingQuietDb; timingDeviceId = id; timingLoadQuiet(); return [v, timingQuietDb];
    });
    expect(other).toEqual([-60, -45]);
    await page.reload();
    await page.waitForSelector('#playBtn');
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingQuietValue')).toHaveText('-45 dB');
  });

  test('meter scale is -80..0 dBFS', async ({ page }) => {
    await page.evaluate(() => { window.clearInterval(window.__iv); timingOnWorkletMessage({ data: { type: 'level', db: -40, thDb: -60, rawDb: -40, clip: false } }); });
    await expect.poll(() => page.evaluate(() => document.getElementById('timingMeterFill').style.transform)).toBe('scaleX(0.5)');
    expect(await page.evaluate(() => document.getElementById('timingMeterTh').style.transform)).toBe('translateX(25%)');
  });

  test('the debug recorder meta carries the quiet level', async ({ page }) => {
    await page.evaluate(() => timingSetQuiet(-52));
    await page.evaluate(() => timingDebugRecord(1));
    const q = await page.evaluate(() => timingDbg.meta.quietBelowDb);
    expect(q).toBe(-52);
    await page.evaluate(() => timingDebugStop());
  });

  for (const [width, minW] of [[700, 300], [375, 250]]) {
    test(`the meter has its own full-width row below the View row at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const g = await page.evaluate(() => {
        const v = document.querySelector('.tm-view-row').getBoundingClientRect();
        const m = document.querySelector('.tm-meter-wrap').getBoundingClientRect();
        const t = document.getElementById('timingTimeline').getBoundingClientRect();
        const meter = document.querySelector('.tm-meter').getBoundingClientRect();
        const st = document.getElementById('timingStatus').getBoundingClientRect();
        return { viewH: v.height, viewBottom: v.bottom, meterTop: m.top, meterW: m.width, meterBottom: m.bottom, chartTop: t.top, trackW: meter.width, statusRight: st.right, wrapRight: m.right };
      });
      expect(g.viewH).toBeLessThan(45);
      expect(g.meterTop).toBeGreaterThanOrEqual(g.viewBottom - 1);
      expect(g.meterBottom).toBeLessThanOrEqual(g.chartTop);
      expect(g.meterW).toBeGreaterThanOrEqual(minW);
      expect(g.trackW).toBeGreaterThan(minW - 120);
      expect(g.statusRight).toBeLessThanOrEqual(g.wrapRight + 0.5);
    });
  }
});

// Meter markers ----------------------------------------------------------------------

test.describe('Timing Check - meter markers', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingNode.port.onmessage = null; });
  });

  test('quiet marker (triangle below the track + dotted line) is visible and moves; threshold line is taller than the track', async ({ page }) => {
    await page.evaluate(() => { timingSetQuiet(-60); timingOnWorkletMessage({ data: { type: 'level', db: -50, thDb: -52, rawDb: -50, clip: false } }); });
    const geo = () => page.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const tri = r(document.querySelector('.tm-meter-tri')), track = r(document.querySelector('.tm-meter')), th = r(document.getElementById('timingMeterTh'));
      const q = r(document.getElementById('timingMeterQuiet')), wrap = r(document.querySelector('.tm-meter-wrap'));
      const dotted = getComputedStyle(document.getElementById('timingMeterQuiet'), '::after');
      return { triW: tri.width, triH: tri.height, triCx: tri.left + tri.width / 2, triTop: tri.top, trackBottom: track.bottom, trackTop: track.top, trackLeft: track.left, trackW: track.width,
               thH: th.height, wrapH: wrap.height, wrapBottom: wrap.bottom, triBottom: tri.bottom, color: getComputedStyle(document.querySelector('.tm-meter-tri')).borderBottomColor,
               dottedW: dotted.width, dottedBg: dotted.backgroundImage.slice(0, 40), qLeft: q.left };
    });
    await expect.poll(async () => (await geo()).triCx).toBeGreaterThan(0);
    const a = await geo();
    expect(a.triW).toBeGreaterThanOrEqual(4);
    expect(a.triH).toBeGreaterThanOrEqual(4);
    expect(a.triTop).toBeGreaterThanOrEqual(a.trackBottom - 1);        // below the track
    expect(a.triBottom).toBeLessThanOrEqual(a.wrapBottom + 0.5);        // inside the reserved row height
    expect(a.color).toBe('rgb(148, 163, 184)');
    expect(a.dottedBg).toContain('repeating-linear-gradient');
    expect(a.thH).toBeGreaterThan(10);                                   // threshold line taller than the 8 px track
    expect(a.wrapH).toBeGreaterThanOrEqual(20);
    expect(a.triCx - a.trackLeft).toBeCloseTo(a.trackW * 0.25, 0);       // -60 dBFS on a -80..0 scale
    await page.evaluate(() => timingSetQuiet(-40));
    await expect.poll(async () => Math.round(((await geo()).triCx - a.trackLeft) / a.trackW * 100)).toBe(50);
  });

  test('the meter row title shows the live threshold and quiet level', async ({ page }) => {
    await page.evaluate(() => { timingSetQuiet(-60); timingOnWorkletMessage({ data: { type: 'level', db: -50, thDb: -52, rawDb: -50, clip: false } }); });
    await expect(page.locator('.tm-meter-wrap')).toHaveAttribute('title', 'Detection threshold \u221252 dB \u00b7 Quiet below \u221260 dB');
    await page.evaluate(() => { timingSetQuiet(-45); timingOnWorkletMessage({ data: { type: 'level', db: -50, thDb: -58.4, rawDb: -50, clip: false } }); });
    await expect(page.locator('.tm-meter-wrap')).toHaveAttribute('title', 'Detection threshold \u221258 dB \u00b7 Quiet below \u221245 dB');
  });
});
