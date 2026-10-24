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
3. **Detect row** (in the settings popover): `DETECT` label · segmented `4 | 8 | 16 | 32` · `Shuffle` toggle · `Locked to <tuplet>` hint (only for tuplet rhythms)
4. **Timeline panel** (shown only in Timeline view)
5. **Summary row**: three small boxes, `Avg · last N bars` / `Spread` / `Hits`
6. A hint line in small grey text: `Use headphones so the mic doesn't pick up the click.`

### View B: Timeline (separate panel)
- Height 132 px, rounded corners, light background. The center horizontal line means on time; the ±10 ms band is tinted green; `EARLY` at the top, `LATE` at the bottom.
- The **NOW** line is fixed at 90 % of the width, and the last **2 bars** scroll left (pixels per second = `playX / (2 × bar duration)`, recomputed when BPM changes).
- Grid lines: bar line (2 px, darker), beat line, sub-grid lines (faint; the finest role-3 lines of the 32 grid are fainter still) for the current Detect grid.
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
- **Dot size**: beat 11 px > main off-beat (1/2, or 2/3 for 8 Shuffle) 8 px > others 6 px > finest (32 grid odd eighths) 4 px.
- **No input**: while playing, if no accepted hit has come in for `max(1 bar, 1.5 s)`, the visible view is dimmed and shows a `No input` pill.
- **Summary**: computed only from accepted hits in the window that is currently visible (Timeline 2 bars, On beats 1 bar). Avg = mean offset, Spread = standard deviation (`±N ms`, ≤ 8 green / ≤ 16 amber / above that red), Hits = number of accepted hits. The app does not know what rhythm the player intends, so Hits is not a miss rate.
- On metronome stop, the current marks stay frozen. On start, everything is cleared.

## Detect grid (positions used for detection)

Roles: 0 = beat, 2 = main off-beat, 1 = other, 3 = finest (32 grid only). Capture weights: 1.0 / 0.85 / 0.6 / 0.5 (role 0 / 2 / 1 / 3).

| Name | Positions within a beat | Roles |
|---|---|---|
| 4 | 0 | 0 |
| 8 | 0, 1/2 | 0, 2 |
| 16 | 0, 1/4, 1/2, 3/4 | 0, 1, 2, 1 |
| 32 | 0, 1/8 ... 7/8 | beat 0, 1/2 = 2, 1/4 and 3/4 = 1, odd eighths = 3 |
| 8 Shuffle | 0, 2/3 | 0, 2 |
| 16 Shuffle | 0, 1/3, 1/2, 5/6 | 0, 1, 2, 1 |
| 8 Triplet (`shuffle` rhythm at Detect 16 only) | 0, 1/3, 2/3 | 0, 1, 2 |
| Triplet (locked only) | 0, 1/3, 2/3 | all 1 except beat |
| Quintuplet (locked only) | 0, 1/5 ... 4/5 | all 1 except beat |
| Sextuplet (locked only) | 0, 1/6 ... 5/6 | 1/2 = 2 |

State: `timingRes` ('4' | '8' | '16' | '32', default '16') and `timingShuffle` (bool, default off). Shuffle applies at 8 and 16 only; at 4 and 32 the toggle is disabled and the preference is kept, so switching back to 8 or 16 restores it.

Lock rule (the `subdivision` value):
- `shuffle` / `16shuffle`: Shuffle is forced on and locked. 32 is disabled; if the chosen resolution is 32 the rhythm's default is used (8 for `shuffle`, 16 for `16shuffle`). 4, 8 and 16 stay available (shuffle has no effect at 4). The `shuffle` rhythm at 16 uses the 8th-triplet grid `8 Triplet` (0, 1/3, 2/3; 2/3 is the main off-beat); at 8 it is `8 Shuffle`, at 4 just `4`. `16shuffle` at 16 is `16 Shuffle`. A straight rhythm with the user's Shuffle toggle at 16 stays `16 Shuffle`.
- `3` / `5` / `6`: the grid is locked to Triplet / Quintuplet / Sextuplet. The whole Detect row is disabled and the hint reads `Locked to Triplet`.
- `1`, `2`, `4`, `4e`: the user's choice.

