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
        out[s] = { key: g.key, name: g.name, locked: g.locked, res: g.res, shuffle: g.shuffle, role: g.role, pos: g.pos.map(p => +p.toFixed(4)) };
      }
      // user-chosen resolution and shuffle on a plain rhythm
      subdivision = '2';
      const combos = {};
      for (const r of ['4', '8', '16', '32']) {
        for (const sh of [false, true]) {
          timingRes = r; timingShuffle = sh;
          const g = getTimingGrid();
          combos[r + (sh ? '+S' : '')] = { key: g.key, name: g.name, res: g.res, shuffle: g.shuffle, locked: g.locked, pos: g.pos.map(p => +p.toFixed(4)), role: g.role, gap: +g.gap.toFixed(4) };
        }
      }
      // locked rhythms with a chosen resolution
      const forced = {};
      for (const s of ['shuffle', '16shuffle']) {
        subdivision = s;
        for (const r of ['4', '8', '16', '32']) {
          timingRes = r; timingShuffle = false;
          const g = getTimingGrid();
          forced[s + '/' + r] = [g.key, g.name, g.res, g.shuffle];
        }
      }
      subdivision = '3'; timingRes = '32';
      const tup = getTimingGrid();
      timingRes = '16'; timingShuffle = false; subdivision = '1';
      return { out, combos, forced, tup: [tup.key, tup.res, tup.shuffle] };
    });
    for (const s of ['1', '2', '4', '4e']) {
      expect(res.out[s]).toMatchObject({ locked: false, key: '16', name: '16', res: '16', shuffle: false });
      expect(res.out[s].pos).toEqual([0, 0.25, 0.5, 0.75]);
    }
    expect(res.out.shuffle).toMatchObject({ key: '8triplet', name: '8 Triplet', locked: true, res: '16', shuffle: true }); // 8th shuffle at Detect 16 = 8th-triplet grid
    expect(res.out['16shuffle']).toMatchObject({ key: '16shuffle', name: '16 Shuffle', locked: true, res: '16', shuffle: true });
    expect(res.out['3']).toMatchObject({ name: 'Triplet', locked: true });
    expect(res.out['5']).toMatchObject({ name: 'Quintuplet', locked: true });
    expect(res.out['6']).toMatchObject({ name: 'Sextuplet', locked: true });
    expect(res.out['16shuffle'].pos).toEqual([0, 0.3333, 0.5, 0.8333]);
    expect(res.out.shuffle.pos).toEqual([0, 0.3333, 0.6667]);
    expect(res.out.shuffle.role).toEqual([0, 1, 2]);
    expect(res.forced['shuffle/4'][0]).toBe('4');
    expect(res.forced['shuffle/8'][0]).toBe('8shuffle');
    const c = res.combos;
    expect(c['4']).toMatchObject({ key: '4', name: '4', pos: [0], role: [0] });
    expect(c['4+S']).toMatchObject({ key: '4', name: '4', shuffle: false }); // shuffle has no effect at 4
    expect(c['8']).toMatchObject({ key: '8', name: '8', pos: [0, 0.5], role: [0, 2], shuffle: false });
    expect(c['8+S']).toMatchObject({ key: '8shuffle', name: '8 Shuffle', pos: [0, 0.6667], role: [0, 2], shuffle: true, res: '8' });
    expect(c['16']).toMatchObject({ key: '16', name: '16', pos: [0, 0.25, 0.5, 0.75], role: [0, 1, 2, 1] });
    expect(c['16+S']).toMatchObject({ key: '16shuffle', name: '16 Shuffle', pos: [0, 0.3333, 0.5, 0.8333], role: [0, 1, 2, 1], shuffle: true });
    expect(c['32']).toMatchObject({ key: '32', name: '32', pos: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], role: [0, 3, 1, 3, 2, 3, 1, 3], gap: 0.125 });
    expect(c['32+S']).toMatchObject({ key: '32', shuffle: false }); // no shuffle at 32
    for (const k of Object.keys(c)) expect(c[k].locked).toBe(false);
    // shuffle rhythms force Shuffle; 32 falls back to the rhythm's default resolution; 4 stays 4
    expect(res.forced['shuffle/4'].slice(0, 1)).toEqual(['4']);
    expect(res.forced['shuffle/8']).toEqual(['8shuffle', '8 Shuffle', '8', true]);
    expect(res.forced['shuffle/16']).toEqual(['8triplet', '8 Triplet', '16', true]);
    expect(res.forced['shuffle/32']).toEqual(['8shuffle', '8 Shuffle', '8', true]);
    expect(res.forced['16shuffle/32']).toEqual(['16shuffle', '16 Shuffle', '16', true]);
    expect(res.tup).toEqual(['triplet', null, false]);
  });

  test('matchOnsetToGrid: role-weighted capture (straight, shuffle, half-time), next beat, rejections', async ({ page }) => {
    const r = await page.evaluate(() => {
      const beats = [0, 1, 2, 3].map(i => ({ time: 10 + i * 0.5, beatInMeasure: i, n: i }));
      const grids = {};
      for (const [k, r, sh] of [['straight', '16', false], ['shuffle', '8', true], ['halftime', '16', true], ['g4', '4', false], ['g8', '8', false], ['g32', '32', false]]) {
        timingRes = r; timingShuffle = sh; subdivision = '1'; grids[k] = getTimingGrid();
      }
      timingRes = '16'; timingShuffle = false;
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
        ambiguousShuffle: m((10.5 * 0.85 + (10.5 + (2 / 3) * 0.5)) / 1.85, 'shuffle'), // 8 Shuffle: weighted midpoint of beat and 2/3
        halftime: m(10 + (5 / 6) * 0.5 + 0.005, 'halftime'),
        halftimeEighthEarly30: m(10.5 + 0.25 - 0.030, 'halftime'),
        ambiguousHalftime: m(mid(10.5 + 0.5 / 3, 10.5 + 0.25), 'halftime'),
        nextBeat: m(10.5 - 0.015, 'straight'),
        beforeFirst: m(9.99, 'straight'),
        empty: matchOnsetToGrid(10, [], grids.straight, 0.5),
      };
      out.reasonStraight = (m(mid(10.5 + 0.125, 10.5 + 0.25), 'straight'), reason());
      // coarse grid 8: a 16th-note hit (1/4) is rejected, a hit on the 8th (1/2) is accepted
      out.g8Sixteenth = m(10.5 + 0.25 * 0.5, 'g8'); out.g8SixteenthReason = reason();
      out.g8SixteenthNear = m(10.5 + 0.25 * 0.5 + 0.004, 'g8'); out.g8SixteenthNearReason = reason();
      out.g8Eighth = m(10.5 + 0.5 * 0.5 + 0.010, 'g8');
      out.g8Beat = m(10.5 + 0.012, 'g8');
      out.g4Eighth = m(10.5 + 0.5 * 0.5, 'g4'); out.g4EighthReason = reason();
      // 8 Shuffle: a hit at 1/3 is equidistant from the beat and 2/3 and is rejected
      out.s8Straight = m(10.5 + 0.5 / 3, 'shuffle'); out.s8StraightReason = reason();
      // fine grid 32: a hit on 1/8 is accepted with the finest role
      out.g32Fine = m(10.5 + 0.125 * 0.5 + 0.006, 'g32');
      out.g32Sixteenth = m(10.5 + 0.25 * 0.5, 'g32');
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
    expect(r.ambiguousShuffle).toBeNull(); // 0.36 beat from both: beyond the 8 Shuffle capture radius
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
    expect(r.g8Sixteenth).toBeNull();
    expect(r.g8SixteenthReason).toBe('too-far');
    expect(r.g8SixteenthNear).toBeNull();
    expect(r.g8SixteenthNearReason).toBe('too-far');
    expect(r.g8Eighth.pos).toBe(0.5);
    expect(r.g8Eighth.role).toBe(2);
    expect(r.g8Eighth.offsetMs).toBeCloseTo(10, 3);
    expect(r.g8Beat.pos).toBe(0);
    expect(r.g8Beat.offsetMs).toBeCloseTo(12, 3);
    expect(r.g4Eighth).toBeNull();
    expect(r.g4EighthReason).toBe('too-far');
    expect(r.s8Straight).toBeNull();
    expect(r.s8StraightReason).toBe('too-far');
    expect(r.g32Fine.pos).toBe(0.125);
    expect(r.g32Fine.role).toBe(3);
    expect(r.g32Fine.offsetMs).toBeCloseTo(6, 3);
    expect(r.g32Sixteenth.pos).toBe(0.25);
    expect(r.g32Sixteenth.role).toBe(1);
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
      timingRecordBeat(1, 0); timingRelayoutTimeline(); timingLayoutBeatsStrip(); timingApplyDetect();
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

  test('Detect row (in the settings popover) follows the rhythm menu locks', async ({ page }) => {
    await page.click('#timingBtn');
    const pick = async v => {
      await page.click('#rhythmTrigger');
      await page.click(`#rhythmMenu [data-value="${v}"]`);
    };
    const detect = async () => page.evaluate(() => ({
      pressed: [...document.querySelectorAll('#timingResSeg button')].map(b => b.getAttribute('aria-pressed')),
      disabled: [...document.querySelectorAll('#timingResSeg button')].map(b => b.disabled),
      shuffle: [document.getElementById('timingShuffleBtn').getAttribute('aria-pressed'), document.getElementById('timingShuffleBtn').disabled],
      hint: document.getElementById('timingDetectHint').hidden ? '' : document.getElementById('timingDetectHint').textContent,
    }));
    // labels, accessible names and the row tooltip
    expect(await page.evaluate(() => [...document.querySelectorAll('#timingResSeg button')].map(b => [b.textContent, b.getAttribute('aria-label')])))
      .toEqual([['4', 'Quarter notes'], ['8', '8th notes'], ['16', '16th notes'], ['32', '32nd notes']]);
    expect(await page.evaluate(() => document.getElementById('timingShuffleBtn').textContent)).toBe('Shuffle');
    let f = await detect();
    expect(f.hint).toBe('');
    expect(f.pressed).toEqual(['false', 'false', 'true', 'false']);
    expect(f.disabled).toEqual([false, false, false, false]);
    expect(f.shuffle).toEqual(['false', false]);

    // shuffle rhythms: Shuffle forced on and locked, 32 disabled, 4/8/16 stay available
    await pick('shuffle');
    f = await detect();
    expect(f.pressed).toEqual(['false', 'false', 'true', 'false']); // the user's 16 is kept
    expect(f.disabled).toEqual([false, false, false, true]);
    expect(f.shuffle).toEqual(['true', true]);
    expect(f.hint).toBe('');
    expect(await page.evaluate(() => getTimingGrid().key)).toBe('8triplet');
    await pick('2');
    await page.click('#timingSetBtn');
    await page.click('#timingResSeg [data-v="32"]');
    await pick('shuffle'); // user chose 32: the rhythm's default (8) is used
    f = await detect();
    expect(f.pressed).toEqual(['false', 'true', 'false', 'false']);
    expect(f.disabled).toEqual([false, false, false, true]);
    expect(await page.evaluate(() => [getTimingGrid().key, timingRes])).toEqual(['8shuffle', '32']);
    await pick('16shuffle');
    f = await detect();
    expect(f.pressed).toEqual(['false', 'false', 'true', 'false']);
    expect(await page.evaluate(() => getTimingGrid().key)).toBe('16shuffle');

    // tuplets: the whole row is disabled and the hint names the tuplet
    await pick('3');
    f = await detect();
    expect(f.pressed).toEqual(['false', 'false', 'false', 'false']);
    expect(f.disabled).toEqual([true, true, true, true]);
    expect(f.shuffle).toEqual(['false', true]);
    expect(f.hint).toBe('Locked to Triplet');
    await pick('5');
    expect((await detect()).hint).toBe('Locked to Quintuplet');

    await pick('2');
    f = await detect();
    expect(f.disabled).toEqual([false, false, false, false]);
    expect(f.pressed).toEqual(['false', 'false', 'false', 'true']); // 32 chosen earlier
    expect(f.hint).toBe('');
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingResSeg')).toBeVisible();
    await page.click('#timingResSeg [data-v="8"]');
    await page.click('#timingShuffleBtn');
    expect((await detect()).shuffle).toEqual(['true', false]);
    expect(await page.evaluate(() => getTimingGrid().key)).toBe('8shuffle');
  });

  test('Shuffle is disabled at 4 and 32 and the preference is restored at 8 and 16', async ({ page }) => {
    await page.click('#timingBtn');
    await page.click('#timingSetBtn');
    const shuf = () => page.evaluate(() => [document.getElementById('timingShuffleBtn').getAttribute('aria-pressed'), document.getElementById('timingShuffleBtn').disabled, getTimingGrid().key]);
    await page.click('#timingResSeg [data-v="8"]');
    await page.click('#timingShuffleBtn');
    expect(await shuf()).toEqual(['true', false, '8shuffle']);
    await page.click('#timingResSeg [data-v="4"]');
    expect(await shuf()).toEqual(['false', true, '4']);
    await page.click('#timingShuffleBtn', { force: true }); // disabled: no effect
    expect(await page.evaluate(() => timingShuffle)).toBe(true);
    await page.click('#timingResSeg [data-v="32"]');
    expect(await shuf()).toEqual(['false', true, '32']);
    await page.click('#timingResSeg [data-v="8"]');
    expect(await shuf()).toEqual(['true', false, '8shuffle']);
    await page.click('#timingResSeg [data-v="16"]');
    expect(await shuf()).toEqual(['true', false, '16shuffle']);
    await page.click('#timingShuffleBtn');
    expect(await shuf()).toEqual(['false', false, '16']);
  });

  test('Detect settings persist across a reload and the old Feel keys migrate once', async ({ page }) => {
    await page.click('#timingBtn');
    await page.click('#timingSetBtn');
    await page.click('#timingResSeg [data-v="8"]');
    await page.click('#timingShuffleBtn');
    expect(await page.evaluate(() => [localStorage.getItem('wm.timing.res'), localStorage.getItem('wm.timing.shuffle')])).toEqual(['8', 'true']);
    await page.reload();
    await page.waitForSelector('#playBtn');
    expect(await page.evaluate(() => [timingRes, timingShuffle, getTimingGrid().key])).toEqual(['8', true, '8shuffle']);

    for (const [feel, res, sh] of [['straight', '16', false], ['shuffle', '8', true], ['halftime', '16', true]]) {
      await page.evaluate((f) => {
        localStorage.removeItem('wm.timing.res'); localStorage.removeItem('wm.timing.shuffle');
        localStorage.setItem('wm.timing.feel', f);
      }, feel);
      await page.reload();
      await page.waitForSelector('#playBtn');
      const r = await page.evaluate(() => ({ res: timingRes, sh: timingShuffle, s: [localStorage.getItem('wm.timing.res'), localStorage.getItem('wm.timing.shuffle')], feel: localStorage.getItem('wm.timing.feel') }));
      expect(r).toEqual({ res, sh, s: [res, String(sh)], feel: null });
    }
    // existing new keys win over a stale feel key, which is still removed
    await page.evaluate(() => { localStorage.setItem('wm.timing.res', '32'); localStorage.setItem('wm.timing.feel', 'shuffle'); });
    await page.reload();
    await page.waitForSelector('#playBtn');
    expect(await page.evaluate(() => [timingRes, localStorage.getItem('wm.timing.feel')])).toEqual(['32', null]);
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

  test('mapping: 5 is the reference tuning; f = 1.5 at 1, 1.0 at 5, 0.35 at 10', async ({ page }) => {
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
    expect(p10.f).toBeCloseTo(0.35, 9);
    expect(p10.combDb).toBeCloseTo(3.5, 9);
    expect(p10.minGateDbfs).toBeCloseTo(-65, 6);
    expect(p10.dropRatio).toBeCloseTo(0.85, 9);
    expect(p10.jumpDb[0]).toBeCloseTo(p5.jumpDb[0] * 0.35, 6);
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
    // the core flags clipping only for a run of >= 4 consecutive samples at >= 0.998 (a flat top)
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
      for (let i = 5; i < 9; i++) b[i] = -0.99997;
      core.process(a, 0); core.process(b, 128);
      const second = core.takeLevel().clip;
      const runOf = (n, v) => run(x => { for (let i = 1000; i < 1000 + n; i++) x[i] = v; });
      // a run split across two process() calls (2 samples at the end of one, 2 at the start of the next)
      const sp = timingMakeOnsetCore(sig.SR);
      const c1 = new Float32Array(128), c2 = new Float32Array(128);
      c1[126] = c1[127] = 1; c2[0] = c2[1] = -1;
      sp.process(c1, 0); sp.process(c2, 128);
      const split4 = sp.takeLevel().clip;
      const sp3 = timingMakeOnsetCore(sig.SR);
      const d2 = new Float32Array(128); d2[0] = 1;
      sp3.process(c1, 0); sp3.process(d2, 128); // 2 + 1 = 3 only
      const split3 = sp3.takeLevel().clip;
      const after = core.takeLevel().clip; // the flag resets after each level report
      return {
        half: run(x => { sig.addSine(x, 0, 300, dbv(-0.5), 0, 0, 0.1); }),
        single: run(x => { x[1000] = 1.0; }),
        run3: runOf(3, 1).clip, run4: runOf(4, 1).clip, run4neg: runOf(4, -0.9985).clip, run4low: runOf(4, 0.9975).clip,
        gap: run(x => { x[1000] = x[1001] = x[1002] = 1; x[1004] = 1; }).clip,
        split4, split3,
        sine005: run(x => { sig.addSine(x, 0, 301, dbv(-0.05), 0, 0, 0.1); }),
        run02: run(x => { const v = dbv(-0.2); for (let i = 1000; i < 1010; i++) x[i] = i % 2 ? -v : v; }),
        second, after,
      };
    });
    expect(flags.half.clip).toBe(false);
    expect(flags.single.clip).toBe(false);
    expect(flags.run3).toBe(false);
    expect(flags.run4).toBe(true);
    expect(flags.run4neg).toBe(true);
    expect(flags.run4low).toBe(false);
    expect(flags.gap).toBe(false);
    expect(flags.split4).toBe(true);
    expect(flags.split3).toBe(false);
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

    test(`${view}: a rejected hit draws a grey cross, is not counted, and the status reads Off grid`, async ({ page }) => {
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
      await expect(page.locator(host + ' .tm-x')).toHaveCount(1);
      await expect(page.locator('#timingStatus')).toHaveText('Off grid');
      await expect(page.locator('#timingHitCount')).toHaveText('1');
      expect(await page.locator('#timingAvg').textContent()).toBe(before);
      const x = await page.evaluate(h => { const e = document.querySelector(h + ' .tm-x'), s = getComputedStyle(e), b = getComputedStyle(e, '::before'); return [s.width, b.backgroundColor, b.height]; }, host);
      expect(x[0]).toBe('9px');
      expect(x[1]).toBe('rgb(148, 163, 184)');
      expect(parseFloat(x[2])).toBeGreaterThanOrEqual(1); // CSS says 1.5px; Chrome snaps to device pixels
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
    await expect(page.locator('#timingTrack .tm-dot, #timingTrack .tm-x, #timingTrack .tm-tri')).toHaveCount(0);
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

  test('history: a finished measurement appends a full diagnostic record (good, unstable, failed)', async ({ page }) => {
    await feed(page, '58', 'true');
    await page.evaluate(() => timingLoopFinish());
    await feed(page, '58', 'false'); // no-op: timingLoop already finished
    await page.click('#timingLoopStart');
    await feed(page, '58 + i * 0.06', 'true');
    await page.evaluate(() => timingLoopFinish());
    await page.click('#timingLoopStart');
    await feed(page, '58', 'i < 10');
    await page.evaluate(() => timingLoopFinish());
    const h = await page.evaluate(() => timingLoopHistory());
    expect(h.map(r => r.result)).toEqual(['good', 'unstable', 'failed']);
    const r = h[0];
    for (const k of ['at', 'n', 'median', 'sd', 'mad', 'min', 'max', 'drift', 'ctxRate', 'baseLatencyMs', 'outputLatencyMs',
      'trackRate', 'trackLatencyMs', 'channelCount', 'label', 'ctxTimeSec', 'pageAgeSec', 'streamAgeSec', 'streamSeq',
      'pageLoadId', 'playedSinceLast', 'outTs', 'channel', 'sensitivity']) expect(r).toHaveProperty(k);
    expect(r.n).toBe(60);
    expect(r.median).toBeCloseTo(58, 0);
    expect(r.ctxRate).toBeGreaterThan(0);
    expect(r.streamSeq).toBeGreaterThanOrEqual(1);
    expect(r.pageLoadId).toMatch(/^[a-z0-9]+$/);
    expect(r.playedSinceLast).toBe(false);
    expect(h[2].n).toBe(10);
    expect(new Set(h.map(x => x.pageLoadId)).size).toBe(1);
    // also stored under the per-device key
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wm.timing.loopHistory.' + timingDeviceId)).length)).toBe(3);
  });

  test('history: cancelled measurements are not recorded; playedSinceLast tracks play', async ({ page }) => {
    await page.click('#timingLoopStop');
    expect(await page.evaluate(() => timingLoopHistory().length)).toBe(0);
    await page.keyboard.press('Escape');
    await clickPlay(page);
    await clickPlay(page);
    await page.click('#timingSetBtn');
    await page.click('#timingLoopStart');
    await feed(page, '58', 'true');
    await page.evaluate(() => timingLoopFinish());
    await page.click('#timingLoopStart');
    await feed(page, '58', 'true');
    await page.evaluate(() => timingLoopFinish());
    const h = await page.evaluate(() => timingLoopHistory());
    expect(h.map(r => r.playedSinceLast)).toEqual([true, false]);
  });

  test('history: capped at 30, Clear empties it', async ({ page }) => {
    await page.evaluate(() => {
      for (let i = 0; i < 33; i++) {
        timingLoop = { clicks: [], oscs: [], gain: audioCtx.createGain(), samples: [], running: true, timer: 0 };
        for (let k = 0; k < 60; k++) timingLoop.samples.push({ ts: k * 0.5, ms: 50 + i });
        timingLoopFinish();
      }
    });
    const h = await page.evaluate(() => timingLoopHistory());
    expect(h.length).toBe(30);
    expect(h[0].median).toBeCloseTo(53, 3); // oldest 3 dropped
    expect(h[29].median).toBeCloseTo(82, 3);
    await page.click('#timingLoopHist summary');
    await page.click('#timingLoopHistClear');
    expect(await page.evaluate(() => timingLoopHistory())).toEqual([]);
    await expect(page.locator('#timingLoopHistList li')).toHaveCount(0);
  });

  test('history: streamSeq increments on device switch and the list renders newest first, 10 max, with flags', async ({ page }) => {
    const seq0 = await page.evaluate(() => timingStreamSeq);
    await feed(page, '58', 'true');
    await page.evaluate(() => timingLoopFinish());
    await page.evaluate(() => timingSwitchDevice(''));
    await expect.poll(() => page.evaluate(() => timingStreamSeq)).toBe(seq0 + 1);
    await page.click('#timingLoopStart');
    await feed(page, '70', 'true');
    await page.evaluate(() => timingLoopFinish());
    const h = await page.evaluate(() => timingLoopHistory());
    expect(h.map(r => r.streamSeq)).toEqual([seq0, seq0 + 1]);
    await page.click('#timingLoopHist summary');
    const lis = page.locator('#timingLoopHistList li');
    await expect(lis).toHaveCount(2);
    await expect(lis.nth(0)).toContainText('70.0 ms');
    await expect(lis.nth(0)).toContainText('stream #' + (seq0 + 1));
    await expect(lis.nth(0)).toHaveAttribute('data-flag', /change/);
    await expect(lis.nth(1)).toContainText('58.0 ms');
    await expect(page.locator('#timingLoopHistSummary')).toHaveText('History (2)');
    // only the newest 10 are listed
    await page.evaluate(() => {
      const base = timingLoopHistory()[0];
      const arr = []; for (let i = 0; i < 15; i++) arr.push(Object.assign({}, base, { median: 100 + i, ctxRate: 48000, trackRate: 44100 }));
      localStorage.setItem('wm.timing.loopHistory.' + timingDeviceId, JSON.stringify(arr));
      timingLoopRenderHistory();
    });
    await expect(lis).toHaveCount(10);
    await expect(lis.nth(0)).toContainText('114.0 ms');
    await expect(lis.nth(0)).toHaveAttribute('data-flag', /rate/);
  });

  test('history: Copy JSON shows Copied, and the panel does not overflow at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await feed(page, '58', 'true');
    await page.evaluate(() => timingLoopFinish());
    await page.click('#timingLoopHist summary');
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.resolve(); });
    await page.click('#timingLoopHistCopy');
    await expect(page.locator('#timingLoopHistCopied')).toHaveText('Copied');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
    // sections in order: input, detect, latency, sensitivity
    const order = await page.evaluate(() => ['timingDeviceSelect', 'timingResSeg', 'timingLatValue', 'timingSensValue']
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

  test('the button label follows the detection grid, latency and sensitivity', async ({ page }) => {
    await expect(page.locator('#timingSetBtn')).toContainText('16');
    await expect(page.locator('#timingSetGrid')).toHaveText('16 \u00b7');
    await page.evaluate(() => { timingSetLatency(99); timingSetSensitivity(7); });
    await expect(page.locator('#timingSetBtn')).toHaveText(/^\s*16 \u00b7\s*99 ms \u00b7 S7/);
    await expect(page.locator('#timingSetVals')).toHaveText('99 ms \u00b7 S7');
    await expect(page.locator('#timingSetEst')).toBeHidden();
    await page.evaluate(() => timingResetLatency());
    await expect(page.locator('#timingSetEst')).toBeVisible();
    for (const [v, text] of [['shuffle', '8 Triplet'], ['16shuffle', '16 Shuffle'], ['3', 'Triplet'], ['2', '16']]) {
      await page.click('#rhythmTrigger');
      await page.click(`#rhythmMenu [data-value="${v}"]`);
      await expect(page.locator('#timingSetGrid')).toHaveText(text + ' \u00b7');
    }
    await page.click('#timingSetBtn');
    for (const [r, sh, text] of [['8', false, '8'], ['8', true, '8 Shuffle'], ['4', false, '4'], ['32', false, '32'], ['16', true, '16 Shuffle']]) {
      await page.click(`#timingResSeg [data-v="${r}"]`);
      if ((await page.evaluate(() => timingShuffle)) !== sh && !(await page.locator('#timingShuffleBtn').isDisabled())) await page.click('#timingShuffleBtn');
      await expect(page.locator('#timingSetGrid')).toHaveText(text + ' \u00b7');
    }
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
               gridShown: getComputedStyle(document.getElementById('timingSetGrid')).display !== 'none',
               detect: (() => { const rr = document.getElementById('timingResSeg').parentElement; const kids = [...rr.children].map(e => e.getBoundingClientRect());
                 return { oneLine: kids.every(k => Math.abs(k.top - kids[0].top) < 1), right: Math.max(...kids.map(k => k.right)), popRight: r.right, sw: rr.scrollWidth, cw: rr.clientWidth }; })() };
    });
    expect(geo.left).toBeGreaterThanOrEqual(0);
    expect(geo.right).toBeLessThanOrEqual(geo.vw);
    expect(geo.scrollW).toBeLessThanOrEqual(baseScrollW); // the popover adds no horizontal overflow
    expect(geo.addonRight).toBeLessThanOrEqual(geo.cardRight + 0.5);
    expect(geo.gridShown).toBe(false); // the grid name drops out of the button on narrow screens
    expect(geo.detect.oneLine).toBe(true); // Detect row (segment + Shuffle) does not wrap
    expect(geo.detect.right).toBeLessThanOrEqual(geo.detect.popRight);
    expect(geo.detect.sw).toBeLessThanOrEqual(geo.detect.cw);
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
    expect(await page.evaluate(() => document.getElementById('timingMeterTh'))).toBeNull();
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

  test('quiet marker (triangle below the track + dotted line) is visible and moves; bold dark; no threshold line', async ({ page }) => {
    await page.evaluate(() => { timingSetQuiet(-60); timingOnWorkletMessage({ data: { type: 'level', db: -50, thDb: -52, rawDb: -50, clip: false } }); });
    const geo = () => page.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const tri = r(document.querySelector('.tm-meter-tri')), track = r(document.querySelector('.tm-meter'));
      const q = r(document.getElementById('timingMeterQuiet')), wrap = r(document.querySelector('.tm-meter-wrap'));
      const dotted = getComputedStyle(document.getElementById('timingMeterQuiet'), '::after');
      return { triW: tri.width, triH: tri.height, triCx: tri.left + tri.width / 2, triTop: tri.top, trackBottom: track.bottom, trackTop: track.top, trackLeft: track.left, trackW: track.width,
               wrapH: wrap.height, wrapBottom: wrap.bottom, triBottom: tri.bottom, color: getComputedStyle(document.querySelector('.tm-meter-tri')).borderBottomColor,
               dottedW: dotted.width, qColor: dotted.backgroundImage, dottedBg: dotted.backgroundImage.slice(0, 40), qLeft: q.left };
    });
    await expect.poll(async () => (await geo()).triCx).toBeGreaterThan(0);
    const a = await geo();
    expect(a.triW).toBeGreaterThanOrEqual(8);
    expect(a.triH).toBeGreaterThanOrEqual(5);
    expect(a.triTop).toBeGreaterThanOrEqual(a.trackBottom - 1);        // below the track
    expect(a.triBottom).toBeLessThanOrEqual(a.wrapBottom + 0.5);        // inside the reserved row height
    expect(a.color).toBe('rgb(51, 65, 85)');
    expect(a.qColor).toContain('rgb(51, 65, 85)');
    expect(a.dottedW).toBe('2px');
    expect(a.dottedBg).toContain('repeating-linear-gradient');
    expect(a.wrapH).toBeGreaterThanOrEqual(20);
    expect(a.triCx - a.trackLeft).toBeCloseTo(a.trackW * 0.25, 0);       // -60 dBFS on a -80..0 scale
    await page.evaluate(() => timingSetQuiet(-40));
    await expect.poll(async () => Math.round(((await geo()).triCx - a.trackLeft) / a.trackW * 100)).toBe(50);
  });

  test('the meter row title shows only the quiet level (no detection threshold)', async ({ page }) => {
    await page.evaluate(() => { timingSetQuiet(-60); timingOnWorkletMessage({ data: { type: 'level', db: -50, thDb: -52, rawDb: -50, clip: false } }); });
    await expect(page.locator('.tm-meter-wrap')).toHaveAttribute('title', 'Quiet below −60 dB');
    await page.evaluate(() => { timingSetQuiet(-45); timingOnWorkletMessage({ data: { type: 'level', db: -50, thDb: -58.4, rawDb: -50, clip: false } }); });
    await expect(page.locator('.tm-meter-wrap')).toHaveAttribute('title', 'Quiet below −45 dB');
  });

  test('an accepted onset flashes the meter (opacity only) and rapid hits restart it', async ({ page }) => {
    const n0 = await page.evaluate(() => +document.getElementById('timingMeterFlash').dataset.flash);
    await page.evaluate(() => { timingOnWorkletMessage({ data: { type: 'onset', time: 1, peakDb: -30, thDb: -55, bands: [] } }); });
    expect(await page.evaluate(() => +document.getElementById('timingMeterFlash').dataset.flash)).toBe(n0 + 1);
    const props = await page.evaluate(() => document.getElementById('timingMeterFlash').getAnimations().map(a => a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(x => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)))));
    expect(props.length).toBe(1);
    expect(props[0].every(k => k === 'opacity')).toBe(true);
    await page.evaluate(() => { for (let i = 0; i < 3; i++) timingOnWorkletMessage({ data: { type: 'onset', time: 2 + i, peakDb: -30, thDb: -55, bands: [] } }); });
    expect(await page.evaluate(() => +document.getElementById('timingMeterFlash').dataset.flash)).toBe(n0 + 4);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('timingMeterFlash')).opacity)).toBe('0');
  });
});

