const { test, expect } = require('@playwright/test');
const { navigateAndWait, clickPlay } = require('./helpers/metronome');

// Timeline history, scroll and zoom ------------------------------------------------------

async function open(page) {
  await navigateAndWait(page);
  await page.click('#timingBtn');
  await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
  await page.evaluate(() => { timingMuteOnsets = true; timingNode.port.onmessage = null; updateBpm(250); });
}
// accepted hits `barsAgo[i]` bars before NOW (synthetic, drawn in the Timeline)
const injectAt = (page, barsAgo) => page.evaluate((list) => {
  list.forEach((b, i) => {
    const hit = { t: timingNowSec() - b * timingBarDur(), offsetMs: 5, beatGlobal: i, beatInMeasure: 0, posInBeat: 0, role: 0, peakDb: -20 };
    timingHits.push(hit); timingTlAddDot(hit);
  });
  timingHits.sort((a, b) => a.t - b.t);
}, barsAgo);
const wheel = (page, x, deltaY, extra = {}) => page.evaluate(([x, deltaY, extra]) => {
  const el = document.getElementById('timingTimeline'), r = el.getBoundingClientRect();
  el.dispatchEvent(new WheelEvent('wheel', Object.assign({ clientX: r.left + x, clientY: r.top + 40, deltaY, bubbles: true, cancelable: true }, extra)));
}, [x, deltaY, extra]);
const flush = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const drag = async (page, dx) => {
  const r = await page.locator('#timingTimeline').boundingBox();
  const y = r.y + r.height / 2, x0 = r.x + r.width / 2;
  await page.mouse.move(x0, y); await page.mouse.down();
  await page.mouse.move(x0 + dx / 2, y, { steps: 4 }); await page.mouse.move(x0 + dx, y, { steps: 4 });
  await page.mouse.up();
};
const timeAt = (page, x) => page.evaluate((x) => (timingTl.live ? timingNowSec() : timingTl.viewT) - (timingTl.playX - x) / timingTl.pps, x);

