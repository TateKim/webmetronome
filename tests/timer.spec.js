const { test, expect } = require('@playwright/test');
const {
  navigateAndWait,
  setupShortTimer,
  startPlayback,
  stopPlayback,
  waitForAutoStop,
  getIsPlaying,
} = require('./helpers/metronome');

test.describe('Timer functionality', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  test.afterEach(async ({ page }) => {
    await stopPlayback(page);
  });

  test('should activate timer via state injection', async ({ page }) => {
    await setupShortTimer(page, 5);
    expect(await page.evaluate(() => isTimerActive)).toBe(true);
    expect(await page.evaluate(() => secondsRemaining)).toBe(5);
  });

  test('should countdown when playing', async ({ page }) => {
    await setupShortTimer(page, 5);
    await startPlayback(page);

    // Wait 2 seconds and check countdown decreased
    await page.waitForTimeout(2200);
    const remaining = await page.evaluate(() => secondsRemaining);
    expect(remaining).toBeLessThanOrEqual(3);
    expect(remaining).toBeGreaterThanOrEqual(1);
  });

  test('should auto-stop when timer expires', async ({ page }) => {
    await setupShortTimer(page, 3);
    await startPlayback(page);
    expect(await getIsPlaying(page)).toBe(true);

    // Wait for auto-stop (3s timer + measure boundary delay)
    await waitForAutoStop(page, 10000);
    expect(await getIsPlaying(page)).toBe(false);
  });

  test('should display timer in MM:SS format', async ({ page }) => {
    await setupShortTimer(page, 65);
    const display = await page.textContent('#timerCountdown');
    expect(display).toContain('01:05');
  });

  test('should show timer display container when active', async ({ page }) => {
    await setupShortTimer(page, 10);
    const visible = await page.isVisible('#timerDisplayContainer');
    expect(visible).toBe(true);
  });
});
