#!/usr/bin/env node
// Replay a capture (wav + csv, from the web "Save last take" button or the Android app) through the web app's OnsetCore,
// print the detected onsets and score them against the grid slots implied by the csv's beats.
//
//   node tools/replay-capture.js capture-20261101-120000 [--sens N] [--gate dB] [--clean|--no-clean|--auto] [--quiet dB]
//                                [--window ms] [--slots N] [--list] [--diff]
//
// <capture> is the path with or without .wav/.csv. OnsetCore is loaded from src/index.html (this repo) the same way
// the Android golden tool does (tools/gen_onset_golden.js there).
//
//   --sens N      user sensitivity 1..10 (default: csv header, else 5)
//   --gate dB     base gate in dBFS (default: the core's own: -55, or -90 when clean)
//   --clean       clean line-input tuning from the start;  --no-clean: plain web tuning;  --auto: like the live worklet
//                 (auto-detect from the noise floor). Default: the csv header's clean=0/1, else plain web tuning.
//   --quiet dB    drop attacks whose raw peak is below dB (default: csv header quietDb, else off)
//   --window ms   a slot counts as hit when an onset is within +-window (default 60)
//   --slots N     grid slots per beat (default from the csv grid: 4->1, 8->2, 16->4, 32->8, else 2)
//   --list        print every replayed onset;  --diff: list csv-vs-replay differences
//
// Click loopback accuracy: when <capture>-click.wav exists (web capture with a click reference channel) a second section measures
// where each scheduled click really arrived in the loopback (rising edge: first sample >= 15 % of the click's peak in a window after
// the click time; clicks from <capture>.json "clicks", else the csv beats; windows without a click, peak < 0.01, are skipped) and compares it
// with latencyFrames, the latency the matcher used: error = measured median - latencyFrames is a shift of every hit. It also recomputes the
// recorded hit offsets with the median measured latency ("median") and with the latency of the click nearest in time ("local").
// The edge sits slightly after the true start (threshold crossing, well under 0.5 ms for a click's first cycle): a constant bias.
//
// Frames: absolute context/input frames (see docs/claude/architecture.md, "Capture export"). Slot = beat + latencyFrames.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = {};
let base = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (['clean', 'no-clean', 'auto', 'list', 'diff'].includes(k)) opt[k] = true; else opt[k] = args[++i];
  } else base = a;
}
if (!base) { console.error('usage: node tools/replay-capture.js <capture[.wav|.csv]> [--sens N] [--gate dB] [--clean|--no-clean|--auto] [--quiet dB] [--window ms] [--slots N] [--list] [--diff]'); process.exit(2); }
base = base.replace(/\.(wav|csv|json)$/i, '');

const repo = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'src/index.html'), 'utf8');
const m = html.match(/const TIMING_ONSET_CORE_SRC = (`[\s\S]*?`);/);
if (!m) throw new Error('TIMING_ONSET_CORE_SRC not found in src/index.html');
const OnsetCore = new Function(eval(m[1]) + '; return OnsetCore;')();

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a wav file');
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString('latin1', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    else if (id === 'data') {
      if (!fmt) throw new Error('data before fmt');
      const len = Math.min(n, b.length - o - 8), bytes = fmt.bits / 8, frames = Math.floor(len / bytes / fmt.ch);
      const x = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const p = o + 8 + i * bytes * fmt.ch;   // first channel only
        x[i] = fmt.tag === 3 && fmt.bits === 32 ? b.readFloatLE(p) : fmt.bits === 16 ? b.readInt16LE(p) / 32768 : (() => { throw new Error('unsupported wav format ' + fmt.tag + '/' + fmt.bits); })();
      }
      return { sr: fmt.sr, x };
    }
    o += 8 + n + (n & 1);
  }
  throw new Error('no data chunk');
}

const wav = readWav(base + '.wav');
const sr = wav.sr;
const meta = {}, beats = [], csvOnsets = [];
for (const line of fs.readFileSync(base + '.csv', 'utf8').split(/\r?\n/)) {
  if (line.startsWith('#')) line.slice(1).trim().split(/\s+/).forEach(kv => { const k = kv.indexOf('='); if (k > 0) meta[kv.slice(0, k)] = kv.slice(k + 1); });
  else if (line.startsWith('beat,')) beats.push(+line.split(',')[1]);
  else if (line.startsWith('onset,')) { const p = line.split(','); csvOnsets.push({ frame: +p[1], peakDb: +p[2], verdict: p.slice(3).join(',') }); }
}
const start = +meta.wavStartInFrame || 0, L = +meta.latencyFrames || 0, end = start + wav.x.length;
if (+meta.sampleRate && +meta.sampleRate !== sr) console.error(`warning: csv sampleRate ${meta.sampleRate} != wav ${sr}`);

