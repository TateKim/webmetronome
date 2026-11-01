const { test, expect } = require('@playwright/test');

// Session key (URL state) -------------------------------------------------------------

const KEY_RE = /^[a-z0-9]{8}$/;
const keyOf = (page) => new URL(page.url()).hash.slice(1);
// Fresh load of "/" + hash (via about:blank, so the same key still reloads the page)
const open = async (page, hash = '') => { await page.goto('about:blank'); await page.goto('/' + hash); await page.waitForSelector('#playBtn'); };
const saved = (page, k) => page.evaluate((key) => JSON.parse(localStorage.getItem('wm.s.' + key)), k);
const flush = (page) => page.evaluate(() => stateSave(false));

test.describe('Session key', () => {
  test('no key -> a key is added with replaceState (history length unchanged, other parts kept)', async ({ page }) => {
    await page.goto('/?x=1');
    await page.waitForSelector('#playBtn');
    const len = await page.evaluate(() => history.length);
    expect(keyOf(page)).toMatch(KEY_RE);
    const u = new URL(page.url());
    expect(u.searchParams.get('x')).toBe('1');
    expect(u.hash).toMatch(/^#[a-z0-9]{8}$/);
    expect(u.pathname).toBe('/');
    await page.reload();
    await page.waitForSelector('#playBtn');
    expect(await page.evaluate(() => history.length)).toBe(len);
  });

  test('an invalid key is replaced; a valid one is kept', async ({ page }) => {
    await open(page, '#BAD!');
    expect(keyOf(page)).toMatch(KEY_RE);
    await open(page, '#abcd1234');
    expect(keyOf(page)).toBe('abcd1234');
  });

  test('changing the hash in the same tab loads the state of that key; junk puts the current key back', async ({ page }) => {
    await open(page, '#keya0001');
    await page.evaluate(() => { updateBpm(66); stateSave(false); });
    await open(page, '#keyb0001');
    await page.evaluate(() => { updateBpm(144); stateSave(false); });
    const nav = page.waitForEvent('load');
    await page.evaluate(() => { location.hash = 'keya0001'; });
    await nav;
    await page.waitForSelector('#playBtn');
    expect(await page.evaluate(() => [sessKey, bpm])).toEqual(['keya0001', 66]);
    await page.evaluate(() => { location.hash = 'BAD!'; });
    await expect.poll(() => keyOf(page)).toBe('keya0001');
    expect(await page.evaluate(() => bpm)).toBe(66);
  });

  test('metronome state comes back with the same key', async ({ page }) => {
    await open(page);
    const k = keyOf(page);
    await page.evaluate(() => {
      updateBpm(93);
      setBeats(7);
      setBeatStates([2, 1, 0, 3, 0, 1, 0]);
      setSubdivision('shuffle');
      setVolume(35);
      applyTimerChoice(10, false);
      setAccelMode('weighted');
      setAccelWeight(3.5);
      accelEditBpm = 140;
      setAccelTarget(140);
    });
    await flush(page);
    await open(page, '#' + k);
    const st = await page.evaluate(() => ({
      bpm, beatsPerMeasure, beatStates, subdivision, masterVolume, isMuted, isTimerActive, targetDuration,
      accelTargetBpm, accelMode, accelWeight, slider: bpmSlider.value, beatCircles: document.querySelectorAll('.beat-circle').length,
      timerShown: !timerDisplayContainer.classList.contains('hidden'), rhythm: document.querySelector('#rhythmMenu .selected')?.dataset.value,
      isPlaying
    }));
    expect(st).toMatchObject({
      bpm: 93, beatsPerMeasure: 7, beatStates: [2, 1, 0, 3, 0, 1, 0], subdivision: 'shuffle', isMuted: false,
      isTimerActive: true, targetDuration: 10, accelTargetBpm: 140, accelMode: 'weighted', accelWeight: 3.5,
      slider: '93', beatCircles: 7, timerShown: true, isPlaying: false
    });
    expect(st.masterVolume).toBeCloseTo(0.35);
    expect(st.rhythm).toBe('shuffle');
  });

  test('mute and the custom timer are restored', async ({ page }) => {
    await open(page);
    const k = keyOf(page);
    await page.evaluate(() => { timerCustomMinutes = 25; applyTimerChoice(25, true); setVolume(60); setMuted(true); });
    await flush(page);
    await open(page, '#' + k);
    const st = await page.evaluate(() => ({ isMuted, masterVolume, timerIsCustom, targetDuration, timerCustomMinutes, vol: volumeSlider.value }));
    expect(st).toMatchObject({ isMuted: true, timerIsCustom: true, targetDuration: 25, timerCustomMinutes: 25, vol: '0' });
    expect(st.masterVolume).toBeCloseTo(0.6);
    // unmuting returns to the saved volume
    await page.evaluate(() => setMuted(false));
    expect(await page.evaluate(() => volumeSlider.value)).toBe('60');
  });

  test('a running accel ramp is saved as its starting BPM; nothing autoplays', async ({ page }) => {
    await open(page);
    const k = keyOf(page);
    await page.evaluate(() => { updateBpm(100); applyTimerChoice(1, false); accelEditBpm = 160; setAccelTarget(160); togglePlay(); });
    await page.waitForFunction(() => isPlaying);
    await page.evaluate(() => updateBpm(133)); // as if the ramp had moved it
    await flush(page);
    expect((await saved(page, k)).bpm).toBe(100);
    await open(page, '#' + k);
    expect(await page.evaluate(() => isPlaying)).toBe(false);
  });

  test('another key starts from the defaults', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { updateBpm(77); setBeats(3); });
    await flush(page);
    await open(page, '#zzzz9999');
    expect(await page.evaluate(() => [bpm, beatsPerMeasure, subdivision])).toEqual([120, 4, '1']);
  });

  test('corrupt or foreign-version JSON -> defaults, no crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    for (const bad of ['{not json', '{"v":2,"bpm":50}', '"str"', 'null']) {
      await page.evaluate((b) => localStorage.setItem('wm.s.corrupt01', b), bad);
      await open(page, '#corrupt01');
      expect(await page.evaluate(() => bpm)).toBe(120);
    }
    // bad fields are ignored one by one, good ones still apply
    await page.evaluate(() => localStorage.setItem('wm.s.fields001', JSON.stringify({ v: 1, bpm: 'x', beats: 99, beatStates: [9], sub: 'nope', vol: 'a', tRes: '7', accel: 5 })));
    await open(page, '#fields001');
    expect(await page.evaluate(() => [bpm, beatsPerMeasure, subdivision])).toEqual([120, 12, '1']);
    expect(errors).toEqual([]);
  });

  test('values out of range are clamped like the UI does', async ({ page }) => {
    await open(page);
    await page.evaluate(() => localStorage.setItem('wm.s.clamp0001', JSON.stringify({ v: 1, bpm: 900, vol: 500 })));
    await open(page, '#clamp0001');
    expect(await page.evaluate(() => [bpm, masterVolume])).toEqual([250, 1]);
  });

  test('Timing prefs come from the snapshot and do not overwrite the globals', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { timingSetView('beats'); timingSetRes('8'); timingSetShuffle(true); timingSetRange(100); practiceSetBars(4); });
    const k = keyOf(page);
    await flush(page);
    // another session changes the globals
    await page.evaluate(() => { localStorage.setItem('wm.timing.view', 'timeline'); localStorage.setItem('wm.timing.res', '32'); localStorage.setItem('wm.timing.shuffle', 'false'); localStorage.setItem('wm.timing.range', '200'); localStorage.setItem('wm.practice.bars', '8'); });
    await open(page, '#' + k);
    expect(await page.evaluate(() => [timingView, timingRes, timingShuffle, timingRangeMs, practice.bars])).toEqual(['beats', '8', true, 100, 4]);
    expect(await page.evaluate(() => [localStorage.getItem('wm.timing.view'), localStorage.getItem('wm.timing.res'), localStorage.getItem('wm.practice.bars')])).toEqual(['timeline', '32', '8']);
    // a key with no snapshot uses the globals
    await open(page, '#nosnap001');
    expect(await page.evaluate(() => [timingView, timingRes, practice.bars])).toEqual(['timeline', '32', 8]);
  });

  test('index is capped at 50 keys; older snapshots are deleted', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const idx = [];
      for (let i = 0; i < 60; i++) { const k = 'old' + String(i).padStart(4, '0'); localStorage.setItem('wm.s.' + k, '{"v":1}'); idx.push({ k, at: 1000 + i }); }
      localStorage.setItem('wm.s.index', JSON.stringify(idx));
    });
    await page.evaluate(() => { updateBpm(101); stateSave(false); });
    const r = await page.evaluate(() => ({ idx: JSON.parse(localStorage.getItem('wm.s.index')), keys: Object.keys(localStorage).filter(k => k.startsWith('wm.s.') && k !== 'wm.s.index'), cur: sessKey }));
    expect(r.idx.length).toBe(50);
    expect(r.idx[0].k).toBe(r.cur);
    expect(r.keys.length).toBe(50);
    expect(r.keys).not.toContain('wm.s.old0000');
    expect(r.keys).toContain('wm.s.old0059');
  });
});