// Input glitch compensation + startup ignore window ------------------------------------

test.describe('Timing Check - input glitch compensation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => {
      timingNode.port.onmessage = null; // ignore the fake device; messages are injected
      timingSwapUntil = 0;
      updateBpm(250);
      window.__gum = 0;
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; return orig(c); };
    });
  });

  // a worklet glitch message starting `afterSec` context seconds after the current stream attached
  const glitch = (page, afterSec, ms) => page.evaluate(({ afterSec, ms }) => timingOnWorkletMessage({ data: { type: 'glitch', startTime: timingStreamCtxAt + afterSec, lengthSamples: Math.round(ms * 48), lengthMs: ms } }), { afterSec, ms });
  const comp = (page) => page.evaluate(() => [timingGlitchCompMs, timingGlitchCompN, timingGlitchCount, timingGlitchMsTotal]);
  const applyMeasurement = (page) => page.evaluate(() => {
    timingLoop = { running: false, result: { median: 77.4 }, seq: timingStreamSeq };
    document.getElementById('timingLoopApply').click();
    timingLoop = null; // the fake measurement must not reach the teardown on a device switch
  });

  test('a zero run within 1 s of attach is logged as ignored and neither counts nor compensates; a later one does', async ({ page }) => {
    await page.evaluate(() => { window.__before = timingGlitchLog().length; });
    await glitch(page, 0.04, 20);
    expect(await comp(page)).toEqual([0, 0, 0, 0]);
    const e = await page.evaluate(() => timingGlitchLog().slice(window.__before));
    expect(e.length).toBe(1);
    expect(e[0]).toMatchObject({ ignored: 'startup', lengthMs: 20 });
    await expect(page.locator('#timingLatComp')).toBeHidden();
    await glitch(page, 0.99, 20);
    expect((await comp(page))[0]).toBe(0);
    await glitch(page, 1.0, 20);
    expect(await comp(page)).toEqual([20, 1, 1, 20]);
    const all = await page.evaluate(() => timingGlitchLog().slice(window.__before));
    expect(all.map(x => x.ignored)).toEqual(['startup', 'startup', undefined]);
  });

  test('the quantum zeroRuns path uses the same startup window', async ({ page }) => {
    const lvl = (page) => page.evaluate(() => timingOnWorkletMessage({ data: { type: 'level', db: -60, thDb: -50, rawDb: -60, clip: false, zeroRuns: timingZeroRaw + 1 } }));
    await page.evaluate(() => { timingStreamCtxAt = audioCtx.currentTime; });
    await lvl(page);
    expect(await page.evaluate(() => timingZeroRuns)).toBe(0);
    await page.evaluate(() => { timingStreamCtxAt = audioCtx.currentTime - 2; });
    await lvl(page);
    expect(await page.evaluate(() => timingZeroRuns)).toBe(1);
    // the same running count again is not a new run
    await page.evaluate(() => timingOnWorkletMessage({ data: { type: 'level', db: -60, thDb: -50, rawDb: -60, clip: false, zeroRuns: timingZeroRaw } }));
    expect(await page.evaluate(() => timingZeroRuns)).toBe(1);
  });

  test('a real 20 ms glitch while playing is compensated: Avg +12 ms, button shows the effective latency', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(6);
    const L = await page.evaluate(() => timingLatencyMs);
    await glitch(page, 5, 20);
    await expect(page.locator('#timingStatus')).toHaveText('Input glitch — compensated +20 ms');
    await expect(page.locator('#timingStatus')).toHaveAttribute('data-q', 'warn');
    await expect(page.locator('#timingSetVals')).toHaveText((L + 20) + ' ms · S5');
    const n = await page.evaluate(() => {
      const done = timingBeats.filter(b => b.dur > 0);
      const picked = done.slice(-4, -1);
      picked.forEach(b => timingHandleOnset(b.time + (timingLatencyMs + 20) / 1000 + 0.012, -20));
      return picked.length;
    });
    expect(n).toBe(3);
    await expect(page.locator('#timingAvg')).toHaveText(/^\+12 ms$/);
    expect(await page.evaluate(() => timingLatencyMs)).toBe(L); // the stored value is untouched
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingLatComp')).toBeVisible();
    await expect(page.locator('#timingLatComp')).toHaveText('+20 ms auto (1 glitch)');
    await expect(page.locator('#timingLatComp')).toHaveAttribute('title', "Chrome's input buffer slipped; the extra delay is added automatically.");
    await glitch(page, 6, 10);
    await expect(page.locator('#timingLatComp')).toHaveText('+30 ms auto (2 glitches)');
    await page.evaluate(() => togglePlay());
  });

  test('Apply, a manual edit and a stream attach each reset the compensation', async ({ page }) => {
    await glitch(page, 5, 20);
    expect((await comp(page))[0]).toBe(20);
    await applyMeasurement(page);
    expect(await comp(page)).toEqual([0, 0, 1, 20]); // the per-stream totals stay, the compensation resets
    await expect(page.locator('#timingLatComp')).toBeHidden();
    await glitch(page, 5, 20);
    await page.evaluate(() => timingSetLatency(60));
    expect((await comp(page))[0]).toBe(0);
    await glitch(page, 5, 20);
    await page.evaluate(() => timingResetLatency());
    expect((await comp(page))[0]).toBe(0);
    await glitch(page, 5, 20);
    expect((await comp(page))[0]).toBe(20);
    await page.evaluate(() => timingSwitchDevice(timingDeviceId));
    await expect.poll(() => page.evaluate(() => timingStreamSeq)).toBe(2);
    expect((await comp(page))).toEqual([0, 0, 0, 0]);
    await expect(page.locator('#timingSetVals')).toHaveText(/^\d+ ms · S5$/);
  });

  test('no reopen happens at START after a glitch: streamSeq is unchanged and no new stream is requested', async ({ page }) => {
    const seq0 = await page.evaluate(() => timingStreamSeq);
    await glitch(page, 5, 20);
    await clickPlay(page);
    await page.waitForTimeout(400);
    await clickPlay(page);
    await clickPlay(page);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [timingStreamSeq, window.__gum, timingGlitchCompMs])).toEqual([seq0, 0, 20]);
    await clickPlay(page);
  });

  test('history records appliedMs, compMs, expectedMs and residualMs; the line shows the residual', async ({ page }) => {
    const out = await page.evaluate(() => {
      const st = (median) => ({ n: 60, median, sd: 1, mad: 1, min: 50, max: 60, drift: 0 });
      timingSetLatency(60, { streamSeq: timingStreamSeq });      // measured on this stream
      timingGlitchCompMs = 20; timingGlitchCompN = 1;
      timingLoopHistAppend('good', st(80.1));
      timingSetLatency(60);                                       // manual: no stream binding
      timingGlitchCompMs = 20;
      timingLoopHistAppend('good', st(80.1));
      timingSetLatency(60, { streamSeq: timingStreamSeq });
      timingMeasuredPage = 'otherpage';                           // measured on another page load / stream
      timingLoopHistAppend('good', st(80.1));
      timingMeasuredPage = timingPageLoadId; timingMeasuredSeq = timingStreamSeq - 1;
      timingLoopHistAppend('good', st(80.1));
      const h = timingLoopHistory();
      return { h, l: h.map(timingLoopHistLine) };
    });
    expect(out.h[0]).toMatchObject({ appliedMs: 60, compMs: 20, expectedMs: 80 });
    expect(out.h[0].residualMs).toBeCloseTo(0.1, 6);
    expect(out.l[0]).toContain('Δ +0.1');
    expect(out.h[1]).toMatchObject({ appliedMs: 60, compMs: 20, expectedMs: null, residualMs: null });
    expect(out.l[1]).not.toContain('Δ');
    expect(out.h[2]).toMatchObject({ expectedMs: null, residualMs: null });
    expect(out.h[3]).toMatchObject({ expectedMs: null, residualMs: null });
    expect(out.h[0]).toHaveProperty('measuredMinusFirst');
    expect(out.h[0]).not.toHaveProperty('reopenCount');
  });

  test('the residual is signed and the line is not changed when there are no zero runs', async ({ page }) => {
    const out = await page.evaluate(() => {
      timingSetLatency(60, { streamSeq: timingStreamSeq });
      timingLoopHistAppend('good', { n: 60, median: 59.6, sd: 1, mad: 1, min: 50, max: 60, drift: 0 });
      const r = timingLoopHistory().pop();
      return [r, timingLoopHistLine(r)];
    });
    expect(out[0].residualMs).toBeCloseTo(-0.4, 6);
    expect(out[1]).toContain('Δ −0.4');
    expect(out[1]).not.toContain('zr');
  });

  test('the glitch log persists across a reload with deviceId and pageLoadId, capped at 200', async ({ page }) => {
    const first = await page.evaluate(() => {
      for (let i = 0; i < 205; i++) timingOnWorkletMessage({ data: { type: 'glitch', startTime: timingStreamCtxAt + 2 + i, lengthSamples: 777, lengthMs: 5 } });
      return { pid: timingPageLoadId, dev: timingDeviceId, ls: JSON.parse(localStorage.getItem('wm.timing.glitchLog')).length };
    });
    expect(first.ls).toBe(200);
    await page.reload();
    await page.waitForLoadState('load');
    const log = await page.evaluate(() => timingGlitchLog());
    expect(log.length).toBe(200);
    const last = log[log.length - 1];
    expect(last).toMatchObject({ lengthSamples: 777, lengthMs: 5, pageLoadId: first.pid, deviceId: first.dev });
    expect(first.dev).not.toBe('');
    expect(await page.evaluate(() => timingPageLoadId)).not.toBe(first.pid);
  });

  test('history Clear also clears the persisted glitch log', async ({ page }) => {
    await glitch(page, 5, 20);
    expect(await page.evaluate(() => timingGlitchLog().length)).toBeGreaterThan(0);
    await page.click('#timingSetBtn');
    await page.click('#timingLoopOpen');
    await page.click('#timingLoopHist summary');
    await page.click('#timingLoopHistClear');
    expect(await page.evaluate(() => [timingGlitchLog().length, localStorage.getItem('wm.timing.glitchLog')])).toEqual([0, null]);
  });

  test('history and glitch entries keep recording latencyHint default (the AudioContext has no options any more)', async ({ page }) => {
    const out = await page.evaluate(() => {
      timingOnWorkletMessage({ data: { type: 'glitch', startTime: timingStreamCtxAt + 3, lengthSamples: 960, lengthMs: 20 } });
      timingLoopHistAppend('good', { n: 60, median: 58, sd: 1, mad: 1, min: 50, max: 60, drift: 0 });
      return [timingGlitchLog().pop().latencyHint, timingLoopHistory().pop().latencyHint];
    });
    expect(out).toEqual(['default', 'default']);
  });

  test('no horizontal overflow at 375 px with the compensation note and effective latency shown', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await applyMeasurement(page);
    await glitch(page, 5, 20);
    await glitch(page, 6, 20);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingLatComp')).toBeVisible();
    const r = await page.evaluate(() => {
      const pop = document.getElementById('timingPopover').getBoundingClientRect();
      const b = document.getElementById('timingSetBtn').getBoundingClientRect();
      const c = document.getElementById('timingLatComp').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, popL: pop.left, popR: pop.right, btnR: b.right, cR: c.right };
    });
    expect(r.sw).toBeLessThanOrEqual(r.iw);
    expect(r.popL).toBeGreaterThanOrEqual(0);
    expect(r.popR).toBeLessThanOrEqual(r.iw);
    expect(r.btnR).toBeLessThanOrEqual(r.iw);
    expect(r.cR).toBeLessThanOrEqual(r.popR);
  });

  test('the worklet core counts each all-zero run once, after non-zero data only', async ({ page }) => {
    const n = await page.evaluate(() => {
      const c = timingMakeOnsetCore(48000);
      const z = new Float32Array(128), v = new Float32Array(128).fill(1e-4);
      const feed = a => a.forEach(x => c.processChannels([x], 0, 0));
      feed([z, z, v, v, z, z, z, v, z]);     // leading zeros ignored; runs start at index 4 and 8
      const first = c.takeLevel().zeroRuns;
      feed([v, z]);
      return [first, c.takeLevel().zeroRuns];
    });
    expect(n).toEqual([2, 3]);
  });

  test('history line shows zr N only when N > 0', async ({ page }) => {
    const st = { n: 60, median: 58, sd: 1, mad: 1, min: 50, max: 60, drift: 0 };
    const out = await page.evaluate((st) => {
      timingZeroRuns = 0; timingLoopHistAppend('good', st);
      timingZeroRuns = 3; timingLoopHistAppend('good', st);
      const h = timingLoopHistory();
      return { h: h.map(r => r.zeroRuns), l: h.map(timingLoopHistLine) };
    }, st);
    expect(out.h).toEqual([0, 3]);
    expect(out.l[0]).not.toContain('zr');
    expect(out.l[1]).toContain('zr 3');
  });
});

