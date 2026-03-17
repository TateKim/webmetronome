# BPM Acceleration Feature Design

**Date:** 2026-03-18
**Project:** webmetronome (index.html — single file, Tailwind CSS, vanilla JS)

---

## Overview

Add a BPM acceleration (gradual tempo increase) feature to the existing metronome. The user sets a target BPM via a collapsible panel below the BPM display. The metronome ramps up from the current BPM to the target BPM over the duration of the existing Timer setting. Each measure end triggers a BPM recalculation.

---

## Requirements

- **Input**: target BPM (number input, 30–250)
- **Duration**: reuses the existing Timer setting (1/5/10/30/60 min)
- **Trigger**: only active when both target BPM is set AND a timer duration is selected
- **Step timing**: BPM is updated at the end of each measure
- **Step calculation**: `newBpm = round(startBpm + (targetBpm - startBpm) * ratio)` where ratio uses `audioCtx.currentTime` for accuracy
- **On stop**: BPM resets to `accelStartBpm` (allows repeating the same ramp)
- **After target reached**: stays at targetBpm until timer expires, then stops normally

---

## UI Design

### Location

Between the BPM control buttons row and the Light Visualizer — currently an empty visual gap.

### Collapsed state

A single small pill/button: `⇢ Accel` centered. Minimal footprint, slate-100 background, indigo text on hover.

### Expanded state

```
[ 120  →  [150]  ×  ]
```

- Left side: current `bpm` live value (read-only label — always reflects current `bpm`)
- Arrow `→`
- Number input for target BPM (slate-100 bg, indigo focus ring, min=30, max=250)
- `×` close button to collapse and clear `accelTargetBpm`; if pressed during active playback, also clears `accelStartBpm` and `accelStartAudioTime` so no BPM reset occurs on stop

### When timer is not set

Target BPM input is disabled, placeholder: "타이머 먼저", muted styling (text-slate-300).

### Active indicator

While playing in accel mode, the `⇢ Accel` toggle shows a small indigo dot (same pattern as `timerActiveDot`) to signal acceleration is running.

---

## Visual Design Constraints

- Follow existing color palette: indigo-500 (`#6366f1`), slate-100/400/700
- Rounded corners consistent with existing elements (rounded-xl / rounded-2xl)
- Font: same `font-bold` weight, `tabular-nums` for numbers
- No new CSS frameworks — plain Tailwind utility classes only

---

## Logic & State

### New state variables

```js
let accelTargetBpm = null;      // null = feature disabled
let accelStartBpm = null;       // captured at play start
let accelStartAudioTime = null; // audioCtx.currentTime at play start
let accelTotalSeconds = 0;      // targetDuration * 60, captured at play start
let accelPanelOpen = false;     // UI toggle state
```

### Measure boundary hook — exact placement

In `nextNote()`, the existing code already has:
```js
if (currentBeatIndex >= beatsPerMeasure) {
    currentBeatIndex = 0;
}
```
Insert the `onMeasureEnd()` call **inside this block, before the reset**:
```js
if (currentBeatIndex >= beatsPerMeasure) {
    onMeasureEnd();           // ← insert here
    currentBeatIndex = 0;
}
```
This ensures it fires exactly once per measure regardless of subdivision.

### BPM ramp calculation

Use `audioCtx.currentTime` (not `secondsRemaining`) for accurate elapsed time:

```js
function onMeasureEnd() {
    if (!isAccelActive()) return;
    const elapsed = audioCtx.currentTime - accelStartAudioTime;
    const ratio = Math.min(elapsed / accelTotalSeconds, 1);
    const newBpm = Math.round(accelStartBpm + (accelTargetBpm - accelStartBpm) * ratio);
    if (newBpm !== bpm) updateBpm(newBpm);
    // updateBpm() already clamps to [30, 250]
}

function isAccelActive() {
    return accelTargetBpm !== null
        && accelTargetBpm !== accelStartBpm
        && isTimerActive
        && isPlaying;
}
```

### On play start

```js
accelStartBpm = bpm;
accelStartAudioTime = audioCtx.currentTime + scheduleAheadTime; // matches nextNoteTime offset
accelTotalSeconds = targetDuration * 60;
```

### On stop

```js
if (accelStartBpm !== null) {
    updateBpm(accelStartBpm);
}
accelStartBpm = null;
accelStartAudioTime = null;
```

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Target BPM = current BPM | `isAccelActive()` returns false; normal playback |
| Target BPM < current BPM | Deceleration — same math works |
| Timer OFF, target BPM set | Input disabled; accel does not activate |
| Timer turned OFF mid-play | `isTimerActive` → false; `isAccelActive()` returns false; ramp freezes at current BPM; on stop, BPM resets to `accelStartBpm` |
| Timer duration changed mid-play | `setTimer()` resets `secondsRemaining` and `targetDuration`; `accelTotalSeconds` was captured at play start so ramp is unaffected (based on original duration) |
| BPM changed manually while playing | `accelStartBpm` unchanged; ramp continues using original start; left-side label updates to show current live `bpm` |
| Tap tempo while accel active | Same as manual BPM change — ramp continues from original `accelStartBpm`; tap-derived BPM is overridden at next measure end |
| Beats per measure changed while playing | Measure boundary fires normally at the new `beatsPerMeasure`; no special handling needed — ramp step may be slightly mis-timed for that one measure, acceptable |
| Target BPM reached before timer ends | `ratio` clamps to 1; `newBpm` stays at `targetBpm`; `updateBpm` is a no-op after first clamp |
| Input left empty | `accelTargetBpm = null`; feature disabled |
| `×` pressed while playing | `accelTargetBpm`, `accelStartBpm`, `accelStartAudioTime` all cleared; ramp halts at current BPM; no reset on stop |

---

## Files Changed

- `index.html` only — all changes in this single file:
  - HTML: new accel panel between BPM controls and visualizer
  - CSS: minimal Tailwind utility classes (no custom CSS needed)
  - JS: new state vars, `onMeasureEnd()`, `isAccelActive()`, hooks in `nextNote()` and `togglePlay()`
