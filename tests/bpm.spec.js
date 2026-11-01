const { test, expect } = require('@playwright/test');
const path = require('path');
const { navigateAndWait } = require('./helpers/metronome');

// BPM detect (tempo of the input signal) ------------------------------------------------
// Synthetic 48 kHz audio -> OnsetCore flux feed -> bpmEstimate, all inside the page.

async function withSignals(page) {
  await navigateAndWait(page);
  await page.addScriptTag({ path: path.join(__dirname, 'helpers', 'signals.js') });
  await page.evaluate(() => {
    // audio -> onset-strength envelope, exactly as the worklet produces it
    window.envOf = (buf) => {
      const core = timingMakeOnsetCore(sig.SR);
      core.setFlux(true);
      const env = [];
      let step = 256 / sig.SR;
      for (let i = 0; i < buf.length; i += 128) {
        core.process(buf.subarray(i, Math.min(buf.length, i + 128)), i);
        core.takeFlux().forEach(m => { step = m.step; for (const v of m.v) env.push(v); });
      }
      return { env, fps: 1 / step, msgs: null };
    };
    // a drum-like hit: short noise burst + decaying low sine
    window.addHit = (buf, t, amp, rand) => {
      sig.addNoise(buf, t, 0.006, amp, rand, 0.002);
      sig.addSine(buf, t, 180, amp, 0.06, 0.001, 0.25);
    };
    window.track = (bpmV, secs, opts) => {
      opts = opts || {};
      const rand = sig.rng(opts.seed || 1), buf = sig.zeros(secs);
      sig.whiteNoise(buf, sig.db(-70), rand);
      const beat = 60 / bpmV;
      for (let k = 0, t = 0.3; t < secs - 0.3; k++, t = 0.3 + k * beat) {
        const jit = opts.jitterMs ? (rand() * 2 - 1) * opts.jitterMs / 1000 : 0;
        addHit(buf, t + jit, sig.db(k % 4 === 0 ? -12 : -16), rand);
        if (opts.eighths) sig.addNoise(buf, t + beat / 2, 0.02, sig.db(-30), rand, 0.008); // soft hi-hat between beats
      }
      return buf;
    };
  });
}

test.describe('BPM detect - estimator', () => {
  test.beforeEach(async ({ page }) => { await withSignals(page); });

  test('steady drum hits give the tempo within 0.5 BPM', async ({ page }) => {
    test.setTimeout(60000);
    const r = await page.evaluate(() => [72, 97, 120, 128, 140].map(b => {
      const { env, fps } = envOf(track(b, 9, { eighths: b === 128 }));
      const e = bpmEstimate(env.slice(-Math.round(8 * fps)), fps);
      return { b, bpm: e && +e.bpm.toFixed(2), conf: e && +e.conf.toFixed(3) };
    }));
    for (const x of r) {
      expect(Math.abs(x.bpm - x.b), JSON.stringify(x)).toBeLessThan(0.5);
      expect(x.conf, JSON.stringify(x)).toBeGreaterThanOrEqual(BPM_STEADY);
    }
  });

  test('a fast tempo is found up to an octave (half / double is the user\'s choice)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { env, fps } = envOf(track(184, 9));
      return bpmEstimate(env, fps).bpm;
    });
    const ratio = r / 184;
    expect(Math.min(Math.abs(ratio - 1), Math.abs(ratio - 0.5))).toBeLessThan(0.005);
  });

  test('a human player (+-12 ms timing jitter) is read within 1 BPM', async ({ page }) => {
    const r = await page.evaluate(() => [86, 110, 132].map(b => {
      const { env, fps } = envOf(track(b, 9, { jitterMs: 12, seed: b }));
      return { b, bpm: bpmEstimate(env.slice(-Math.round(8 * fps)), fps).bpm };
    }));
    for (const x of r) expect(Math.abs(x.bpm - x.b), JSON.stringify(x)).toBeLessThan(1);
  });

  test('bass notes without a click transient are read too', async ({ page }) => {
    const r = await page.evaluate(() => {
      const rand = sig.rng(3), buf = sig.zeros(9), beat = 60 / 104;
      sig.whiteNoise(buf, sig.db(-70), rand);
      const notes = [55, 65.4, 73.4, 82.4];
      for (let k = 0; 0.3 + k * beat < 8.5; k++) sig.addBass(buf, 0.3 + k * beat, notes[k % 4], sig.db(-14), null, 0, rand);
      const { env, fps } = envOf(buf);
      return bpmEstimate(env, fps).bpm;
    });
    expect(Math.abs(r - 104)).toBeLessThan(0.6);
  });

  test('noise only is not a steady beat', async ({ page }) => {
    const r = await page.evaluate(() => {
      const rand = sig.rng(5), buf = sig.zeros(9);
      sig.whiteNoise(buf, sig.db(-40), rand);
      const { env, fps } = envOf(buf);
      const e = bpmEstimate(env, fps);
      const silent = bpmEstimate(new Array(1500).fill(0), 187.5);
      return { conf: e ? e.conf : null, silent };
    });
    expect(r.silent).toBeNull();
    if (r.conf !== null) expect(r.conf).toBeLessThan(BPM_STEADY);
  });

  test('the flux feed is off by default and stamps frames on the context clock', async ({ page }) => {
    const r = await page.evaluate(() => {
      const core = timingMakeOnsetCore(sig.SR), buf = sig.zeros(1);
      core.process(buf.subarray(0, 4096), 0);
      const off = core.takeFlux().length;
      core.setFlux(true);
      for (let i = 4096; i < 48000; i += 128) core.process(buf.subarray(i, i + 128), i);
      const m = core.takeFlux();
      return { off, n: m.length, t0: m[0].time, t1: m[1].time, len: m[0].v.length, step: m[0].step };
    });
    expect(r.off).toBe(0);
    expect(r.len).toBe(32);
    expect(r.step).toBeCloseTo(256 / 48000, 9);
    expect(r.t0).toBeCloseTo(4096 / 48000, 9);
    expect(r.t1 - r.t0).toBeCloseTo(32 * 256 / 48000, 9);
    expect(r.n).toBe(Math.floor((48000 - 4096) / 256 / 32));
  });
});

