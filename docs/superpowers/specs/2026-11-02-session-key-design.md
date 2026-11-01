# Session Key (URL state) — Design Spec

Date: 2026-11-02

## Goal

Every page entry gets a random key in the URL. The app state is saved in localStorage under that key, so opening the
page again (same browser, same machine) with the same key restores the same state. Local only; no server.

## Key

- The URL hash is the key: `index.html#k7f3q9xa` (8 chars, `[a-z0-9]`, from `crypto.getRandomValues`).
- On load: if the hash is present and valid (`/^[a-z0-9]{4,32}$/`), use it; otherwise generate one and write it with
  `history.replaceState` (no reload, no new history entry, path and query kept). Works on `file://` and http(s).
- `hashchange`: a new valid key different from the current one saves the current snapshot (force) and calls
  `location.reload()` so that key loads cleanly; an empty/invalid hash is replaced by the current key (replaceState).
- A key with no saved snapshot (shared link, cleared storage) simply starts from defaults and saves under that key.

## What is saved (one JSON snapshot, `wm.s.<key>`)

`{ v: 1, at: <ms epoch>, ... }` with:
- Metronome: `bpm`, `beatsPerMeasure`, `beatStates`, `subdivision`, volume (slider value) and mute, timer minutes
  (`targetDuration` choice, not the remaining time).
- Accel: target BPM (`accelTargetBpm` / last target), duration, mode, weight (settings only; no running ramp state).
- Timing UI prefs: `timingView`, `timingRes`, `timingShuffle`, `timingRangeMs`.
- Timing on/off, Practice mode on/off, `practice.bars`.

Not saved per key: anything per input device (latency, channel, ref channel, trim, sensitivity, quiet level,
loopback/glitch history, device id) — these describe the hardware and stay global as today. Playback state is never
restored (no autoplay).

## Restore

- At init, after the defaults are built and before the first render, apply the snapshot through the existing entry
  points (e.g. `updateBpm`, the beats change path, the rhythm selection path, `setTimer`, volume/mute setters, accel
  setters, `timingSetView(.., false)` etc.) — never by poking DOM or duplicating their logic. Invalid/out-of-range
  values are ignored field by field (clamped like the UI does).
- Snapshot values override the global Timing prefs (`wm.timing.view/res/shuffle/range`, `wm.practice.bars`); with
  no snapshot the globals are used as today. The globals keep being written as today.
- Timing on: only auto-started when `navigator.permissions.query({name:'microphone'})` says `granted` (no
  permission prompt without a user gesture). Then Practice mode is re-entered if it was on. If permission is not
  granted, Timing stays off and the saved `timing`/`practice` flags are kept in the snapshot (not overwritten with
  false) until the user turns Timing on or off themselves; turning Timing on then re-enters Practice if it was on.
  The AudioContext may start suspended; the existing START gesture resumes it.

## Save

- One function `stateSnapshot()` builds the object; `stateSave()` writes it only when the JSON differs from the last
  write. Called by a debounced trigger (~400 ms) and on `pagehide` / `visibilitychange` (hidden). The trigger is a
  1 s `setInterval` diff check (tiny object, no scheduler impact) — no save calls sprinkled over every setter.
- localStorage in try/catch; storage unavailable = the feature silently does nothing.
- Housekeeping: index `wm.s.index` = `[{k, at}]`; keep the 50 most recent keys, delete older snapshots.

## Share link

The local key stays the default. A separate **Share** action makes a short URL that carries the settings themselves,
so it works on another browser/device.

- **Format**: hash starting with `~` (never a valid key, so the two can't be confused), versioned, comma separated,
  URL-safe without escaping, defaults omitted. Core positional fields, then optional tagged tokens, e.g.
  `#~1,120,4,2000,16,v80,t5,a150w2d10,T16,P4` (version, bpm, beats, beat states as digits, rhythm code, then tokens:
  volume, mute, timer, accel target/mode/weight/duration, Timing prefs + on, Practice + bars). Exact token letters are
  defined in code next to one encoder/decoder pair (`stateEncodeShare(o)` / `stateDecodeShare(s)`) built on the same
  `stateSnapshot()` / `stateRestore()` objects — no second list of fields. Parsing is tolerant: unknown tokens and
  bad values are ignored field by field; an unknown version → treated as no state.
- **Opening a share URL**: decode → generate a fresh local key → apply the state via `stateRestore` (+ timing rule
  above) → save under the new key → `history.replaceState` to `#<newkey>`. So the address bar turns into a normal
  local URL and later changes never touch the shared link. A `hashchange` to a share hash in an open tab saves the
  current snapshot and reloads (same path as a key change).
- **UI** (English): portrait — a small share icon button in the card's top-right corner (absolute, slate-300 →
  indigo on hover, `aria-label="Copy share link"`, does not move any existing element). Practice — a `Share link` item
  in the More overlay. Click: build the URL from the current state, `navigator.clipboard.writeText`, show a short
  toast `Link copied` (opacity fade only). If the clipboard is unavailable, show the URL in a small popover with a
  read-only selected text field.

## Tests (`tests/session.spec.js`)
- Share: encode → decode round trip equals the snapshot (all fields, defaults omitted); a typical state is ≤ 60 chars;
  opening a share URL restores it and the URL becomes `#<new key>` with that state saved; tolerant parse of junk tokens;
  the share button copies (grant clipboard permissions) and shows the toast; portrait layout boxes unchanged.
- No hash → a key is added to the URL by replaceState (history length unchanged).
- Change bpm/beats/beat states/rhythm/volume/timer/accel/timing prefs, reload with the same URL → identical state.
- Another key → defaults (or globals). Invalid key → replaced. Corrupt JSON → defaults, no crash.
- Timing restore with permission granted (Playwright fake media + grant) → Timing and Practice back on.
- Index cap at 50.