// --- replay -------------------------------------------------------------------------------------
const sens = opt.sens !== undefined ? +opt.sens : (+meta.sensitivity || 5);
const core = new OnsetCore(sr, { sensitivity: sens });
let mode = 'plain';
if (opt.auto) { core.setAutoClean(true); mode = 'auto'; }
else if (opt.clean || (!opt['no-clean'] && meta.clean === '1')) { core.setClean(true); mode = 'clean'; }
if (opt.gate !== undefined) core.setBaseGateDb(+opt.gate);
const quiet = opt.quiet !== undefined ? +opt.quiet : (meta.quietDb !== undefined && meta.quietDb !== 'na' ? +meta.quietDb : null);
if (quiet !== null) core.setQuietGateDb(quiet);
const on = [];
for (let i = 0; i < wav.x.length; i += 128) {
  const ons = core.process(wav.x.subarray(i, Math.min(wav.x.length, i + 128)), start + i);
  for (const o of ons) on.push({ frame: o.time * sr, peakDb: o.peakDb, rawDb: o.rawDb });
}

// --- score against the slots ---------------------------------------------------------------------
const grid = String(meta.grid || '8');
const spb = opt.slots ? +opt.slots : ({ 4: 1, 8: 2, 16: 4, 32: 8 }[parseInt(grid, 10)] || 2);
const win = (opt.window !== undefined ? +opt.window : 60) * sr / 1000, msF = sr / 1000;
const margin = 0.1 * sr;
const gaps = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b), medGap = gaps.length ? gaps[gaps.length >> 1] : 0;
const slots = [];
for (let i = 0; i + 1 < beats.length; i++) {
  const g = beats[i + 1] - beats[i];
  if (medGap && g > 1.5 * medGap) continue;   // a pause or a tempo jump: no slots across it
  for (let k = 0; k < spb; k++) slots.push(beats[i] + g * k / spb + L);
}
const live = slots.filter(s => s > start + margin && s < end - margin);
const inRange = on.filter(o => o.frame > start + margin - win && o.frame < end - margin + win);
const offs = [];
let hit = 0, dup = 0;
for (const s of live) {
  const near = inRange.filter(o => Math.abs(o.frame - s) < win);
  if (near.length) { hit++; dup += near.length - 1; offs.push((near[0].frame - s) / msF); }
}
const extra = inRange.filter(o => !live.some(s => Math.abs(o.frame - s) < win)).length;
offs.sort((a, b) => a - b);
const median = offs.length ? offs[offs.length >> 1] : NaN;
const mean = offs.reduce((a, b) => a + b, 0) / (offs.length || 1);
const sd = Math.sqrt(offs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (offs.length || 1));

console.log(`capture ${base}  sr=${sr}  ${(wav.x.length / sr).toFixed(1)} s  bpm=${meta.bpm} grid=${grid} slots/beat=${spb} latencyFrames=${L}`);
console.log(`replay: sens=${sens} mode=${mode} gate=${opt.gate !== undefined ? opt.gate + ' dB' : 'default'} quiet=${quiet === null ? 'off' : quiet + ' dB'}  ->  ${on.length} onsets`);
console.log(`score: hit ${hit}/${live.length} slots (window +-${(win / msF).toFixed(0)} ms), extras ${extra}, dups ${dup}, offset median ${median.toFixed(2)} ms, mean ${mean.toFixed(2)} ms, SD ${sd.toFixed(2)} ms`);

if (opt.list) {
  console.log('replayed onsets (frame, ms from wav start, peakDb, nearest slot offset ms):');
  for (const o of on) {
    let d = null;
    for (const s of live) if (d === null || Math.abs(o.frame - s) < Math.abs(d)) d = o.frame - s;
    console.log(`  ${Math.round(o.frame)}\t${((o.frame - start) / msF).toFixed(1)}\t${o.peakDb.toFixed(1)}\t${d === null ? '-' : (d / msF).toFixed(2)}`);
  }
}

