const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { navigateAndWait, clickPlay } = require('./helpers/metronome');

// Capture export: worklet ring (last 30 s of the instrument channel), page log, wav/csv/json files ----------------

test.describe('Capture - worklet ring', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });

  test('keeps exactly the last 30 s, chronological, with the first sample frame', async ({ page }) => {
    const r = await page.evaluate(() => {
      const sr = 8000, Q = 128, S = 2 ** 21, G = { currentFrame: 0 }, msgs = [];
      let Proc = null;
      class Base { constructor() { this.port = { postMessage: (m) => msgs.push(m), onmessage: null }; } }
      new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'G', TIMING_WORKLET_SRC.replace(/\bcurrentFrame\b/g, 'G.currentFrame'))(Base, (n, c) => { Proc = c; }, sr, G);
      const p = new Proc();
      const feed = (q0, q1, skip) => {
        for (let q = q0; q < q1; q++) {
          if (skip && skip(q)) continue;
          const x = new Float32Array(Q);
          for (let i = 0; i < Q; i++) x[i] = (q * Q + i) / S;
          G.currentFrame = q * Q;
          p.process([[x]]);
        }
      };
      const dump = () => { msgs.length = 0; p.port.onmessage({ data: { type: 'config', dump: true } }); return msgs.find(m => m.type === 'capture'); };
      const check = (d) => { let ok = true; for (let k = 0; k < d.samples.length; k++) if (d.samples[k] !== (d.frame + k) / S) { ok = false; break; } return ok; };
      const out = {};
      feed(0, 100);                                   // 12800 samples: less than the ring
      let d = dump(); out.short = { frame: d.frame, n: d.samples.length, ok: check(d), sr: d.sr };
      feed(100, 2000);                                // 256000 samples > 240000: wrapped
      d = dump(); out.full = { frame: d.frame, n: d.samples.length, ok: check(d), end: d.frame + d.samples.length };
      feed(2000, 2100, q => q >= 2020 && q < 2024);   // a real gap of 4 quanta: silence keeps the ring chronological
      d = dump(); out.gap = { n: d.samples.length, end: d.frame + d.samples.length, zeros: d.samples.subarray(2020 * 128 - d.frame, 2024 * 128 - d.frame).every(v => v === 0), before: d.samples[2020 * 128 - d.frame - 1] === (2020 * 128 - 1) / S };
      p.port.onmessage({ data: { type: 'config', channel: 1 } });   // channel change: restarts
      feed(2100, 2110);
      d = dump(); out.chan = { n: d.samples.length, frame: d.frame };
      return out;
    });
    expect(r.short).toEqual({ frame: 0, n: 12800, ok: true, sr: 8000 });
    expect(r.full.n).toBe(240000);
    expect(r.full.end).toBe(2000 * 128);
    expect(r.full.frame).toBe(2000 * 128 - 240000);
    expect(r.full.ok).toBe(true);
    expect(r.gap).toEqual({ n: 240000, end: 2100 * 128, zeros: true, before: true });
    expect(r.chan).toEqual({ n: 10 * 128, frame: 2100 * 128 });
  });
});

