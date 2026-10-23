// Synthetic 48 kHz test signals for the onset detector (OnsetCore).
// Plain script: usable from Node (module.exports) and injected into the page (window.sig).
(function () {
  const SR = 48000;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function zeros(sec) { return new Float32Array(Math.round(sec * SR)); }
  const db = x => Math.pow(10, x / 20);

  // sine with linear attack and exponential decay, added into buf
  function addSine(buf, start, f, amp, tau, attack, dur, phase) {
    const s0 = Math.round(start * SR);
    const n = Math.min(buf.length - s0, Math.round((dur || 2) * SR));
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const fade = Math.min(1, ((n - i) / SR) / 0.05); // 50 ms fade-out at the end so the cut is not an onset
      const env = fade * (attack > 0 && t < attack ? t / attack : 1) * (tau ? Math.exp(-t / tau) : 1);
      buf[s0 + i] += amp * env * Math.sin(2 * Math.PI * f * t + (phase || 0));
    }
  }

  function addNoise(buf, start, dur, amp, rand, tau) {
    const s0 = Math.round(start * SR);
    const n = Math.min(buf.length - s0, Math.round(dur * SR));
    for (let i = 0; i < n; i++) {
      const env = tau ? Math.exp(-(i / SR) / tau) : 1;
      buf[s0 + i] += amp * env * (rand() * 2 - 1);
    }
  }

  // Bass: partials k=1..40 (amp 1/k, tau 1.5/k) plus an optional weak noise transient (dB relative to the note)
  function addBass(buf, start, f0, gain, transientDb, transientMs, rand) {
    const s0 = Math.round(start * SR);
    const n = buf.length - s0;
    for (let k = 1; k <= 40; k++) {
      const f = f0 * k;
      if (f >= SR / 2) break;
      const tau = 1.5 / k, a = gain / k, w = 2 * Math.PI * f / SR;
      const len = Math.min(n, Math.round(tau * 8 * SR));
      for (let i = 0; i < len; i++) buf[s0 + i] += a * Math.exp(-i / (tau * SR)) * Math.sin(w * i);
    }
    if (transientDb !== null && transientDb !== undefined) {
      addNoise(buf, start, (transientMs || 3) / 1000, gain * 1.5 * db(transientDb), rand);
    }
  }

  function whiteNoise(buf, amp, rand) {
    for (let i = 0; i < buf.length; i++) buf[i] += amp * (rand() * 2 - 1) * 1.732; // uniform with rms = amp
  }

  // Run a core over a signal in 128-sample chunks; returns [{time, peakDb}]
  function run(core, buf) {
    const out = [];
    for (let i = 0; i < buf.length; i += 128) {
      const ons = core.process(buf.subarray(i, Math.min(buf.length, i + 128)), i);
      ons.forEach(o => out.push(o));
    }
    return out;
  }

  const sig = { SR, rng, zeros, db, addSine, addNoise, addBass, whiteNoise, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = sig;
  else window.sig = sig;
})();