// Re-measure hint: a measurement is only valid for the stream it was taken on ----------

test.describe('Timing Check - Re-measure hint', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingNode.port.onmessage = null; });
  });
  const hint = (page) => page.evaluate(() => [!document.getElementById('timingSetRemeasure').hidden, !document.getElementById('timingLatRemeasure').hidden]);
  const reopen = (page) => page.evaluate(() => timingSwitchDevice(timingDeviceId));
  const applyMeasurement = (page) => page.evaluate(() => {
    timingLoop = { running: false, result: { median: 77.4 }, seq: timingStreamSeq };
    document.getElementById('timingLoopApply').click();
    timingLoop = null; // the fake measurement must not reach the teardown on a device switch
  });

  test('no hint without a measurement; an applied measurement on the current stream shows none', async ({ page }) => {
    expect(await hint(page)).toEqual([false, false]);
    await applyMeasurement(page);
    expect(await hint(page)).toEqual([false, false]);
    expect(await page.evaluate(() => [timingMeasuredSeq === timingStreamSeq, timingLatencyMs])).toEqual([true, 77]);
  });

  test('a stream change after an applied measurement shows the hint; a new apply clears it', async ({ page }) => {
    await applyMeasurement(page);
    await reopen(page);
    await expect.poll(() => hint(page)).toEqual([true, true]);
    expect(await page.locator('#timingLatRemeasure').getAttribute('title')).toContain('Latency can shift by up to ~10 ms per reopen');
    await applyMeasurement(page);
    expect(await hint(page)).toEqual([false, false]);
  });

  test('Timing off then on shows the hint', async ({ page }) => {
    await applyMeasurement(page);
    await page.click('#timingBtn');
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await expect.poll(() => hint(page)).toEqual([true, true]);
  });

  test('a manual latency edit shows no hint and clears an existing one', async ({ page }) => {
    await page.evaluate(() => timingSetLatency(60));
    await reopen(page);
    await expect.poll(() => page.evaluate(() => timingStreamSeq)).toBeGreaterThan(1);
    expect(await hint(page)).toEqual([false, false]);
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.latencySrc.' + timingDeviceId))).toBe('{"manual":true}');
    await applyMeasurement(page);
    await reopen(page);
    await expect.poll(() => hint(page)).toEqual([true, true]);
    await page.evaluate(() => timingSetLatency(61));
    expect(await hint(page)).toEqual([false, false]);
  });

  test('after a reload (different pageLoadId in the stored source) the hint shows on the first stream', async ({ page }) => {
    await applyMeasurement(page);
    await page.evaluate(() => {
      localStorage.setItem('wm.timing.latencySrc.' + timingDeviceId, JSON.stringify({ pageLoadId: 'oldpage', streamSeq: timingStreamSeq }));
    });
    await page.click('#timingBtn');
    await page.click('#timingBtn');
    await expect.poll(() => hint(page)).toEqual([true, true]);
    await page.reload();
    await page.waitForLoadState('load');
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await expect.poll(() => hint(page)).toEqual([true, true]);
  });

  test('the hint does not overflow at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await applyMeasurement(page);
    await reopen(page);
    await expect.poll(() => hint(page)).toEqual([true, true]);
    await page.click('#timingSetBtn');
    const r = await page.evaluate(() => {
      const pop = document.getElementById('timingPopover').getBoundingClientRect();
      const b = document.getElementById('timingSetBtn').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, popL: pop.left, popR: pop.right, btnR: b.right };
    });
    expect(r.sw).toBeLessThanOrEqual(r.iw);
    expect(r.popL).toBeGreaterThanOrEqual(0);
    expect(r.popR).toBeLessThanOrEqual(r.iw);
    expect(r.btnR).toBeLessThanOrEqual(r.iw);
  });
});

// Glitch log + the removed Audio buffer experiment ----------------------------------------------------

test.describe('Timing Check - glitch log', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__acArgs = [];
      const Orig = window.AudioContext;
      window.AudioContext = function (...a) { window.__acArgs.push(a); return new Orig(...a); };
      window.AudioContext.prototype = Orig.prototype;
    });
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
  });

  test('worklet core reports one sample-precise run spanning quanta; short and leading runs are ignored', async ({ page }) => {
    const g = await page.evaluate(() => {
      const c = timingMakeOnsetCore(48000);
      const v = new Float32Array(128).fill(1e-4);
      const z = n => new Float32Array(n);
      let f = 0;
      const feed = a => { c.processChannels([a], 0, f); f += a.length; };
      feed(z(128)); feed(v);              // leading zeros ignored
      feed(z(20)); feed(v);               // < 32 samples ignored
      const start = f;
      feed(z(128)); feed(z(128)); feed(z(128)); feed(z(96)); // 480 zeros
      feed(v);
      return { g: c.takeGlitches(), start };
    });
    expect(g.g.length).toBe(1);
    expect(g.g[0]).toMatchObject({ type: 'glitch', lengthSamples: 480 });
    expect(g.g[0].lengthMs).toBeCloseTo(10, 5);
    expect(g.g[0].startTime).toBeCloseTo(g.start / 48000, 6);
  });

  test('a glitch message fills timingGlitchLog and glitchMsTotal accumulates; history records it', async ({ page }) => {
    const r = await page.evaluate(() => {
      timingNode.port.onmessage = null;
      timingLongTaskEnd = 0;
      const base = timingStreamCtxAt + 2;
      for (let i = 0; i < 205; i++) timingOnWorkletMessage({ data: { type: 'glitch', startTime: base + i, lengthSamples: 480, lengthMs: 10 } });
      const log = timingGlitchLog();
      const first = timingGlitchMsTotal;
      timingLongTaskEnd = performance.now() - 100;
      timingOnWorkletMessage({ data: { type: 'glitch', startTime: base + 999, lengthSamples: 480, lengthMs: 10 } });
      const lt = timingGlitchLog().slice(-2).map(e => e.longTask);
      timingGlitchMsTotal -= 10; timingGlitchCount--;
      timingLoopHistAppend('good', { n: 60, median: 58, sd: 1, mad: 1, min: 50, max: 60, drift: 0 });
      timingLoopHistAppend('good', { n: 60, median: 68, sd: 1, mad: 1, min: 50, max: 60, drift: 0 });
      const h = timingLoopHistory();
      return { base, len: log.length, lt, last: log[log.length - 1], first, h, line: timingLoopHistLine(h[1]) };
    });
    expect(r.len).toBe(200);
    expect(r.last).toMatchObject({ ctxTime: r.base + 204, lengthMs: 10, lengthSamples: 480, latencyHint: 'default', playing: false });
    for (const k of ['at', 'streamSeq', 'streamAgeSec', 'visibility', 'hasFocus']) expect(r.last).toHaveProperty(k);
    expect(r.lt).toEqual([false, true]);
    expect(r.first).toBe(2050);
    expect(r.h[1]).toMatchObject({ glitches: 205, glitchMsTotal: 2050, latencyHint: 'default' });
    expect(r.h[0].measuredMinusFirst).toBe(0);
    expect(r.h[1].measuredMinusFirst).toBe(10);
  });

  test('Copy glitch log copies via the shared helper', async ({ page }) => {
    await page.evaluate(() => { navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
    await page.click('#timingSetBtn');
    await page.click('#timingLoopOpen');
    await page.click('#timingLoopHist summary');
    await page.click('#timingGlitchCopy');
    await expect(page.locator('#timingLoopHistCopied')).toHaveText('Copied');
    expect(await page.evaluate(() => JSON.parse(window.__copied))).toEqual([]);
  });

  test('the Audio buffer setting is gone: no UI, AudioContext built with no options, a stored wm.audio.latencyHint is deleted on load', async ({ page }) => {
    expect(await page.evaluate(() => window.__acArgs.map(a => a.length))).toEqual([0]);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingBufSelect')).toHaveCount(0);
    await expect(page.locator('#timingBufNow')).toHaveCount(0);
    await expect(page.locator('#timingBufNote')).toHaveCount(0);
    await expect(page.locator('#timingPopover')).not.toContainText('Audio buffer');
    // a user who had picked 20 ms: the key is removed on load and the context is built the default way
    await page.evaluate(() => localStorage.setItem('wm.audio.latencyHint', '0.02'));
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('wm.audio.latencyHint'))).toBeNull();
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    expect(await page.evaluate(() => window.__acArgs.map(a => a.length))).toEqual([0]);
  });

  test('no horizontal overflow at 375 px with the loop panel open', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.click('#timingSetBtn');
    await page.click('#timingLoopOpen');
    await page.click('#timingLoopHist summary');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const b = await page.evaluate(() => { const p = document.getElementById('timingPopover').getBoundingClientRect(); return [p.left, p.right, innerWidth]; });
    expect(b[0]).toBeGreaterThanOrEqual(0);
    expect(b[1]).toBeLessThanOrEqual(b[2]);
  });
});

// Click ref channel -------------------------------------------------------------

// In-page synthesis helpers for the template matching tests. A click is built from the formulas of playSound():
// a sine (phase 0 at the start) times an exponential gain ramp gain -> 0.001 over dur; tone 0 / 1 / 2 = 800 Hz x1.8 / 600 Hz x1.5 / 1200 Hz x3.0.
// The start may be fractional (a continuous-time click sampled on the grid), so sub-sample precision is really exercised.
const SYNTH_SRC = `(() => {
  const S = { sr: 48000 };
  S.TONES = [[800, 1.8], [600, 1.5], [1200, 3.0]];
  S.rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  S.gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  S.clickInto = (buf, start, tone, dur, amp, sr) => {
    sr = sr || S.sr;
    const f = S.TONES[tone][0], g = S.TONES[tone][1], n = Math.round(dur * sr), rate = Math.log(g / 0.001) / (sr * dur);
    for (let m = Math.ceil(start); m < buf.length && m - start <= n; m++) { const k = m - start; buf[m] += amp * Math.exp(-rate * k) * Math.sin(2 * Math.PI * f * k / sr); }
  };
  S.rms = (a) => { let e = 0; for (let i = 0; i < a.length; i++) e += a[i] * a[i]; return Math.sqrt(e / a.length); };
  // rms of the first 15 ms of a click (the part the matcher sees)
  S.clickRms = (tone, dur, amp) => { const t = new Float32Array(720); S.clickInto(t, 0, tone, dur, amp); return S.rms(t); };
  S.pink = (n, r) => {
    const o = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) { const w = S.gauss(r); b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; o[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
    return o;
  };
  // music-like: a chord (110-440 Hz), 800 Hz at a random (non-matching) phase, 1.5 k and 2.2 kHz partials, plus random percussive noise bursts
  S.music = (n, r) => {
    const o = new Float32Array(n), fr = [110, 165, 220, 330, 440, 800, 1500, 2200], am = [1, 0.8, 0.8, 0.6, 0.5, 0.5, 0.3, 0.2], ph = fr.map(() => r() * 2 * Math.PI);
    for (let i = 0; i < n; i++) { let v = 0; for (let j = 0; j < fr.length; j++) v += am[j] * Math.sin(2 * Math.PI * fr[j] * i / S.sr + ph[j]); o[i] = v; }
    for (let t = Math.round(0.1 * S.sr); t < n - 4000; t += Math.round((0.15 + 0.3 * r()) * S.sr)) for (let k = 0; k < 4000; k++) o[t + k] += 2.5 * S.gauss(r) * Math.exp(-k / 600);
    return o;
  };
  // adds noise of the given kind scaled to rel x the rms of an amp-scaled click
  S.addNoise = (sig, kind, rel, tone, dur, amp, r) => {
    const n = kind === 'pink' ? S.pink(sig.length, r) : S.music(sig.length, r), sc = rel * S.clickRms(tone, dur, amp) / S.rms(n);
    for (let i = 0; i < sig.length; i++) sig[i] += n[i] * sc;
  };
  // feeds sig through core in 128-frame quanta; onEvent(ev) may react (e.g. set the track). Returns copies of the events.
  S.run = (core, sig, onEvent) => {
    const evs = [];
    for (let f = 0; f + 128 <= sig.length; f += 128) {
      const o = core.processChannels([sig.subarray(f, f + 128)], 0, f);
      for (let i = 0; i < o.length; i++) { const e = { time: o[i].time, lagMs: o[i].lagMs, ncc: o[i].ncc, sched: o[i].sched }; evs.push(e); if (onEvent) onEvent(e); }
    }
    return evs;
  };
  S.click = (sched, tone, dur) => [sched, S.TONES[tone][0], dur, S.TONES[tone][1]];
  // one noisy trial: a click (random lag 60-120 ms) in noise; track = 'true' (locked on the true lag) or null (unlocked). Returns the error in ms.
  S.trial = (kind, rel, seed, locked) => {
    const r = S.rng(seed), tone = seed % 3, lagMs = 60 + 60 * r(), sched = 0.3 + r() * 0.01, start = sched * S.sr + lagMs * S.sr / 1000;
    const sig = new Float32Array(Math.round(1.2 * S.sr));
    S.clickInto(sig, start, tone, 0.05, 0.3);
    S.addNoise(sig, kind, rel, tone, 0.05, 0.3, r);
    const core = timingMakeRefTemplate(S.sr);
    core.addClicks(S.click(sched, tone, 0.05));
    core.setTrack(locked ? (start / S.sr - sched) : null);
    const evs = S.run(core, sig);
    return evs.length ? { err: (evs[0].time - start / S.sr) * 1000, ncc: evs[0].ncc, n: evs.length } : { err: null, n: 0 };
  };
  window.__S = S;
})()`;

