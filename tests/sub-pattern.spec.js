const { test, expect } = require('@playwright/test');
const { navigateAndWait } = require('./helpers/metronome');

// Sub pattern (per-beat subdivision rests) ---------------------------------------------

// Run one measure through the real nextNote()/scheduleNote(); returns the sounded clicks as "beat:cell" (cell = index in the beat's positions)
// and every scheduled click ("all", incl. rests) plus the Timing beat records.
async function runMeasure(page, { beats, sub, withTiming }) {
  return page.evaluate(({ beats, sub, withTiming }) => {
    initAudioContext();
    setBeats(beats);
    setSubdivision(sub);
    const sounded = [], all = [], recorded = [];
    const origPlay = playSound, origRec = timingRecordBeat, origOn = timingOn;
    let current = null;
    playSound = (time, tone) => { sounded.push(current); };
    if (withTiming) { timingOn = true; timingRecordBeat = (t, b) => recorded.push(b); }
    nextNoteTime = audioCtx.currentTime + 100;
    currentBeatIndex = 0;
    let guard = 0;
    while (guard++ < 200) {
      const idx = currentBeatIndex, main = Math.floor(idx + 0.05);
      current = main + ':' + (idx - main).toFixed(3);
      all.push(current);
      scheduleNote(idx, nextNoteTime);
      nextNote();
      if (currentBeatIndex === 0) break;
    }
    playSound = origPlay; timingRecordBeat = origRec; timingOn = origOn;
    return { sounded, all, recorded };
  }, { beats, sub, withTiming: !!withTiming });
}

const setPat = (page, sub, beat, mask) => page.evaluate(([s, b, m]) => { setSubdivision(s); setSubPatternOn(true); subPatSet(b, m); }, [sub, beat, mask]);

test.describe('Sub pattern - scheduler', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });

  const cases = [
    ['2', 2, 'o-x', 0b01, ['0:0.000']],
    ['2', 2, 'x-o', 0b10, ['0:0.500']],
    ['3', 3, 'o-x-o', 0b101, ['0:0.000', '0:0.667']],
    ['shuffle', 2, 'o-x', 0b01, ['0:0.000']],
    ['shuffle', 2, 'x-o', 0b10, ['0:0.667']],
    ['16shuffle', 4, 'x-o-o-x', 0b0110, ['0:0.333', '0:0.500']],
    ['4', 4, 'o-x-o-o', 0b1101, ['0:0.000', '0:0.500', '0:0.750']],
    ['5', 5, 'o-o-x-x-o', 0b10011, ['0:0.000', '0:0.200', '0:0.800']],
    ['6', 6, 'x-o-o-o-o-x', 0b011110, ['0:0.167', '0:0.333', '0:0.500', '0:0.667']],
  ];
  for (const [sub, cells, name, mask, expected] of cases) {
    test(`rhythm ${sub}: ${name} sounds exactly the "o" cells of beat 1, other beats are full`, async ({ page }) => {
      await page.evaluate(() => { setBeats(2); });
      await setPat(page, sub, 0, mask);
      const r = await runMeasure(page, { beats: 2, sub });
      expect(r.all.length).toBe(cells * 2);
      expect(r.sounded.filter(s => s.startsWith('0:'))).toEqual(expected);
      expect(r.sounded.filter(s => s.startsWith('1:')).length).toBe(cells);
    });
  }

  test('a rest on cell 0 mutes the beat click but still records the beat for Timing', async ({ page }) => {
    await page.evaluate(() => { setBeats(2); });
    await setPat(page, '2', 0, 0b10);
    const r = await runMeasure(page, { beats: 2, sub: '2', withTiming: true });
    expect(r.sounded).toEqual(['0:0.500', '1:0.000', '1:0.500']);
    expect(r.recorded).toEqual([0, 1]);
  });

  test('beat mute (state 3) still mutes the whole beat', async ({ page }) => {
    await page.evaluate(() => { setBeats(2); setBeatStates([3, 0]); });
    await setPat(page, '4', 1, 0b0011);
    const r = await runMeasure(page, { beats: 2, sub: '4' });
    expect(r.sounded.filter(s => s.startsWith('0:'))).toEqual([]); // the muted beat is silent, subdivisions included
    expect(r.sounded.filter(s => s.startsWith('1:'))).toEqual(['1:0.000', '1:0.250']);
  });

  test('rests are not reported as audible clicks (click-ref records only real playSound calls)', async ({ page }) => {
    await page.evaluate(() => { setBeats(1); });
    await setPat(page, '4', 0, 0b0001);
    const n = await page.evaluate(() => {
      initAudioContext();
      timingRefOn = true;
      const rec = [];
      const o = timingRecordClick;
      timingRecordClick = (t) => rec.push(t);
      nextNoteTime = audioCtx.currentTime + 100; currentBeatIndex = 0;
      for (let i = 0; i < 4; i++) { scheduleNote(currentBeatIndex, nextNoteTime); nextNote(); }
      timingRecordClick = o; timingRefOn = false;
      return rec.length;
    });
    expect(n).toBe(1);
  });

  test('off, quarter and 16th (4e) are unchanged', async ({ page }) => {
    await page.evaluate(() => { setBeats(2); });
    await setPat(page, '4', 0, 0b0001);
    await page.evaluate(() => setSubPatternOn(false));
    let r = await runMeasure(page, { beats: 2, sub: '4' });
    expect(r.sounded.length).toBe(8);
    await page.evaluate(() => setSubPatternOn(true));
    r = await runMeasure(page, { beats: 2, sub: '1' });
    expect(r.sounded.length).toBe(2);
    r = await runMeasure(page, { beats: 2, sub: '4e' });
    expect(r.sounded.map(s => s.split(':')[1])).toEqual(['0.000', '0.750', '0.000', '0.750']);
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(0);
  });
});

