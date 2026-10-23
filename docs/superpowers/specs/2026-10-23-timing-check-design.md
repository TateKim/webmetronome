# Timing Check (mic input) — Design Spec

Date: 2026-10-23
Status: approved direction (mockup: `tmp/timing-feedback-views.html`)

## Goal

Show in real time how closely the player's hits, picked up by a microphone, follow the metronome grid.
Show live feedback only. There is no summary score after practice.

## Principles

- **The base metronome UI does not change.** Everything new appears only while the **Timing** feature is on.
- **Timing accuracy first.** Hit times are measured with the same clock as the scheduler (`audioCtx`), inside an AudioWorklet, at sample precision. The lookahead scheduler is not touched apart from one recording hook.
- **Show confident signals only.** Weak sounds, background noise and hits that cannot be clearly assigned to a grid point are ignored.
- **Animate on the compositor only.** Moving elements change only `transform` / `opacity` (see memory note "Rendering compositor-only").
- All UI text is English.

## UI

### Header
- Add a new **Timing** button (mic icon) to the left group after `Vol`. Its label is `Timing`, in the same style as the existing header buttons.
- Off: same as today. On: `bg-indigo-100 text-indigo-600`, plus a small green dot in the top-right corner while the mic is active.
- The first time it is turned on, the button click (a user gesture) requests mic permission. If access is denied, the add-on block shows: `Microphone access is blocked. Allow it in your browser's site settings.`

### Add-on block (shown only when Timing is on)
Placed between the beat indicator and the main controls (`timerDisplayContainer` / TAP / START), above a dashed divider. Top to bottom:

1. **Input row**: `INPUT` label · device `<select>` · latency status · `Calibrate`/`Recalibrate` button
   - Latency status: `Latency 38 ms` (green) / `Not calibrated` (amber) / `Calibrating…` / `Calibration failed` (red)
2. **View row**: segmented `Timeline | On beats` · mic icon + input level meter + status text
   - Meter: dB scale from −60 to 0 dBFS. It fills with `scaleX`, and a vertical line marks the current detection threshold (it moves with the noise floor).
   - Status text: `Detected` (green, 0.45 s after an accepted hit) / `Too weak` (a sound below threshold, or one too far from the grid) / `Quiet`
3. **Feel row**: `FEEL` label · segmented `Straight | Shuffle | Half-time shuffle` · `Set by rhythm` hint (only while locked)
4. **Timeline panel** (shown only in Timeline view)
5. **Summary row**: three small boxes, `Avg · last N bars` / `Spread` / `Hits`
6. A hint line in small grey text: `Use headphones so the mic doesn't pick up the click.`

### View B: Timeline (separate panel)
- Height 132 px, rounded corners, light background. The center horizontal line means on time; the ±10 ms band is tinted green; `EARLY` at the top, `LATE` at the bottom.
- The **NOW** line is fixed at 90 % of the width, and the last **2 bars** scroll left (pixels per second = `playX / (2 × bar duration)`, recomputed when BPM changes).
- Grid lines: bar line (2 px, darker), beat line, sub-grid lines (faint) for the current Feel.
- Dot: x = hit time (after compensation), y = offset (±50 ms maps to the top/bottom edge, clamped). Color by accuracy, size by grid position.

### View C: On beats (attached to the beat indicator)
- A 96 px strip placed directly under the beat circles. It is aligned with the circle centers and spans exactly one bar.
- x for position `p` (in beats) = center of circle k + fraction × beat spacing. Beat spacing is measured from the actual DOM positions of the circles (normally 52 px = 40 + 12 gap).
- The strip runs from 1/4 beat before beat 1 to 7/8 beat after the last beat.
- A position bar (2 px, indigo, with a faint gradient trail) sweeps from left to right.
- Each beat has a cell that runs from 1/8 beat before that beat to 1/8 beat before the next one. When the position bar enters a cell, the marks from the previous pass fade out over 0.7 beat via WAAPI opacity animation and are then removed. New hits are drawn in their place.
- If the circles wrap onto two or more lines (too many beats), **On beats is disabled** and the view switches to Timeline automatically.

