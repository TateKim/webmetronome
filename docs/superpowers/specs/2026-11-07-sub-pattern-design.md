# Sub pattern (per-beat subdivision rests) — design

## Goal

Let the player choose, for each beat, which subdivision clicks sound and which are rests.
Examples: 8ths `o-o`, `x-o`, `o-x`; 16ths `o-x-o-o`, `x-o-o-x`; triplets `o-x-o`; shuffle `o-x` / `x-o`.
Decisions (user, 2026-11-07): per beat; edit by tapping cells directly; shown when switched on; keep the existing
"16th (따으으따)" rhythm (`4e`) as it is.

## Cells per rhythm

| subdivision | cells | positions in the beat (fraction) |
|---|---|---|
| `1` quarter | — (feature not shown) | |
| `2` eighth | 2 | 0, 1/2 |
| `3` triplet | 3 | 0, 1/3, 2/3 |
| `shuffle` | 2 | 0, 2/3 |
| `16shuffle` | 4 | 0, 1/3, 1/2, 5/6 |
| `4` 16th | 4 | 0, 1/4, 1/2, 3/4 |
| `4e` 16th (따으으따) | — (fixed pattern, feature not shown) | |
| `5` quintuplet | 5 | k/5 |
| `6` sextuplet | 6 | k/6 |

One table (`SUB_PATTERN_POS`) is the single source; the scheduler and the UI both use it.

## State

- `subPatternOn` (boolean, default off).
- `subPatterns`: patterns kept **per cell count** so switching rhythm and back keeps them:
  `{ [cells]: number[] }` — one bitmask per beat (bit k = cell k sounds). Missing entry = all cells on.
  Beats added later default to all on; removing beats drops their entries (like `beatStates`).
- When off, or for `1` / `4e`, nothing changes: every click plays as today.

## Scheduler (timing first — the lookahead scheduler is not restructured)

In `scheduleNote`, after the existing `4e` branch and before `playSound`: if the feature applies, find the cell index
of `beatIndex - mainBeatInt` in `SUB_PATTERN_POS[subdivision]` (nearest within 0.05). If its bit is off, skip the
sound only. Everything else stays: `timingRecordBeat` on main beats, `scheduleDraw` (so the beat highlight still moves),
`nextNote` timing. A rest on cell 0 mutes the beat's own click (its accent tone is not played); beat state 3 (mute)
still mutes the whole beat. Muted clicks must not reach anything that assumes an audible click (e.g. the click-ref
template messages, `timingRecordClick`) — check where `playSound` reports clicks.

## UI

- **Switch**: practice mode (landscape) — a "Sub pattern" On/Off segment in the More overlay (`#prMoreOv`).
  Portrait (no More menu) — a small toggle next to the beat-count control (− 4 +). Same state.
- **Icons**: when on and the rhythm has cells, under each beat circle a compact icon of that beat's cells
  (filled = sound, hollow = rest). Hidden when off, for `1` and `4e`. Must fit the portrait beat grid and the practice
  beat strip (`body.wm-practice #beatContainer`) without overflow at 375 px and with many beats.
- **Editor**: tapping an icon opens a small popover anchored to it with the beat's cells as large toggle buttons
  (tap = sound/rest) and an "All on" button. Changes apply immediately (live while playing). Closes on outside click
  / Escape, like the other menus (opening it closes them). Tapping the beat circle keeps cycling accent tones.
- All UI text in English.

## Persistence and sharing

- Saved with the other settings (localStorage), restored on load.
- Share link / session key: an optional trailing field, written only when the feature is on and some pattern differs
  from all-on; old links (no field) restore with the feature off; old parsers ignore the extra field.

## Tests (Playwright)

Scheduler skips exactly the rest cells (count scheduled sounds per beat for 8th/triplet/shuffle/16th-shuffle/16th);
a rest on cell 0 still records the beat for Timing; patterns survive rhythm switches per cell count and beat-count
changes; off / `1` / `4e` unchanged; editor toggles and "All on"; switch in portrait and in the practice More overlay;
persistence across reload; share-link round trip and old-link compatibility; no horizontal overflow at 375 px with
8 beats of 16ths.