test.describe('Sub pattern - state', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });

  test('patterns survive rhythm switches (per cell count) and beat-count changes', async ({ page }) => {
    await page.evaluate(() => { setBeats(4); setSubPatternOn(true); setSubdivision('4'); subPatSet(1, 0b0101); setSubdivision('3'); subPatSet(1, 0b011); });
    await page.evaluate(() => setSubdivision('4'));
    expect(await page.evaluate(() => subMask(4, 1))).toBe(0b0101);
    expect(await page.evaluate(() => subMask(3, 1))).toBe(0b011);
    expect(await page.evaluate(() => subMask(4, 0))).toBe(0b1111);
    // the 8th and the 16th share no pattern; shuffle shares the 8th's cell count
    await page.evaluate(() => { setSubdivision('2'); subPatSet(0, 0b01); setSubdivision('shuffle'); });
    expect(await page.evaluate(() => subMask(2, 0))).toBe(0b01);
    // fewer beats drops the entries, more beats come back all on
    await page.evaluate(() => { setSubdivision('4'); setBeats(1); setBeats(4); });
    expect(await page.evaluate(() => subMask(4, 1))).toBe(0b1111);
    await page.evaluate(() => { setBeats(4); subPatSet(3, 0b0001); setBeats(6); });
    expect(await page.evaluate(() => [subMask(4, 3), subMask(4, 5)])).toEqual([0b0001, 0b1111]);
  });

  test('the switch toggles the same state in portrait; icons show only when on and the rhythm has cells', async ({ page }) => {
    await expect(page.locator('#subPatToggle')).toBeVisible();
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(0);
    await page.click('#subPatToggle');
    expect(await page.evaluate(() => subPatternOn)).toBe(true);
    await expect(page.locator('#subPatToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(0); // rhythm 1: no cells
    await page.evaluate(() => setSubdivision('4'));
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(4);
    await expect(page.locator('#beatContainer .sp-icon').first().locator('.sp-dot')).toHaveCount(4);
    await page.click('#subPatToggle');
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(0);
  });

  test('tapping a beat circle still cycles the tone; tapping the icon does not', async ({ page }) => {
    await page.evaluate(() => { setSubdivision('2'); setSubPatternOn(true); });
    const before = await page.evaluate(() => beatStates[1]);
    await page.locator('#beatContainer .beat-circle').nth(1).click({ position: { x: 20, y: 8 } });
    expect(await page.evaluate(() => beatStates[1])).toBe((before + 1) % 4);
    const b2 = await page.evaluate(() => beatStates[1]);
    await page.locator('#beatContainer .sp-icon').nth(1).click();
    expect(await page.evaluate(() => beatStates[1])).toBe(b2);
  });
});