### Shared
- **Accuracy colors**: |offset| ≤ 10 ms green (`#10b981`), ≤ 25 ms amber (`#f59e0b`), above that red (`#f43f5e`).
- **Dot size**: beat 11 px > main off-beat (straight 1/2, shuffle 2/3, half-time 1/2) 8 px > others 6 px.
- **No input**: while playing, if no accepted hit has come in for `max(1 bar, 1.5 s)`, the visible view is dimmed and shows a `No input` pill.
- **Summary**: computed only from accepted hits in the window that is currently visible (Timeline 2 bars, On beats 1 bar). Avg = mean offset, Spread = standard deviation (`±N ms`, ≤ 8 green / ≤ 16 amber / above that red), Hits = number of accepted hits. The app does not know what rhythm the player intends, so Hits is not a miss rate.
- On metronome stop, the current marks stay frozen. On start, everything is cleared.

## Feel (grid used for detection)

| Feel | Positions within a beat | Main off-beat |
|---|---|---|
| Straight | 0, 1/4, 1/2, 3/4 | 1/2 |
| Shuffle | 0, 1/3, 2/3 | 2/3 |
| Half-time shuffle | 0, 1/3, 1/2, 5/6 | 1/2 |
| Triplet (locked only) | 0, 1/3, 2/3 | — |
| Quintuplet (locked only) | 0, 1/5, 2/5, 3/5, 4/5 | — |
| Sextuplet (locked only) | 0, 1/6 … 5/6 | 1/2 |

Lock rule (the `subdivision` value):
- `shuffle` → Shuffle, `16shuffle` → Half-time shuffle, `3` → Triplet, `5` → Quintuplet, `6` → Sextuplet. All of these are locked.
- `1`, `2`, `4`, `4e` → the user's choice (default Straight).
- When locked, the segment highlights the matching option. For a grid that is not in the segment (Triplet and the like), all buttons are disabled and the hint reads `Set by rhythm: Triplet`.

## Audio input pipeline

- `getUserMedia({ audio: { deviceId, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`
- It uses the same `audioCtx` (`initAudioContext()`): `MediaStreamSource → AudioWorkletNode('onset-detector') → Gain(0) → destination` (the zero-gain connection only keeps the processing graph alive).
- The worklet code is kept inline as a string and loaded through a Blob URL, so it still works with a single file and no server.

### Onset detection (inside the worklet, per sample)
1. First-order high-pass filter at about 120 Hz (removes DC and rumble). `e = |hp|`.
2. Fast peak follower: `fast = e > fast ? e : fast × exp(-1/(0.010·sr))`
3. Noise floor: `floor += (fast − floor) × (1 − exp(-1/(0.4·sr)))`, updated only while ARMED. Minimum 1e-4.
4. Threshold: `th = max(10^(-45/20), floor × 4)` (+12 dB over the noise floor).
5. State machine:
   - **ARMED**: track `minEnv`. If `fast > th` and `fast > 2 × minEnv`, it triggers. `onsetFrame = currentFrame + i` → HOLD.
   - **HOLD** (35 ms): track `peak`. When it ends, post `{type:'onset', time: onsetFrame / sampleRate, peakDb, thDb}` → DECAY.
   - **DECAY**: when `fast < 0.5 × peak` → ARMED (`minEnv = fast`).
6. Every 1024 frames, post `{type:'level', db, thDb}` (db = max of `fast` in that window).

`time` is in the context time domain, the same clock as the scheduler.

## Grid matching (main thread)