`getTimingGrid()` returns `{ key, name, pos, role, gap, res, shuffle, locked }`; names are `4`, `8`, `16`, `32`, `8 Shuffle`, `16 Shuffle` or the tuplet name (also the settings-button text and the debug meta).

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
  - |offset| > capture radius × dur (too-far; see v1.2: 0.42 × widest grid gap, clamped to 0.16-0.45 beat)
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
`wm.timing.view` (timeline|beats), `wm.timing.res`, `wm.timing.shuffle`, `wm.timing.deviceId`, `wm.timing.latency.<id>`. The Timing on/off state itself is not saved, because turning it on prompts for permission.

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

## v1.2 변경 - Feel 대신 Detect 그리드 (2026-10-24)

- 설정 팝오버의 Feel(Straight / Shuffle / Half-time)을 **Detect** 컨트롤로 교체했다: `4 | 8 | 16 | 32` 분할 선택 + 같은 줄의 `Shuffle` 토글. 접근성 이름은 Quarter notes / 8th notes / 16th notes / 32nd notes.
- 조합: 4 = [0], 8 = [0, 1/2], 16 = [0, 1/4, 1/2, 3/4](기존 straight), 32 = 8분의 1 간격 8개(홀수 번째에 role 3, 가중치 0.5, 가장 작은 4 px 점, 가장 옅은 격자선), 8 Shuffle = [0, 2/3], 16 Shuffle = [0, 1/3, 1/2, 5/6](기존 half-time). Shuffle은 4와 32에서 비활성이며 사용자 설정값은 유지되어 8/16으로 돌아오면 복원된다.
- 잠금: `shuffle`/`16shuffle` 리듬은 Shuffle 강제 ON + 32 비활성(해상도가 32였다면 각각 8 / 16 사용), 3/5/6 잇단음표는 Detect 줄 전체 비활성 + `Locked to Triplet` 힌트.
- 저장: `wm.timing.res`, `wm.timing.shuffle`. 예전 `wm.timing.feel`은 첫 로드에서 변환(straight -> 16/off, shuffle -> 8/on, halftime -> 16/on)한 뒤 삭제한다.
- 매칭 보정: 거친 그리드(예: 8)에서 16분음표 위치의 타격이 박/8분음표 사이 중간이라 가중치 때문에 엉뚱하게 채택되던 문제를 막기 위해, 기각 반경을 고정 0.45박에서 `0.42 x 가장 넓은 그리드 간격`(최소 0.16박, 최대 0.45박)으로 바꿨다. 16 이하의 촘촘한 그리드 동작은 그대로이고, 8에서 1/4 위치 타격은 `too-far`로 기각되어 회색 링으로 표시된다.
- `shuffle`(8분 셔플) 리듬에서 Detect가 16이면 16 Shuffle 대신 8분 3연음 그리드 `8 Triplet`([0, 1/3, 2/3], 2/3이 main off-beat)을 쓴다. 4는 `4`, 8은 `8 Shuffle`, `16shuffle` 리듬의 16은 `16 Shuffle`, 직선 리듬에서 사용자가 Shuffle을 켠 16도 `16 Shuffle` 그대로다.

## v1.3 Click ref 채널 (2026-10-24)
(2026-10-24 갱신: 아래 검출기/잠금/한계 항목은 v1.4에서 템플릿 매칭으로 대체됨. 설정, Trim, Lost, UI 항목은 그대로 유효하다.)

배경: 실기기 데이터에서 입력 스트림마다 80~90 ms의 무작위 오프셋이 생기고, Chrome 입력 FIFO가 가끔 미끄러져(10/20 ms) 지연이 그만큼 커진다. 별도 루프백 측정은 스트림이 바뀌면 무효가 되므로 취약하다. 인터페이스의 "Loopback" 장치처럼 한 스트림에 악기(Ch 1)와 메트로놈 재생음(Ch 2)이 함께 들어오면 같은 시간축을 공유하므로, 메트로놈 클릭을 직접 검출해 예약 시각과 짝지으면 `liveL = refTime - scheduledTime`이 이 스트림의 정확한 현재 왕복 지연이 된다. 오프셋과 글리치가 자동으로 추적된다. **선택 기능이며 기본값은 Off**: Off이면 기존 방식(수동/측정 지연, Measure, 글리치 보정, Re-measure 힌트)이 그대로 동작한다.