test.describe('Session key - Timing restore', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('with the microphone granted, Timing and Practice come back', async ({ context, page }) => {
    await context.grantPermissions(['microphone']);
    await open(page);
    const k = keyOf(page);
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await page.click('#practiceBtn');
    await expect(page.locator('body')).toHaveClass(/wm-practice/);
    await page.evaluate(() => { practiceSetBars(4); });
    await flush(page);
    expect(await saved(page, k)).toMatchObject({ timing: true, practice: true, bars: 4 });
    await open(page, '#' + k);
    await expect.poll(() => page.evaluate(() => timingOn && !!timingStream)).toBe(true);
    await expect(page.locator('body')).toHaveClass(/wm-practice/);
    expect(await page.evaluate(() => [practice.on, practice.bars, isPlaying])).toEqual([true, 4, false]);
  });

  test('without permission Timing stays off but the saved flags are kept until the user turns it on', async ({ page }) => {
    await open(page);
    const k = keyOf(page);
    await page.evaluate((key) => localStorage.setItem('wm.s.' + key, JSON.stringify({ v: 1, at: 1, bpm: 90, timing: true, practice: true })), k);
    await open(page, '#' + k);
    expect(await page.evaluate(() => [bpm, timingOn])).toEqual([90, false]);
    await page.evaluate(() => stateSave(true));
    expect(await saved(page, k)).toMatchObject({ bpm: 90, timing: true, practice: true });
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    await expect(page.locator('body')).toHaveClass(/wm-practice/, { timeout: 5000 });
  });
});