- Recording hook: in `scheduleNote()`, when `isMainBeat` (including muted beats), push `{ time, beatInMeasure }` into a ring buffer (last 64 beats). Beat duration = the next beat's time minus this one's; for the most recent beat use `60/bpm`.
- Compensated time: `t' = onset.time − L` (L = calibrated round-trip latency in seconds).
- Find the beat k with `beat.time ≤ t'`. Candidates are `beat_k.time + pos × dur_k` and the next beat's 0 position. Pick the nearest grid point g; `offset = t' − g` (ms).
- **Reject**:
  - |offset| > 0.4 × (minimum grid gap × dur)  (ambiguous)
  - The metronome is not playing, or the hit is before the first beat
  - |offset| > 60 ms
- On acceptance: `{ t: t', offsetMs, beatIndexGlobal, posInBeat, role }` goes to both views and the summary log.

## Latency calibration

- Stored per device in `localStorage['wm.timing.latency.' + deviceId]` (ms; always wrap in try/catch).
- If not calibrated: `L = (audioCtx.outputLatency || 0) + audioCtx.baseLatency + 0.010`, shown as `Not calibrated`.
- **Calibrate** (available only while the metronome is stopped; pressing START cancels it):
  1. Play 8 strong clicks (`playSound(t, 2)`) at 0.5 s intervals, starting at `audioCtx.currentTime + 0.3`.
  2. For each click, take the first onset in `[ts, ts + 0.45)` and use `onset.time − ts`.
  3. With 6 or more samples and MAD ≤ 4 ms → L = median, then save. Otherwise `Calibration failed` with the tooltip `Let the mic hear the speaker, then try again.`
- Calibration measures input latency plus output latency together, which matches exactly what the compensation needs. Bluetooth headphones can have a different output latency, so the user needs to calibrate again after switching.

## Device management

- After permission is granted, list `audioinput` devices with `enumerateDevices()`. Remember the last choice in `localStorage['wm.timing.deviceId']`.
- On a `devicechange` event, refresh the list. If the current device disappears, switch to the default device.
- Switching devices: stop the current tracks, then call `getUserMedia` again with `deviceId: { exact }` and reconnect the nodes.
- Timing off: stop the tracks (releases the mic) and disconnect the nodes.

## Persistence (localStorage, try/catch)
`wm.timing.view` (timeline|beats), `wm.timing.feel`, `wm.timing.deviceId`, `wm.timing.latency.<id>`. The Timing on/off state itself is not saved, because turning it on prompts for permission.

## Out of scope (v1)
- Suppressing click bleed when using speakers (mitigated with the headphones hint)
- Tap-along calibration (fallback when the loopback cannot be heard)
- Post-practice score/report

---

## v1.1 changes — headphones + audio interface setup (2026-10-23)

Target setup: the metronome is heard on **headphones**, and the instrument comes in on a specific **audio interface input**. The mic never hears the click, but there are three gaps.

### 1. Input channel selection
- Next to the device select, add a `Ch` segmented control: `1 | 2` (only when the device has 2+ channels).
- getUserMedia asks for `channelCount: { ideal: 2 }`. The channel count actually received comes from `track.getSettings().channelCount`. If it is 1, hide the control.
- The worklet uses only the selected channel index (passed in through `port.postMessage({type:'config', channel})`).
- Saved per device: `wm.timing.channel.<deviceId>`.

### 2. Manual latency adjustment (replaces automatic calibration)
The user's decision: latency is **adjusted manually**. Remove the automatic calibration (the Calibrate button, the loopback measurement code, `playSound()` returning the oscillator, and the related tests).
- Input row: `INPUT` · device select · `Ch 1|2` (only when available)
- New row: `LATENCY` label · `−` button · value `31 ms` (tabular-nums) · `+` button · `Reset` text button
  - 1 ms per step; while a button is held, repeat after 400 ms at a 60 ms interval. Range 0–300 ms.
  - Click the value to type it in directly (a small number input; Enter or blur applies it, Esc cancels).
  - Takes effect immediately (hits that arrive afterwards use the new value) and is saved per device: `wm.timing.latency.<id>`.
  - `Reset` → the browser estimate: `round((outputLatency + baseLatency + (track.getSettings().latency || 0.010)) × 1000)`.
  - When there is no saved value, use the estimate and show a small `est.` label (grey) next to the value. It disappears once the user changes the value.
- Help tooltip (`title`) on the value: `Play steady on the click and adjust until Avg sits near 0 ms.`
- Delete the existing latency status texts (`Latency 38 ms`, `Not calibrated`, `Calibrating…`, `Calibration failed`).

### 3. Onset detection algorithm replacement (fixes false triggers on sustained low notes)
The existing per-sample peak follower (10 ms decay) ripples on notes at 80 Hz and below. The trough-to-peak ratio exceeds 2×, so it is expected to produce false onsets every cycle. Replace it with:
- Signal: the selected channel → 1st-order HP at 40 Hz (lowered from 120 Hz, to keep bass attacks) → `|y|`.
- Split into 64-sample sub-blocks. `m[i]` = max |y| of the block.
- `env[i]` = max of `m` over the last W blocks (W ≈ 25 ms) — a ripple-free envelope down to 40 Hz.
- `ref[i]` = `env[i − W]` (the envelope just before the attack).
- Trigger: `m[i] > th` and `m[i] > 2 × ref[i]` (+6 dB jump), and at least 40 ms since the last onset.
- Exact time: the first sample in the triggering block where `|y| > max(th, 2 × ref)` → `onsetFrame`.
- After the trigger, keep tracking the peak for 30 ms, then post `onset {time, peakDb, thDb}`.
- Noise floor: EMA of `m` (τ = 0.5 s), updated only while there is no onset in progress and nothing within 150 ms after one. `th = max(10^(-50/20), floor × 4)`.
- level messages stay the same (every 1024 frames).
- **Testability**: put the detector core in an `OnsetCore` class (no AudioWorklet dependency; `process(samples, startFrame)` → array of onsets). Inside the worklet string, define it and wrap it with `OnsetDetector`. The page can create the same class with `new Function(TIMING_ONSET_CORE_SRC)` and test it with synthetic signals.

### 3a. Follow-up decisions (from real-device testing)
- Reported problem: one hit was detected as several dots. Instrument: **electric bass, fingerstyle, DI into the interface**.
- **Telling attack from sustain comes first**: the main decision is how fast the level rises. A trigger needs a rise of +6 dB or more within about 8 ms, measured against a reference window that ends 8–10 ms before the current block. Slow changes such as tremolo, beating, vibrato and swelling sustain never trigger. The noise-floor threshold is only a minimal safety gate against silence and hum (≈ −55 dBFS or floor + 6 dB).
- **Fast runs (16th-note runs)**: the new attack may be barely louder than the ringing sustain. So rises are checked in about 4 bands (150–400 Hz, 400 Hz–1 kHz, 1–2.5 kHz, 2.5–6 kHz). If any one band rises quickly (about +4.5 dB within 8 ms), or the summed rise across bands is large enough, it counts as an attack. A fresh pluck makes the upper partials, which had already decayed, jump up again. Tests: runs at 150/180 BPM, previous note not muted, changing pitch or repeating the same pitch, same level or 3 dB softer.
- **Automatic attack detection**: there is no manual threshold control. The threshold follows the detection band's noise floor automatically (+12 dB, absolute minimum −50 dBFS). Attacks are found from the jump relative to the preceding window, plus a re-trigger guard.
- Re-trigger guard: after an onset, ignore triggers until 40 ms have passed and the block peak has dropped below 0.7× the tracked peak at least once (unless a new attack more than 2× the current envelope comes in).
- Detection band: instead of the 40 Hz HP, a 2nd-order Butterworth HP at about 150–250 Hz (final value chosen from the test results). Pluck transients and upper partials are short in this band, while the ringing sustain sits mostly in the low band. The level meter also shows this band.
- Synthetic test signals: bass (31/41/55 Hz, partial decay τ_k = 1.5 s/k, fingerstyle-weak transient or none), legato 16ths at 150 BPM, successive notes 6 dB softer each, tremolo sustain, drum-like hits, noise.

### Out of scope (unchanged)
Click-bleed suppression (not needed with headphones).

### 4. Loopback measurement (optional, added 2026-10-23)
Purpose: measure only the system latency (output + input) and its **jitter**, so it stays separate from the player's own habits. Manual LATENCY stays as it is; the measurement is for reference / one-click apply.
- A `Measure` text button at the right end of the LATENCY row. Clicking it opens a small inline panel below the row:
  - Help: `Connect your interface output to its input with a cable, then press Start. Keep the output volume low.`
  - `Start` / `Stop` / `Close` buttons. Available only while the metronome is stopped (pressing START cancels it).
- Measuring: for 30 s, clicks every 0.5 s (60 total). They use their own short click synth (1.2 kHz, 5 ms) → their own GainNode → destination (independent of the app volume/mute; cancel = stop the oscillators + disconnect).
- Per click: take the first onset in `[ts, ts + 0.4)`, sample = `(onset − ts) × 1000` ms.
- Live display (updated per sample): `n/60 · median 58.2 ms · ±0.4 ms (SD) · range 57.6–58.9`
- Result: median, SD, MAD, min/max, **drift** (linear regression slope of samples vs time, ms/min), number of misses.
  - Success: 40 or more samples and MAD ≤ 2 ms → `System latency 58 ms ± 0.4 ms` (green) + an `Apply` button (sets LATENCY = round(median), clears the `est.` tag).
  - Large jitter (SD > 2 ms) or |drift| > 1 ms/min → amber warning: `Latency is unstable. Use the same interface for input and output, and match sample rates.`
  - Fewer than 40 samples → `Could not hear the clicks. Check the cable and levels.`
- Saved per device: `wm.timing.loopback.<id>` = `{ median, sd, mad, drift, n, at }`. The LATENCY value's tooltip shows the last measurement.
- The debug recorder can record during a measurement (no extra work needed).