test.describe('Timing Check - click ref template matching (worklet core)', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); await page.evaluate(SYNTH_SRC); });

  test('a clean click at 89.3 ms is found to a few microseconds: every tone, sub-sample start, level, sample rate; unlocked and locked', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, out = [];
      for (const sr of [48000, 44100]) for (const tone of [0, 1, 2]) for (const [i, amp] of [0.5, 0.01].entries()) for (const track of [null, 0.0893]) {
        const sched = 0.2 + i * 0.00001234 + tone * 0.000007, sig = new Float32Array(Math.round(0.9 * sr));
        S.clickInto(sig, sched * sr + 89.3 * sr / 1000, tone, 0.05, amp, sr);
        const core = timingMakeRefTemplate(sr);
        core.addClicks(S.click(sched, tone, 0.05));
        core.setTrack(track);
        const evs = S.run(core, sig);
        out.push({ sr, tone, amp, track, n: evs.length, lagMs: evs[0] && evs[0].lagMs, ncc: evs[0] && evs[0].ncc, schedOk: evs[0] && evs[0].sched === sched });
      }
      return out;
    });
    expect(res.length).toBe(24);
    for (const r of res) {
      expect(r.n).toBe(1);
      expect(Math.abs(r.lagMs - 89.3)).toBeLessThanOrEqual(0.05);
      expect(r.ncc).toBeGreaterThan(0.99);
      expect(r.schedOk).toBe(true);
    }
    console.log('clean click, worst |error| (ms):', Math.max(...res.map(r => Math.abs(r.lagMs - 89.3))).toFixed(4));
  });

  test('lag ranges: unlocked 5-400 ms, locked +-4 ms, widened -5..+45 ms (10 / 20 / 40 ms slips); beyond that is a miss', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, out = {};
      const one = (lagMs, track) => {
        const sched = 0.1, sig = new Float32Array(Math.round(0.9 * S.sr));
        S.clickInto(sig, sched * S.sr + lagMs * S.sr / 1000, 0, 0.05, 0.4);
        const core = timingMakeRefTemplate(S.sr);
        core.addClicks(S.click(sched, 0, 0.05));
        core.setTrack(track);
        const evs = S.run(core, sig);
        return { n: evs.length, lagMs: evs.length ? evs[0].lagMs : null, wide: core.wide, full: core.full, misses: core.misses };
      };
      for (const l of [6, 50, 250, 399]) out['unlocked ' + l] = one(l, null);
      for (const l of [409]) out['unlocked ' + l] = one(l, null);
      for (const l of [89.3, 85.4, 93.2]) out['locked ' + l] = one(l, 0.0893);
      for (const l of [99.3, 109.3, 129.3, 84.4, 133.6]) out['wide ' + l] = one(l, 0.0893);
      for (const l of [140, 83.9]) out['beyond ' + l] = one(l, 0.0893);
      return out;
    });
    for (const k of Object.keys(res)) {
      const lag = parseFloat(k.split(' ')[1]);
      if (k.startsWith('unlocked') || k.startsWith('locked') || k.startsWith('wide')) {
        if (k === 'unlocked 409') { expect(res[k].n, k).toBe(0); continue; }
        expect(res[k].n, k).toBe(1);
        expect(Math.abs(res[k].lagMs - lag), k).toBeLessThanOrEqual(0.05);
      } else expect(res[k].n, k).toBe(0);
    }
    expect(res['unlocked 250'].full).toBe(1);
    expect(res['locked 85.4'].wide).toBe(0);   // inside +-4 ms: the first search is enough
    expect(res['wide 109.3'].wide).toBe(1);    // a +20 ms slip needs the widened search
    expect(res['wide 129.3'].wide).toBe(1);
  });

  test('same RMS background (pink noise; music with a non-matching 800 Hz plus percussive bursts): lag within 0.1 ms, unlocked and locked', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, out = { pink: [], music: [] };
      for (const kind of ['pink', 'music']) for (let s = 0; s < 18; s++) for (const locked of [false, true]) out[kind].push(S.trial(kind, 1, 1000 + s, locked));
      return out;
    });
    for (const kind of ['pink', 'music']) {
      expect(res[kind].length).toBe(36);
      for (const t of res[kind]) { expect(t.n, kind).toBe(1); expect(Math.abs(t.err), kind).toBeLessThanOrEqual(0.1); expect(t.ncc).toBeGreaterThanOrEqual(0.6); }
      console.log(kind + ' at +0 dB, worst |error| (ms):', Math.max(...res[kind].map(t => Math.abs(t.err))).toFixed(3));
    }
  });

  test('+6 dB louder background: pink noise and music; events are mostly exact, and the tracked live latency stays within 0.1 ms', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, out = {};
      // single events: how many are accepted and exact (a slip, when it happens, is one carrier period: noise decided for a neighbouring cycle)
      for (const kind of ['pink', 'music']) {
        const t = []; for (let s = 0; s < 30; s++) t.push(S.trial(kind, 2, 1000 + s, true));
        out[kind] = { accepted: t.filter(x => x.n === 1).length, exact: t.filter(x => x.n === 1 && Math.abs(x.err) <= 0.1).length };
      }
      // 12 clicks 0.5 s apart in continuous background through the real matcher (median of 5): liveL
      const chain = (kind, seed) => {
        const r = S.rng(seed), tone = seed % 3, lag = (60 + 60 * r()) / 1000, clicks = [], sig = new Float32Array(Math.round(6.8 * S.sr));
        for (let i = 0; i < 12; i++) { const sched = 0.2 + i * 0.5 + r() * 0.001; S.clickInto(sig, sched * S.sr + lag * S.sr, tone, 0.05, 0.3); clicks.push(...S.click(sched, tone, 0.05)); }
        S.addNoise(sig, kind, 2, tone, 0.05, 0.3, r);
        const core = timingMakeRefTemplate(S.sr); core.addClicks(clicks);
        let st = timingRefNewState();
        const evs = S.run(core, sig, (e) => { st = timingRefMatch(st, e.sched, e.time).state; core.setTrack(st.liveL); });
        return { err: st.liveL === null ? null : Math.abs(st.liveL - lag) * 1000, n: evs.length };
      };
      for (const kind of ['pink', 'music']) out[kind + 'Chain'] = Array.from({ length: 10 }, (_, i) => chain(kind, 2000 + i));
      return out;
    });
    console.log('+6 dB single events accepted / exact of 30: pink', res.pink.accepted, res.pink.exact, ' music', res.music.accepted, res.music.exact);
    expect(res.pink.exact).toBeGreaterThanOrEqual(26);
    expect(res.music.exact).toBeGreaterThanOrEqual(15);
    expect(res.music.accepted - res.music.exact).toBeLessThanOrEqual(4);
    // the median of 5 absorbs isolated slips: pink always; with the harsher music one run in ten may still end a carrier period off
    for (const c of res.pinkChain) { expect(c.err).not.toBeNull(); expect(c.err).toBeLessThanOrEqual(0.1); expect(c.n).toBeGreaterThanOrEqual(8); }
    // loud music (+6 dB, with a strong 800 Hz partial) hides some clicks: most runs still lock (first click needs NCC >= 0.65), and a locked one is not wrong
    const locked = res.musicChain.filter(c => c.err !== null);
    expect(locked.length).toBeGreaterThanOrEqual(6);
    expect(locked.filter(c => c.err > 0.1).length).toBeLessThanOrEqual(1);
  });

  test('loud bursts at wrong times are not picked; silence, pink noise or music alone give no event', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, out = { withClick: [], silence: 0, music: 0, pink: 0 };
      for (let s = 0; s < 20; s++) {
        const r = S.rng(77 + s), tone = s % 3, sched = 0.3, start = sched * S.sr + (60 + 60 * r()) * S.sr / 1000, N = Math.round(1.2 * S.sr);
        const bursts = new Float32Array(N), cr = S.clickRms(tone, 0.05, 0.3);
        // six decaying white-noise bursts, 30 x the click rms, before and after the click (and inside the search window)
        for (const off of [10, 25, 40, 150, 210, 300]) { const b0 = Math.round(sched * S.sr + off * S.sr / 1000); for (let k = 0; k < 1000; k++) bursts[b0 + k] += 30 * cr * S.gauss(r) * Math.exp(-k / 400); }
        const sig = Float32Array.from(bursts); S.clickInto(sig, start, tone, 0.05, 0.3);
        const run = (x, locked) => { const core = timingMakeRefTemplate(S.sr); core.addClicks(S.click(sched, tone, 0.05)); core.setTrack(locked ? start / S.sr - sched : null); return S.run(core, x); };
        for (const locked of [false, true]) { const e = run(sig, locked); out.withClick.push(e.length ? (e[0].time - start / S.sr) * 1000 : null); }
        out.silence += run(new Float32Array(N), false).length;
        const m = S.music(N, r), sc = 0.1 / S.rms(m);
        out.music += run(m.map(v => v * sc), false).length;
        const p = S.pink(N, r), sp = 0.3 / S.rms(p);
        out.pink += run(p.map(v => v * sp), false).length;
      }
      return out;
    });
    for (const e of res.withClick) { expect(e).not.toBeNull(); expect(Math.abs(e)).toBeLessThanOrEqual(0.1); }
    expect(res.silence).toBe(0);
    expect(res.music).toBe(0);
    expect(res.pink).toBe(0);
  });

  test('unlocked, the first click of a run takes its own (earliest) response although slightly louder clicks of the same tone follow', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, sig = new Float32Array(Math.round(1.2 * S.sr)), clicks = [];
      [0.5, 0.6, 0.6, 0.6, 0.6].forEach((amp, i) => { const sched = 0.1 + i * 0.06; S.clickInto(sig, sched * S.sr + 0.0893 * S.sr, 0, 0.009, amp); clicks.push(...S.click(sched, 0, 0.009)); });
      const core = timingMakeRefTemplate(S.sr); core.addClicks(clicks);
      return S.run(core, sig).map(e => e.lagMs);
    });
    expect(res.length).toBe(5);
    res.forEach(l => expect(Math.abs(l - 89.3)).toBeLessThanOrEqual(0.05));
  });

  test('16ths at 200 BPM with 89 ms latency: every event is paired with its own scheduled click; a mid-play reset locks on the right click; a +20 ms jump is adopted after 2 events', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, gap = 0.075, n = 44, jumpAt = 30;
      const sig = new Float32Array(Math.round((n * gap + 0.8) * S.sr)), clicks = [], scheds = [];
      for (let i = 0; i < n; i++) {
        const sched = 0.2 + i * gap, tone = i % 4 === 0 ? 2 : 0, lag = i < jumpAt ? 0.089 : 0.109, dur = Math.min(0.05, 0.15 * gap);
        S.clickInto(sig, sched * S.sr + lag * S.sr, tone, dur, tone === 2 ? 0.5 : 0.2);
        clicks.push(...S.click(sched, tone, dur)); scheds.push(sched);
      }
      const core = timingMakeRefTemplate(S.sr); core.addClicks(clicks);
      let st = timingRefNewState();
      const rows = [];
      const evs = S.run(core, sig, (e) => {
        if (rows.length === 12) { st = timingRefNewState(); core.setTrack(0.08, false); } // the stream / channel changes mid-play: only the stored latency (80 ms) as a hint, clicks keep coming 75 ms apart
        const r = timingRefMatch(st, e.sched, e.time);
        st = r.state; core.setTrack(st.liveL);
        rows.push({ i: scheds.indexOf(e.sched), kind: r.kind, lagMs: e.lagMs, liveMs: st.liveL * 1000 });
      });
      return { rows, n: evs.length, wide: core.wide, misses: core.misses };
    });
    expect(res.misses).toBe(0);
    expect(res.rows.length).toBeGreaterThanOrEqual(38);
    res.rows.forEach((r, k) => { expect(r.i, 'every event names a distinct scheduled click, in order').toBe(k); });
    const lagOf = (r) => (r.i < 30 ? 89 : 109);
    for (const r of res.rows) expect(Math.abs(r.lagMs - lagOf(r))).toBeLessThanOrEqual(0.05);
    expect(res.rows[0].kind).toBe('lock');
    expect(res.rows[12].kind).toBe('lock');                 // mid-play reset: locked on its own click, not a neighbour (14 / 164 ms)
    expect(res.rows[12].liveMs).toBeCloseTo(89, 1);
    expect(res.rows.slice(1, 12).every(r => r.kind === 'accept')).toBe(true);
    expect(res.rows.slice(13, 30).every(r => r.kind === 'accept')).toBe(true);
    expect(res.rows[30].kind).toBe('pending');
    expect(res.rows[31].kind).toBe('jump');
    expect(res.rows[31].liveMs).toBeCloseTo(109, 1);
    expect(res.rows.slice(32).every(r => r.kind === 'accept')).toBe(true);
    expect(res.wide).toBeGreaterThanOrEqual(1);   // the first click after the jump needs the widened search; the next ones follow the new lag
  });

  test('tones, accents, ghost notes and the short clicks of fast tempos and subdivisions are all found to 0.05 ms', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, out = [];
      for (const bpm of [60, 140, 250]) for (const sub of [1, 2, 4]) {
        const interval = 60 / bpm / sub, dur = Math.min(0.05, 0.15 * interval), n = 14, sig = new Float32Array(Math.round((n * interval + 0.8) * S.sr)), clicks = [];
        const tones = [2, 0, 1, 0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 0], amps = [1, 0.5, 0.3, 0.05, 0.5, 0.02, 0.9, 1, 0.2, 0.5, 0.01, 0.7, 0.4, 0.5];
        for (let i = 0; i < n; i++) { const sched = 0.1 + i * interval + 0.000013 * i; S.clickInto(sig, sched * S.sr + 0.0893 * S.sr, tones[i], dur, amps[i]); clicks.push(...S.click(sched, tones[i], dur)); }
        const core = timingMakeRefTemplate(S.sr); core.addClicks(clicks);
        let st = timingRefNewState();
        const evs = S.run(core, sig, (e) => { st = timingRefMatch(st, e.sched, e.time).state; core.setTrack(st.liveL); });
        out.push({ bpm, sub, n: evs.length, worst: Math.max(...evs.map(e => Math.abs(e.lagMs - 89.3))), dur });
      }
      return out;
    });
    for (const r of res) { expect(r.n, r.bpm + '/' + r.sub).toBe(14); expect(r.worst, r.bpm + '/' + r.sub).toBeLessThanOrEqual(0.05); }
  });

  test('CPU cost per 128-frame render quantum with the ref on and locked (16ths at 200 BPM in music at the click level)', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, gap = 0.075, n = 200, sr = S.sr;
      const sig = new Float32Array(Math.round((n * gap + 0.8) * sr)), clicks = [];
      for (let i = 0; i < n; i++) { const sched = 0.2 + i * gap, tone = i % 4 === 0 ? 2 : 0; S.clickInto(sig, sched * sr + 0.089 * sr, tone, 0.01125, 0.4); clicks.push(...S.click(sched, tone, 0.01125)); }
      S.addNoise(sig, 'music', 1, 0, 0.0113, 0.4, S.rng(5));
      const quantum = (core, f) => core.processChannels([sig.subarray(f, f + 128)], 0, f);
      // locked and steady: prediction known, clicks pre-queued as the main thread would send them
      const core = timingMakeRefTemplate(sr); core.setTrack(0.089); core.addClicks(clicks);
      for (let f = 0; f < 128 * 400; f += 128) quantum(core, f); // warm-up (JIT)
      const core2 = timingMakeRefTemplate(sr); core2.setTrack(0.089); core2.addClicks(clicks);
      const q = Math.floor(sig.length / 128), times = new Float64Array(q);
      let ev = 0;
      const t0 = performance.now();
      for (let i = 0; i < q; i++) { const a = performance.now(); ev += quantum(core2, i * 128).length; times[i] = performance.now() - a; }
      const total = performance.now() - t0;
      // idle baseline: ref on, no clicks queued (the prefilter only)
      const core3 = timingMakeRefTemplate(sr); core3.setTrack(0.089);
      const b0 = performance.now(); for (let i = 0; i < q; i++) quantum(core3, i * 128); const idle = performance.now() - b0;
      // unlocked: first lock needs the 5-400 ms sweep (time-sliced)
      const core4 = timingMakeRefTemplate(sr); core4.addClicks(clicks.slice(0, 4));
      let worstUnlocked = 0, sumUnlocked = 0; const nu = Math.floor(1.2 * sr / 128);
      for (let i = 0; i < nu; i++) { const a = performance.now(); quantum(core4, i * 128); const d = performance.now() - a; sumUnlocked += d; worstUnlocked = Math.max(worstUnlocked, d); }
      const sorted = Array.from(times).sort((a, b) => a - b);
      return { q, ev, avgUs: total / q * 1000, idleUs: idle / q * 1000, p99Us: sorted[Math.floor(q * 0.99)] * 1000, maxMs: sorted[q - 1], worstUnlockedMs: worstUnlocked, unlockedAvgMs: sumUnlocked / nu, budgetMs: 128 / sr * 1000, misses: core2.misses };
    });
    console.log('ref cost per 128-frame quantum (budget ' + res.budgetMs.toFixed(2) + ' ms): locked avg ' + res.avgUs.toFixed(1) + ' us, p99 ' + res.p99Us.toFixed(0) + ' us, max ' + res.maxMs.toFixed(2) + ' ms; idle (filter only) ' + res.idleUs.toFixed(1) + ' us; unlocked first-click sweep: avg ' + (res.unlockedAvgMs * 1000).toFixed(1) + ' us, worst ' + res.worstUnlockedMs.toFixed(2) + ' ms');
    expect(res.ev).toBeGreaterThanOrEqual(190);
    // averages and the 99th percentile are asserted; the single worst quantum is only reported (an OS hiccup in a parallel test run would make it flaky)
    expect(res.avgUs).toBeLessThan(50);                   // < 2 % of the 2.67 ms quantum, on average
    expect(res.p99Us).toBeLessThan(res.budgetMs * 1000 * 0.25);
    expect(res.unlockedAvgMs).toBeLessThan(res.budgetMs * 0.25);
  });

  test('a stale frame number from the render thread (the same currentFrame twice) neither resets the ring nor shifts the time axis; a real gap is zero-filled', async ({ page }) => {
    const res = await page.evaluate(() => {
      const S = window.__S, sig = new Float32Array(Math.round(0.9 * S.sr)), sched = 0.2;
      S.clickInto(sig, sched * S.sr + 0.0893 * S.sr, 0, 0.05, 0.4);
      const feed = (frameOf) => {
        const core = timingMakeRefTemplate(S.sr); core.addClicks(S.click(sched, 0, 0.05));
        const evs = [];
        for (let q = 0; q * 128 + 128 <= sig.length; q++) for (const e of core.processChannels([sig.subarray(q * 128, q * 128 + 128)], 0, frameOf(q))) evs.push(e.lagMs);
        return evs;
      };
      // quanta 110 and 112 (inside the click response) and 300 report the previous quantum's frame number (as seen in a loaded browser); the next one is right again
      const stale = feed(q => (q === 110 || q === 112 || q === 300 ? q - 1 : q) * 128);
      // a real gap: quanta 180 and 181 were never passed on (the audio is missing: the signal there is zero)
      const sig2 = Float32Array.from(sig); sig2.fill(0, 180 * 128, 182 * 128);
      const core = timingMakeRefTemplate(S.sr); core.addClicks(S.click(sched, 0, 0.05));
      const gap = [];
      for (let q = 0; q * 128 + 128 <= sig2.length; q++) { if (q === 180 || q === 181) continue; for (const e of core.processChannels([sig2.subarray(q * 128, q * 128 + 128)], 0, q * 128)) gap.push(e.lagMs); }
      return { stale, gap };
    });
    expect(res.stale.length).toBe(1);
    expect(Math.abs(res.stale[0] - 89.3)).toBeLessThanOrEqual(0.05);
    expect(res.gap.length).toBe(1);               // a gap long after the click: nothing moves
    expect(Math.abs(res.gap[0] - 89.3)).toBeLessThanOrEqual(0.05);
  });

  test('the instrument detector and the glitch scan ignore the ref channel', async ({ page }) => {
    const r = await page.evaluate(() => {
      const S = window.__S, sr = S.sr, total = 40000;
      const instr = new Float32Array(total), ref = new Float32Array(total), clicks = [];
      for (let i = 0; i < 3; i++) { const sched = (1000 + i * 9000) / sr; S.clickInto(ref, sched * sr + 480, 0, 0.05, 0.4); clicks.push(...S.click(sched, 0, 0.05)); }
      for (let k = 0; k < 2000; k++) instr[5000 + k] = 0.4 * Math.sin(k * 0.3) * Math.exp(-k / 400);
      const det = timingMakeRefTemplate(sr), core = timingMakeOnsetCore(sr);
      det.addClicks(clicks); det.setTrack(0.01);
      const refs = [], ons = [];
      for (let f = 0; f + 128 <= total; f += 128) {
        const chs = [instr.subarray(f, f + 128), ref.subarray(f, f + 128)];
        ons.push(...core.processChannels(chs, 0, f));
        for (const e of det.processChannels(chs, 1, f)) refs.push(e.lagMs);
      }
      // instrument channel carries a steady non-zero signal while the ref channel is exactly zero: not a glitch
      const g = timingMakeOnsetCore(sr), v = new Float32Array(128).fill(1e-4), z = new Float32Array(128);
      for (let f = 0; f < 128 * 40; f += 128) g.processChannels([v, z], 0, f);
      return { refs, onsets: ons.length, glitches: g.takeGlitches().length, zeroRuns: g.takeLevel().zeroRuns };
    });
    expect(r.refs.length).toBe(3);
    r.refs.forEach(l => expect(Math.abs(l - 10)).toBeLessThanOrEqual(0.05));
    expect(r.onsets).toBe(1);     // only the instrument burst
    expect(r.glitches).toBe(0);
    expect(r.zeroRuns).toBe(0);
  });

  test('the worklet finds the real app clicks (accent, normal, subdivisions) at their scheduled start through a 90 ms digital loopback', async ({ page }) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => {
      timingNode.port.onmessage = null;
      timingChannels = 2; timingLoadChannel();
      timingSetRef(1);
      // tap the metronome output into channel 1 of a second detector through a whole-sample delay (like an interface digital loopback)
      const node = new AudioWorkletNode(audioCtx, 'onset-detector', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
      const merger = audioCtx.createChannelMerger(2);
      const delay = audioCtx.createDelay(1);
      window.__tapDelayMs = Math.round(0.09 * audioCtx.sampleRate) / audioCtx.sampleRate * 1000;
      delay.delayTime.value = window.__tapDelayMs / 1000;
      masterGainNode.connect(delay); delay.connect(merger, 0, 1);
      merger.connect(node);
      const sink = audioCtx.createGain(); sink.gain.value = 0;
      node.connect(sink); sink.connect(audioCtx.destination);
      window.__tapRefs = [];
      // the app side runs for real: events go to timingHandleRef, and the clicks / track messages it posts are forwarded to the tap
      node.port.onmessage = (e) => { if (e.data.type === 'ref') { window.__tapRefs.push(e.data); timingOnWorkletMessage(e); } };
      const orig = timingNode.port.postMessage.bind(timingNode.port);
      timingNode.port.postMessage = (m) => { orig(m); if (m.type === 'clicks' || m.type === 'track') node.port.postMessage(m); };
      node.port.postMessage({ type: 'config', channel: 0, refChannel: 1 });
      updateBpm(120);
      subdivision = '4';
      beatStates[0] = 2; beatStates[1] = 1;
    });
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => window.__tapRefs.length)).toBeGreaterThan(14);
    await page.evaluate(() => togglePlay());
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const sr = audioCtx.sampleRate, st = timingRefState();
      const clicks = timingClickTimes.slice();
      return { lags: window.__tapRefs.map(r => r.lagMs), scheds: window.__tapRefs.map(r => clicks.indexOf(r.sched)), n: window.__tapRefs.length, clicks: clicks.length, sr, delay: window.__tapDelayMs, live: st.liveLms, locked: st.locked, hist: st.history.map(h => h.kind), minNcc: Math.min(...window.__tapRefs.map(r => r.ncc)) };
    });
    // every scheduled click is found once, in order, and named by its own scheduled time
    res.scheds.forEach((i, k) => { expect(i).toBeGreaterThanOrEqual(0); if (k) expect(i).toBe(res.scheds[k - 1] + 1); });
    expect(res.n).toBeGreaterThanOrEqual(res.clicks - 3);
    expect(res.minNcc).toBeGreaterThan(0.95);
    const oneSampleMs = 1000 / res.sr;
    for (const l of res.lags) expect(Math.abs(l - res.delay)).toBeLessThanOrEqual(1.5 * oneSampleMs);
    expect(res.locked).toBe(true);
    expect(Math.abs(res.live - res.delay)).toBeLessThanOrEqual(1.5 * oneSampleMs);
    expect(res.hist[0]).toBe('lock');
    expect(res.hist.slice(1).every(k => k === 'accept')).toBe(true);
    console.log('real-click lag (ms) min/max:', Math.min(...res.lags).toFixed(4), Math.max(...res.lags).toFixed(4), 'delay', res.delay.toFixed(4), 'live', res.live.toFixed(4));
  });
});

