const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { navigateAndWait, clickPlay } = require('./helpers/metronome');

// Capture export: worklet ring (last 30 s of the instrument channel), page log, wav/csv/json files ----------------

test.describe('Capture - worklet ring', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });

  test('(armed) keeps exactly the last 30 s, chronological, with the first sample frame', async ({ page }) => {
    const r = await page.evaluate(() => {
      const sr = 8000, Q = 128, S = 2 ** 21, G = { currentFrame: 0 }, msgs = [];
      let Proc = null;
      class Base { constructor() { this.port = { postMessage: (m) => msgs.push(m), onmessage: null }; } }
      new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'G', TIMING_WORKLET_SRC.replace(/\bcurrentFrame\b/g, 'G.currentFrame'))(Base, (n, c) => { Proc = c; }, sr, G);
      const p = new Proc();
      p.port.onmessage({ data: { type: 'config', capture: 'arm', id: 1 } });   // the ring records only during a take
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

  // Worklet harness shared by the take tests: sr 8000, 128-sample quanta; ch0 = ramp, ch1 (when two channels) = -ramp
  const HARNESS = `(sr) => {
    const Q = 128, S = 2 ** 21, G = { currentFrame: 0 }, msgs = [];
    let Proc = null;
    class Base { constructor() { this.port = { postMessage: (m) => msgs.push(m), onmessage: null }; } }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'G', TIMING_WORKLET_SRC.replace(/\\bcurrentFrame\\b/g, 'G.currentFrame'))(Base, (n, c) => { Proc = c; }, sr, G);
    const p = new Proc();
    const send = (m) => p.port.onmessage({ data: Object.assign({ type: 'config' }, m) });
    const feed = (q0, q1, two) => {
      for (let q = q0; q < q1; q++) {
        const x = new Float32Array(Q), y = new Float32Array(Q);
        for (let i = 0; i < Q; i++) { x[i] = (q * Q + i) / S; y[i] = -x[i]; }
        G.currentFrame = q * Q;
        p.process(two ? [[x, y]] : [[x]]);
      }
    };
    const dump = () => { msgs.length = 0; send({ dump: true }); return msgs.find(m => m.type === 'capture'); };
    return { p, msgs, send, feed, dump, S, Q };
  }`;

  test('records only while armed: disarmed writes nothing, arm clears, 1.5 s tail after stop, then frozen', async ({ page }) => {
    const r = await page.evaluate((src) => {
      const h = (0, eval)(src)(8000), out = {};
      h.feed(0, 50);
      out.disarmed = h.dump().samples.length;                     // never armed: nothing recorded
      h.send({ capture: 'arm', id: 7 });
      h.feed(50, 100);                                            // 6400 samples
      let d = h.dump(); out.armed = { n: d.samples.length, frame: d.frame, armed: d.armed };
      h.send({ capture: 'arm', id: 8 });                          // a new take replaces the old one
      h.feed(100, 110);
      d = h.dump(); out.rearm = { n: d.samples.length, frame: d.frame };
      h.msgs.length = 0;
      h.send({ capture: 'stop', afterSec: 1.5 });                 // 12000 samples = 93.75 quanta
      h.feed(110, 300);
      const end = h.msgs.filter(m => m.type === 'capend');
      d = h.dump();
      let ok = true; for (let k = 0; k < d.samples.length; k++) if (d.samples[k] !== (d.frame + k) / h.S) { ok = false; break; }
      out.end = end; out.stopped = { n: d.samples.length, frame: d.frame, ok, armed: d.armed, last: d.samples[d.samples.length - 1] === (d.frame + d.samples.length - 1) / h.S };
      const snap = Array.from(d.samples);
      h.feed(300, 500);                                           // far past the tail: the ring must not change
      const d2 = h.dump();
      out.frozen = { sameLen: d2.samples.length === d.samples.length, sameFrame: d2.frame === d.frame, same: d2.samples.every((v, i) => v === snap[i]) };
      h.msgs.length = 0;
      h.send({ capture: 'stop', afterSec: 1 });                   // stop while disarmed: no effect, no second capend
      h.feed(500, 520);
      out.noSecondEnd = h.msgs.filter(m => m.type === 'capend').length;
      h.send({ capture: 'arm', id: 9 });
      h.feed(520, 525);
      d = h.dump(); out.next = { n: d.samples.length, frame: d.frame };
      // channel change: ignored by a frozen take
      h.send({ capture: 'stop', afterSec: 0 }); h.feed(525, 527);
      const before = h.dump().samples.length; h.send({ channel: 1 }); out.chanFrozen = [before, h.dump().samples.length];
      return out;
    }, HARNESS);
    expect(r.disarmed).toBe(0);
    expect(r.armed).toEqual({ n: 6400, frame: 50 * 128, armed: true });
    expect(r.rearm).toEqual({ n: 10 * 128, frame: 100 * 128 });
    // the tail is counted in frames from the first quantum after the stop message (exact to the frame)
    expect(r.end).toEqual([{ type: 'capend', id: 8, frame: 110 * 128 + 12000 }]);
    expect(r.stopped).toEqual({ n: 10 * 128 + 12000, frame: 100 * 128, ok: true, armed: false, last: true });
    expect(r.frozen).toEqual({ sameLen: true, sameFrame: true, same: true });
    expect(r.noSecondEnd).toBe(0);
    expect(r.next).toEqual({ n: 5 * 128, frame: 520 * 128 });
    expect(r.chanFrozen[1]).toBe(r.chanFrozen[0]);
  });

  test('the click ring is allocated lazily, recorded in lockstep and exported only when a ref channel was used', async ({ page }) => {
    const r = await page.evaluate((src) => {
      const h = (0, eval)(src)(8000), out = {};
      out.lazy = h.p.ccap === null;
      h.send({ capture: 'arm', id: 1 });
      h.feed(0, 10);
      let d = h.dump(); out.noRef = d.click === null;
      h.send({ refChannel: 1 });
      out.allocated = h.p.ccap !== null && h.p.ccap.length === h.p.cap.length;
      h.feed(10, 30, true);                                       // two channels now
      d = h.dump();
      out.len = [d.samples.length, d.click.length, d.refCh];
      out.front = d.click.subarray(0, 10 * 128).every(v => v === 0);        // before the ref channel was used: silence, same start frame
      out.mirror = d.click.subarray(10 * 128).every((v, k) => v === -d.samples[10 * 128 + k]);
      h.send({ capture: 'arm', id: 2 });                          // new take: ring cleared, ref still on
      h.feed(30, 33, true);
      d = h.dump(); out.take2 = [d.samples.length, d.click.length, d.frame];
      h.send({ refChannel: -1 }); h.send({ capture: 'arm', id: 3 }); h.feed(33, 35);
      d = h.dump(); out.off = d.click === null;
      return out;
    }, HARNESS);
    expect(r).toEqual({ lazy: true, noRef: true, allocated: true, len: [30 * 128, 30 * 128, 1], front: true, mirror: true, take2: [3 * 128, 3 * 128, 30 * 128], off: true });
  });
});

test.describe('Capture - log and files', () => {
  test.beforeEach(async ({ page }) => { await navigateAndWait(page); });

  test('the Capture button is disabled without a stream and enabled with one', async ({ page }) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream && !!timingNode)).toBe(true);
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingCaptureBtn')).toBeDisabled();   // no take yet: nothing to save
    await expect(page.locator('#timingCaptureBtn')).toHaveText('Save last take');
    await page.keyboard.press('Escape');                              // the popover covers the play button
    await clickPlay(page);                                            // a take starts
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingCaptureBtn')).toBeEnabled();
    await page.keyboard.press('Escape');
    await clickPlay(page);                                            // stopped: the take stays savable
    await page.click('#timingSetBtn');
    await expect(page.locator('#timingCaptureBtn')).toBeEnabled();
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

  test('log: frozen at the disarm point (late entries are dropped, none pruned); a new take replaces it', async ({ page }) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream && !!timingNode)).toBe(true);
    const r = await page.evaluate(() => {
      timingCapBegin();
      const sr = audioCtx.sampleRate;
      for (let t = 0; t <= 100; t += 1) {
        timingCapPush(timingCap.beats, { time: t, beatInMeasure: 0, n: t });
        timingCapPush(timingCap.onsets, { time: t, verdict: 'hit' });
      }
      const live = timingCap.onsets.length;                          // pruned to ~33 s while recording
      timingCapOnEnd({ id: timingCapSeq - 1, frame: 90.5 * sr });    // an old take's capend: ignored
      const ignored = timingCapEnd;
      timingCapOnEnd({ id: timingCapSeq, frame: 90.5 * sr });
      const frozenEnd = timingCapEnd, n0 = timingCap.onsets.length, nb = timingCap.beats.length, last = timingCap.onsets[n0 - 1].time;
      timingCapPush(timingCap.onsets, { time: 91, verdict: 'hit' });   // after the disarm point
      timingCapPush(timingCap.beats, { time: 95, beatInMeasure: 1, n: 95 });
      timingCapPush(timingCap.events, { type: 'clean', t: 99 });
      const dropped = [timingCap.onsets.length === n0, timingCap.beats.length === nb, timingCap.events.length === 0];
      timingCapPush(timingCap.onsets, { time: 90.2, verdict: 'hit' }); // a late detector message inside the take: kept
      const out = { live, ignored, frozenEnd, n0, last, dropped, kept: timingCap.onsets.length, first: timingCap.onsets[0].time };
      timingCapBegin();
      out.reset = [timingCapEnd, timingCap.onsets.length, timingCap.beats.length];
      return out;
    });
    expect(r.live).toBeLessThan(40);
    expect(r.ignored).toBe(null);
    expect(r.frozenEnd).toBeCloseTo(90.5, 3);
    expect(r.last).toBe(90);
    expect(r.dropped).toEqual([true, true, true]);
    expect(r.kept).toBe(r.n0 + 1);
    expect(r.first).toBeGreaterThan(100 - 34);
    expect(r.reset).toEqual([null, 0, 0]);
  });

  test('after Stop the take stays: 1.5 s tail, then frozen (ring and log), export long after still has it', async ({ page }) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream && !!timingNode)).toBe(true);
    await page.evaluate(() => { timingMuteOnsets = true; updateBpm(240); });
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingBeats.filter(b => b.dur > 0).length)).toBeGreaterThan(8);
    const stopAt = await page.evaluate(() => audioCtx.currentTime);
    await clickPlay(page);
    await expect.poll(() => page.evaluate(() => timingCapEnd !== null), { timeout: 8000 }).toBe(true);
    const end = await page.evaluate(() => timingCapEnd);
    expect(end - stopAt).toBeGreaterThan(1.4);
    expect(end - stopAt).toBeLessThan(1.8);
    const snap = () => page.evaluate(async () => {
      const files = [], orig = timingDownloadBlob;
      timingDownloadBlob = (n, blob) => files.push({ n, blob });
      const c = await timingCaptureSave();
      await new Promise(r => setTimeout(r, 900));
      timingDownloadBlob = orig;
      return { j: c.json, csvHead: c.csv.split('\n')[0], names: files.map(f => f.n), sr: c.sr, ctx: audioCtx.currentTime };
    });
    const a = await snap();
    await page.waitForTimeout(2500);                                 // the mic keeps beeping; a still-recording ring would move on
    const b = await snap();
    expect(b.ctx - a.ctx).toBeGreaterThan(2);
    expect(b.j.wav).toEqual(a.j.wav);
    expect(b.j.wav.takeOpen).toBe(false);
    expect(b.j.wav.startFrame + b.j.wav.samples).toBeLessThanOrEqual(Math.round(end * a.sr) + 1);
    expect(b.j.wav.startFrame + b.j.wav.samples).toBeGreaterThanOrEqual(Math.round(end * a.sr) - 1);
    expect(b.j.onsets.length).toBe(a.j.onsets.length);
    expect(b.j.beats.length).toBe(a.j.beats.length);
    expect(a.names.length).toBe(3);                                  // no ref channel: no click wav
    expect(a.csvHead).not.toContain('clickWav');
  });

  test('export adds -click.wav (same length) and csv keys when the dump carries a click ring; json lists the scheduled clicks', async ({ page }) => {
    await page.click('#timingBtn');
    await expect.poll(() => page.evaluate(() => !!timingStream && !!timingNode)).toBe(true);
    const r = await page.evaluate(() => {
      timingCapBegin();
      timingCapPush(timingCap.clicks, { time: 1.0 });
      timingCapPush(timingCap.clicks, { time: 1.5 });
      const sr = audioCtx.sampleRate, n = Math.round(sr * 3);
      const dump = { frame: Math.round(sr * 0.5), sr, samples: new Float32Array(n), click: new Float32Array(n).fill(0.25), refCh: 1, armed: false };
      const c = timingCaptureBuild(dump);
      return { hdr: c.csv.split('\n')[0], wav: [c.wav.size, c.clickWav.size], json: c.json.wav, clicks: c.json.clicks, sr };
    });
    expect(r.hdr).toMatch(/ clickWav=1 refChannel=2$/);
    expect(r.wav[0]).toBe(r.wav[1]);
    expect(r.json).toMatchObject({ clickWav: true, refChannel: 2, takeOpen: false });
    expect(r.clicks.map(c => c.frame)).toEqual([Math.round(r.sr * 1.0), Math.round(r.sr * 1.5)]);
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

test.describe('Capture - replay tool accuracy section', () => {
  function wavBuf(x, sr) {
    const b = Buffer.alloc(56 + x.length * 4);
    b.write('RIFF', 0); b.writeUInt32LE(48 + x.length * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34);
    b.write('fact', 36); b.writeUInt32LE(4, 40); b.writeUInt32LE(x.length, 44); b.write('data', 48); b.writeUInt32LE(x.length * 4, 52);
    for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i], 56 + i * 4);
    return b;
  }

  test('clicks arriving 3 ms later than latencyFrames are reported as +3 ms latency error; hit offsets are corrected', async ({}, testInfo) => {
    const sr = 48000, ms = sr / 1000, L = Math.round(20 * ms), extra = Math.round(3 * ms), start = 100000, secs = 8, n = secs * sr;
    const inst = new Float32Array(n), click = new Float32Array(n);
    const beats = [], onsets = [];
    for (let k = 0; ; k++) {
      const beat = start + Math.round(0.5 * sr) + k * Math.round(0.5 * sr);   // 120 bpm
      if (beat - start + L + 0.2 * sr > n) break;
      beats.push(beat);
      const c0 = beat - start + L + extra;                                    // the click really arrives 3 ms after beat + latencyFrames
      for (let i = 0; i < 0.01 * sr; i++) click[c0 + i] = 0.8 * Math.sin(2 * Math.PI * 1000 * i / sr) * Math.exp(-i / (0.004 * sr));
      const o0 = beat - start + L + Math.round(5 * ms);                       // played 5 ms late by the recorded latency
      for (let i = 0; i < 0.02 * sr; i++) inst[o0 + i] = 0.5 * Math.exp(-i / (0.005 * sr)) * (((i * 7919) % 13) / 6.5 - 1);
      onsets.push(beat + L + Math.round(5 * ms));
    }
    const stem = testInfo.outputPath('capture-synthetic');
    fs.writeFileSync(stem + '.wav', wavBuf(inst, sr));
    fs.writeFileSync(stem + '-click.wav', wavBuf(click, sr));
    const hdr = `# sampleRate=${sr} latencyFrames=${L} wavStartInFrame=${start} bpm=120 beats=4 rhythm=8 grid=4 sensitivity=5 detector=web-onsetcore platform=web clock=ctx-frames clean=0 quietDb=-60 channel=1 refChannel=2 clickWav=1`;
    fs.writeFileSync(stem + '.csv', [hdr, ...beats.map((b, i) => `beat,${b},${i % 4}`), ...onsets.map(f => `onset,${f},-20.0,hit +5.00 ms pos=0.000`)].join('\n') + '\n');
    const text = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'replay-capture.js'), stem, '--no-clean'], { encoding: 'utf8' });
    expect(text).toMatch(/click loopback \(csv beats\): \d+\/\d+ clicks found, refChannel=2/);
    const m = /measured latency: median ([\d.]+) ms, SD ([\d.]+) ms.*drift ([+-][\d.]+) ms\/min/.exec(text);
    expect(+m[1]).toBeCloseTo(23, 0);                                          // 20 ms used + 3 ms
    expect(+m[2]).toBeLessThan(0.1);
    const e = /latency error ([+-][\d.]+) ms/.exec(text);
    expect(+e[1]).toBeGreaterThan(2.6); expect(+e[1]).toBeLessThan(3.4);
    const h = /recorded med \+([\d.]+) SD [\d.]+ +\| +with median latency med \+?([\d.-]+) SD [\d.]+ +\| +with local latency med \+?([\d.-]+)/.exec(text);
    expect(+h[1]).toBeCloseTo(5, 1);
    expect(+h[2]).toBeGreaterThan(1.6); expect(+h[2]).toBeLessThan(2.4);       // 5 - 3
    expect(+h[3]).toBeGreaterThan(1.6); expect(+h[3]).toBeLessThan(2.4);
  });
});
