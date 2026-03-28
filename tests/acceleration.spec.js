const { test, expect } = require('@playwright/test');
const {
  navigateAndWait,
  getBpm,
  setupAccelTest,
  startPlayback,
  stopPlayback,
  waitForAutoStop,
  buildSchedule,
  getAccelMeasureCount,
  getIsPlaying,
} = require('./helpers/metronome');

test.describe('Acceleration - Schedule precomputation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  test('linear schedule should be monotonically increasing', async ({ page }) => {
    const schedule = await buildSchedule(page, {
      startBpm: 120, targetBpm: 130, durationSecs: 30, mode: 'linear',
    });

    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0].bpm).toBe(120);
    expect(schedule[schedule.length - 1].bpm).toBe(130);

    // Monotonically increasing
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].bpm).toBeGreaterThanOrEqual(schedule[i - 1].bpm);
    }
  });

  test('count schedule should have equal reps per step', async ({ page }) => {
    const schedule = await buildSchedule(page, {
      startBpm: 120, targetBpm: 130, durationSecs: 30, mode: 'count',
    });

    expect(schedule.length).toBeGreaterThan(1);

    // In count mode, all steps have the same number of reps (cycles)
    // Verify by checking startRep deltas are proportional to measure duration
    // Count mode: each BPM gets `cycles` reps, so reps per step = cycles
    const reps = [];
    for (let i = 0; i < schedule.length; i++) {
      const nextStart = i < schedule.length - 1 ? schedule[i + 1].startRep : undefined;
      if (nextStart !== undefined) {
        reps.push(nextStart - schedule[i].startRep);
      }
    }
    // In count mode, each step gets the same number of reps
    const allEqual = reps.every(r => r === reps[0]);
    expect(allEqual).toBe(true);
  });

  test('weighted schedule should front-load slower BPMs', async ({ page }) => {
    const schedule = await buildSchedule(page, {
      startBpm: 120, targetBpm: 140, durationSecs: 60, mode: 'weighted', weight: 3,
    });

    expect(schedule.length).toBeGreaterThan(2);

    // Calculate reps per step
    const reps = [];
    for (let i = 0; i < schedule.length; i++) {
      const nextStart = i < schedule.length - 1 ? schedule[i + 1].startRep : undefined;
      if (nextStart !== undefined) {
        reps.push(nextStart - schedule[i].startRep);
      }
    }

    // First step should have more or equal reps than last step (front-loaded)
    if (reps.length >= 2) {
      expect(reps[0]).toBeGreaterThanOrEqual(reps[reps.length - 1]);
    }
  });

  test('schedule should cover full BPM range (60->200)', async ({ page }) => {
    const schedule = await buildSchedule(page, {
      startBpm: 60, targetBpm: 200, durationSecs: 60, mode: 'linear',
    });

    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0].bpm).toBe(60);
    expect(schedule[schedule.length - 1].bpm).toBe(200);
  });

  test('schedule should be empty when start equals target', async ({ page }) => {
    const schedule = await buildSchedule(page, {
      startBpm: 120, targetBpm: 120, durationSecs: 30, mode: 'linear',
    });

    expect(schedule.length).toBe(0);
  });

  test('deceleration schedule should be monotonically decreasing', async ({ page }) => {
    const schedule = await buildSchedule(page, {
      startBpm: 150, targetBpm: 100, durationSecs: 30, mode: 'linear',
    });

    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0].bpm).toBe(150);
    expect(schedule[schedule.length - 1].bpm).toBe(100);

    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].bpm).toBeLessThanOrEqual(schedule[i - 1].bpm);
    }
  });
});

test.describe('Acceleration - Live playback', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  test.afterEach(async ({ page }) => {
    await stopPlayback(page);
  });

  test('short range linear (120->125, 5s) should reach target', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 120, targetBpm: 125, durationSecs: 5, mode: 'linear',
    });
    await startPlayback(page);
    await waitForAutoStop(page, 15000);

    const finalBpm = await getBpm(page);
    expect(finalBpm).toBeGreaterThanOrEqual(124);
    expect(finalBpm).toBeLessThanOrEqual(126);

    // accelMeasureCount resets to 0 on stop, so verify BPM changed as proof of advancement
    expect(finalBpm).not.toBe(120);
  });

  test('short range count (120->125, 5s) should reach target', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 120, targetBpm: 125, durationSecs: 5, mode: 'count',
    });
    await startPlayback(page);
    await waitForAutoStop(page, 15000);

    const finalBpm = await getBpm(page);
    expect(finalBpm).toBeGreaterThanOrEqual(124);
    expect(finalBpm).toBeLessThanOrEqual(126);
  });

  test('short range weighted (120->125, 5s) should reach target', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 120, targetBpm: 125, durationSecs: 5, mode: 'weighted', weight: 2,
    });
    await startPlayback(page);
    await waitForAutoStop(page, 15000);

    const finalBpm = await getBpm(page);
    expect(finalBpm).toBeGreaterThanOrEqual(124);
    expect(finalBpm).toBeLessThanOrEqual(126);
  });

  test('long range linear (60->200, 5s) should reach target', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 60, targetBpm: 200, durationSecs: 5, mode: 'linear',
    });
    await startPlayback(page);
    await waitForAutoStop(page, 15000);

    const finalBpm = await getBpm(page);
    // With a very wide range in short time, allow some tolerance
    expect(finalBpm).toBeGreaterThanOrEqual(190);
  });

  test('long range count (60->200, 5s) should reach target', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 60, targetBpm: 200, durationSecs: 5, mode: 'count',
    });
    await startPlayback(page);
    await waitForAutoStop(page, 15000);

    const finalBpm = await getBpm(page);
    expect(finalBpm).toBeGreaterThanOrEqual(190);
  });

  test('long range weighted (60->200, 5s, weight=3) should reach target', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 60, targetBpm: 200, durationSecs: 5, mode: 'weighted', weight: 3,
    });
    await startPlayback(page);
    await waitForAutoStop(page, 15000);

    const finalBpm = await getBpm(page);
    expect(finalBpm).toBeGreaterThanOrEqual(190);
  });

  test('deceleration (150->100, 5s) should decrease BPM', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 150, targetBpm: 100, durationSecs: 5, mode: 'linear',
    });
    await startPlayback(page);
    await waitForAutoStop(page, 15000);

    const finalBpm = await getBpm(page);
    expect(finalBpm).toBeLessThanOrEqual(102);
    expect(finalBpm).toBeGreaterThanOrEqual(98);
  });

  test('accel should not activate without timer', async ({ page }) => {
    // Set target BPM but no timer
    await page.evaluate(() => {
      accelTargetBpm = 150;
      accelStartBpm = 120;
      // isTimerActive remains false
    });

    const active = await page.evaluate(() => isAccelActive());
    expect(active).toBe(false);
  });

  test('reset button should restore original BPM after accel run', async ({ page }) => {
    await setupAccelTest(page, {
      startBpm: 120, targetBpm: 130, durationSecs: 3, mode: 'linear',
    });
    await startPlayback(page);
    await waitForAutoStop(page, 10000);

    // After stop, BPM should have changed
    const finalBpm = await getBpm(page);
    expect(finalBpm).toBeGreaterThan(120);

    // Reset button should be visible
    const resetVisible = await page.evaluate(() => {
      return accelResetBtn.style.display !== 'none';
    });
    expect(resetVisible).toBe(true);

    // Click reset
    await page.click('#accelResetBtn');

    // BPM should be restored to original
    const restoredBpm = await getBpm(page);
    expect(restoredBpm).toBe(120);
  });
});