test.describe('Timeline history, scroll and zoom', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 375, height: 700 }); await open(page); });

  test('keeps 20 bars of hits, drops older ones; the beat log is time-bounded', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(4);
    await injectAt(page, [25, 21, 19, 10, 3]);
    await page.evaluate(() => { timingUpdateSummary(); timingTlPrune(timingNowSec()); });
    expect(await page.evaluate(() => timingHits.length)).toBe(3);
    await expect(page.locator('#timingTrack .tm-dot')).toHaveCount(3);
    expect(await page.evaluate(() => timingBeats.length <= (TIMING_HISTORY_BARS + 1) * beatsPerMeasure + 2)).toBe(true);
  });

  test('Ctrl+wheel zooms within 1..20 bars, anchored at the pointer when stopped', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(8);
    await page.waitForTimeout(1500);
    await clickPlay(page); // stopped: the zoom anchors at the pointer
    expect(await page.evaluate(() => timingTlBars())).toBe(2);
    const before = await timeAt(page, 150);
    await wheel(page, 150, -100, { ctrlKey: true }); // zoom in (zooming out is limited by the little data recorded here)
    await flush(page);
    expect(await page.evaluate(() => timingTlBars())).toBeLessThan(2);
    expect(await page.evaluate(() => Math.abs(timingTl.pps - timingTl.playX / (timingTlBars() * timingBarDur())))).toBeLessThan(1e-3);
    expect(Math.abs((await timeAt(page, 150)) - before)).toBeLessThan(0.05);
    for (let i = 0; i < 30; i++) await wheel(page, 150, 400, { ctrlKey: true });
    await flush(page);
    expect(await page.evaluate(() => timingTlBars())).toBe(20);
    for (let i = 0; i < 60; i++) await wheel(page, 150, -400, { ctrlKey: true });
    await flush(page);
    expect(await page.evaluate(() => timingTlBars())).toBe(1);
    await expect.poll(() => page.evaluate(() => timingLsGet('wm.timing.tlbars'))).toBe('1');
    await page.evaluate(() => timingTlGoLive(false)); // the anchored zoom detached from live
    await expect(page.locator('#timingAvgLabel')).toHaveText('Avg · last 1 bar');
  });

  test('drag scroll back freezes the view while playing, hits keep being recorded; Now returns to live', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(8);
    await page.evaluate(() => timingTlSetBars(3, null, false, true));
    await page.waitForTimeout(2500);
    await expect(page.locator('#timingNowBtn')).toBeHidden();
    await drag(page, 120);
    expect(await page.evaluate(() => timingTl.live)).toBe(false);
    await expect(page.locator('#timingNowBtn')).toBeVisible();
    const vt = await page.evaluate(() => timingTl.viewT);
    const tr1 = await page.evaluate(() => document.getElementById('timingTrack').style.transform);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => timingTl.viewT)).toBe(vt);
    expect(await page.evaluate(() => document.getElementById('timingTrack').style.transform)).toBe(tr1);
    const n0 = await page.evaluate(() => timingHits.length);
    await page.evaluate(() => { const b = timingBeats.filter(b => b.dur > 0).slice(-2)[0]; timingHandleOnset(b.time + timingLatencyMs / 1000 + 0.003, -20); });
    expect(await page.evaluate(() => timingHits.length)).toBe(n0 + 1);
    await expect(page.locator('#timingAvgLabel')).toHaveText('Avg · visible');
    await page.click('#timingNowBtn');
    await expect.poll(() => page.evaluate(() => timingTl.live)).toBe(true);
    await expect(page.locator('#timingNowBtn')).toBeHidden();
    await expect(page.locator('#timingAvgLabel')).toHaveText('Avg · last 3 bars');
    // Start of a new take also returns to live
    await drag(page, 100);
    expect(await page.evaluate(() => timingTl.live)).toBe(false);
    await clickPlay(page); await clickPlay(page);
    expect(await page.evaluate(() => timingTl.live)).toBe(true);
  });

  test('cannot scroll past the oldest data or past NOW; summary follows the visible window', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(8);
    await page.waitForTimeout(1200);
    await clickPlay(page);
    await page.evaluate(() => { timingTlSetBars(4, null, false, true); });
    await injectAt(page, [0.1, 0.3, 1.0]);
    await page.evaluate(() => { timingUpdateSummary(); });
    await wheel(page, 100, -100000, { shiftKey: true });
    const st = await page.evaluate(() => ({ left: timingTl.viewT - timingTl.playX / timingTl.pps, oldest: timingBeats[0].time, live: timingTl.live }));
    expect(st.left).toBeGreaterThanOrEqual(st.oldest - 1e-6);
    await wheel(page, 100, 100000, { shiftKey: true });
    expect(await page.evaluate(() => timingTl.live)).toBe(true);
    await page.evaluate(() => { timingTlScrollTo(timingNowSec() - 0.8 * timingBarDur()); timingTlFlush(); });
    await expect(page.locator('#timingAvgLabel')).toHaveText('Avg · visible');
    const hits = await page.evaluate(() => { const tl = timingTl, l = tl.viewT - tl.playX / tl.pps, r = tl.viewT + (tl.w - tl.playX) / tl.pps; return timingHits.filter(h => h.t >= l && h.t <= r).length; });
    await expect(page.locator('#timingHitCount')).toHaveText(hits ? String(hits) : '–');
  });

  test('keyboard: arrows scroll, + / - zoom, End returns to live', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(8);
    await page.waitForTimeout(1200);
    await clickPlay(page);
    await page.focus('#timingTimeline');
    const b0 = await page.evaluate(() => timingTlBars());
    await page.keyboard.press('+');
    expect(await page.evaluate(() => timingTlBars())).toBeLessThan(b0);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    expect(await page.evaluate(() => timingTlBars())).toBeGreaterThan(b0);
    const bpm0 = await page.evaluate(() => bpm);
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => timingTl.live)).toBe(false);
    expect(await page.evaluate(() => bpm)).toBe(bpm0);
    await page.keyboard.press('End');
    await expect.poll(() => page.evaluate(() => timingTl.live)).toBe(true);
  });
});