- 설정: INPUT 섹션의 악기 채널(Ch 1/Ch 2) 아래에 `Click` = `Off | 악기 채널을 뺀 모든 채널`. 악기 채널과 Click 채널은 상호 배타(악기 채널로 Click 채널을 고르면 Click은 Off). 장치별 저장 `wm.timing.refCh.<deviceId>`(`off` 또는 채널 번호), 기본 Off. 툴팁: "Channel that carries the metronome itself (e.g. an interface loopback). Timing is then measured against the actual clicks, so latency is tracked automatically."
- 검출기(워클릿, `RefClick`): OnsetCore의 밴드/글리치 스캔과 별개로 ref 채널 원본 샘플을 본다. 느린 RMS로 노이즈 바닥을 추적하고, `|x| > max(1e-4, 8 x floor)`인 첫 샘플에서 트리거한 뒤 최대 3 ms 뒤로 거슬러 올라가 상승 시작 샘플(`> max(2e-5, 2 x floor)`)을 찾는다. 불응기 25 ms, 그리고 2 ms 동안 큰 샘플이 없어야 재장전되므로 클릭의 꼬리(링잉)에서 다시 트리거되지 않는다. `{type:'ref', time: frame/sampleRate, peak}`를 보낸다. 앱의 클릭은 `osc.start(time)` + 즉시 풀 게인인 사인(위상 0)이라 첫 출력 샘플이 정확히 0이고 두 번째 샘플부터 값이 있다. 그래서 검출 시각은 예약 샘플보다 정확히 1샘플(48 kHz에서 약 21 us) 늦으며, 이 고정량을 `lead = 1`샘플로 보정한다(실제 클릭으로 측정한 오차 0.00샘플).
- 스케줄러 훅: `playSound`에서 소리가 실제로 예약되는 지점에 한 번 push(`timingRecordClick`). 음소거된 박(그 박의 서브디비전 포함)은 기록하지 않는다. 링 버퍼 `timingClickTimes`(64개). `timingOn`이고 ref가 켜졌을 때만 동작하며 예약 계산은 바꾸지 않는다.
- 잠금(`timingRefMatch`, 순수 함수): 재생 시작 때 ref 상태와 링 버퍼를 비우고, 첫 ref 이벤트를 이번 실행의 첫 클릭(창 `[refTime - 0.5 s, refTime - 0.005 s]`에서 가장 이른 것)과 짝짓는다. 재생 중에 스트림/채널이 바뀌면(링을 유지) 이전 liveL(또는 저장된 지연)을 힌트로 가장 가까운 후보를 고른다.
- 추적: 이벤트마다 창 안의 후보 오프셋 `refTime - s` 중 현재 liveL에 가장 가까운 것을 고른다. 3 ms 이내면 채택하고 liveL = 최근 5개 채택값의 중앙값. 3 ms 이내 후보가 없으면 보류(pending)하고, 연속 2개의 보류 이벤트가 1 ms 이내로 일치하면 새 오프셋을 채택(점프; 10/20 ms 글리치)하며 글리치 로그에 `ref-jump`(oldMs/newMs/deltaMs)를 남긴다. 보류 뒤 정상 이벤트가 오면 이상치로 버린다.
- Lost: 재생 중 채택된 이벤트가 1.5 s 넘게 없으면 lost. lost인 동안 마지막 liveL을 계속 쓰고, 없으면 `timingEffectiveLatencyMs()`로 폴백한다. 경고 "No click on ref channel"(warn)은 이번 실행에서 한 번도 잠기지 못했거나, 들렸어야 할 클릭이 예약된 채로 lost일 때만 표시한다(음소거는 경고 없음).
- 사용: 잠긴 상태에서 악기 매칭 지연은 `L = liveL + trim`(`timingMatchLatencyMs()` 한 곳). liveL에 이미 슬립이 포함되므로 글리치 보정은 더하지 않는다. Trim `wm.timing.refTrim.<deviceId>`(기본 0, -20..+20 ms)은 헤드폰 경로와 루프백 경로의 작은 아날로그 차이용.
- UI(ref 켬): LATENCY 행이 `Live 89.0 ms`(잠기기 전 `Live —`)와 Trim 스테퍼로 바뀌고, Measure는 비활성(툴팁 "Not needed with a click ref channel")이며 루프백 패널, Re-measure 힌트, `+N ms auto` 표시는 숨긴다. 설정 버튼 텍스트는 `16 · Live 89 ms · S5`. 375 px에서 가로 넘침 없음.
- 디버그: `timingDebugRecord` JSON에 `ref.events`, `ref.clicks`, `ref.liveLHistory`가 추가되고, 콘솔에서 `timingRefState()`로 상태를 본다.
- 한계: 빠른 클릭(예: 200 BPM 16분음표, 75 ms 간격)에서는 오프셋이 클릭 간격의 배수만큼 어긋나도 자기 일관적이므로, 가장 신뢰할 수 있는 잠금은 재생 시작 때의 첫 클릭 짝짓기다. 재생 중 켜면 힌트(저장된 지연)가 간격의 절반 이내로 맞아야 한다.