test.describe('Capture - log and files', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });

  test('the Capture button is disabled without a stream and enabled with one', async ({ page }) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream && !!timingNode)).toBe(true);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingCaptureBtn')).toBeEnabled();
    await expect(page.locator('#timingCaptureBtn')).toHaveText('Save last 30 s');
    const off = await page.evaluate(() => { const s = timingStream; timingStream = null; timingRenderCaptureBtn(); const d = document.getElementById('timingCaptureBtn').disabled; timingStream = s; timingRenderCaptureBtn(); return d; });
    expect(off).toBe(true);
    await page.click('#timingBtn'); // Timing off
    await expect(page.locator('#timingCaptureBtn')).toBeDisabled();
  });

  test('the export log keeps about 30 s of beats, onsets, events and quiet drops', async ({ page }) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream)).toBe(true);
    const r = await page.evaluate(() => {
      timingCapReset();
      for (let t = 0; t <= 100; t += 0.5) {
        timingCapPush(timingCap.beats, { time: t, beatInMeasure: 0, n: t * 2 });
        timingCapPush(timingCap.onsets, { time: t, verdict: 'hit', offsetMs: 0, pos: 0 });
        timingCapPush(timingCap.events, { type: 'clean', t });
        timingCapPush(timingCap.drops, { t, rawDb: -70 });
      }
      const first = (a) => a[0].time !== undefined ? a[0].time : a[0].t;
      return ['beats', 'onsets', 'events', 'drops'].map(k => [first(timingCap[k]), timingCap[k].length]);
    });
    for (const [first, n] of r) { expect(first).toBeGreaterThanOrEqual(100 - 33.5); expect(first).toBeLessThanOrEqual(100 - 30); expect(n).toBeLessThan(75); }
  });

  test('live flow: wav header and sample count, csv format, onset verdicts, json; tools/replay-capture.js reads it', async ({ page }, testInfo) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream && !!timingNode)).toBe(true);
    await page.evaluate(() => { timingMuteOnsets = true; updateBpm(240); });
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length)).toBeGreaterThan(4);
    const res = await page.evaluate(async () => {
      // inject a hit 7 ms late on a finished beat, an off-grid one and a louder duplicate in the same cell
      const b = timingBeats.filter(x => x.dur > 0).slice(-3)[0];
      const L = timingMatchLatencyMs() / 1000;
      const base = timingCap.onsets.length;
      timingCapOnset({ time: b.time + L + 0.007, peakDb: -30, rawDb: -28, thDb: -50, bands: [1, 2, 3, 4] });
      timingHandleOnset(b.time + L + 0.007, -30);
      timingCapOnset({ time: b.time + L + 0.11, peakDb: -20 });
      timingHandleOnset(b.time + L + 0.11, -20);
      const files = [];
      const orig = timingDownloadBlob;
      timingDownloadBlob = (n, blob) => files.push({ n, blob });
      const c = await timingCaptureSave();
      await new Promise(r => setTimeout(r, 800));
      timingDownloadBlob = orig;
      const out = { names: files.map(f => f.n), stamp: c.stamp, sr: c.sr };
      out.wav = Array.from(new Uint8Array(await files[0].blob.arrayBuffer()).slice(0, 56));
      out.wavSize = files[0].blob.size;
      out.wavBytes = Array.from(new Uint8Array(await files[0].blob.arrayBuffer()));
      out.csv = await files[1].blob.text();
      out.json = JSON.parse(await files[2].blob.text());
      return out;
    });
    expect(res.names).toEqual(['capture-' + res.stamp + '.wav', 'capture-' + res.stamp + '.csv', 'capture-' + res.stamp + '.json']);
    expect(res.stamp).toMatch(/^\d{8}-\d{6}$/);
    const w = res.wav, u32 = (o) => (w[o] | w[o + 1] << 8 | w[o + 2] << 16 | w[o + 3] << 24) >>> 0;
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE');
    expect(w[20]).toBe(3); expect(w[22]).toBe(1);                 // float, mono
    expect(u32(24)).toBe(res.sr);
    const nSamples = u32(44);
    expect(u32(52)).toBe(nSamples * 4);
    expect(res.wavSize).toBe(56 + nSamples * 4);
    expect(nSamples).toBeGreaterThan(res.sr * 0.5);
    expect(nSamples).toBeLessThanOrEqual(res.sr * 30);
    const lines = res.csv.trim().split('\n');
    expect(lines[0]).toMatch(/^# sampleRate=\d+ latencyFrames=[\d.]+ wavStartInFrame=\d+ bpm=240 beats=4 rhythm=\S+ grid=\S+ sensitivity=5 detector=web-onsetcore platform=web clock=ctx-frames app=\S+ latencyMs=[\d.]+ clean=[01] noiseDb=\S+ quietDb=-60 channel=1 device=\S+ ua=\S+$/);
    expect(lines.filter(l => l.startsWith('#')).length).toBe(1);
    const beats = lines.filter(l => l.startsWith('beat,')), all = lines.filter(l => l.startsWith('onset,')), onsets = all.filter(l => !l.endsWith(',muted')); // the fake mic beeps too (muted for matching, still logged)
    expect(beats.length).toBeGreaterThan(3);
    for (const l of beats) expect(l).toMatch(/^beat,\d+,[0-3]$/);
    expect(onsets.length).toBe(2);
    expect(onsets[0]).toMatch(/^onset,\d+,-30\.0,hit [+-]\d+\.\d\d ms pos=\d\.\d{3}$/);
    expect(onsets[1]).toMatch(/^onset,\d+,-20\.0,(hit [+-]\d+\.\d\d ms pos=\d\.\d{3}|reject (ambiguous|too-far) [+-]\d+\.\d ms|merged)$/);
    const hdr = Object.fromEntries(lines[0].slice(2).split(' ').map(kv => kv.split('=')));
    const start = +hdr.wavStartInFrame, sr = +hdr.sampleRate;
    expect(+onsets[0].split(',')[1]).toBeGreaterThanOrEqual(start);
    expect(+onsets[0].split(',')[1]).toBeLessThanOrEqual(start + nSamples);
    expect(res.json.format).toBe('webmetronome-capture');
    expect(res.json.wav).toMatchObject({ startFrame: start, samples: nSamples, sampleRate: sr });
    const jo = res.json.onsets.filter(o => o.verdict !== 'muted');
    expect(jo.length).toBe(2);
    expect(jo[0]).toMatchObject({ peakDb: -30, rawDb: -28, thDb: -50, verdict: 'hit' });
    expect(jo[0].bands).toEqual([1, 2, 3, 4]);
    expect(res.json.meta.detector.cleanTuning).toBeDefined();
    expect(res.json.beats.length).toBe(beats.length);

    // the replay tool understands the files
    const stem = testInfo.outputPath('capture-' + res.stamp);
    fs.writeFileSync(stem + '.wav', Buffer.from(res.wavBytes));
    fs.writeFileSync(stem + '.csv', res.csv);
    const text = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'replay-capture.js'), stem, '--no-clean'], { encoding: 'utf8' });
    expect(text).toMatch(/replay: sens=5 mode=plain .*-> +\d+ onsets/);
    expect(text).toMatch(/score: hit \d+\/\d+ slots/);
    expect(text).toMatch(/diff vs csv onsets in the wav range: csv \d+, replay \d+/);
  });
});