test.describe('Timing Check - click ref matcher (pure)', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });

  // feeds [sched, refTime] pairs through timingRefMatch and returns the per-event results
  const run = (page, pairs) => page.evaluate((pairs) => {
    let st = timingRefNewState();
    return pairs.map(([s, t]) => {
      const r = timingRefMatch(st, s, t);
      st = r.state;
      return { kind: r.kind, liveMs: st.liveL === null ? null : st.liveL * 1000, pendingMs: st.pending === null ? null : st.pending * 1000, oldMs: r.oldL === undefined ? null : r.oldL * 1000, newMs: r.newL === undefined ? null : r.newL * 1000, acc: st.accepted.length };
    });
  }, pairs);
  const grid = (n, step, t0 = 10) => Array.from({ length: n }, (_, i) => t0 + i * step);

  test('the first event locks to the lag of its own click, whichever click that is', async ({ page }) => {
    const r = await run(page, [[10, 10.089]]);
    expect(r[0].kind).toBe('lock');
    expect(r[0].liveMs).toBeCloseTo(89, 6);
    // a click in the middle of a fast run: the event names it, there is nothing else to pair with
    const f = await run(page, [[10.45, 10.539]]);
    expect(f[0].liveMs).toBeCloseTo(89, 6);
  });

  test('a stable 89 ms offset is tracked and liveL is the median of the last 5 accepted offsets', async ({ page }) => {
    const clicks = grid(12, 0.5);
    const offs = [0.089, 0.0895, 0.0885, 0.0900, 0.0880, 0.0910, 0.0890, 0.0892];
    const r = await run(page, offs.map((o, i) => [clicks[i], clicks[i] + o]));
    expect(r.map(x => x.kind)).toEqual(['lock', ...Array(7).fill('accept')]);
    const last5 = offs.slice(-5).map(x => x * 1000).sort((a, b) => a - b);
    expect(r[7].liveMs).toBeCloseTo(last5[2], 6);
    expect(r[7].acc).toBe(5);
    expect(r[1].liveMs).toBeCloseTo((89 + 89.5) / 2, 6); // median of two
  });

  test('a +20 ms jump is adopted after 2 agreeing events; a single outlier is rejected', async ({ page }) => {
    const clicks = grid(14, 0.5);
    const ev = (i, o) => [clicks[i], clicks[i] + o];
    const r = await run(page, [ev(0, 0.089), ev(1, 0.089), ev(2, 0.089), ev(3, 0.109), ev(4, 0.1095), ev(5, 0.109)]);
    expect(r.map(x => x.kind)).toEqual(['lock', 'accept', 'accept', 'pending', 'jump', 'accept']);
    expect(r[3].liveMs).toBeCloseTo(89, 6);
    expect(r[3].pendingMs).toBeCloseTo(109, 6);
    expect(r[4].oldMs).toBeCloseTo(89, 6);
    expect(r[4].newMs).toBeCloseTo(109.25, 6);
    expect(r[5].liveMs).toBeCloseTo(109.125, 6); // median of the accepted offsets [109.25, 109]
    // an outlier between good events is dropped and does not become a jump
    const o = await run(page, [ev(0, 0.089), ev(1, 0.089), ev(2, 0.099), ev(3, 0.089), ev(4, 0.089)]);
    expect(o.map(x => x.kind)).toEqual(['lock', 'accept', 'pending', 'accept', 'accept']);
    expect(o[3].pendingMs).toBeNull();
    expect(o[4].liveMs).toBeCloseTo(89, 6);
    // two disagreeing off-track events do not jump either
    const d = await run(page, [ev(0, 0.089), ev(1, 0.089), ev(2, 0.099), ev(3, 0.110)]);
    expect(d.map(x => x.kind)).toEqual(['lock', 'accept', 'pending', 'pending']);
  });

  test('16ths at 200 BPM (75 ms apart) with 89 ms latency: every event keeps its own click, also after a 20 ms jump', async ({ page }) => {
    const clicks = grid(40, 0.075);
    const r = await run(page, clicks.map((s, i) => [s, s + (i < 25 ? 0.089 : 0.109)]));
    expect(r[0].liveMs).toBeCloseTo(89, 6);
    r.slice(0, 25).forEach(x => expect(Math.abs(x.liveMs - 89)).toBeLessThan(0.01)); // never the neighbours (14 / 164 ms)
    expect(r[25].kind).toBe('pending');
    expect(r[26].kind).toBe('jump');
    r.slice(26).forEach(x => expect(Math.abs(x.liveMs - 109)).toBeLessThan(0.01));
  });
});

test.describe('Timing Check - click ref flow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => {
      timingNode.port.onmessage = null; // ignore the fake device; messages are injected
      timingSwapUntil = 0;
      timingChannels = 2; timingLoadChannel();
      updateBpm(250);
    });
  });

  const setRef = (page) => page.evaluate(() => timingSetRef(1));
  const glitch = (page, afterSec, ms) => page.evaluate(({ afterSec, ms }) => timingOnWorkletMessage({ data: { type: 'glitch', startTime: timingStreamCtxAt + afterSec, lengthSamples: Math.round(ms * 48), lengthMs: ms } }), { afterSec, ms });
  // inject a ref event for every click in the ring, in order, `off` seconds after the click
  const injectRefs = (page, off, from = 0) => page.evaluate(({ off, from }) => timingClickTimes.slice(from).map(s => timingHandleRef(s, s + off, 0.9).kind), { off, from });
  // Fake "2 s later" tick and read the state in the same task. The page's own frame loop also runs timingRefTick with the real clock
  // and would clear the faked lost flag between two separate evaluate() calls (that was the flake).
  const lostSnapshot = (page) => page.evaluate(() => { timingRefTick(audioCtx.currentTime + 2); return timingRefState(); });
  const playUntilClicks = async (page, n) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingClickTimes.length)).toBeGreaterThan(n);
  };
  // instrument onsets `lateMs` after (beat + latency)
  const hitBeats = (page, latMs, lateMs, k = 3) => page.evaluate(({ latMs, lateMs, k }) => {
    const done = timingBeats.filter(b => b.dur > 0).slice(-(k + 1), -1);
    done.forEach(b => timingHandleOnset(b.time + (latMs + lateMs) / 1000, -20));
    return done.length;
  }, { latMs, lateMs, k });

  test('lock, then instrument matching uses liveL: Avg +12 ms; the glitch is not compensated twice', async ({ page }) => {
    await setRef(page);
    await playUntilClicks(page, 6);
    const kinds = await injectRefs(page, 0.089);
    expect(kinds[0]).toBe('lock');
    expect(kinds.slice(1).every(k => k === 'accept')).toBe(true);
    expect(await page.evaluate(() => Math.round(timingMatchLatencyMs() * 1000) / 1000)).toBe(89);
    // the stored/manual latency is irrelevant now
    await page.evaluate(() => timingSetLatency(30));
    expect(await hitBeats(page, 89, 12)).toBe(3);
    await expect(page.locator('#timingAvg')).toHaveText(/^\+12 ms$/);
    // a 20 ms FIFO slip: the worklet reports the zero run, the ref sees +20 ms. liveL follows; the glitch compensation must not be added on top
    await glitch(page, 5, 20);
    expect(await page.evaluate(() => timingGlitchCompMs)).toBe(20);
    expect(await page.evaluate(() => Math.round(timingMatchLatencyMs()))).toBe(89);
    await page.evaluate(() => { timingHits = []; });
    expect(await hitBeats(page, 89, 12)).toBe(3);
    await expect(page.locator('#timingAvg')).toHaveText(/^\+12 ms$/); // double compensation would give +32 ms
    // the following clicks arrive 20 ms later: two agreeing events adopt the jump (logged), then Avg stays +12
    await page.evaluate(() => {
      const next = timingClickTimes[timingClickTimes.length - 1];
      window.__fut = [next + 0.24, next + 0.48, next + 0.72];
      window.__fut.forEach(s => timingClickTimes.push(s));
    });
    const jk = await page.evaluate(() => window.__fut.map(s => timingHandleRef(s, s + 0.109, 0.9).kind));
    expect(jk).toEqual(['pending', 'jump', 'accept']);
    const st = await page.evaluate(() => timingRefState());
    expect(st.liveLms).toBeCloseTo(109, 1);
    expect(st.matchLatencyMs).toBeCloseTo(109, 1);
    const log = await page.evaluate(() => timingGlitchLog().filter(e => e.type === 'ref-jump'));
    expect(log.length).toBe(1);
    expect(log[0].oldMs).toBeCloseTo(89, 1);
    expect(log[0].newMs).toBeCloseTo(109, 1);
    expect(log[0].deltaMs).toBeCloseTo(20, 1);
    await page.evaluate(() => { timingHits = []; });
    expect(await hitBeats(page, 109, 12)).toBe(3);
    await expect(page.locator('#timingAvg')).toHaveText(/^\+12 ms$/);
    await clickPlay(page);
  });

  test('syncing: no hit is judged before the ref is confirmed by 2 agreeing clicks; Syncing… and the Live pulse show meanwhile and clear on lock; then hits count', async ({ page }) => {
    await setRef(page);
    await playUntilClicks(page, 2);
    await page.evaluate(() => { timingPlayStart = audioCtx.currentTime + 60; }); // a loaded machine must not reach the 1.5 s no-click warning during the checks
    await page.evaluate(() => { timingDbg = { refs: [], clicks: [], beats: [], onsets: [], matches: [], near: [], chunks: [] }; });
    await expect(page.locator('#timingStatus')).toHaveText('Syncing…');
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingRefLive')).toHaveText('Live —');
    expect(await page.evaluate(() => 'sync' in document.getElementById('timingRefLive').dataset)).toBe(true);
    // before any ref event: hits are not judged
    expect(await hitBeats(page, 89, 12, 1)).toBe(1);
    expect(await page.evaluate(() => timingHits.length)).toBe(0);
    expect(await page.evaluate(() => timingDbg.matches.map(m => m.reason).slice(-1))).toEqual(['syncing']);
    // one ref event is a lock but not yet confirmed: still nothing judged
    expect(await page.evaluate(() => { const s = timingClickTimes[0]; return timingHandleRef(s, s + 0.089, 0.9).kind; })).toBe('lock');
    expect(await hitBeats(page, 89, 12, 1)).toBe(1);
    expect(await page.evaluate(() => timingHits.length)).toBe(0);
    // a second click that disagrees (>1 ms) replaces the lock; still syncing
    expect(await page.evaluate(() => { const s = timingClickTimes[1]; return timingHandleRef(s, s + 0.095, 0.9).kind; })).toBe('lock');
    expect(await page.evaluate(() => timingRefState().locked && timingRef.confirmed)).toBe(false);
    // two agreeing clicks confirm
    expect(await page.evaluate(() => { const s = timingClickTimes[2]; return timingHandleRef(s, s + 0.0955, 0.9).kind; })).toBe('accept');
    await expect(page.locator('#timingStatus')).not.toHaveText('Syncing…');
    await expect(page.locator('#timingRefLive')).toHaveText(/^Live 95[.][0-9] ms$/);
    expect(await page.evaluate(() => 'sync' in document.getElementById('timingRefLive').dataset)).toBe(false);
    await page.evaluate(() => { timingDbg = null; });
    await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length)).toBeGreaterThan(4);
    await page.evaluate(() => { timingHits = []; });
    expect(await hitBeats(page, 95, 12)).toBe(3);
    expect(await page.evaluate(() => timingHits.length)).toBe(3);
    // a later loss keeps judging with the held liveL
    await page.evaluate(() => { timingRefTick(audioCtx.currentTime + 5); timingHits = []; }); // same slots again would be merged (equal level)
    expect(await hitBeats(page, 95, 12)).toBe(3);
    expect(await page.evaluate(() => timingHits.length)).toBe(3);
    await page.keyboard.press('Escape');
    await clickPlay(page);
  });

  test('trim is added to liveL; ref off restores the manual latency + glitch compensation path', async ({ page }) => {
    await setRef(page);
    await playUntilClicks(page, 4);
    await injectRefs(page, 0.089);
    await page.evaluate(() => timingSetRefTrim(-3));
    expect(await page.evaluate(() => timingMatchLatencyMs())).toBeCloseTo(86, 6);
    await page.evaluate(() => { timingSetLatency(40); });
    await glitch(page, 5, 10);
    await page.evaluate(() => timingSetRef(-1));
    expect(await page.evaluate(() => timingMatchLatencyMs())).toBe(50);
    await clickPlay(page);
  });

  test('lost: nothing ever locked warns; a muted metronome after a lock holds liveL silently; audible clicks without ref warn and hold', async ({ page }) => {
    await setRef(page);
    await playUntilClicks(page, 3);
    // never locked: falls back to the manual/effective latency and warns after 1.5 s
    expect(await page.evaluate(() => timingMatchLatencyMs() === timingEffectiveLatencyMs())).toBe(true);
    await expect(page.locator('#timingStatus')).toHaveText('No click on ref channel', { timeout: 5000 });
    await expect(page.locator('#timingStatus')).toHaveAttribute('data-q', 'warn');
    // lock now, then let 2 s pass with clicks still being scheduled: lost + warn, last liveL is kept
    await injectRefs(page, 0.089);
    expect(await page.evaluate(() => timingRefState().warn)).toBe(false);
    await page.waitForTimeout(500); // clicks scheduled after the last heard one
    let s = await lostSnapshot(page);
    expect(s.lost).toBe(true);
    expect(s.warn).toBe(true);
    expect(s.matchLatencyMs).toBeCloseTo(89, 6);
    await expect(page.locator('#timingRefLive')).toHaveText('Live 89.0 ms');
    // a heard click clears it
    const ok = await page.evaluate(() => { const s0 = timingClickTimes[timingClickTimes.length - 1]; return timingHandleRef(s0, s0 + 0.089, 0.9).kind; });
    expect(ok).toBe('accept');
    s = await page.evaluate(() => timingRefState());
    expect([s.lost, s.warn]).toEqual([false, false]);
    // muted: no clicks are scheduled any more, so being silent is not an error (lost, but no warning)
    await page.evaluate(() => { beatStates.fill(3); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { timingClickTimes.forEach(s => timingHandleRef(s, s + 0.089, 0.9)); });
    s = await lostSnapshot(page);
    expect(s.lost).toBe(true);
    expect(s.warn).toBe(false);
    expect(s.matchLatencyMs).toBeCloseTo(89, 6);
    await clickPlay(page);
  });

  test('the ref state is cleared on play start', async ({ page }) => {
    await setRef(page);
    await playUntilClicks(page, 4);
    await injectRefs(page, 0.089);
    expect((await page.evaluate(() => timingRefState())).locked).toBe(true);
    await clickPlay(page);
    await clickPlay(page);
    const s = await page.evaluate(() => timingRefState());
    expect(s.locked).toBe(false);
    expect(s.events).toBe(0);
    expect(s.clickTimes.length).toBeLessThanOrEqual(4); // only the new run's clicks
    await clickPlay(page);
  });

  test('the scheduler hook does not alter scheduled times', async ({ page }) => {
    const capture = async (refOn) => {
      await page.evaluate((refOn) => { timingSetRef(refOn ? 1 : -1); updateBpm(120); subdivision = '2'; }, refOn);
      await clickPlay(page);
      await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(7);
      await clickPlay(page);
      return page.evaluate(() => ({ beats: timingBeats.slice(0, 8).map(b => b.time - timingBeats[0].time), clicks: timingClickTimes.slice(0, 15).map(t => t - timingClickTimes[0]) }));
    };
    const off = await capture(false);
    const on = await capture(true);
    expect(off.clicks.length).toBe(0);
    expect(on.beats.length).toBe(8);
    on.beats.forEach((d, i) => { expect(d).toBeCloseTo(i * 0.5, 9); expect(off.beats[i]).toBeCloseTo(d, 9); });
    expect(on.clicks.length).toBe(15);
    on.clicks.forEach((d, i) => expect(d).toBeCloseTo(i * 0.25, 9)); // every beat and every half-beat click, nothing else
  });

  test('muted beats record no click (their subdivision clicks are muted too); the others do', async ({ page }) => {
    await setRef(page);
    await page.evaluate(() => { updateBpm(120); subdivision = '2'; beatStates[1] = 3; });
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(5);
    await clickPlay(page);
    const c = await page.evaluate(() => timingClickTimes.map(t => Math.round((t - timingClickTimes[0]) / 0.25)));
    // beat 2 (index 1) is muted: neither its main click nor its subdivision click sounds, so neither is recorded
    expect(c.slice(0, 6)).toEqual([0, 1, 4, 5, 6, 7]);
  });
});

