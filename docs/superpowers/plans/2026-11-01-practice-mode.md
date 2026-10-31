# Practice Mode — Implementation Plan

Spec: [specs/2026-11-01-practice-mode-design.md](../specs/2026-11-01-practice-mode-design.md).
All code in `src/index.html`. Run `npx playwright test` after each task; every existing test must keep passing.

## Task 1 — Timeline sizing generalisation (no visible change)
- Replace `TIMING_TL_H` / `TIMING_TL_HALF` usages with `timingTl.h` / `timingTl.half`, set in `timingTlLayout()`
  from `timingTimeline.clientHeight` (fallback 132 → half 58). `timingTlY`, `timingTlAddRing`, the range re-place
  loop in `timingApplyRange`, `--bh` band height and the guide lines must use the live half.
- Add `timingTlBars()` (returns 2 for now) and use it in `timingTlLayout` (pps), `timingTlRebuild` (from = now −
  (bars + 0.2)·barDur), `timingUpdateSummary` (timeline window + label), and the hit/reject keep window
  (`keepFrom = now − max(4, bars + 1)·barDur`).
- Tests: existing suite green.

## Task 2 — Session statistics (computed, not shown yet)
- `practiceSession = { start, end, n, sum, sumSq }`; reset in `timingOnPlayStart()`; `end` set in
  `timingOnPlayStop()`. Add on accepted hit (where `timingHits.push` happens), subtract in `timingRemoveHitMark`.
- `practiceSessionStats()` → `{ secs, n, mean, sd }` (pure, for tests).
- Tests (`tests/practice.spec.js`): inject onsets via `timingHandleOnset` on a running metronome; check n/mean/sd;
  replacement in the same cell keeps n unchanged; reset on START.

## Task 3 — Practice mode shell
- HTML: practice header/footer containers and slots (hidden unless `body.wm-practice`), the Practice button in the
  Timing view row, the portrait-mode button, BPM block + BPM overlay container, Bars chip + menu, `Press Play`
  hint, ms label layer, Session box.
- JS `practiceSetMode(on)`: re-parent existing nodes into slots, remembering each original position with a
  placeholder comment node (`practiceMoves = [{el, ph}]`), and restore them exactly on exit. Force Timeline
  view while on (don't persist), restore `timingSetView(stored, false)` on exit. Relayout + rebuild Timeline.
  Exit when `timingStop()` runs. Menus: BPM overlay and Bars menu use the existing dropdown open/close conventions
  (one open at a time, outside click / Esc).
- Footer: recent summary + session box, updated in the existing ~100 ms summary tick; session time ticks there too.
- CSS under `body.wm-practice` only. Check at 640x360, 844x390, 1280x720: no page scroll, header one line, menus
  inside the viewport.
- `timingTlBars()` returns `practiceBars` (2/4/8, default 4, `wm.practice.bars`) while in practice mode.
- Tests: enter/exit restores every moved element to its original parent and index; portrait layout unchanged
  (compare bounding boxes of key elements before/after a round trip); no vertical scroll in practice at 844x390;
  bars switch changes `timingTl.pps`; Timing off exits practice.

## Task 4 — Right-side ms labels and ±10 ms label
- Built in `timingApplyRange` (same source `TIMING_RANGE_GUIDES`), placed with `transform` at the guide y; shown only
  in practice mode. Hide `.tm-scale` in practice.

## Task 5 — Waveform
- Worklet: `wave` config flag; 64-sample block peak of `chs[this.ch]` (raw); post every 16 blocks with `time` from
  the frame clock; preallocate; transfer a fresh Float32Array(16) per post.
- Main: `timingOnWorkletMessage` routes `wave` → `practiceWaveIn(m)` (ignored unless practice mode and playing).
  Ring buffer (Float32Array pairs, cap 30 s). Canvas tiles per spec; `practiceWaveRedraw()` on relayout / range /
  quiet change; tiles registered in `timingTl.items`-like list so prune removes them (or a separate list pruned in
  `timingTlPrune`). Clear on `timingTlReset` at START.
- Send `{type:'config', wave}` on enter/exit and after stream attach.
- Tests: post synthetic `wave` messages through `timingOnWorkletMessage` → tiles exist, non-empty pixels near the
  expected x for a loud block, nothing for a block below quiet level; worklet unit test via the existing stubbed
  worklet scope: a 1.0 impulse yields a `wave` post with peak 1 at the right block time.

## Task 6 — Docs
- `docs/claude/architecture.md`: a "Practice mode" section (state, functions, re-parenting rule, waveform data
  path, session stats, tests). Link spec/plan in `CLAUDE.md`.