// --- diff vs the onsets recorded in the csv -------------------------------------------------------
const rec = csvOnsets.filter(o => o.frame >= start && o.frame <= end);
const tol = 2 * msF, used = new Set(), both = [], recOnly = [];
for (const r of rec) {
  let bi = -1;
  on.forEach((o, i) => { if (!used.has(i) && Math.abs(o.frame - r.frame) < tol && (bi < 0 || Math.abs(o.frame - r.frame) < Math.abs(on[bi].frame - r.frame))) bi = i; });
  if (bi >= 0) { used.add(bi); both.push(r); } else recOnly.push(r);
}
const repOnly = on.filter((o, i) => !used.has(i));
console.log(`diff vs csv onsets in the wav range: csv ${rec.length}, replay ${on.length}, in both ${both.length}, csv only ${recOnly.length}, replay only ${repOnly.length}`);
if (opt.diff) {
  recOnly.forEach(r => console.log(`  csv only    ${r.frame}\t${((r.frame - start) / msF).toFixed(1)} ms\t${r.peakDb}\t${r.verdict}`));
  repOnly.forEach(o => console.log(`  replay only ${Math.round(o.frame)}\t${((o.frame - start) / msF).toFixed(1)} ms\t${o.peakDb.toFixed(1)}`));
}

// --- click loopback accuracy (capture-<stamp>-click.wav) -------------------------------------------
if (fs.existsSync(base + '-click.wav')) {
  const cw = readWav(base + '-click.wav');
  let clicks = beats.slice(), src = 'csv beats';
  try { const j = JSON.parse(fs.readFileSync(base + '.json', 'utf8')); if (j.clicks && j.clicks.length) { clicks = j.clicks.map(c => c.frame); src = 'json clicks'; } } catch (e) { /* no json */ }
  clicks.sort((a, b) => a - b);
  const lags = [];   // {frame, ms}
  for (let i = 0; i < clicks.length; i++) {
    const c = clicks[i], gap = i + 1 < clicks.length ? clicks[i + 1] - c : 0.4 * sr;
    const a = Math.round(c - start), z = Math.min(cw.x.length, a + Math.round(Math.min(0.4 * sr, 0.8 * gap)));
    if (a < 0 || z <= a) continue;
    let pk = 0;
    for (let k = a; k < z; k++) pk = Math.max(pk, Math.abs(cw.x[k]));
    if (pk < 0.01) continue;
    let e = a;
    while (Math.abs(cw.x[e]) < 0.15 * pk) e++;
    lags.push({ frame: c, ms: (e - a) / msF });
  }
  const med = (v) => { const t = v.slice().sort((x, y) => x - y); return t.length ? t[t.length >> 1] : NaN; };
  const sdOf = (v) => { const m = v.reduce((x, y) => x + y, 0) / (v.length || 1); return Math.sqrt(v.reduce((x, y) => x + (y - m) * (y - m), 0) / (v.length || 1)); };
  console.log(`click loopback (${src}): ${lags.length}/${clicks.length} clicks found, refChannel=${meta.refChannel || '?'}`);
  if (lags.length) {
    const ms = lags.map(l => l.ms), lMed = med(ms), Lms = L / msF, err = lMed - Lms;
    // drift: least-squares slope of lag over time, in ms per minute
    const t = lags.map(l => (l.frame - lags[0].frame) / sr), tm = t.reduce((x, y) => x + y, 0) / t.length, mm = ms.reduce((x, y) => x + y, 0) / ms.length;
    let num = 0, den = 0;
    t.forEach((x, i) => { num += (x - tm) * (ms[i] - mm); den += (x - tm) * (x - tm); });
    const drift = den > 0 ? 60 * num / den : 0;
    console.log(`  measured latency: median ${lMed.toFixed(2)} ms, SD ${sdOf(ms).toFixed(2)} ms, min ${Math.min(...ms).toFixed(2)}, max ${Math.max(...ms).toFixed(2)}, drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} ms/min`);
    console.log(`  used by the matcher (latencyFrames): ${Lms.toFixed(2)} ms  ->  latency error ${err >= 0 ? '+' : ''}${err.toFixed(2)} ms (${err >= 0 ? 'hits were reported early' : 'hits were reported late'} by that much)`);
    const hits = [];
    for (const r of csvOnsets) {
      const h = /^hit ([+-][\d.]+) ms/.exec(r.verdict);
      if (h && r.frame >= start && r.frame <= end) hits.push({ frame: r.frame, rec: +h[1] });
    }
    if (hits.length) {
      const near = (f) => { let b = lags[0]; for (const l of lags) if (Math.abs(l.frame - f) < Math.abs(b.frame - f)) b = l; return b.ms - Lms; };
      const stat = (v) => `med ${med(v) >= 0 ? '+' : ''}${med(v).toFixed(2)} SD ${sdOf(v).toFixed(2)}`;
      console.log(`  hit offsets (${hits.length}), ms:  recorded ${stat(hits.map(h => h.rec))}  |  with median latency ${stat(hits.map(h => h.rec - err))}  |  with local latency ${stat(hits.map(h => h.rec - near(h.frame)))}`);
    }
  }
}