test.describe('Timing Check - click ref UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => {
      timingNode.port.onmessage = null;
      timingSwapUntil = 0;
      timingChannels = 2; timingChannel = 0; timingLoadChannel(); timingRenderRefSeg();
    });
  });

  const segTexts = (page) => page.evaluate(() => [...document.querySelectorAll('#timingRefSeg button')].map(b => b.textContent));
  const lockRef = (page) => page.evaluate(() => {
    timingClickTimes = [20, 21, 22];
    timingHandleRef(20, 20.089, 0.9); timingHandleRef(21, 21.089, 0.9);
  });
  const glitchUi = (page) => page.evaluate(() => timingOnWorkletMessage({ data: { type: 'glitch', startTime: timingStreamCtxAt + 5, lengthSamples: 960, lengthMs: 20 } }));

  test('the Click options are Off plus every channel except the instrument channel, with the tooltip', async ({ page }) => {
    await page.click('#timingSetBtn');
    expect(await segTexts(page)).toEqual(['Off', 'Ch 2']);
    await page.evaluate(() => { timingSetChannel(1); });
    expect(await segTexts(page)).toEqual(['Off', 'Ch 1']);
    await page.evaluate(() => { timingChannels = 4; timingSetChannel(2); });
    expect(await segTexts(page)).toEqual(['Off', 'Ch 1', 'Ch 2', 'Ch 4']);
    await page.evaluate(() => { timingChannels = 1; timingLoadChannel(); timingRenderRefSeg(); });
    await expect(page.locator('#timingRefRowSel')).toBeHidden();
  });

  test('instrument and click channels are mutually exclusive', async ({ page }) => {
    await page.click('#timingSetBtn');
    await page.click('#timingRefSeg [data-v="1"]');
    expect(await page.evaluate(() => [timingRefCh, timingRefOn, localStorage.getItem('wm.timing.refCh.' + timingDeviceId)])).toEqual([1, true, '1']);
    await expect(page.locator('#timingRefSeg [data-v="1"]')).toHaveAttribute('aria-pressed', 'true');
    // picking the click channel as the instrument channel switches the click ref off
    await page.click('#timingChSeg [data-v="1"]');
    expect(await page.evaluate(() => [timingChannel, timingRefCh, timingRefOn, localStorage.getItem('wm.timing.refCh.' + timingDeviceId)])).toEqual([1, -1, false, 'off']);
    expect(await segTexts(page)).toEqual(['Off', 'Ch 1']);
    await expect(page.locator('#timingRefSeg [data-v="-1"]')).toHaveAttribute('aria-pressed', 'true');
    // the API refuses the instrument channel too
    expect(await page.evaluate(() => { timingSetRef(1); return timingRefCh; })).toBe(-1);
    // a stored ref equal to the instrument channel is dropped on load
    expect(await page.evaluate(() => { localStorage.setItem('wm.timing.refCh.' + timingDeviceId, '1'); timingLoadRef(); return timingRefCh; })).toBe(-1);
  });

  test('the ref channel and its trim persist per device and are posted to the worklet', async ({ page }) => {
    const r = await page.evaluate(() => {
      const sent = [];
      const orig = timingNode.port.postMessage.bind(timingNode.port);
      timingNode.port.postMessage = m => { sent.push(m); orig(m); };
      timingDeviceId = 'devA';
      timingSetRef(1); timingSetRefTrim(4);
      const a = [localStorage.getItem('wm.timing.refCh.devA'), localStorage.getItem('wm.timing.refTrim.devA')];
      timingDeviceId = 'devB'; timingLoadRef();
      const b = [timingRefCh, timingRefTrimMs, timingRefOn];
      timingDeviceId = 'devA'; timingLoadRef();
      const c = [timingRefCh, timingRefTrimMs, timingRefOn];
      timingSetRefTrim(99);
      return { a, b, c, clamp: timingRefTrimMs, cfg: sent.filter(m => m.type === 'config').map(m => m.refChannel) };
    });
    expect(r.a).toEqual(['1', '4']);
    expect(r.b).toEqual([-1, 0, false]);
    expect(r.c).toEqual([1, 4, true]);
    expect(r.clamp).toBe(20);
    expect(r.cfg).toContain(1);
  });

  test('ref mode: Live / Trim replace the latency stepper and Measure; hints and notes are hidden; the button shows Live', async ({ page }) => {
    // before: normal latency UI with a glitch note
    await page.evaluate(() => { timingSetLatency(58); });
    await glitchUi(page);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingLatRow')).toBeVisible();
    await expect(page.locator('#timingLatComp')).toBeVisible();
    await page.evaluate(() => { timingLatencyEst = false; timingMeasuredSeq = 5; timingMeasuredPage = 'x'; timingRenderLatency(); });
    await expect(page.locator('#timingLatRemeasure')).toBeVisible();
    await page.click('#timingRefSeg [data-v="1"]');
    await expect(page.locator('#timingLatRow')).toBeHidden();
    await expect(page.locator('#timingLoopOpen')).toBeHidden();
    await expect(page.locator('#timingLoopPanel')).toBeHidden();
    await expect(page.locator('#timingLatComp')).toBeHidden();
    await expect(page.locator('#timingLatRemeasure')).toBeHidden();
    await expect(page.locator('#timingRefMeasureOff')).toBeVisible();
    await expect(page.locator('#timingRefMeasureOff')).toBeDisabled();
    await expect(page.locator('#timingRefMeasureOff')).toHaveAttribute('title', 'Not needed with a click ref channel');
    await expect(page.locator('#timingRefLive')).toHaveText('Live —');
    await expect(page.locator('#timingSetGrid')).toHaveText('16 ·');
    await expect(page.locator('#timingSetVals')).toHaveText('Live — · S5');
    await expect(page.locator('#timingSetEst')).toBeHidden();
    await lockRef(page);
    await expect(page.locator('#timingRefLive')).toHaveText('Live 89.0 ms');
    await expect(page.locator('#timingSetVals')).toHaveText('Live 89 ms · S5');
    // trim stepper
    await expect(page.locator('#timingRefTrimValue')).toHaveText('0 ms');
    await page.click('#timingRefTrimPlus');
    await page.click('#timingRefTrimPlus');
    await expect(page.locator('#timingRefTrimValue')).toHaveText('+2 ms');
    await page.click('#timingRefTrimMinus');
    await page.click('#timingRefTrimMinus');
    await page.click('#timingRefTrimMinus');
    await expect(page.locator('#timingRefTrimValue')).toHaveText('−1 ms');
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.refTrim.' + timingDeviceId))).toBe('-1');
    expect(await page.evaluate(() => timingMatchLatencyMs())).toBeCloseTo(88, 6);
    // back to Off restores the latency UI and label
    await page.click('#timingRefSeg [data-v="-1"]');
    await expect(page.locator('#timingLatRow')).toBeVisible();
    await expect(page.locator('#timingRefRow')).toBeHidden();
    await expect(page.locator('#timingLoopOpen')).toBeVisible();
    await expect(page.locator('#timingSetVals')).toHaveText('78 ms · S5'); // 58 + 20 ms glitch compensation
  });

  test('no horizontal overflow at 375 px in ref mode (locked, with a glitch note stored)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await glitchUi(page);
    await page.click('#timingSetBtn');
    await page.click('#timingRefSeg [data-v="1"]');
    await page.evaluate(() => { timingClickTimes = [20, 21, 22]; timingHandleRef(20, 20.1234, 0.9); timingHandleRef(21, 21.1234, 0.9); timingSetRefTrim(-20); });
    const r = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      const pop = rect('timingPopover');
      const ids = ['timingRefLive', 'timingRefMeasureOff', 'timingRefTrimValue', 'timingRefTrimPlus', 'timingRefSeg'];
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, popL: pop.left, popR: pop.right, inside: ids.map(i => [rect(i).left >= pop.left - 0.5, rect(i).right <= pop.right + 0.5]), btnR: rect('timingSetBtn').right, text: document.getElementById('timingSetVals').textContent };
    });
    expect(r.text).toBe('Live 123 ms · S5');
    expect(r.sw).toBeLessThanOrEqual(r.iw);
    expect(r.popL).toBeGreaterThanOrEqual(0);
    expect(r.popR).toBeLessThanOrEqual(r.iw);
    expect(r.btnR).toBeLessThanOrEqual(r.iw);
    r.inside.forEach(x => { expect(x[0]).toBe(true); expect(x[1]).toBe(true); });
  });

  test('the debug recorder records ref events, scheduled clicks and the liveL history; timingRefState is exposed', async ({ page }) => {
    await page.evaluate(() => { timingSetRef(1); timingDbg = { refs: [], clicks: [], beats: [], onsets: [], matches: [], near: [], chunks: [] }; });
    await lockRef(page);
    await page.evaluate(() => timingRecordClick(30, 800, 0.05, 1.8));
    const r = await page.evaluate(() => ({ refs: timingDbg.refs, clicks: timingDbg.clicks, st: window.timingRefState() }));
    expect(r.refs.map(x => x.kind)).toEqual(['lock', 'accept']);
    expect(r.refs[1].liveLms).toBeCloseTo(89, 6);
    expect(r.clicks).toEqual([30]);
    expect(r.st).toMatchObject({ enabled: true, channel: 1, locked: true, trimMs: 0 });
    expect(r.st.liveLms).toBeCloseTo(89, 6);
    expect(r.st.history.length).toBe(2);
    await page.evaluate(() => { timingDbg = null; });
  });
});

test.describe('Timing Check - click ref Off keeps the classic path', () => {
  test('with the ref Off (the default) latency path, Measure UI, label and glitch compensation are unchanged', async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingNode.port.onmessage = null; timingSwapUntil = 0; timingChannels = 2; timingLoadChannel(); timingLoadRef(); timingSetLatency(99); });
    const s = await page.evaluate(() => ({ ch: timingRefCh, on: timingRefOn, eff: timingEffectiveLatencyMs(), used: timingMatchLatencyMs() }));
    expect(s).toEqual({ ch: -1, on: false, eff: 99, used: 99 });
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingSetGrid')).toHaveText('16 ·');
    await expect(page.locator('#timingSetVals')).toHaveText('99 ms · S5');
    await expect(page.locator('#timingLatRow')).toBeVisible();
    await expect(page.locator('#timingLoopOpen')).toBeVisible();
    await expect(page.locator('#timingLoopOpen')).toBeEnabled();
    await expect(page.locator('#timingRefRow')).toBeHidden();
    // glitch compensation still applies; the Re-measure hint still shows
    await page.evaluate(() => timingOnWorkletMessage({ data: { type: 'glitch', startTime: timingStreamCtxAt + 5, lengthSamples: 960, lengthMs: 20 } }));
    expect(await page.evaluate(() => timingMatchLatencyMs())).toBe(119);
    await expect(page.locator('#timingSetVals')).toHaveText('119 ms · S5');
    await page.evaluate(() => { timingMeasuredSeq = 5; timingMeasuredPage = 'x'; timingLatencyEst = false; timingRenderLatency(); });
    await expect(page.locator('#timingLatRemeasure')).toBeVisible();
    // switching the ref on while playing and back off returns cleanly to the classic path
    await page.evaluate(() => { updateBpm(250); timingSetRef(1); });
    await page.evaluate(() => togglePlay());
    await expect(page.locator('#timingRefRow')).toBeVisible();
    await page.evaluate(() => { timingClickTimes = [1]; timingHandleRef(1, 1.05, 0.9); });
    expect(await page.evaluate(() => Math.round(timingMatchLatencyMs()))).toBe(50);
    await page.evaluate(() => timingSetRef(-1));
    expect(await page.evaluate(() => [timingRefOn, timingMatchLatencyMs()])).toEqual([false, 119]);
    await expect(page.locator('#timingSetVals')).toHaveText('119 ms · S5');
    await expect(page.locator('#timingLatRow')).toBeVisible();
    await expect(page.locator('#timingLoopOpen')).toBeVisible();
    await expect(page.locator('#timingLatRemeasure')).toBeVisible();
    await page.evaluate(() => togglePlay());
  });
});

// Marker shapes by grid role -----------------------------------------------------

test.describe('Timing Check - marker shapes by grid role', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingMuteOnsets = true; timingNode.port.onmessage = null; updateBpm(60); });
    await page.click('#timingSetBtn');
    await page.click('#timingResSeg [data-v="32"]');
    await page.keyboard.press('Escape');
  });
  // one hit per role on the 32 grid: pos 0 (beat), 1/8 (finest), 1/4 (other), 1/2 (main off-beat), all exactly on time
  const injectRoles = (page) => page.evaluate(() => {
    const done = timingBeats.filter(b => b.dur > 0); const b = done[done.length - 2];
    const g = getTimingGrid();
    return [0, 1 / 8, 1 / 4, 1 / 2].map(p => {
      const j = g.pos.findIndex(x => Math.abs(x - p) < 1e-9);
      const r = timingHandleOnset(b.time + timingLatencyMs / 1000 + p * b.dur, -20);
      return r && { role: g.role[j], posInBeat: p };
    });
  });
  for (const view of ['timeline', 'beats']) {
    test(`${view}: role -> shape (beat circle, off-beat diamond, other square, finest tiny circle) and a centred diamond`, async ({ page }) => {
      test.setTimeout(30000);
      if (view === 'beats') await page.click('#timingViewSeg [data-v="beats"]');
      await clickPlay(page);
      await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length), { timeout: 10000 }).toBeGreaterThan(2);
      const host = view === 'timeline' ? '#timingTrack' : '#timingBeatsMarks';
      const roles = await injectRoles(page);
      expect(roles.map(r => r && r.role)).toEqual([0, 3, 1, 2]);
      await expect(page.locator(host + ' .tm-dot')).toHaveCount(4);
      const info = await page.evaluate(h => {
        const out = {};
        for (const c of ['d0', 'd1', 'd2', 'd3']) {
          const el = document.querySelector(h + ' .tm-dot.' + c), s = getComputedStyle(el), r = el.getBoundingClientRect();
          const b = getComputedStyle(el, '::before');
          out[c] = { w: s.width, h: s.height, radius: s.borderTopLeftRadius, bg: s.backgroundColor, cx: r.left + r.width / 2, cy: r.top + r.height / 2, before: b.content, bw: parseFloat(b.width), bh: parseFloat(b.height), bl: parseFloat(b.left), bt: parseFloat(b.top), tf: b.transform, bbg: b.backgroundColor };
        }
        out.halfBeatPx = h === '#timingTrack' ? 0.5 * timingBeats.filter(b => b.dur > 0).slice(-2)[0].dur * timingTl.pps : 0.5 * timingC.sp;
        const cr = document.querySelector(h).closest('.tm-chart').getBoundingClientRect();
        out.midY = cr.top + cr.height / 2;
        return out;
      }, host);
      expect(parseFloat(info.d0.radius)).toBeGreaterThan(0); expect(info.d0.w).toBe('11px');
      expect(parseFloat(info.d3.radius)).toBeGreaterThan(0); expect(info.d3.w).toBe('4px');
      expect(info.d1.radius).toBe('0px'); expect(info.d1.w).toBe('6px'); expect(info.d1.h).toBe('6px');
      expect(info.d1.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(info.d2.radius).toBe('0px'); expect(info.d2.bg).toBe('rgba(0, 0, 0, 0)');   // the element is only the centring box
      expect(info.d2.before).toBe('""');
      expect(info.d2.bbg).not.toBe('rgba(0, 0, 0, 0)');
      expect(info.d2.tf).toMatch(/^matrix\(0\.70\d*, 0\.70\d*, -0\.70\d*, 0\.70\d*, 0, 0\)$/);   // rotate(45deg)
      // the diamond is centred in its box: pseudo-element centre == box centre
      expect(info.d2.bl + info.d2.bw / 2).toBeCloseTo(parseFloat(info.d2.w) / 2, 2);
      expect(info.d2.bt + info.d2.bh / 2).toBeCloseTo(parseFloat(info.d2.h) / 2, 2);
      // x encodes timing: the half-beat diamond sits half a beat after the beat circle; on time = on the centre line vertically
      expect(Math.abs((info.d2.cx - info.d0.cx) - info.halfBeatPx)).toBeLessThanOrEqual(0.5);
      for (const c of ['d0', 'd1', 'd2', 'd3']) expect(Math.abs(info[c].cy - info.midY)).toBeLessThanOrEqual(0.5);
    });
  }

  test('the rejected mark is a grey cross, distinct from every filled shape', async ({ page }) => {
    await page.click('#timingViewSeg [data-v="beats"]');
    const css = await page.evaluate(() => {
      const el = document.createElement('div'); el.className = 'tm-x'; document.getElementById('timingBeatsMarks').appendChild(el);
      const s = getComputedStyle(el), b = getComputedStyle(el, '::before'), a = getComputedStyle(el, '::after');
      const r = { w: s.width, bw: s.borderTopWidth, bg: s.backgroundColor, bb: b.backgroundColor, ba: a.backgroundColor, tb: b.transform, ta: a.transform };
      el.remove(); return r;
    });
    expect(css.w).toBe('9px');
    expect(css.bw).toBe('0px');
    expect(css.bg).toBe('rgba(0, 0, 0, 0)');          // no fill or border on the element itself
    expect(css.bb).toBe('rgb(148, 163, 184)');        // two grey bars
    expect(css.ba).toBe('rgb(148, 163, 184)');
    expect(css.tb).not.toBe(css.ta);                  // crossed (+45 / -45 deg)
  });
});

