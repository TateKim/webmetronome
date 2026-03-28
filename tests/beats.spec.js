const { test, expect } = require('@playwright/test');
const { navigateAndWait } = require('./helpers/metronome');

test.describe('Beat management', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  test('should display 4 beat circles by default', async ({ page }) => {
    const circles = await page.locator('#beatContainer > *').count();
    expect(circles).toBe(4);
  });

  test('should increase beat count', async ({ page }) => {
    await page.click('#increaseBeats');
    const circles = await page.locator('#beatContainer > *').count();
    expect(circles).toBe(5);
    expect(await page.evaluate(() => beatsPerMeasure)).toBe(5);
  });

  test('should decrease beat count', async ({ page }) => {
    await page.click('#decreaseBeats');
    const circles = await page.locator('#beatContainer > *').count();
    expect(circles).toBe(3);
    expect(await page.evaluate(() => beatsPerMeasure)).toBe(3);
  });

  test('should not go below 1 beat', async ({ page }) => {
    // Click decrease many times
    for (let i = 0; i < 10; i++) {
      await page.click('#decreaseBeats');
    }
    const circles = await page.locator('#beatContainer > *').count();
    expect(circles).toBe(1);
    expect(await page.evaluate(() => beatsPerMeasure)).toBe(1);
  });

  test('should not go above 12 beats', async ({ page }) => {
    // Click increase many times
    for (let i = 0; i < 20; i++) {
      await page.click('#increaseBeats');
    }
    const circles = await page.locator('#beatContainer > *').count();
    expect(circles).toBe(12);
    expect(await page.evaluate(() => beatsPerMeasure)).toBe(12);
  });

  test('should cycle beat state on click', async ({ page }) => {
    // Get the first beat circle
    const firstBeat = page.locator('#beatContainer > *').first();

    // First beat defaults to state 2 (strong accent)
    let state = await page.evaluate(() => beatStates[0]);
    expect(state).toBe(2);

    // Click to cycle: 2 -> 3 (mute)
    await firstBeat.click();
    state = await page.evaluate(() => beatStates[0]);
    expect(state).toBe(3);

    // Click again: 3 -> 0 (normal)
    await firstBeat.click();
    state = await page.evaluate(() => beatStates[0]);
    expect(state).toBe(0);

    // Click again: 0 -> 1 (accent)
    await firstBeat.click();
    state = await page.evaluate(() => beatStates[0]);
    expect(state).toBe(1);

    // Click again: 1 -> 2 (back to strong accent)
    await firstBeat.click();
    state = await page.evaluate(() => beatStates[0]);
    expect(state).toBe(2);
  });
});
