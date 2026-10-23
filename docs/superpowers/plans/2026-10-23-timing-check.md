# Timing Check — Implementation Plan

Spec: [specs/2026-10-23-timing-check-design.md](../specs/2026-10-23-timing-check-design.md)
Visual reference: `tmp/timing-feedback-views.html` (mockup — reuse its CSS/geometry ideas, NOT its simulation code)

All code goes in `src/index.html` (single file, Tailwind CDN). Keep the existing scheduler intact.

## Task 1 — State + pure helpers
Add a `// --- Timing Check (mic input) ---` section after the existing state vars.
- State: `timingOn`, `timingView`, `timingFeel`, `timingStream`, `timingSource`, `timingNode`, `timingSink`, `timingDeviceId`, `timingLatencyMs`, `timingCalibrated`, `timingBeats` (ring buffer), `timingHits` (log), `timingLastHitTime`, `timingCalib` (null | in-progress object).
- Pure functions (global, so tests can call them via `page.evaluate`):
  - `getTimingGrid()` → `{ name, pos[], role[], gap, locked }` from `subdivision` + `timingFeel` (lock table in spec).
  - `matchOnsetToGrid(tComp, beats, grid, fallbackDur)` → `{ offsetMs, beatGlobal, pos, role } | null` (applies the reject rules).
  - `timingQuality(ms)` → `'good' | 'warn' | 'bad'`.
  - `median(arr)`, `mad(arr)`.

## Task 2 — Scheduler hook
In `scheduleNote()`, when `isMainBeat`, call `timingRecordBeat(time, mainBeatInt % beatsPerMeasure)` (cheap push into ring buffer, before the mute early-return paths). In `togglePlay()` start: clear beats/hits/marks; stop: freeze (stop rAF loop).
In the rhythm menu handler: call `timingApplyFeel()`. In beats +/- handlers and `renderBeatIndicators()`: call `timingLayoutBeatsStrip()`. In `updateBpm()`: call `timingRelayoutTimeline()`.
Each hook must be a no-op when `timingOn` is false.

## Task 3 — Audio input + worklet
- Inline worklet source string → `Blob` → `audioCtx.audioWorklet.addModule(url)` once.
- `timingStart()` (from Timing button click): `initAudioContext()`, getUserMedia (constraints in spec), build graph, enumerate devices, populate select, start level/onset message handling. Errors → message in add-on.
- `timingStop()`: stop tracks, disconnect, hide UI.
- `timingSwitchDevice(id)`, `devicechange` listener.
- Worklet `port.onmessage`: `level` → meter; `onset` → calibration collector if calibrating, else `timingHandleOnset(time, peakDb)`.
- `timingHandleOnset(time, peakDb)` must be a global entry point (tests inject synthetic onsets through it).

## Task 4 — UI markup + CSS
- Header Timing button (left group, after Vol). Mic SVG; `aria-pressed`; live dot.
- Add-on block markup per spec (ids: `timingAddon`, `timingDeviceSelect`, `timingLatency`, `timingCalibrateBtn`, `timingViewSeg`, `timingMeterFill`, `timingMeterTh`, `timingStatus`, `timingFeelSeg`, `timingFeelHint`, `timingTimeline`, `timingTrack`, `timingNow`, `timingNoInputB`, `timingAvg`, `timingSpread`, `timingHitCount`, `timingError`).
- C strip under `#beatContainer` (ids: `timingBeatsStrip`, `timingBeatsGrid`, `timingBeatsMarks`, `timingSweep`, `timingNoInputC`).
- CSS: copy the relevant rules from the mockup (`.chart`, `.band`, `.mid`, `.gl`, `.dot.d0/.d1/.d2`, `.noinput`, `.seg`, meter). Moving things use `transform`/`opacity` only; `will-change: transform` on track/sweep/meter fill.

## Task 5 — Rendering loop
- `requestAnimationFrame` loop active only while `timingOn && isPlaying`.
- Now = `audioCtx.currentTime`. Timeline: `translate3d(playX − now·pps)`, prune items left of view. On beats: compute position p from the beat ring buffer, move sweep, wipe the cell on entry.
- Summary refresh every 100 ms; No-input check per frame (class toggle only on change).
- Meter render from latest `level` message.

## Task 6 — Calibration
Per spec. Disable Calibrate while playing; START during calibration cancels it. Save per device.

## Task 7 — Persistence
view / feel / deviceId / latency per device, all in try/catch.

## Task 8 — Tests (`tests/timing.spec.js`)
Add to `playwright.config.js` chromium launch args: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`.
- Grid: `getTimingGrid()` for each subdivision (lock + names); `matchOnsetToGrid` straight / shuffle / half-time offsets and rejection of ambiguous hits.
- UI: Timing toggle shows/hides add-on and leaves base UI untouched; Feel locked for shuffle/16shuffle; On beats disabled when 8+ beats wrap.
- Flow: start playback with Timing on, inject synthetic onsets via `timingHandleOnset(beatTime + L + 0.012)` → a dot with `data-q="warn"`? (12 ms → warn) appears in the Timeline and summary Avg ≈ +12 ms; no hits for > 1 bar → No input visible.
- Existing tests must still pass (`npm test`).

## Task 9 — Docs
Add a "Timing Check" section to `docs/claude/architecture.md` (state vars, hooks, worklet, functions) and link the spec/plan from `CLAUDE.md` Docs list.
