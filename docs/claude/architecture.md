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
