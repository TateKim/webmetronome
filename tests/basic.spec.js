const { test, expect } = require('@playwright/test');
const { navigateAndWait, getBpm, setBpm, clickPlay, getIsPlaying } = require('./helpers/metronome');

test.describe('Basic metronome controls', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  test('should start and stop playback', async ({ page }) => {
    expect(await getIsPlaying(page)).toBe(false);
    expect(await page.textContent('#playText')).toBe('START');

    await clickPlay(page);
    expect(await getIsPlaying(page)).toBe(true);
    expect(await page.textContent('#playText')).toBe('STOP');

    await clickPlay(page);
    expect(await getIsPlaying(page)).toBe(false);
    expect(await page.textContent('#playText')).toBe('START');
  });

  test('should display default BPM of 120', async ({ page }) => {
    expect(await page.textContent('#bpmDisplay')).toBe('120');
    expect(await getBpm(page)).toBe(120);
  });

  test('should increment BPM with +1 button', async ({ page }) => {
    await page.click('#increaseBpm');
    expect(await getBpm(page)).toBe(121);
    expect(await page.textContent('#bpmDisplay')).toBe('121');
  });

  test('should decrement BPM with -1 button', async ({ page }) => {
    await page.click('#decreaseBpm');
    expect(await getBpm(page)).toBe(119);
    expect(await page.textContent('#bpmDisplay')).toBe('119');
  });

  test('should increment BPM with +5 button', async ({ page }) => {
    await page.click('#increaseBpm5');
    expect(await getBpm(page)).toBe(125);
    expect(await page.textContent('#bpmDisplay')).toBe('125');
  });

  test('should decrement BPM with -5 button', async ({ page }) => {
    await page.click('#decreaseBpm5');
    expect(await getBpm(page)).toBe(115);
    expect(await page.textContent('#bpmDisplay')).toBe('115');
  });

  test('should update BPM via slider', async ({ page }) => {
    await page.fill('#bpmSlider', '180');
    await page.dispatchEvent('#bpmSlider', 'input');
    expect(await getBpm(page)).toBe(180);
    expect(await page.textContent('#bpmDisplay')).toBe('180');
  });

  test('should clamp BPM to minimum 30', async ({ page }) => {
    await setBpm(page, 10);
    expect(await getBpm(page)).toBe(30);
  });

  test('should clamp BPM to maximum 250', async ({ page }) => {
    await setBpm(page, 300);
    expect(await getBpm(page)).toBe(250);
  });

  test('should toggle play with Space key', async ({ page }) => {
    await page.keyboard.press('Space');
    expect(await getIsPlaying(page)).toBe(true);

    await page.keyboard.press('Space');
    expect(await getIsPlaying(page)).toBe(false);
  });

  test('should adjust BPM with arrow keys', async ({ page }) => {
    await page.keyboard.press('ArrowUp');
    expect(await getBpm(page)).toBe(121);

    await page.keyboard.press('ArrowDown');
    expect(await getBpm(page)).toBe(120);
  });
});