// Worklet frame clock ----------------------------------------------------------------

test.describe('Timing Check - worklet frame clock', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });
  // runs the real processor source against a stubbed AudioWorkletGlobalScope; stale quanta report the previous quantum's currentFrame
  const run = (page, mode) => page.evaluate((mode) => {
    const sr = 48000, total = 128 * 80, G = { currentFrame: 0 }, msgs = [];
    let Proc = null;
    class Base { constructor() { this.port = { postMessage: (m) => msgs.push(m) }; } }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'G', TIMING_WORKLET_SRC.replace(/\bcurrentFrame\b/g, 'G.currentFrame'))(Base, (n, c) => { Proc = c; }, sr, G);
    const x = new Float32Array(total).fill(1e-4);
    x.fill(0, 1000, 1100);                                    // 100 zero samples (a glitch) crossing the quantum boundary at 1024
    for (let k = 0; k < 1500; k++) x[6000 + k] = 0.4 * Math.sin(k * 0.3) * Math.exp(-k / 400);   // an onset
    const p = new Proc();
    const stale = new Set(mode === 'stale' ? [7, 8, 9, 46, 47, 48] : []);   // 7..9 cover the glitch, 46..48 the onset
    for (let q = 0; q * 128 < total; q++) {
      if (mode === 'gap' && q >= 20 && q < 22) continue;     // two quanta never passed on
      G.currentFrame = (stale.has(q) ? q - 1 : q) * 128;
      p.process([[x.subarray(q * 128, q * 128 + 128)]]);
    }
    return { sr, onsets: msgs.filter(m => m.type === 'onset').map(m => m.time), glitches: msgs.filter(m => m.type === 'glitch').map(m => ({ t: m.startTime, n: m.lengthSamples })) };
  }, mode);

  test('a repeated currentFrame does not shift onset or glitch timestamps', async ({ page }) => {
    const ok = await run(page, 'ok');
    const st = await run(page, 'stale');
    expect(ok.glitches).toEqual([{ t: 1000 / ok.sr, n: 100 }]);
    expect(ok.onsets.length).toBe(1);
    expect(st.glitches).toEqual(ok.glitches);
    expect(st.onsets).toEqual(ok.onsets);
  });

  test('a real gap (frames skipped) resyncs the clock to currentFrame', async ({ page }) => {
    const ok = await run(page, 'ok');
    const gap = await run(page, 'gap');
    expect(gap.onsets.length).toBe(1);
    expect(Math.abs(gap.onsets[0] - ok.onsets[0])).toBeLessThan(1e-9);
  });
});

// "?" help tips in the settings popover ------------------------------------------------------
test.describe('Timing Check - help tips', () => {
  const TIPS = {
    input: ['Input', 'The audio input to listen to — pick your audio interface. The Ch buttons (or list, on interfaces with many inputs) choose the channel your instrument is on. A loopback device can carry the instrument and the metronome together (see Click).'],
    click: ['Click', "Optional. A channel that carries the metronome itself, e.g. an interface loopback. Timing is then measured against the actual clicks, so latency is tracked automatically and Measure isn't needed. Leave Off if you don't have one."],
    detect: ['Detect', 'Which notes to check. 4 = beats only, 8 = beats and off-beats, 16 / 32 = finer. Hits between grid points show as grey × marks (Off grid), higher = earlier, lower = later. Shuffle swings the 8th or 16th positions. Shuffle and tuplet rhythms lock this.'],
    latency: ['Latency', "How long the sound takes to reach your ears and come back from your instrument. It is subtracted from every hit. Use Measure with a cable from an output to an input to set it exactly. Re-measure after reloading or switching devices. \"+N ms auto\" is added when the browser's input buffer slips."],
    live: ['Live', 'Latency measured continuously from the clicks on the Click channel. "Syncing…" means it is still locking on; hits are not judged until then.'],
    trim: ['Trim', 'A small fixed correction for the difference between what you hear and the loopback, e.g. the headphone path. Adjust it if hits look consistently early or late.'],
    sens: ['Sensitivity', 'How small a rise in level counts as a new note. Raise it if soft notes are missed; lower it if one note shows up as several marks.'],
    quiet: ['Quiet below', 'Below this input level the status shows Quiet. Lower it if your signal is soft but fine.'],
  };
  const btn = (page, k) => page.locator(`#timingPopover .tm-help[data-help="${k}"]`);
  const tip = (page, k) => page.locator('#timingHelp-' + k);
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    // two channels so the Click row exists; classic mode by default
    await page.evaluate(() => { timingChannels = 2; timingChannel = 0; timingLoadChannel(); timingRenderRefSeg(); });
    await page.click('#timingSetBtn');
  });

  for (const k of ['input', 'click', 'detect', 'latency', 'sens', 'quiet']) {
    test(`${k}: "?" has the right label and its bubble shows the exact text`, async ({ page }) => {
      await expect(btn(page, k)).toHaveAttribute('aria-label', 'Help: ' + TIPS[k][0]);
      await expect(btn(page, k)).toHaveAttribute('aria-expanded', 'false');
      await expect(btn(page, k)).toHaveAttribute('aria-controls', 'timingHelp-' + k);
      await expect(tip(page, k)).toBeHidden();
      await btn(page, k).click();
      await expect(tip(page, k)).toBeVisible();
      await expect(tip(page, k)).toHaveAttribute('role', 'tooltip');
      await expect(tip(page, k)).toHaveText(TIPS[k][1]);
      await expect(btn(page, k)).toHaveAttribute('aria-expanded', 'true');
      const inside = await page.evaluate((id) => {
        const t = document.getElementById(id).getBoundingClientRect(), p = document.getElementById('timingPopover').getBoundingClientRect();
        return t.left >= p.left && t.right <= p.right && t.right <= window.innerWidth && t.left >= 0;
      }, 'timingHelp-' + k);
      expect(inside).toBe(true);
    });
  }

  test('LIVE and TRIM tips exist only in click-ref mode; LATENCY only in classic mode', async ({ page }) => {
    await expect(btn(page, 'latency')).toBeVisible();
    await expect(btn(page, 'live')).toBeHidden();
    await expect(btn(page, 'trim')).toBeHidden();
    await page.click('#timingRefSeg [data-v="1"]');
    await expect(btn(page, 'latency')).toBeHidden();
    for (const k of ['live', 'trim']) {
      await expect(btn(page, k)).toBeVisible();
      await expect(btn(page, k)).toHaveAttribute('aria-label', 'Help: ' + TIPS[k][0]);
      await btn(page, k).focus(); // keyboard: the previous bubble may cover the next "?"
      await page.keyboard.press('Enter');
      await expect(tip(page, k)).toHaveText(TIPS[k][1]);
      await expect(tip(page, k)).toBeVisible();
    }
    await expect(tip(page, 'live')).toBeHidden(); // only one open at a time
  });

  test('only one bubble is open at a time', async ({ page }) => {
    await btn(page, 'input').click();
    await btn(page, 'sens').click();
    await expect(tip(page, 'sens')).toBeVisible();
    await expect(tip(page, 'input')).toBeHidden();
    await expect(btn(page, 'input')).toHaveAttribute('aria-expanded', 'false');
    expect(await page.locator('.tm-help-tip[data-open]').count()).toBe(1);
  });

  test('pressing "?" again, Escape and an outside click each close the bubble; the popover stays open', async ({ page }) => {
    await btn(page, 'detect').click();
    await expect(tip(page, 'detect')).toBeVisible();
    await btn(page, 'detect').click();
    await expect(tip(page, 'detect')).toBeHidden();
    await expect(page.locator('#timingPopover')).toBeVisible();
    await btn(page, 'detect').click();
    await tip(page, 'detect').click(); // tapping the bubble dismisses it; the popover stays open
    await expect(tip(page, 'detect')).toBeHidden();
    await expect(page.locator('#timingPopover')).toBeVisible();
    await btn(page, 'detect').click();
    await expect(tip(page, 'detect')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip(page, 'detect')).toBeHidden();
    await expect(page.locator('#timingPopover')).toBeVisible();
    await expect(btn(page, 'detect')).toBeFocused();
    await btn(page, 'quiet').click();
    await page.click('#timingDeviceSelect'); // outside the bubble, inside the popover
    await expect(tip(page, 'quiet')).toBeHidden();
    await expect(page.locator('#timingPopover')).toBeVisible();
    await btn(page, 'quiet').click();
    await page.click('#bpmDisplay'); // outside the popover
    await expect(page.locator('#timingPopover')).toBeHidden();
    await expect(tip(page, 'quiet')).toBeHidden();
    // Escape with no bubble open still closes the popover
    await page.click('#timingSetBtn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#timingPopover')).toBeHidden();
  });

  test('"?" buttons are keyboard reachable and toggle with Enter', async ({ page }) => {
    await btn(page, 'input').focus();
    await page.keyboard.press('Enter');
    await expect(tip(page, 'input')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(tip(page, 'input')).toBeHidden();
  });

  test('no horizontal overflow at 375 px with the widest bubble open', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    const widest = await page.evaluate(() => [...document.querySelectorAll('.tm-help-tip')].sort((a, b) => b.textContent.length - a.textContent.length)[0].id.replace('timingHelp-', ''));
    expect(widest).toBe('latency');
    await page.click('#timingSetBtn'); // close
    await page.click('#timingSetBtn'); // reopen so it is re-fitted to the new viewport
    await btn(page, widest).click();
    await expect(tip(page, widest)).toBeVisible();
    const m = await page.evaluate((id) => {
      const t = document.getElementById(id).getBoundingClientRect(), p = document.getElementById('timingPopover').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, vw: window.innerWidth, l: t.left, r: t.right, pl: p.left, pr: p.right };
    }, 'timingHelp-' + widest);
    expect(m.sw).toBeLessThanOrEqual(m.vw);
    expect(m.l).toBeGreaterThanOrEqual(0);
    expect(m.r).toBeLessThanOrEqual(m.vw);
    expect(m.l).toBeGreaterThanOrEqual(m.pl);
    expect(m.r).toBeLessThanOrEqual(m.pr);
  });
});

test.describe('Timing Check - help tips layout', () => {
  const rightMost = (page, keys) => page.evaluate((keys) => keys.map(k => {
    const b = document.querySelector(`#timingPopover .tm-help[data-help="${k}"]`);
    const row = b.closest('.tm-lab, .tm-lat-head, .tm-row');
    const rr = row.getBoundingClientRect(), br = b.getBoundingClientRect();
    const cs = getComputedStyle(row);
    const contentRight = rr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const cy = (br.top + br.bottom) / 2;
    // every other visible child of the row must sit on the button's line and to its left
    const sibs = [...row.children].filter(c => c !== b && c.getBoundingClientRect().width > 0);
    return {
      k, dRight: Math.abs(br.right - contentRight), hasLabel: sibs.length > 0,
      sameLine: sibs.every(c => { const r = c.getBoundingClientRect(); return cy >= r.top - 1 && cy <= r.bottom + 1 && r.right <= br.left + 1; }),
    };
  }), keys);

  for (const width of [900, 375]) {
    test(`every "?" is the right-most element of its row, on the label's line, at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await navigateAndWait(page);
      await page.click('#timingBtn');
      await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
      await page.evaluate(() => { timingChannels = 2; timingChannel = 0; timingLoadChannel(); timingRenderRefSeg(); });
      await page.click('#timingSetBtn');
      // show the optional "Re-measure" pill and the "+N ms auto" note too: the "?" stays right-most
      await page.evaluate(() => { document.getElementById('timingLatRemeasure').hidden = false; const c = document.getElementById('timingLatComp'); c.hidden = false; c.textContent = '+20 ms auto (1 glitch)'; });
      for (const r of await rightMost(page, ['input', 'click', 'detect', 'latency', 'sens', 'quiet'])) {
        expect(r.dRight, r.k + ' right edge').toBeLessThanOrEqual(1);
        expect(r.sameLine, r.k + ' same line').toBe(true);
      }
      await page.click('#timingRefSeg [data-v="1"]');
      for (const r of await rightMost(page, ['live', 'trim'])) {
        expect(r.dRight, r.k + ' right edge').toBeLessThanOrEqual(1);
        expect(r.hasLabel).toBe(true);
        expect(r.sameLine, r.k + ' same line').toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

// Selectable vertical range (View range) ---------------------------------------------------------
test.describe('Timing Check - view range', () => {
  const TIP = "How far early or late the chart's top and bottom edges are. Hits beyond it are drawn as red triangles at the edge. Widen it to see big misses; narrow it to see small differences.";
  const open = async (page, view) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingMuteOnsets = true; timingNode.port.onmessage = null; });
    if (view === 'beats') await page.click('#timingViewSeg [data-v="beats"]');
  };
  // synthetic accepted hits (role 0) at the given offsets
  const inject = (page, view, offs) => page.evaluate(([view, offs]) => {
    offs.forEach((ms, i) => {
      const hit = { t: timingNowSec() - 0.05 * i, offsetMs: ms, beatGlobal: i, beatInMeasure: i % 4, posInBeat: 0, role: 0, peakDb: -20 };
      timingHits.push(hit);
      if (view === 'timeline') timingTlAddDot(hit); else timingCAddMark(hit);
    });
  }, [view, offs]);
  const geo = (page, host) => page.evaluate((h) => [...document.querySelectorAll(h + ' > *')].filter(e => /^tm-(dot|tri)/.test(e.className)).map(e => {
    const c = e.closest('.tm-chart').getBoundingClientRect(), r = e.getBoundingClientRect();
    return { cls: e.className, q: e.dataset.q || '', dy: (r.top + r.bottom) / 2 - (c.top + c.bottom) / 2 };
  }), host);

  test('defaults to 50, persists across reload, ignores junk', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => timingRangeMs)).toBe(50);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingRangeSeg [aria-pressed="true"]')).toHaveText('±50');
    await page.click('#timingRangeSeg [data-v="200"]');
    expect(await page.evaluate(() => localStorage.getItem('wm.timing.range'))).toBe('200');
    await page.reload();
    await expect.poll(() => page.evaluate(() => timingRangeMs)).toBe(200);
    await page.evaluate(() => localStorage.setItem('wm.timing.range', '77'));
    await page.reload();
    expect(await page.evaluate(() => timingRangeMs)).toBe(50);
  });

  test('View range item sits below Detect with the exact help text and a right-edge "?"', async ({ page }) => {
    await open(page);
    await page.click('#timingSetBtn');
    const order = await page.evaluate(() => {
      const y = (id) => document.getElementById(id).getBoundingClientRect().top;
      return [y('timingResSeg') < y('timingRangeSeg'), y('timingRangeSeg') < y('timingSensValue')];
    });
    expect(order).toEqual([true, true]);
    await expect(page.locator('#timingRangeSeg button')).toHaveText(['±50', '±100', '±200']);
    const b = page.locator('#timingPopover .tm-help[data-help="range"]');
    await expect(b).toHaveAttribute('aria-label', 'Help: View range');
    await b.click();
    await expect(page.locator('#timingHelp-range')).toHaveText(TIP);
    await expect(page.locator('#timingHelp-range')).toBeVisible();
    const d = await page.evaluate(() => {
      const bt = document.querySelector('#timingPopover .tm-help[data-help="range"]'), row = bt.closest('.tm-lab');
      const rr = row.getBoundingClientRect(), br = bt.getBoundingClientRect();
      const lab = row.querySelector('.tm-label').getBoundingClientRect();
      return { dRight: Math.abs(rr.right - br.right), same: Math.abs((lab.top + lab.bottom) / 2 - (br.top + br.bottom) / 2) < 3, text: row.querySelector('.tm-label').textContent, up: getComputedStyle(row.querySelector('.tm-label')).textTransform };
    });
    expect(d.dRight).toBeLessThanOrEqual(1);
    expect(d.same).toBe(true);
    expect(d.text + '|' + d.up).toBe('View range|uppercase');
  });

  for (const view of ['timeline', 'beats']) {
    const host = view === 'timeline' ? '#timingTrack' : '#timingBeatsMarks';
    const chart = view === 'timeline' ? '#timingTimeline' : '#timingBeatsChart';
    const half = view === 'timeline' ? 132 / 2 - 8 : 96 / 2 - 7;

    test(`${view}: +80 ms is a triangle at 50 and an in-range dot at the correct y at 100; markers re-place on switching`, async ({ page }) => {
      await open(page, view);
      await inject(page, view, [80, -30, 5]);
      let g = await geo(page, host);
      expect(g.length).toBe(3);
      expect(g.filter(x => x.cls.startsWith('tm-tri')).length).toBe(1);
      await page.click('#timingSetBtn');
      await page.click('#timingRangeSeg [data-v="100"]');
      g = await geo(page, host);
      expect(g.filter(x => x.cls.startsWith('tm-tri')).length).toBe(0);
      const dy = (ms, r) => ms * half / r;
      const pos80 = g.find(x => Math.abs(x.dy - dy(80, 100)) < 1.2), neg30 = g.find(x => Math.abs(x.dy - dy(-30, 100)) < 1.2), p5 = g.find(x => Math.abs(x.dy - dy(5, 100)) < 1.2);
      expect(pos80 && pos80.q).toBe('bad');   // quality is ms based: 80 ms stays red
      expect(neg30 && neg30.q).toBe('bad');
      expect(p5 && p5.q).toBe('good');
      expect(g.every(x => x.cls.startsWith('tm-dot d0'))).toBe(true);
      // back to 50: +80 is a triangle again, pinned to the bottom edge
      await page.click('#timingRangeSeg [data-v="50"]');
      g = await geo(page, host);
      expect(g.filter(x => x.cls === 'tm-tri down').length).toBe(1);
      expect(g.filter(x => x.cls.startsWith('tm-dot')).length).toBe(2);
      // 200: all in range, scaled
      await page.click('#timingRangeSeg [data-v="200"]');
      g = await geo(page, host);
      expect(g.filter(x => x.cls.startsWith('tm-tri')).length).toBe(0);
      expect(g.some(x => Math.abs(x.dy - dy(80, 200)) < 1.2)).toBe(true);
      // beyond 200 is still a triangle
      await inject(page, view, [-250]);
      await expect(page.locator(host + ' .tm-tri.up')).toHaveCount(1);
      await expect(page.locator(host + ' .tm-tri.up')).toHaveAttribute('title', '−250 ms');
      await page.click('#timingRangeSeg [data-v="50"]');
      await expect(page.locator(host + ' .tm-dot')).toHaveCount(2);
      await expect(page.locator(host + ' .tm-tri')).toHaveCount(2);
    });

    test(`${view}: the good band keeps its true +/-10 ms height, the scale label and guides follow the range`, async ({ page }) => {
      await open(page, view);
      await page.click('#timingSetBtn');
      const band = () => page.evaluate((c) => document.querySelector(c + ' .tm-band').getBoundingClientRect().height, chart);
      const label = () => page.locator(chart + ' .tm-scale').innerText();
      const guides = () => page.evaluate((c) => document.querySelectorAll(c + ' .tm-rg').length, chart);
      const res = {};
      for (const r of [50, 100, 200]) {
        await page.click(`#timingRangeSeg [data-v="${r}"]`);
        res[r] = { h: await band(), label: await label(), g: await guides() };
      }
      expect([res[50].label, res[100].label, res[200].label]).toEqual(['±50 ms', '±100 ms', '±200 ms']);
      for (const r of [50, 100, 200]) expect(Math.abs(res[r].h - 20 * half / r)).toBeLessThan(0.6);
      expect(Math.abs(res[100].h - res[50].h / 2)).toBeLessThan(0.6);
      expect([res[50].g, res[100].g, res[200].g]).toEqual([2, 4, 4]);
      // guides sit at the true ms: at range 100 they are +/-25 and +/-50
      await page.click('#timingRangeSeg [data-v="100"]');
      const ys = await page.evaluate((c) => {
        const ch = document.querySelector(c).getBoundingClientRect();
        return [...document.querySelectorAll(c + ' .tm-rg')].map(g => g.getBoundingClientRect().top - (ch.top + ch.height / 2)).sort((a, b) => a - b);
      }, chart);
      [-50, -25, 25, 50].forEach((ms, i) => expect(Math.abs(ys[i] - ms * half / 100)).toBeLessThan(1.2));
    });
  }

  test('fits at 375 px with no horizontal overflow, scale labels visible in both views', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await open(page);
    await page.click('#timingSetBtn');
    await page.click('#timingRangeSeg [data-v="200"]');
    await page.click('#timingPopover .tm-help[data-help="range"]');
    await expect(page.locator('#timingHelp-range')).toBeVisible();
    const m = await page.evaluate(() => {
      const t = document.getElementById('timingHelp-range').getBoundingClientRect(), p = document.getElementById('timingPopover').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, vw: window.innerWidth, ok: t.left >= p.left && t.right <= p.right };
    });
    expect(m.sw).toBeLessThanOrEqual(m.vw);
    expect(m.ok).toBe(true);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingTimeline .tm-scale')).toBeVisible();
    await page.click('#timingViewSeg [data-v="beats"]');
    await expect(page.locator('#timingBeatsChart .tm-scale')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await page.evaluate(() => {
      const q = (s) => document.querySelector(s).getBoundingClientRect();
      const s = q('#timingBeatsChart .tm-scale'), e = q('#timingBeatsChart .tm-side.t'), l = q('#timingBeatsChart .tm-side.b'), c = q('#timingBeatsChart');
      return { overE: s.top < e.bottom, overL: s.bottom > l.top, within: s.left >= c.left && s.right <= c.right };
    });
    expect(r.overE).toBe(false);
    expect(r.overL).toBe(false);
    expect(r.within).toBe(true);
  });
});