const BPM_STEADY = 0.2; // mirrors BPM_DET_STEADY in src/index.html

test.describe('BPM detect - UI', () => {
  test.beforeEach(async ({ page }) => { await withSignals(page); });

  async function timingOn(page) {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    // the fake capture device beeps; only synthetic envelopes reach the detector
    await page.evaluate(() => {
      timingMuteOnsets = true;
      const sent = [];
      window.cfgSent = sent;
      const post = timingNode.port.postMessage.bind(timingNode.port);
      timingNode.port.postMessage = (m, t) => { if (m && m.type === 'config') sent.push(m); return post(m, t); };
      timingNode.port.onmessage = null;
    });
  }
  // feed a synthetic track as worklet 'flux' messages, then analyse once
  async function feed(page, bpmV) {
    await page.evaluate((b) => {
      const { env, fps } = envOf(track(b, 9));
      for (let i = 0; i + 32 <= env.length; i += 32) bpmDetIn({ type: 'flux', time: i / fps, step: 1 / fps, v: Float32Array.from(env.slice(i, i + 32)) });
      bpmDetTick();
    }, bpmV);
  }

  test('BPM button toggles the panel and the worklet feed; Set applies the tempo', async ({ page }) => {
    test.setTimeout(60000);
    await expect(page.locator('#bpmDetBtn')).toBeHidden();
    await timingOn(page);
    await expect(page.locator('#bpmDetPanel')).toBeHidden();
    await page.click('#bpmDetBtn');
    await expect(page.locator('#bpmDetPanel')).toBeVisible();
    await expect(page.locator('#bpmDetBtn')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => cfgSent[cfgSent.length - 1].flux)).toBe(true);
    await expect(page.locator('#bpmDetState')).toHaveText('Listening…');
    await expect(page.locator('#bpmDetApply')).toBeDisabled();

    await feed(page, 97);
    await expect(page.locator('#bpmDetValue')).toHaveText('97');
    await expect(page.locator('#bpmDetState')).toHaveText('Steady beat');
    await page.click('#bpmDetDouble');
    await expect(page.locator('#bpmDetValue')).toHaveText('194');
    await page.click('#bpmDetHalf');
    await page.click('#bpmDetApply');
    expect(await page.evaluate(() => bpm)).toBe(97);
    await expect(page.locator('#bpmDisplay')).toHaveText('97');

    await page.click('#bpmDetBtn');
    await expect(page.locator('#bpmDetPanel')).toBeHidden();
    expect(await page.evaluate(() => cfgSent[cfgSent.length - 1].flux)).toBe(false);
  });

  test('Timing off and Practice mode switch the detector off', async ({ page }) => {
    await timingOn(page);
    await page.click('#bpmDetBtn');
    await page.evaluate(() => practiceSetMode(true));
    expect(await page.evaluate(() => bpmDet.on)).toBe(false);
    await page.evaluate(() => practiceSetMode(false));
    await page.click('#bpmDetBtn');
    expect(await page.evaluate(() => bpmDet.on)).toBe(true);
    await page.evaluate(() => timingStop());
    expect(await page.evaluate(() => ({ on: bpmDet.on, timer: bpmDet.timer }))).toEqual({ on: false, timer: 0 });
    await expect(page.locator('#bpmDetPanel')).toBeHidden();
  });

  test('without the detector the worklet config message has no flux field', async ({ page }) => {
    await timingOn(page);
    await page.evaluate(() => timingPostConfig());
    expect(await page.evaluate(() => 'flux' in cfgSent[cfgSent.length - 1])).toBe(false);
  });
});