## v1.4 Click ref 템플릿 매칭 + Audio buffer 제거 (2026-10-24)

**Audio buffer 설정 제거.** 설정 팝오버의 Audio buffer 선택(`#timingBufSelect`)과 `wm.audio.latencyHint`로 AudioContext 생성 옵션을 바꾸던 진단 실험을 삭제했다. `initAudioContext()`는 예전처럼 옵션 없이 `new AudioContext()`를 만든다. 로드 때마다 저장된 `wm.audio.latencyHint` 키를 지워서(`timingRestorePrefs`), 20 ms를 골랐던 사용자도 기본값으로 돌아간다. 이력/글리치 로그의 `latencyHint` 필드는 예전 로그와 비교할 수 있도록 항상 `'default'`로 계속 기록한다(상수 `TIMING_LATENCY_HINT`, 변수 `audioCtxHintUsed`는 삭제). 이 설정 전용 CSS는 없었다(`.tm-select`, `.tm-hint-ind`, `.tm-note`는 다른 곳에서 계속 쓴다).

**문제.** 실기기(입력 = Loopback 1/2, Ch 1 악기, Ch 2 메트로놈)에서 v1.3 임계값 검출기는 잘 동작했지만, 연습 중 백킹 트랙이나 YouTube 소리가 Ch 2에 메트로놈과 함께 섞이면 음악에 오검출되거나 상승 구간이 음악 쪽으로 치우친다.

**접근.** 클릭을 우리가 합성하므로 파형을 정확히 안다. `playSound`의 파라미터 그대로: 사인(600/800/1200 Hz, 톤 1/0/2), `osc.start(time)`에서 위상 0, 게인은 `time`에 시작 게인(1.5/1.8/3.0)으로 계단 후 `0.001`까지 `dur = min(50 ms, 최단 간격의 15%)` 동안 지수 램프. 루프백은 같은 샘플레이트의 디지털 복사본이라 클릭이 볼륨만 곱해져 샘플 단위로 거의 그대로 나타난다. 그래서 `RefClick`(임계값 + 되감기)을 지우고 `RefTemplate`(템플릿 매칭)으로 바꿨다.