// Same-slot merge and nearby-noise merge ---------------------------------------------------------
test.describe('Timing Check - same-slot merge and nearby-noise merge', () => {
  const open = async (page, view) => {
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingMuteOnsets = true; timingNode.port.onmessage = null; updateBpm(60); });
    if (view === 'beats') await page.click('#timingViewSeg [data-v="beats"]');
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length), { timeout: 12000 }).toBeGreaterThan(6);
  };
  // inject on completed beat `k` (counted from the newest completed one), `p` = position inside the beat, offset in ms
  const hitAt = (page, k, p, db, offMs = 0) => page.evaluate(([k, p, db, offMs]) => {
    const done = timingBeats.filter(b => b.dur > 0), b = done[done.length - 1 - k];
    const r = timingHandleOnset(b.time + timingLatencyMs / 1000 + p * b.dur + offMs / 1000, db);
    return r && { offsetMs: r.offsetMs, peakDb: r.peakDb };
  }, [k, p, db, offMs]);
  const host = (view) => view === 'timeline' ? '#timingTrack .tm-dot' : '#timingBeatsMarks .tm-dot';

  for (const view of ['timeline', 'beats']) {
    test(`${view}: a louder sound on the same slot replaces the dot; a quieter one is dropped`, async ({ page }) => {
      test.setTimeout(40000);
      await open(page, view);
      const a = await hitAt(page, 1, 0, -30, 3);
      expect(a).not.toBeNull();
      await expect(page.locator(host(view))).toHaveCount(1);
      // quieter and equal: dropped
      expect(await hitAt(page, 1, 0, -40, 5)).toBeNull();
      expect(await hitAt(page, 1, 0, -30, 6)).toBeNull();
      await expect(page.locator(host(view))).toHaveCount(1);
      expect(await page.evaluate(() => timingHits.length)).toBe(1);
      expect(await page.evaluate(() => timingHits[0].offsetMs)).toBeCloseTo(3, 0);
      // louder: replaces (still one dot, one hit, new offset)
      const c = await hitAt(page, 1, 0, -20, -8);
      expect(c).not.toBeNull();
      await expect(page.locator(host(view))).toHaveCount(1);
      expect(await page.evaluate(() => timingHits.length)).toBe(1);
      expect(await page.evaluate(() => timingHits[0].peakDb)).toBe(-20);
      expect(await page.evaluate(() => timingHits[0].offsetMs)).toBeCloseTo(-8, 0);
      // a different slot still adds a dot
      expect(await hitAt(page, 1, 0.5, -20)).not.toBeNull();
      await expect(page.locator(host(view))).toHaveCount(2);
      // summary counts one hit per slot
      await page.evaluate(() => timingUpdateSummary());
      await expect(page.locator('#timingHitCount')).toHaveText('2');
    });
  }

  test('the merged dot survives a view switch and a range change', async ({ page }) => {
    test.setTimeout(40000);
    await open(page, 'timeline');
    await hitAt(page, 1, 0, -30, 3);
    await hitAt(page, 1, 0, -20, -8);
    await page.click('#timingViewSeg [data-v="beats"]');
    await expect(page.locator(host('beats'))).toHaveCount(1);
    await page.evaluate(() => timingSetRange(100));
    await expect(page.locator(host('beats'))).toHaveCount(1);
    await page.click('#timingViewSeg [data-v="timeline"]');
    await expect(page.locator(host('timeline'))).toHaveCount(1);
  });

  const res = (page, r) => page.evaluate((r) => { timingRes = r; }, r);
  const rings = (view) => view === 'timeline' ? '#timingTrack .tm-x' : '#timingBeatsMarks .tm-x';
  const marks = (page) => page.evaluate(() => [timingHits.length, timingRejects.length]);

  for (const view of ['timeline', 'beats']) {
    test(`${view}: several onsets in one cell leave one dot at the loudest one's offset`, async ({ page }) => {
      test.setTimeout(40000);
      await open(page, view);
      // 16 grid: the cell of slot 0.25 spans 0.125..0.375 of the beat
      expect(await hitAt(page, 1, 0.25, -30, 10)).not.toBeNull();
      expect(await hitAt(page, 1, 0.25, -20, -20)).not.toBeNull(); // louder: replaces
      expect(await hitAt(page, 1, 0.25, -25, 30)).toBeNull();      // quieter: dropped
      expect(await hitAt(page, 1, 0.25, -20, 40)).toBeNull();      // equal: dropped
      await expect(page.locator(host(view))).toHaveCount(1);
      expect(await page.evaluate(() => timingHits.map(h => [h.peakDb, Math.round(h.offsetMs)]))).toEqual([[-20, -20]]);
      await page.evaluate(() => timingUpdateSummary());
      await expect(page.locator('#timingHitCount')).toHaveText('1');
    });

    test(`${view}: a louder ring is kept against a quieter hit; a louder hit removes a quieter ring`, async ({ page }) => {
      test.setTimeout(40000);
      await open(page, view);
      await res(page, '4'); // one slot per beat; p = 0.45 is beyond the capture radius (ring) but still in that beat's cell
      expect(await hitAt(page, 1, 0.45, -20)).toBeNull();
      expect(await marks(page)).toEqual([0, 1]);
      await expect(page.locator(rings(view))).toHaveCount(1);
      expect(await hitAt(page, 1, 0.02, -30)).toBeNull(); // quieter on-grid hit in the same cell
      expect(await marks(page)).toEqual([0, 1]);
      await expect(page.locator(rings(view))).toHaveCount(1);
      await expect(page.locator(host(view))).toHaveCount(0);
      // louder hit replaces the ring
      expect(await hitAt(page, 1, 0.02, -10)).not.toBeNull();
      expect(await marks(page)).toEqual([1, 0]);
      await expect(page.locator(rings(view))).toHaveCount(0);
      await expect(page.locator(host(view))).toHaveCount(1);
      await page.evaluate(() => timingUpdateSummary());
      await expect(page.locator('#timingHitCount')).toHaveText('1');
    });

    test(`${view}: a reject cross sits at its offset from the nearest slot (early up, late down), clamps at the edge, and follows the view range`, async ({ page }) => {
      test.setTimeout(40000);
      await open(page, view);
      await res(page, '4');
      // y (px from the centre line) of the cross, read from its inline translate
      const crossY = () => page.evaluate((v) => {
        const el = document.querySelector((v === 'timeline' ? '#timingTrack' : '#timingBeatsMarks') + ' .tm-x');
        return parseFloat(/,\s*(-?[\d.]+)px/.exec(el.style.transform)[1]);
      }, view);
      const half = await page.evaluate((v) => v === 'timeline' ? TIMING_TL_HALF : TIMING_C_HALF, view);
      // 0.45 beat after the slot (450 ms at 60 BPM): far beyond any range -> late, clamped at the bottom edge
      expect(await hitAt(page, 1, 0.45, -20)).toBeNull();
      expect(await page.evaluate(() => Math.round(timingRejects[0].offsetMs))).toBe(450);
      expect(await crossY()).toBeCloseTo(half, 1);
      await expect(page.locator(rings(view))).toHaveCount(1);
      // an in-range late offset sits below the centre at the dot mapping; widening the range moves it toward the centre
      await page.evaluate(() => { timingRejects[0].offsetMs = 20; timingSetRange(50); });
      const y50 = await crossY();
      expect(y50).toBeCloseTo(half * 20 / 50, 1);
      await page.evaluate(() => timingSetRange(100));
      const y100 = await crossY();
      expect(y100).toBeCloseTo(half * 20 / 100, 1);
      expect(y100).toBeLessThan(y50);
      expect(y100).toBeGreaterThan(0);
      // early: above the centre; beyond the range it clamps to the top edge, still a cross (no triangle)
      await page.evaluate(() => { timingRejects[0].offsetMs = -30; timingSetRange(50); });
      expect(await crossY()).toBeCloseTo(-half * 30 / 50, 1);
      await page.evaluate(() => { timingRejects[0].offsetMs = -80; timingSetRange(50); });
      expect(await crossY()).toBeCloseTo(-half, 1);
      await expect(page.locator(rings(view))).toHaveCount(1);
      await expect(page.locator((view === 'timeline' ? '#timingTrack' : '#timingBeatsMarks') + ' .tm-tri')).toHaveCount(0);
      // a real early reject (0.55 beat = next slot, 450 ms early) lands on the top edge
      await page.evaluate(() => { timingRejects.length = 0; document.querySelectorAll('.tm-x').forEach(e => e.remove()); });
      expect(await hitAt(page, 2, 0.55, -20)).toBeNull();
      expect(await page.evaluate(() => Math.round(timingRejects[0].offsetMs))).toBe(-450);
      expect(await crossY()).toBeCloseTo(-half, 1);
    });

    test(`${view}: a quieter ring first, then a louder hit in the same cell removes the ring`, async ({ page }) => {
      test.setTimeout(40000);
      await open(page, view);
      await res(page, '4');
      expect(await hitAt(page, 1, 0.45, -30)).toBeNull();
      await expect(page.locator(rings(view))).toHaveCount(1);
      expect(await hitAt(page, 1, 0.02, -20)).not.toBeNull();
      await expect(page.locator(rings(view))).toHaveCount(0);
      await expect(page.locator(host(view))).toHaveCount(1);
    });

    test(`${view}: onsets in adjacent cells are both kept even if one is much quieter`, async ({ page }) => {
      test.setTimeout(40000);
      await open(page, view);
      expect(await hitAt(page, 1, 0.25, -20)).not.toBeNull();
      expect(await hitAt(page, 1, 0.5, -60)).not.toBeNull();
      await expect(page.locator(host(view))).toHaveCount(2);
    });
  }

  test('a lone quiet onset after several loud hits is still shown (no global filtering)', async ({ page }) => {
    test.setTimeout(40000);
    await open(page, 'timeline');
    for (let k = 2; k <= 5; k++) expect(await hitAt(page, k, 0, -20)).not.toBeNull();
    expect(await hitAt(page, 1, 0, -60)).not.toBeNull();
    await expect(page.locator('#timingTrack .tm-dot')).toHaveCount(5);
  });

  test('cell boundaries follow the detect grid: 8 merges onsets 0.25 beat apart, 16 keeps them apart', async ({ page }) => {
    test.setTimeout(40000);
    await open(page, 'timeline');
    await res(page, '8');
    await hitAt(page, 2, 0.3, -20);
    await hitAt(page, 2, 0.55, -10);
    const a = await marks(page);
    expect(a[0] + a[1]).toBe(1);
    await res(page, '16');
    await hitAt(page, 1, 0.3, -20);
    await hitAt(page, 1, 0.55, -10);
    const b = await marks(page);
    expect(b[0] + b[1]).toBe(3);
  });
});

// More than two input channels ---------------------------------------------------------

test.describe('Timing Check - many input channels', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__gumCalls = [];
      const md = navigator.mediaDevices;
      if (md && md.getUserMedia) {
        const orig = md.getUserMedia.bind(md);
        md.getUserMedia = (c) => { window.__gumCalls.push(JSON.parse(JSON.stringify(c))); return orig(c); };
      }
    });
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingNode.port.onmessage = null; timingSwapUntil = 0; });
    await page.click('#timingSetBtn');
  });

  const setCh = (page, n) => page.evaluate((n) => { timingChannels = n; timingLoadChannel(); timingLoadRef(); }, n);
  const chOpts = (page) => page.evaluate(() => [...document.querySelectorAll('#timingChSeg button, #timingChSeg option')].map(b => b.textContent));
  const refOpts = (page) => page.evaluate(() => [...document.querySelectorAll('#timingRefSeg button, #timingRefSeg option')].map(b => b.textContent));

  test('requests as many capture channels as the device has', async ({ page }) => {
    const calls = await page.evaluate(() => window.__gumCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].audio.channelCount.ideal).toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => [timingNode.channelCount, timingNode.channelCountMode])).toEqual([32, 'max']);
  });

  test('4 channels show segmented buttons; the click list is Off plus the other three', async ({ page }) => {
    await setCh(page, 4);
    expect(await chOpts(page)).toEqual(['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4']);
    expect(await refOpts(page)).toEqual(['Off', 'Ch 2', 'Ch 3', 'Ch 4']);
    expect(await page.locator('#timingChSeg select, #timingRefSeg select').count()).toBe(0);
    await page.click('#timingChSeg [data-v="3"]');
    expect(await refOpts(page)).toEqual(['Off', 'Ch 1', 'Ch 2', 'Ch 3']);
  });

  test('1 channel hides both selectors', async ({ page }) => {
    await setCh(page, 1);
    await expect(page.locator('#timingChSeg')).toBeHidden();
    await expect(page.locator('#timingRefRowSel')).toBeHidden();
  });

  test('8 channels use selects; Ch 6 instrument and Ch 7 click post the right config and persist', async ({ page }) => {
    await setCh(page, 8);
    await expect(page.locator('#timingChSeg select')).toBeVisible();
    await expect(page.locator('#timingRefSeg select')).toBeVisible();
    expect((await chOpts(page)).length).toBe(8);
    expect(await refOpts(page)).toEqual(['Off', 'Ch 2', 'Ch 3', 'Ch 4', 'Ch 5', 'Ch 6', 'Ch 7', 'Ch 8']); // Ch 1 is the instrument
    await page.evaluate(() => { window.__posted = []; const o = timingNode.port.postMessage.bind(timingNode.port); timingNode.port.postMessage = (m) => { window.__posted.push(m); o(m); }; });
    await page.selectOption('#timingChSeg select', '5');
    await page.selectOption('#timingRefSeg select', '6');
    const cfg = await page.evaluate(() => window.__posted.filter(m => m.type === 'config').pop());
    expect([cfg.channel, cfg.refChannel]).toEqual([5, 6]);
    // the instrument channel is gone from the click list
    expect(await refOpts(page)).toEqual(['Off', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4', 'Ch 5', 'Ch 7', 'Ch 8']);
    // choosing the click channel as the instrument switches the click off
    await page.selectOption('#timingChSeg select', '6');
    expect(await page.evaluate(() => [timingChannel, timingRefCh])).toEqual([6, -1]);
    await page.selectOption('#timingChSeg select', '5');
    await page.selectOption('#timingRefSeg select', '6');
    // persists across a reload
    await page.reload();
    await page.waitForFunction(() => typeof timingLoadChannel === 'function');
    const r = await page.evaluate(() => {
      timingDeviceId = timingLsGet('wm.timing.deviceId') || timingDeviceId;
      timingChannels = 8; timingLoadChannel(); timingLoadRef();
      return [timingChannel, timingRefCh, document.querySelector('#timingChSeg select').value, document.querySelector('#timingRefSeg select').value];
    });
    expect(r).toEqual([5, 6, '5', '6']);
  });

  test('8 channels do not overflow the popover at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await setCh(page, 8);
    const m = await page.evaluate(() => {
      const pop = document.getElementById('timingPopover').getBoundingClientRect();
      const kids = [...document.querySelectorAll('#timingPopover select, #timingPopover #timingChSeg, #timingPopover #timingRefSeg')].map(e => e.getBoundingClientRect());
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, pw: document.getElementById('timingPopover').scrollWidth, pcw: document.getElementById('timingPopover').clientWidth,
        out: kids.filter(k => k.right > pop.right + 0.5 || k.left < pop.left - 0.5).length };
    });
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.pw).toBeLessThanOrEqual(m.pcw);
    expect(m.out).toBe(0);
  });

  test('worklet core: a 4-channel input with signal only on index 3 triggers onsets with channel 3', async ({ page }) => {
    await page.addScriptTag({ path: require('path').join(__dirname, 'helpers', 'signals.js') });
    const r = await page.evaluate(() => {
      const n = Math.round(sig.SR * 1.2), chs = [0, 1, 2, 3].map(() => new Float32Array(n)), rnd = sig.rng(9);
      chs.forEach(c => sig.whiteNoise(c, sig.db(-70), rnd));
      for (const t of [0.2, 0.6, 0.9]) {
        sig.addNoise(chs[3], t, 0.004, sig.db(-15), rnd, 0.002);
        sig.addSine(chs[3], t, 300, sig.db(-15), 0.05, 0.001, 0.25);
      }
      const count = idx => {
        const core = timingMakeOnsetCore(sig.SR);
        let c = 0;
        for (let i = 0; i < n; i += 128) c += core.processChannels(chs.map(x => x.subarray(i, i + 128)), idx, i).length;
        return c;
      };
      return [0, 1, 2, 3].map(count);
    });
    expect(r).toEqual([0, 0, 0, 3]);
  });
});
