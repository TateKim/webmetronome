# Architecture

Single-file web app: all HTML, CSS, and JavaScript live in `src/index.html`. No build step — `dist/index.html` is a manual copy/deploy artifact.

Dependencies are CDN-only:
- Tailwind CSS (via CDN script tag)
- Google Fonts (Noto Sans KR)
- Web Audio API (browser built-in)

Open `src/index.html` directly in a browser — no server required.

## Audio Timing

The metronome uses the **Web Audio API lookahead scheduler** pattern for sample-accurate timing:

- `scheduler()` runs on `setTimeout(scheduler, lookahead)` (25ms intervals)
- It pre-schedules notes up to `scheduleAheadTime` (100ms) ahead using `audioCtx.currentTime`
- `nextNote()` advances `nextNoteTime` and `currentBeatIndex` based on the current subdivision
- `scheduleNote()` calls `playSound(time, toneType)` and `scheduleDraw()` — draw uses `setTimeout` offset from `audioCtx.currentTime` so visuals sync to audio
- **Never replace `audioCtx.currentTime`-based scheduling with `setInterval` or `Date.now()`**

## State Variables

All state is in module-level `let` vars (lines 539–579 of `src/index.html`):

| Group | Key vars |
|-------|----------|
| Playback | `isPlaying`, `bpm`, `subdivision`, `beatsPerMeasure`, `currentBeatIndex` |
| Audio | `audioCtx`, `masterGainNode`, `nextNoteTime`, `lookahead`, `scheduleAheadTime` |
| Timer | `isTimerActive`, `targetDuration`, `secondsRemaining`, `timerExpired` |
| Accel | `accelTargetBpm`, `accelStartBpm`, `accelTotalSeconds`, `accelMode`, `accelWeight`, `accelSchedule`, `accelMeasureCount` |
| Beat grid | `beatStates[]` — each element is 0 (normal), 1 (accent), 2 (strong accent), or 3 (mute) |

## Key Functions

- `togglePlay()` — starts/stops playback; captures accel anchor state on start, resets on stop
- `updateBpm(val)` — single entry point for all BPM changes (clamps to 30–250, updates slider + display)
- `buildAccelSchedule()` — precomputes the full BPM ramp schedule at play start
- `onMeasureEnd()` — called inside `nextNote()` at each measure boundary; steps BPM for accel
- `isAccelActive()` — guard used throughout accel logic
- `setTimer(minutes)` — activates/deactivates timer, syncs UI
- `initBeats()` / `renderBeatIndicators()` — rebuild the beat circle DOM when `beatsPerMeasure` changes
- `calcStepReps(startBpm, endBpm, effectiveSecs)` — computes per-BPM measure repetition counts for all three accel modes

## Tone Types

`playSound(time, toneType)`:
- `0` = normal beat (800 Hz)
- `1` = accent (600 Hz, softer)
- `2` = strong accent (1200 Hz, louder)
- `3` = mute (silent — `playSound` returns early)

Subdivisions on non-main beats always use tone type `0`.

## Accel Feature

BPM acceleration/deceleration ramps from `accelStartBpm` to `accelTargetBpm`. Three modes:
- `linear` — equal time per BPM step
- `count` — equal measure repetitions per BPM step
- `weighted` — front-loaded time distribution controlled by `accelWeight` slider

The schedule is precomputed into `accelSchedule[]` at play start (`buildAccelSchedule()`), indexed by measure count (`accelMeasureCount`). `onMeasureEnd()` looks up the next BPM from this array.

On stop: `accelStartBpm` is cleared (no BPM reset on stop — the ramp stays at wherever it ended). The "Off" button in the overlay clears `accelTargetBpm` entirely and turns off the timer.

For the design spec, see [specs/2026-03-18-bpm-acceleration-design.md](../superpowers/specs/2026-03-18-bpm-acceleration-design.md).

## Timing Check (mic input)