test.describe('Sub pattern - editor', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
    await page.evaluate(() => { setSubdivision('4'); setSubPatternOn(true); });
  });

  test('tapping an icon opens the editor; cells toggle live; All on resets; Escape and outside click close', async ({ page }) => {
    await page.locator('#beatContainer .sp-icon').nth(1).click();
    const pop = page.locator('#subPatPop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.sp-cell')).toHaveCount(4);
    await pop.locator('.sp-cell').nth(1).click();
    await pop.locator('.sp-cell').nth(3).click();
    expect(await page.evaluate(() => subMask(4, 1))).toBe(0b0101);
    await expect(pop.locator('.sp-cell').nth(1)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#beatContainer .sp-icon').nth(1).locator('.sp-dot.on')).toHaveCount(2);
    await expect(pop).toBeVisible(); // stays open while editing
    await pop.getByText('All on').click();
    expect(await page.evaluate(() => subMask(4, 1))).toBe(0b1111);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await page.locator('#beatContainer .sp-icon').nth(0).click();
    await expect(pop).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(pop).toBeHidden();
  });

  test('opening another menu closes the editor and the editor closes the menus', async ({ page }) => {
    await page.locator('#beatContainer .sp-icon').nth(0).click();
    await expect(page.locator('#subPatPop')).toBeVisible();
    await page.click('#rhythmTrigger');
    await expect(page.locator('#subPatPop')).toBeHidden();
    await expect(page.locator('#rhythmMenu')).toBeVisible();
    await page.locator('#beatContainer .sp-icon').nth(0).click();
    await expect(page.locator('#rhythmMenu')).toBeHidden();
    await expect(page.locator('#subPatPop')).toBeVisible();
  });

  test('the editor follows live playback: edits apply to the running scheduler', async ({ page }) => {
    await page.evaluate(() => { setBeats(1); subPatSet(0, 0b1111); });
    const count = () => page.evaluate(() => {
      initAudioContext();
      let n = 0; const o = playSound; playSound = () => { n++; };
      nextNoteTime = audioCtx.currentTime + 0.01; currentBeatIndex = 0;
      const stop = nextNoteTime + 1; // the same loop the scheduler runs, over one second
      while (nextNoteTime < stop) { scheduleNote(currentBeatIndex, nextNoteTime); nextNote(); }
      playSound = o; return n;
    });
    const full = await count();
    await page.evaluate(() => subPatSet(0, 0b0001));
    const part = await count();
    expect(part).toBeLessThan(full);
  });
});

test.describe('Sub pattern - persistence and sharing', () => {
  const open = async (page, hash = '') => { await page.goto('about:blank'); await page.goto('/' + hash); await page.waitForSelector('#playBtn'); };

  test('state comes back after a reload with the same key', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { setBeats(3); setSubdivision('3'); setSubPatternOn(true); subPatSet(1, 0b101); stateSave(true); });
    const key = new URL(page.url()).hash;
    await open(page, key);
    expect(await page.evaluate(() => [subPatternOn, subdivision, subMask(3, 1), subMask(3, 0)])).toEqual([true, '3', 0b101, 0b111]);
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(3);
    await expect(page.locator('#beatContainer .sp-icon').nth(1).locator('.sp-dot.on')).toHaveCount(2);
  });

  test('share link round trip writes an optional trailing field', async ({ page }) => {
    await open(page);
    const link = await page.evaluate(() => {
      setBeats(3); setSubdivision('4'); setSubPatternOn(true); subPatSet(1, 0b1001); setSubdivision('2'); subPatSet(0, 0b10); setSubdivision('4');
      return stateEncodeShare(stateSnapshot());
    });
    expect(link).toMatch(/,Y(2:2|4:f-9)\.(2:2|4:f-9)$/);
    await open(page, '#' + link);
    expect(await page.evaluate(() => [subPatternOn, subdivision, subMask(4, 1), subMask(4, 2), subMask(2, 0), subMask(2, 1)])).toEqual([true, '4', 0b1001, 0b1111, 0b10, 0b11]);
  });

  test('no field when off or when every pattern is all-on; old links restore with the feature off; bad fields are ignored', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      setBeats(2); setSubdivision('4'); subPatSet(0, 0b0101);
      const off = stateEncodeShare(stateSnapshot());
      setSubPatternOn(true);
      subPatSet(0, 0b1111);
      const allOn = stateEncodeShare(stateSnapshot());
      return { off, allOn };
    });
    expect(r.off).not.toMatch(/,Y/);
    expect(r.allOn).not.toMatch(/,Y/);
    await open(page, '#~1,100,3,200,2,v60');
    expect(await page.evaluate(() => [subPatternOn, bpm, subMask(2, 0)])).toEqual([false, 100, 3]);
    await open(page, '#~1,100,2,20,4,Yzz,Y9:1,Y4:ff');
    expect(await page.evaluate(() => [subPatternOn, subMask(4, 0)])).toEqual([true, 15]);
    await open(page, '#~1,100,2,20,4,Yzz,Y9:1');
    expect(await page.evaluate(() => subPatternOn)).toBe(false);
  });
});