- 스케줄러 훅: `timingRecordClick(time, freq, dur, gain)`가 `timingClickTimes`에 시각을 넣고(경고/상태용), `[sched, freq, dur, gain]`을 `timingClickOut`에 쌓는다. 스케줄러 틱이 끝난 뒤 마이크로태스크 한 번으로 `{type:'clicks'}`를 워클릿에 보낸다(스케줄 계산은 그대로).
- 워클릿: ref 채널을 2차 하이패스 250 Hz + 로우패스 2400 Hz로 거른 뒤(템플릿도 같은 필터를 통과시켜 피크 위치가 어긋나지 않는다) 링 버퍼(>= 1.5 s)에 둔다. 예약된 클릭마다 검색 창이 링에 다 들어오면 템플릿(첫 15 ms)과의 상호상관을 찾는다. 성긴 단계(약 12 kHz, 렌더 퀀텀당 150 k MAC로 시간 분할) -> 상위 8개 피크 주변 전속도 상관 -> 포물선 보간(샘플 이하 정밀도). 피크는 원시 상관으로 고르고(큰 버스트에 강함) NCC >= 0.6인 후보만 채택(런의 첫 클릭은 0.65). 결과는 `{type:'ref', time: sched + lag, lagMs, ncc, sched}`이고 실패는 보내지 않는다.
- 검색 범위: 예측 없음 5~400 ms, 예측 L이 있으면 L +-4 ms, 실패 시 L-5 ~ L+45 ms로 넓힘(10/20/40 ms 글리치 슬립). 힌트만 있으면(lost, 재생 중 켬) 마지막에 전체 범위로 폴백. 추적은 메인 스레드가 맡는다(`timingPostTrack`): 중앙값/점프/lost 규칙이 이미 거기에 있고 워클릿은 상관기로만 두는 편이 단순하다. 워클릿은 그 사이에 자기 마지막 결과를 따라간다.
- 메인 스레드: 이벤트가 자기 `sched`를 들고 오므로 짝짓기가 사라졌다. `timingRefMatch(state, sched, refTime)`는 첫 이벤트 잠금, 최근 5개 중앙값, 2회 일치 점프 채택(`ref-jump` 로그), 이상치 기각을 그대로 유지하고, `timingHandleRef(sched, time, ncc)`가 진입점이다. 재시작 가드(`timingRefIgnoreUntil`)와 "가장 가까운 후보" 선택, `lockMode`/`hint` 상태는 삭제. 빠른 서브디비전(200 BPM 16분음표, 75 ms 간격)에서 스트림이 재생 중 바뀔 때 이웃 클릭에 잠기던 문제는 클릭마다 상관을 계산하므로 해결됐고(테스트 있음), 같은 톤의 클릭이 범위 안에 여러 개면 예측에 가장 가까운 응답(예측이 없으면 가장 이른 응답)을 자기 것으로 본다.
- 측정(Chrome, 앱의 실제 클릭을 정수 샘플 지연 90 ms로 루프백): 검출 지연 = 90.0000 ms. 합성 클릭 89.3 ms는 0.001 ms 이내. 같은 RMS의 핑크 노이즈/음악(800 Hz 비일치 위상 + 타악 버스트)에서 +-0.1 ms(합성 120회 오류 0), +6 dB에서는 개별 이벤트의 약 8%가 반송파 한 주기(0.8~1.7 ms) 어긋난 이웃 주기를 고르지만 5개 중앙값이 흡수한다. 비용: 128프레임 퀀텀당 평균 약 3~5 us, 클릭이 끝나는 퀀텀 약 0.1 ms, 첫 클릭 5~400 ms 스윕은 약 8개 퀀텀로 분산(예산 2.67 ms).
- 한계: 클릭 주파수 부근에 센 부분음이 있는 큰 음악에서는 NCC가 게이트 아래로 내려가 해당 클릭은 보고되지 않는다(긴 구간이면 기존 lost 경고). 진폭이 30% 넘게 다른 같은 톤 클릭은 넓은 검색에서 구분하지 못한다(앱은 같은 톤을 같은 진폭으로 낸다). 큰 감쇠 노이즈 버스트가 아주 드물게 NCC 0.6을 넘을 수 있다.
- Syncing: ref 모드에서는 첫 잠금이 연속 2개 클릭(1 ms 이내 일치)으로 확인될 때까지 악기 타격을 판정하지 않는다(점/Avg/Spread에 반영 안 함, 디버그 reason `syncing`). 그동안 상태 `Syncing…`(중립)과 `Live —`의 opacity 펄스를 보이고, 확인되면 상태를 지운다. 이후 lost가 되면 마지막 liveL로 계속 판정한다. Ref Off는 변경 없음.