test.describe('Timeline zoom - practice mode', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 844, height: 390 }); await open(page); await page.click('#practiceBtn'); });

  test('presets 2 / 4 / 8 set the zoom and are lit only when the zoom equals them', async ({ page }) => {
    await page.click('#prMoreBtn');
    const lit = () => page.evaluate(() => [...document.querySelectorAll('#prBarsSeg button[aria-pressed="true"]')].map(b => b.dataset.v));
    expect(await lit()).toEqual(['4']);
    await page.click('#prBarsSeg button[data-v="8"]');
    expect(await page.evaluate(() => practice.bars)).toBe(8);
    expect(await lit()).toEqual(['8']);
    await wheel(page, 200, -100, { ctrlKey: true });
    await flush(page);
    expect(await lit()).toEqual([]);
    expect(await page.evaluate(() => practice.bars)).toBeLessThan(8);
    await page.click('#prBarsSeg button[data-v="2"]');
    expect(await lit()).toEqual(['2']);
    expect(await page.evaluate(() => timingLsGet('wm.practice.bars'))).toBe('2');
  });

  test('Now button and gestures survive practice mode re-parenting', async ({ page }) => {
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.length)).toBeGreaterThan(8);
    await page.waitForTimeout(1200);
    await drag(page, 100);
    await expect(page.locator('#prMain #timingNowBtn')).toBeVisible();
    await page.click('#prExit');
    await expect(page.locator('#timingNowBtn')).toBeVisible();
    await page.click('#timingNowBtn');
    await expect.poll(() => page.evaluate(() => timingTl.live)).toBe(true);
  });
});

test.describe('Timing settings popover in practice mode', () => {
  for (const [w, h] of [[900, 420], [740, 360]]) {
    test(`opens next to the button (${w}x${h})`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page);
      await page.click('#practiceBtn');
      await page.click('#prMoreBtn');
      await page.click('#timingSetBtn');
      await expect(page.locator('#timingPopover')).toBeVisible();
      await page.waitForTimeout(250); // fadeIn animation
      const g = await page.evaluate(() => {
        const r = (id) => { const q = document.getElementById(id).getBoundingClientRect(); return { left: q.left, right: q.right, top: q.top, bottom: q.bottom, width: q.width }; };
        return { p: r('timingPopover'), b: r('timingSetBtn'), o: r('prMoreOv'), vw: innerWidth, vh: innerHeight };
      });
      expect(g.p.left).toBeGreaterThanOrEqual(7.5); expect(g.p.top).toBeGreaterThanOrEqual(7.5);
      expect(g.p.right).toBeLessThanOrEqual(g.vw - 7.5); expect(g.p.bottom).toBeLessThanOrEqual(g.vh - 7.5);
      if (g.o.left - 8 - g.p.width >= 8) {
        expect(g.p.right).toBeLessThanOrEqual(g.o.left - 7.5);
        if (g.p.bottom < g.vh - 8 - 1) expect(Math.abs(g.p.top - g.b.top)).toBeLessThan(9); // else clamped to the viewport bottom
      }
      await page.screenshot({ path: `tmp/zoom/popover-${w}x${h}.png` });
      await page.setViewportSize({ width: w - 40, height: h });
      const r = await page.evaluate(() => { const p = document.getElementById('timingPopover').getBoundingClientRect(); return [p.left, p.right, innerWidth]; });
      expect(r[0]).toBeGreaterThanOrEqual(7.5); expect(r[1]).toBeLessThanOrEqual(r[2] - 7.5);
    });
  }
});
