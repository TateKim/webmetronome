# Practice Mode (landscape) — Design Spec

Date: 2026-11-01
Status: approved direction (reference screenshot supplied by the user; similar feel, not identical)

## Goal

A wide, landscape layout for practising with Timing Check. The timing Timeline fills the screen and also shows the
input waveform; the metronome controls shrink to one header line (with overlays for adjustments); the bottom line
shows status and practice statistics. Switch with a button. **Portrait (the current layout) does not change.**

## Principles

- Portrait design and behaviour stay exactly as today. Practice mode is a CSS class + DOM re-parenting of existing
  controls; no control is duplicated (one element, one set of listeners, one id).
- Timing accuracy first: the scheduler is untouched. The waveform uses the worklet frame clock (`frameStart`), the
  same clock as onsets.
- Compositor-only animation: moving things change only `transform`/`opacity` (memory note "Rendering
  compositor-only"). Waveform tiles are canvases drawn once (or appended to) and then moved with the track.
- All UI text English.

## Entering / leaving

- Enter: a `Practice` button (landscape icon + label) in the Timing view row next to the settings button
  (`#timingSetBtn`). It exists only while Timing is on, like every other Timing control, so the base UI is unchanged.
- Leave: a round icon button at the bottom-left of the practice footer (rotate icon, `aria-label="Portrait mode"`),
  and automatically when Timing is turned off (or fails / mic denied).
- The mode is not persisted (Timing on/off is not persisted either). The bar count is (`wm.practice.bars`).
- Entering/leaving does not stop playback and does not clear marks (the Timeline is re-laid out and rebuilt from
  the ring buffers, like a view switch).
- In practice mode the Timeline view is used regardless of `timingView`; the stored view is not changed and comes
  back on exit.

## Layout (body class `wm-practice`)

Card: full viewport (`100dvh`, small outer margin, max-width ~1400px), rounded, flex column, no page scroll at
640x360 and up. Three rows:

### 1. Header (one line, ~56px) — revised after 2nd reference screenshot
Left to right:
- **Play/Stop** — the existing `#playBtn` as a pill: indigo `Play` when stopped, rose/red `Stop` while playing.
  `#accelStopBtn` sits next to it when visible.
- **Inline BPM stepper** — round slate buttons `−5` `−` · big tabular BPM number · `+` `+5` (the existing
  `#decreaseBpm5/#decreaseBpm/#increaseBpm/#increaseBpm5` re-parented; the number is a display bound to `bpm`;
  clicking the number opens a small BPM overlay with the slider, TAP TEMPO and the accel trigger/status).
  The slider row itself is not shown in the header.
- **Rhythm/beats chip** — rhythm icon (existing `#rhythmTrigger` look) + two text lines: `4 beats` /
  `Grid 1/16` (grid = current detect grid name from `getTimingGrid()`, e.g. `Grid 1/16`, `Grid 8 Shuffle`).
  Clicking opens an overlay holding the existing rhythm menu items and the Beats stepper (`- 4 +`).
- **Session box** — `Session` label + `0:38` elapsed (big, tabular), with a small line under it when there is room
  (`412 hits · +3 ms · ±9 ms`; may be a tooltip/title on narrow screens).
- **More** — indigo text button opening an overlay with everything else: Timer, Volume, **Bars** (`2 | 4 | 8`),
  and the Timing settings (`#timingSetBtn` + popover, or its contents). Re-parent, don't duplicate.
- Never wraps to a second line; at narrow widths the sub-line of the session box hides first.

### 2. Timeline (flex: 1)
The existing `#timingTimeline`, taller (fills remaining height) and wider:
- `EARLY` top-left, `LATE` bottom-left (existing labels).
- Right-side **ms labels** on the guide lines (`−50 ms`, `−25 ms`, `+25 ms`, `+50 ms` for range 50; follows
  `TIMING_RANGE_GUIDES`, early = negative at the top) and a small green `±10 ms` label at the band's top-left.
  The `±N ms` scale label is hidden in practice mode (the right labels replace it).
- **Beat indicator** (`#beatContainer`, re-parented) centred at the top of the chart, smaller circles (~22px), the
  "Tap circles..." hint hidden. Tapping still cycles tones.
- NOW line at 90% (existing). Visible window = **bars** (2/4/8, default 4) instead of the fixed 2.
- **Waveform** layer (see below) under grid lines and markers, above the green band.
- `Press Play` centred hint (slate-500, 20px) while stopped and the track is empty.
- `No input` pill unchanged.

### 3. Footer (one line, ~52px)
Left to right: portrait-mode button · status line in the status colour: `<device label> · listening` (device name
from the selected input, then the lower-cased `#timingStatus` text, e.g. `iRig HD X · listening`, `· quiet`,
`· no input`), with the compact meter optional · flexible gap · **Recent**: `Avg +0 ms  Spread ±48 ms  Hits 16`
inline, large values coloured by quality (the existing `#timingAvg/Spread/HitCount`).
Timer countdown (`#timerCountdown`) and `#accelResetBtn` appear in the footer when active.
The Session box lives in the header (see above).

Hidden in practice mode: big BPM display area, visual light, On-beats strip, view segmented control, Practice button
itself, the headphones note, the "Tap circles" hint.

## Waveform

- **Data (worklet).** New `config` flag `wave: true|false` (sent on enter/exit and on stream attach while in
  practice). While on, per 64-sample block the worklet keeps the peak |x| of the raw selected instrument channel and
  every 16 blocks posts `{type:'wave', time, step, peaks}` (`time` = context seconds of the first block, from the
  `frameStart` clock; `step` = 64 / sampleRate; `peaks` a transferred Float32Array(16)). Nothing is computed when off.
- **Store (main).** Ring of `{t, peak}` in compensated time `t = time − L/1000`, with
  `L = timingMatchLatencyMs()` at arrival (the same L hits use, so waveform peaks line up with dots). Keep at least
  `(bars + 1)` bars of data (cap 30 s). Cleared at START (with the Timeline reset).
- **Scale.** dB: `db = 20·log10(peak)`; height fraction `clamp((db − quietDb) / (0 − quietDb), 0, 1)` where
  `quietDb = timingQuietDb` (popover QUIET BELOW). Symmetric above/below the centre line, full height = the
  Timeline half height.
- **Style.** Neutral slate, not indigo: fill `rgba(100,116,139,0.15)` (15% opacity) and the outer edge stroked at
  1.5px, `rgba(71,85,105,0.85)` (top and bottom outlines, not closed vertical sides). The envelope looks blocky/
  stepped (per-column max, no smoothing), like the reference.
- Before any input arrives the centre line is drawn as the "flat" waveform (the reference shows a dark flat line
  before the first hit) — i.e. silent columns draw the outline at the centre.
- **Drawing.** Canvas tiles (256 CSS px wide, DPR-aware, full chart height) appended to `#timingTrack` and placed in
  track coordinates like other items (`translate`), so they scroll with the track for free. New data is drawn into
  the current tile (per-pixel-column max of peaks; overlap one column with the previous so the outline is
  continuous across tiles). Tiles are pruned with the other items. On relayout (BPM, bars, resize, range, quiet
  level) all tiles are cleared and redrawn from the ring.
- Portrait mode: no waveform (flag off, no tiles).

## Statistics

- **Recent** = the existing summary, window `bars` in practice mode (2 in portrait timeline, 1 in On beats).
- **Session** (reset at START, frozen at stop, kept until the next START):
  elapsed time (context clock since START, `m:ss`, `h:mm:ss` from 1 h), accepted hit count, mean offset and
  standard deviation over all accepted hits of the session. Uses running sums (n, Σx, Σx²); when a hit is replaced
  by a louder one in the same cell (`timingRemoveHitMark`), the old one is subtracted. Rejects (off-grid) are not
  counted. Colours use the existing quality helpers (`timingQuality`, `timingSpreadQuality`).
- Computed always (cheap), shown only in practice mode.

## Sizing changes to existing Timeline code

- `TIMING_TL_H`/`TIMING_TL_HALF` constants become values read at layout (`timingTl.h`, `timingTl.half`, from
  `clientHeight`; portrait keeps 132/58 exactly).
- The `2` bars in `timingTlLayout`, `timingTlRebuild` (2.2 bars), `timingUpdateSummary` come from one helper
  `timingTlBars()` (practice ? `practiceBars` : 2).
- A `ResizeObserver` (or window `resize`) on the Timeline triggers relayout while in practice mode.

## Size: Fill / Fixed (added 2026-11-02)

- Practice mode has two sizes, toggled in the More overlay (`SIZE` label, segmented `Fill | Fixed`):
  - **Fill** (current behaviour): the card fills the viewport.
  - **Fixed**: a fixed-size card centred on the page like the portrait card (same white card, `rounded-[2.5rem]`,
    `shadow-2xl`, page background visible around it): width `min(960px, 100vw - 32px)` (shrinks to fit the
    viewport width), height **fixed at 480 px** (never shrinks; on a shorter viewport the page scrolls vertically,
    like portrait).
- Default `Fill`. Saved globally (`wm.practice.size`), in the session snapshot and in the share link.
- Switching size re-lays out the Timeline (same path as a resize) without stopping playback or clearing marks.
- Tests: toggle switches card size (Fixed at 1600x900 = 960x480, at 844x390 = fits, no page scroll), persisted,
  marks/playback unaffected.

## Out of scope
- Auto-switch on device rotation, fullscreen API, screen wake lock.
- Waveform in portrait mode.
- Saving session history.