test.describe('Share link', () => {
  const fullState = () => {
    updateBpm(93); setBeats(7); setBeatStates([2, 1, 0, 3, 0, 1, 0]); setSubdivision('16shuffle');
    setVolume(35); setMuted(true); applyTimerChoice(25, true); setAccelMode('weighted'); setAccelWeight(3.5); setAccelTarget(140);
    timingSetView('beats'); timingSetRes('8'); timingSetShuffle(true); timingSetRange(100); practiceSetBars(8);
  };
  const run = (page, fn) => page.evaluate((src) => { new Function('return (' + src + ')')()(); return stateEncodeShare(stateSnapshot()); }, fn.toString());

  test('encode -> decode round trip equals the snapshot (all fields); defaults are omitted', async ({ page }) => {
    await open(page);
    const base = await page.evaluate(() => ({ enc: stateEncodeShare(stateSnapshot()), same: JSON.stringify(stateDecodeShare(stateEncodeShare(stateSnapshot()))) === JSON.stringify(stateSnapshot()) }));
    expect(base.enc).toBe('~1,120,4,2000,1');
    expect(base.same).toBe(true);
    const enc = await run(page, fullState);
    expect(enc.startsWith('~1,93,7,2103010,S')).toBe(true);
    const r = await page.evaluate((e) => ({ dec: stateDecodeShare(e), snap: stateSnapshot() }), enc);
    expect(r.dec).toEqual(r.snap);
  });

  test('a typical state is at most 60 characters', async ({ page }) => {
    await open(page);
    const enc = await run(page, () => { updateBpm(100); setBeats(3); setSubdivision('2'); setVolume(60); applyTimerChoice(10, false); setAccelTarget(140); });
    expect(enc.length).toBeLessThanOrEqual(60);
  });

  test('opening a share URL restores it, becomes #<new key> and saves under it', async ({ page }) => {
    await open(page);
    const enc = await run(page, fullState);
    await open(page, '#' + enc);
    const k = keyOf(page);
    expect(k).toMatch(KEY_RE);
    const st = await page.evaluate(() => ({ bpm, beatsPerMeasure, beatStates, subdivision, isMuted, targetDuration, timerIsCustom, accelTargetBpm, accelMode, accelWeight, timingView, timingRes, timingShuffle, timingRangeMs, bars: practice.bars, key: sessKey }));
    expect(st).toMatchObject({ bpm: 93, beatsPerMeasure: 7, beatStates: [2, 1, 0, 3, 0, 1, 0], subdivision: '16shuffle', isMuted: true, targetDuration: 25, timerIsCustom: true, accelTargetBpm: 140, accelMode: 'weighted', accelWeight: 3.5, timingView: 'beats', timingRes: '8', timingShuffle: true, timingRangeMs: 100, bars: 8, key: k });
    expect(await saved(page, k)).toMatchObject({ bpm: 93, beats: 7, sub: '16shuffle', accel: { target: 140 } });
    // later changes never touch the shared link: opening it again gives the shared state
    await page.evaluate(() => { updateBpm(50); stateSave(false); });
    await open(page, '#' + enc);
    expect(await page.evaluate(() => bpm)).toBe(93);
  });

  test('a share hash typed into an open tab saves the current state and loads the shared one', async ({ page }) => {
    await open(page, '#sharetab1');
    await page.evaluate(() => updateBpm(66));
    const nav = page.waitForEvent('load');
    await page.evaluate(() => { location.hash = '~1,150,5,20000,2'; });
    await nav;
    await page.waitForSelector('#playBtn');
    expect(await page.evaluate(() => [bpm, beatsPerMeasure, subdivision])).toEqual([150, 5, '2']);
    expect(keyOf(page)).toMatch(KEY_RE);
    expect((await saved(page, 'sharetab1')).bpm).toBe(66);
  });

  test('tolerant parse: junk tokens and bad values are ignored; unknown version is no state', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    const r = await page.evaluate(() => ({
      a: stateDecodeShare('~1,abc,99,xyz,??,Zzz,v,v-5,vNaN,t10,x,xq,R7,,,a999,u'),
      b: stateDecodeShare('~2,100,4,2000,1'),
      c: stateDecodeShare('~1,200'),
    }));
    expect(r.b).toBeNull();
    expect(r.a).toMatchObject({ bpm: 120, beats: 12, sub: '1', timer: 10, tRes: '16', accel: { mode: 'linear', target: 999 } });
    expect(r.a.beatStates.length).toBe(12);
    expect(r.c).toMatchObject({ bpm: 200, beats: 4 });
    await open(page, '#~1,abc,,,,,,v999,a999');
    expect(await page.evaluate(() => [bpm, masterVolume, accelTargetBpm])).toEqual([120, 1, null]);
    await open(page, '#~9,1,2');
    expect(await page.evaluate(() => bpm)).toBe(120);
    expect(errors).toEqual([]);
  });

  test('the share button copies the link and shows the toast', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await page.evaluate(() => { updateBpm(101); setBeats(3); });
    await page.click('#shareBtn');
    await expect(page.locator('#shareToast')).toHaveText('Link copied');
    await expect(page.locator('#shareToast')).toHaveCSS('opacity', '1');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(/#~1,101,3,200,1$/);
    expect(text.startsWith(page.url().split('#')[0])).toBe(true);
    await expect(page.locator('#shareToast')).toHaveCSS('opacity', '0', { timeout: 5000 });
  });

  test('without a clipboard the link appears in a read-only, selected field', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no clipboard')) }, configurable: true }); });
    await page.click('#shareBtn');
    const inp = page.locator('#shareInput');
    await expect(inp).toBeVisible();
    await expect(inp).toHaveAttribute('readonly', '');
    expect(await inp.inputValue()).toMatch(/#~1,120,4,2000,1$/);
    expect(await page.evaluate(() => { const i = document.getElementById('shareInput'); return i.selectionStart === 0 && i.selectionEnd === i.value.length; })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(inp).toBeHidden();
  });

  test('portrait: the share button moves nothing', async ({ page }) => {
    await open(page);
    const boxes = () => page.evaluate(() => [...document.querySelectorAll('.tm-card *')].filter(e => !e.closest('#shareBtn') && e.id !== 'visualLight' && e.getBoundingClientRect().width > 0)
      .map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className.toString().slice(0, 30), Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(); }));
    const withBtn = await boxes();
    await page.evaluate(() => { document.getElementById('shareBtn').style.display = 'none'; });
    expect(await boxes()).toEqual(withBtn);
    await page.evaluate(() => { document.getElementById('shareBtn').style.display = ''; });
    const card = await page.locator('.tm-card').boundingBox();
    const b = await page.locator('#shareBtn').boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width);
    expect(b.y - card.y).toBeLessThan(20);
  });

  test.describe('practice', () => {
    test.use({ viewport: { width: 844, height: 390 } });
    test('the More overlay has a Share link item that copies', async ({ context, page }) => {
      await context.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write']);
      await open(page);
      await page.click('#timingBtn');
      await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
      await page.click('#practiceBtn');
      await expect(page.locator('#shareBtn')).toBeHidden();
      await page.click('#prMoreBtn');
      await page.click('#prShareBtn');
      await expect(page.locator('#shareToast')).toHaveCSS('opacity', '1');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/#~1,120,4,2000,1.*T.*P/);
    });
  });
});