Optional add-on (header **Timing** button) that listens to a microphone and shows live early/late feedback against the metronome grid. Everything is inert while `timingOn` is false. Design: [specs/2026-10-23-timing-check-design.md](../superpowers/specs/2026-10-23-timing-check-design.md), plan: [plans/2026-10-23-timing-check.md](../superpowers/plans/2026-10-23-timing-check.md). Code lives in one `// --- Timing Check (mic input) ---` block just before `// Init` in `src/index.html`.

- **Clock**: onsets are detected in an AudioWorklet (`TIMING_WORKLET_SRC`, inline string loaded via Blob URL) and stamped `currentFrame / sampleRate`, the same context clock as `scheduler()`. Never use `Date.now()`/`performance.now()` for hit timing.
- **State**: `timingOn`, `timingView` (`timeline`|`beats`), `timingFeel`, `timingStream/Source/Node/Sink`, `timingDeviceId`, `timingLatencyMs`, `timingLatencyEst`, `timingChannel/timingChannels`, `timingBeats` (64-beat ring buffer of `{time, beatInMeasure, n, dur}`), `timingHits`, `timingLastHitTime`, `timingMuteOnsets` (tests only: drop live mic onsets).
- **Hooks into existing code** (all no-ops when off): `scheduleNote()` -> `timingRecordBeat()` for main beats only; `togglePlay()` -> `timingOnPlayStart()` (before `scheduler()`) / `timingOnPlayStop()`; `updateBpm()` -> `timingRelayoutTimeline()`; rhythm menu click -> `timingApplyFeel()`; `renderBeatIndicators()` -> `timingLayoutBeatsStrip()`.
- **Pure/global helpers** (callable from tests): `getTimingGrid()` (feel + lock table from `subdivision`), `matchOnsetToGrid(tComp, beats, grid, fallbackDur)`, `timingQuality(ms)`, `median`, `mad`, `timingHandleOnset(time, peakDb)` (entry point for detected hits; tests inject synthetic onsets here).
- **Pipeline**: `timingStart()` -> `getUserMedia` (no AEC/NS/AGC) -> `MediaStreamSource -> AudioWorkletNode('onset-detector') -> Gain(0) -> destination`. Worklet posts `level` (every 1024 frames) and `onset` (after a 30 ms hold). `timingOnWorkletMessage()` routes them. Devices: `timingRefreshDevices()`, `timingSwitchDevice()`, `devicechange` listener.
- **Latency (manual)**: no automatic calibration. LATENCY row (-/value/+, hold-to-repeat, click-to-type, Reset) via `timingWireStepper()`/`timingSetLatency()`; saved per device (`wm.timing.latency.<id>`); without a saved value `timingEstimateLatencyMs()` (outputLatency + baseLatency + track latency) is used and `est.` is shown. Channel select (`timingChSeg`, `wm.timing.channel.<id>`) is posted to the worklet with `{type:'config', channel}`.
- **Detector**: `OnsetCore` (source string `TIMING_ONSET_CORE_SRC`, no AudioWorklet dependency; the page builds it with `timingMakeOnsetCore(sr)` for tests). 4 band-passes (150-400, 400-1k, 1-2.5k, 2.5-6k Hz, 4th order), 64-sample block maxima per band; a band triggers on a fast rise (block max > per-band jump x the max of a 35 ms reference window that ends 8 ms earlier; jumps 3/2.5/1.7/1.7) above its gate max(-55 dBFS, floor+6 dB), or a summed positive rise >= 10 dB; re-trigger guard (>= 40 ms and the band must have dropped below 0.7 x peak, or exceed 1.5 x it); onset time = earliest crossing sample. Synthetic scenarios live in `tests/helpers/scenarios.js`.
- **Views**: Timeline (`timingTl*`, track moved with `translate3d`, 2 bars, NOW at 90%) and On beats strip (`timingC*`, sweep bar, per-beat-cell fade via WAAPI opacity). Only `transform`/`opacity` animate. `timingFrame()` is the rAF loop, active only while `timingOn && isPlaying`.
- **localStorage keys** (always try/catch): `wm.timing.view`, `wm.timing.feel`, `wm.timing.deviceId`, `wm.timing.latency.<id>`, `wm.timing.channel.<id>`.
- **Tests**: `tests/timing.spec.js`; `playwright.config.js` launches Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`.
- **Debug recorder** (developer only, console): `timingDebugRecord(seconds = 20)` / `timingDebugStop()`. While recording, the worklet streams raw samples of the selected channel (1024-sample chunks with their context frame) and posts near-miss events; the page logs beats, onsets (with triggering bands and rise), match results (accepted or rejected with reason) and, at the end, downloads `timing-debug-<timestamp>.wav` (32-bit float mono) and `.json` and prints a summary. Nothing runs unless recording.
- **Sensitivity** (1-10, default 5 = reference tuning, `wm.timing.sensitivity.<id>`, sent live in the worklet `config` message): `OnsetCore.setSensitivity(v)` scales every band jump (in dB), the combined-rise threshold and the gate (floor + 6 dB x f) by f (1.5 at 1, 1.0 at 5, 0.55 at 10), shifts the absolute gate (-55 dBFS + (5 - v) x 2 dB) and moves the re-trigger drop ratio (0.6 at 1, 0.7 at 5, 0.8 at 10). `params()` returns the effective values (also stored in the debug JSON).
- **Grid matching**: role-weighted capture. Each grid point scores |offset| / weight (beat 1.0, main off-beat 0.85, other 0.6); lowest wins; rejected as `ambiguous` if the runner-up is within 8 % or `too-far` if > 0.45 beat away. No fixed ms cap; views clamp at +/-50 ms, out-of-range hits draw as edge triangles (`.tm-tri`), rejected hits as grey rings (`.tm-ring`, status `Off grid`, not counted in the summary).
- **Input too hot**: the worklet level message carries the raw channel peak (`rawDb`) and a `clip` flag (any raw sample >= 0.999, i.e. full scale); clip shows `#timingHot` (space reserved to avoid layout shift) and a red meter for 3 s.
- **Loopback measurement** (optional, `Measure` in the LATENCY row): `timingLoopStart()` schedules 60 clicks 0.5 s apart from a dedicated synth (1.2 kHz, 5 ms, own GainNode, independent of app volume/mute); onsets are routed to `timingLoopOnset()` (first onset in [ts, ts+0.4) per click) and never reach the matcher/views. `timingLoopFinish()` computes median/SD/MAD/range/drift/misses; success (>= 40 samples, MAD, SD <= 2 ms, |drift| <= 1 ms/min) offers `Apply`; result saved as `wm.timing.loopback.<id>` and shown in the LATENCY tooltip. START cancels (`timingLoopCancel`).
- **Settings popover** (`#timingSetBtn` in the View row, `#timingPopover`): holds INPUT (device + Ch), FEEL, LATENCY (+ Measure panel) and SENSITIVITY with the same ids as before. The button label shows `Feel · <latency> ms · S<n>` (+ `est.`, pulsing dot while a loopback measurement runs; the feel word is hidden below 420 px). Opens like the other app menus (closes timer/volume/rhythm/accel menus), closes on outside click (capture-phase listener), Esc, or another menu. A running measurement continues while it is closed.
- **Status / meter**: the meter has its own full-width row below the View row (mic icon, track, fixed-width status) with scale -80..0 dBFS, the detection-threshold line and a faint quiet tick (`#timingMeterQuiet`). Status: event statuses (`Detected`, `Off grid`, `Too weak`) take priority while live; otherwise `Quiet` once the raw input (`rawDb`) has stayed below the quiet level for >= 1 s, else `Listening`. Quiet level: popover `QUIET BELOW` (-80..-30 dB, default -60, `wm.timing.quiet.<id>`).