test.describe('Sub pattern - layout', () => {
  test('no horizontal overflow at 375 px with 8 beats of 16ths, and with 12 beats of sextuplets', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await navigateAndWait(page);
    await page.evaluate(() => { setBeats(8); setSubdivision('4'); setSubPatternOn(true); subPatSet(2, 0b0110); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const box = await page.locator('#beatContainer').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    // every icon stays inside the card and does not overlap the circles of the next row
    const bad = await page.evaluate(() => {
      const circles = [...beatContainer.children], out = [];
      circles.forEach((c, i) => {
        const ir = c.querySelector('.sp-icon').getBoundingClientRect();
        if (ir.left < 0 || ir.right > innerWidth) out.push('x' + i);
        circles.forEach((d, j) => { if (j !== i) { const r = d.getBoundingClientRect(); if (ir.left < r.right && ir.right > r.left && ir.top < r.bottom && ir.bottom > r.top) out.push(i + '/' + j); } });
      });
      return out;
    });
    expect(bad).toEqual([]);
    await page.evaluate(() => { setBeats(12); setSubdivision('6'); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});

test.describe('Sub pattern - practice mode', () => {
  test('the switch lives in the More overlay and shares the state; icons sit in the beat strip', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await navigateAndWait(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.evaluate(() => { timingMuteOnsets = true; timingNode.port.onmessage = null; setBeats(8); setSubdivision('4'); });
    await page.click('#practiceBtn');
    await expect(page.locator('body')).toHaveClass(/wm-practice/);
    await expect(page.locator('#subPatToggle')).toBeHidden();
    await page.click('#prMoreBtn');
    await expect(page.locator('#prSubSeg')).toBeVisible();
    await page.click('#prSubSeg button[data-v="on"]');
    expect(await page.evaluate(() => subPatternOn)).toBe(true);
    await expect(page.locator('#prSubSeg button[data-v="on"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(8);
    // the strip stays inside the viewport and icons do not overlap each other
    const ok = await page.evaluate(() => {
      const icons = [...beatContainer.querySelectorAll('.sp-icon')].map(i => i.getBoundingClientRect());
      return icons.every((r, i) => r.left >= 0 && r.right <= innerWidth && (i === 0 || r.left >= icons[i - 1].right - 1)) && document.documentElement.scrollWidth <= innerWidth;
    });
    expect(ok).toBe(true);
    // editor works in practice mode and closes the More overlay
    await page.locator('#beatContainer .sp-icon').nth(2).click();
    await expect(page.locator('#prMoreOv')).toBeHidden();
    await page.locator('#subPatPop .sp-cell').nth(0).click();
    expect(await page.evaluate(() => subMask(4, 2))).toBe(0b1110);
    await page.keyboard.press('Escape');
    // back to portrait: toggle shows the same state
    await page.click('#prExit');
    await expect(page.locator('#subPatToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#beatContainer .sp-icon')).toHaveCount(8);
  });
});

test.describe('Sub pattern - muted beat', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });
  const dots = (page, i) => page.evaluate((i) => [...beatContainer.children[i].querySelectorAll('.sp-dot')].map(d => d.classList.contains('on')), i);

  test('a muted beat shows all dots as rests, others unchanged, mask kept, restored on un-mute', async ({ page }) => {
    await page.evaluate(() => { setBeats(3); setBeatStates([0, 0, 0]); });
    await setPat(page, '4', 0, 0b0101);
    await setPat(page, '4', 1, 0b0011);
    expect(await dots(page, 0)).toEqual([true, false, true, false]);
    // cycle beat 0 through the circle tap: 0 -> 1 -> 2 -> 3
    for (let n = 0; n < 3; n++) await page.locator('#beatContainer .beat-circle').nth(0).click();
    expect(await page.evaluate(() => beatStates[0])).toBe(3);
    expect(await dots(page, 0)).toEqual([false, false, false, false]);
    expect(await dots(page, 1)).toEqual([true, true, false, false]);
    expect(await dots(page, 2)).toEqual([true, true, true, true]);
    expect(await page.evaluate(() => subMask(4, 0))).toBe(0b0101);
    await page.locator('#beatContainer .beat-circle').nth(0).click();
    expect(await page.evaluate(() => beatStates[0])).toBe(0);
    expect(await dots(page, 0)).toEqual([true, false, true, false]);
  });

  test('editor shows "Beat muted" with stored cells for a muted beat, and updates live', async ({ page }) => {
    await page.evaluate(() => { setBeats(2); setBeatStates([0, 0]); });
    await setPat(page, '4', 0, 0b0101);
    await page.locator('#beatContainer .sp-icon').nth(0).click();
    await expect(page.locator('#subPatPop .sp-note')).toHaveCount(0);
    await page.evaluate(() => setBeatStates([3, 0]));
    await expect(page.locator('#subPatPop')).toBeVisible();
    await expect(page.locator('#subPatPop .sp-note')).toHaveText('Beat muted');
    await expect(page.locator('#subPatPop .sp-cell').nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#subPatPop .sp-cell').nth(1)).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#subPatPop .sp-cells')).opacity))).toBeLessThan(1);
    await page.locator('#subPatPop .sp-cell').nth(1).click(); // still editable
    expect(await page.evaluate(() => subMask(4, 0))).toBe(0b0111);
    await page.evaluate(() => setBeatStates([0, 0]));
    await expect(page.locator('#subPatPop .sp-note')).toHaveCount(0);
  });
});
