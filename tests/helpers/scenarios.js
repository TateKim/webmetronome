// Synthetic onset-detector scenarios (48 kHz). Plain script: Node (module.exports) and page (window.scenarios).
// Each scenario: { name, build(sig) -> Float32Array, expect: number | number[] (onset times in ms), tol (ms) }
(function () {
  const TWO_PI = 2 * Math.PI;

  function fadeTail(buf, ms) {
    const n = Math.round(ms / 1000 * 48000);
    for (let i = 0; i < n && i < buf.length; i++) buf[buf.length - 1 - i] *= i / n;
    return buf;
  }

  // plucked harmonic note: partials 1..n at 1/k, 2 ms attack, tau 300 ms, plus a short click
  function pluck(sig, buf, t, f0, amp, clickDb) {
    for (let k = 1; k <= 4; k++) sig.addSine(buf, t, f0 * k, amp / k, 0.3, 0.002, 1.5);
    if (clickDb !== null) sig.addNoise(buf, t, 0.0005, amp * sig.db(clickDb), sig.rng(Math.round(t * 1000) + 3));
  }

  // bass with vibrato on every partial (+/- cents at rate Hz), amplitude as addBass
  function addBassVibrato(sig, buf, start, f0, gain, cents, rate) {
    const SR = sig.SR, s0 = Math.round(start * SR), n = buf.length - s0;
    const ph = new Float64Array(41);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = f0 * Math.pow(2, cents / 1200 * Math.sin(TWO_PI * rate * t));
      let v = 0;
      for (let k = 1; k <= 40; k++) {
        if (f * k >= SR / 2) break;
        ph[k] += TWO_PI * f * k / SR;
        v += gain / k * Math.exp(-t * k / 1.5) * Math.sin(ph[k]);
      }
      buf[s0 + i] += v;
    }
  }

  // run of bass notes: notes = [{t, f, gainDb}]
  function bassRun(sig, total, notes, trDb) {
    const b = sig.zeros(total), r = sig.rng(11);
    notes.forEach(n => sig.addBass(b, n.t, n.f, 0.3 * sig.db(n.gainDb || 0), trDb, 3, r));
    return b;
  }
  function run16(bpm, count, pitches, softDb) {
    const step = 60 / bpm / 4, notes = [], exp = [];
    for (let i = 0; i < count; i++) {
      const t = 0.1 + i * step;
      notes.push({ t, f: pitches[i % pitches.length], gainDb: softDb ? -softDb * Math.min(i, 2) : 0 });
      exp.push(t * 1000);
    }
    return { notes, exp, total: 0.1 + count * step + 1.2 };
  }

  const list = [];
  const add = (name, build, expect, tol) => list.push({ name, build, expect, tol });

  // --- sustained low notes: exactly one onset
  [55, 82].forEach(f => add('sustained ' + f + ' Hz sine', sig => {
    const b = sig.zeros(2.3); sig.addSine(b, 0.1, f, 0.5, 4, 0, 2.1); return b;
  }, 1));

  // --- plucked notes
  add('plucked 110 Hz 16ths at 150 BPM', sig => {
    const b = sig.zeros(2.4);
    for (let i = 0; i < 10; i++) pluck(sig, b, 0.1 + i * 0.1, 110, 0.5, -12);
    return fadeTail(b, 50);
  }, Array.from({ length: 10 }, (_, i) => 100 + i * 100), 1.5);
  add('re-strum over a ringing chord', sig => {
    const b = sig.zeros(1.2);
    [110, 165, 220].forEach(f => { pluck(sig, b, 0.1, f, 0.3, -12); pluck(sig, b, 0.35, f, 0.3, -12); });
    return fadeTail(b, 50);
  }, [100, 350], 1.5);
  add('realistic pluck: 1 ms transient, fast partial decay, 800 ms sustain with 5 Hz tremolo', sig => {
    const SR = sig.SR, b = sig.zeros(1.3), s0 = Math.round(0.1 * SR);
    for (let i = 0; i < 1.2 * SR; i++) {
      const t = i / SR;
      const env = (t < 0.001 ? t / 0.001 : 1) * (0.4 + 0.6 * Math.exp(-t / 0.007)) * (t > 0.02 ? 1 + 0.2 * Math.sin(TWO_PI * 5 * (t - 0.02)) : 1);
      b[s0 + i] += 0.5 * env * (Math.sin(TWO_PI * 196 * t) + 0.5 * Math.sin(TWO_PI * 392 * t) + 0.25 * Math.sin(TWO_PI * 1180 * t));
    }
    sig.addNoise(b, 0.1, 0.001, 0.5, sig.rng(5));
    return fadeTail(b, 80);
  }, 1);
  add('drum-like hit with a second bounce', sig => {
    const b = sig.zeros(1), r = sig.rng(3);
    sig.addNoise(b, 0.1, 0.005, 0.5, r);
    sig.addSine(b, 0.1, 180, 0.6, 0.04, 0.001, 0.4);
    sig.addSine(b, 0.115, 180, 0.15, 0.04, 0.001, 0.4);
    return b;
  }, 1);
  add('amplitude-modulated sustained 82 Hz (3 Hz)', sig => {
    const SR = sig.SR, b = sig.zeros(2.1), s0 = Math.round(0.1 * SR);
    for (let i = 0; i < 2 * SR; i++) { const t = i / SR; b[s0 + i] = 0.5 * (1 + 0.5 * Math.sin(TWO_PI * 3 * t)) * Math.sin(TWO_PI * 82 * t); }
    return fadeTail(b, 50);
  }, 1);

  // --- noise
  add('white noise at -60 dBFS', sig => { const b = sig.zeros(2); sig.whiteNoise(b, sig.db(-60), sig.rng(7)); return b; }, 0);
  add('noise at -60 dBFS plus hits at -20 dBFS', sig => {
    const b = sig.zeros(2), r = sig.rng(7);
    sig.whiteNoise(b, sig.db(-60), r);
    for (let i = 0; i < 4; i++) {
      sig.addNoise(b, 0.3 + i * 0.4, 0.004, sig.db(-20), r, 0.002);
      sig.addSine(b, 0.3 + i * 0.4, 150, sig.db(-20), 0.05, 0.001, 0.3);
    }
    return b;
  }, [300, 700, 1100, 1500], 2);

  // --- bass model (partials 1..40 at 1/k, tau 1.5/k s), fingerstyle weak transient and none
  [[-24, 'weak transient'], [null, 'no transient']].forEach(([tr, label]) => {
    [41, 31].forEach(f => add('bass ' + f + ' Hz single note, ' + label, sig => bassRun(sig, 2.3, [{ t: 0.1, f }], tr), 1));
    add('bass legato 16ths at 150 BPM alternating 41/55 Hz, ' + label, sig => {
      const r = run16(150, 10, [41, 55]); return bassRun(sig, r.total, r.notes, tr);
    }, Array.from({ length: 10 }, (_, i) => 100 + i * 100), 2);
    add('bass 6 dB softer per note for 3 notes, ' + label, sig => {
      return bassRun(sig, 1, [0, 1, 2].map(i => ({ t: 0.1 + i * 0.1, f: i % 2 ? 55 : 41, gainDb: -6 * i })), tr);
    }, [100, 200, 300], 2);
    add('bass note with 400 ms of +/-20% 4 Hz tremolo, ' + label, sig => {
      const b = bassRun(sig, 1.2, [{ t: 0.1, f: 41 }], tr), s0 = Math.round(0.1 * sig.SR);
      for (let i = 0; i < 0.5 * sig.SR; i++) b[s0 + i] *= 1 + 0.2 * Math.sin(TWO_PI * 4 * i / sig.SR);
      return b;
    }, 1);
    [150, 180].forEach(bpm => {
      add('bass 16th run at ' + bpm + ' BPM, changing pitch, same amplitude, ' + label, sig => {
        const r = run16(bpm, 12, [41, 46, 49, 55]); return bassRun(sig, r.total, r.notes, tr);
      }, run16(bpm, 12, [41]).exp, 2);
      add('bass 16th run at ' + bpm + ' BPM, same pitch re-plucked, ' + label, sig => {
        const r = run16(bpm, 12, [41]); return bassRun(sig, r.total, r.notes, tr);
      }, run16(bpm, 12, [41]).exp, 2);
      add('bass 16th run at ' + bpm + ' BPM, 3 dB softer for 2 notes, ' + label, sig => {
        const r = run16(bpm, 8, [41, 46, 49, 55], 3); return bassRun(sig, r.total, r.notes, tr);
      }, run16(bpm, 8, [41]).exp, 2);
    });
    // sustain-only behaviours: exactly one onset (the pluck)
    add('bass sustain swells +8 dB over 60 ms (slow swell), ' + label, sig => {
      const b = bassRun(sig, 2.3, [{ t: 0.1, f: 41 }], tr), SR = sig.SR;
      for (let i = Math.round(0.6 * SR); i < b.length; i++) {
        const x = Math.min(1, (i - 0.6 * SR) / (0.06 * SR));
        b[i] *= 1 + (Math.pow(10, 8 / 20) - 1) * x;
      }
      return b;
    }, 1);
    add('two detuned strings beating (41 and 41.7 Hz) for 3 s, ' + label, sig => {
      const b = sig.zeros(3.3), r = sig.rng(2);
      sig.addBass(b, 0.1, 41, 0.15, tr, 3, r); sig.addBass(b, 0.1, 41.7, 0.15, tr === null ? null : -300, 3, r);
      return b;
    }, 1);
    add('vibrato +/-15 cents at 6 Hz on a 55 Hz note, ' + label, sig => {
      const b = sig.zeros(2.3); addBassVibrato(sig, b, 0.1, 55, 0.3, 15, 6);
      if (tr !== null) sig.addNoise(b, 0.1, 0.003, 0.3 * 1.5 * sig.db(tr), sig.rng(4));
      return b;
    }, 1);
  });

  // new pluck only +6 dB above the ringing level with a 3 ms rise
  add('new pluck +6 dB over ringing level, 3 ms rise', sig => {
    const b = sig.zeros(1.2);
    sig.addSine(b, 0.1, 1700, 0.2, 5, 0.003, 1.0);
    sig.addSine(b, 0.6, 1900, 0.2, 5, 0.003, 0.5);
    return b;
  }, [100, 600], 4.5);

  // Weak-attack scenarios: not required at sensitivity 5; higher sensitivity must catch more of them.
  // Each: { name, build(sig), times (true note starts in ms) }
  const weak = [];
  (function () {
    const times = n => Array.from({ length: n }, (_, i) => (0.1 + i * 0.1) * 1000);
    const t12 = times(12), t10 = times(10);
    weak.push({
      name: 'bass 16ths at 150 BPM changing pitch, every note 5 dB softer than the previous',
      times: t12,
      build: sig => bassRun(sig, 0.1 + 12 * 0.1 + 1.2, t12.map((t, i) => ({ t: t / 1000, f: [41, 46, 49, 55][i % 4], gainDb: -5 * i })), -24)
    });
    weak.push({
      name: 'fingerstyle very weak: re-plucks far below the ringing level, no transient',
      times: t10,
      build: sig => bassRun(sig, 0.1 + 10 * 0.1 + 1.2, t10.map((t, i) => ({ t: t / 1000, f: 41, gainDb: i === 0 ? 0 : -33 })), null)
    });
  })();

  const api = { list, weak, fadeTail };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.scenarios = api;
})();
