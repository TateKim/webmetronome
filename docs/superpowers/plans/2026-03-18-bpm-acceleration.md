# BPM Acceleration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible BPM acceleration panel that ramps tempo from the current BPM to a target BPM over the existing timer duration, resetting on stop for repeatable practice.

**Architecture:** All changes are in the single `index.html` file. The HTML panel is inserted between the BPM slider row and the Light Visualizer. New JS state variables track the ramp. `onMeasureEnd()` fires inside the existing `nextNote()` wrap block to update BPM each measure. `togglePlay()` captures start state and resets on stop.

**Tech Stack:** Vanilla JS, Tailwind CSS (CDN), Web Audio API — no build step, open `index.html` directly in a browser to test.

---

## File Map

| File | Change |
|------|--------|
| `index.html` ~line 381 | Insert accel panel HTML between end of BPM controls row and `<!-- Light Visualizer -->` comment |
| `index.html` ~line 448 | Add 5 accel state variables after Timer Variables block |
| `index.html` ~line 489 | Add DOM refs for accel elements after volume DOM refs |
| `index.html` ~line 722 | Add `isAccelActive()` and `onMeasureEnd()` after `updatePendulumSpeed()` |
| `index.html` ~line 689 | Hook `onMeasureEnd()` into the `nextNote()` wrap block |
| `index.html` ~line 785–799 | Add accel start capture (play branch) and accel reset (stop branch) in `togglePlay()` |
| `index.html` ~line 975 | Add event listeners before `initBeats()` |

---

## Task 1: Add HTML panel structure

**Files:**
- Modify: `index.html` — insert between `</div>` ending the BPM controls row (~line 380) and `<!-- Light Visualizer -->` (~line 382)

- [ ] **Step 1: Locate the insertion point**

  Find this block in `index.html`:
  ```html
              <button id="increaseBpm5" ...>+5</button>
          </div>

          <!-- Light Visualizer -->
  ```

- [ ] **Step 2: Insert the accel panel HTML**

  Insert between the closing `</div>` of the BPM controls row and `<!-- Light Visualizer -->`:

  ```html
          <!-- Accel Panel: fixed-height container so card height never changes -->
          <div class="w-full px-0 mb-2 mt-1 flex flex-col items-center">
              <!-- Toggle button row (always visible) -->
              <div id="accelToggleRow" class="relative inline-flex items-center justify-center">
                  <button id="accelToggleBtn" class="flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-500 text-xs font-bold transition-colors">
                      <span>⇢ Accel</span>
                  </button>
                  <div id="accelActiveDot" class="hidden absolute -top-1 -right-1 w-2 h-2 bg-indigo-500 rounded-full border border-white"></div>
              </div>

              <!-- Ramp row: uses 'invisible' (not 'hidden') to always reserve vertical space -->
              <!-- Toggle between 'invisible pointer-events-none' (collapsed) and '' (expanded) -->
              <div id="accelPanel" class="invisible pointer-events-none w-full mt-2 flex items-center justify-center gap-2">
                  <span id="accelStartLabel" class="text-lg font-bold tabular-nums text-slate-700 w-10 text-right">120</span>
                  <span class="text-slate-400 font-bold">→</span>
                  <input
                      id="accelTargetInput"
                      type="number"
                      min="30"
                      max="250"
                      placeholder="목표"
                      class="w-20 px-2 py-1 rounded-xl bg-slate-100 text-slate-700 font-bold text-center tabular-nums text-lg border-2 border-transparent focus:border-indigo-300 focus:outline-none"
                  />
                  <button id="accelCloseBtn" class="w-7 h-7 rounded-full bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-400 flex items-center justify-center text-sm font-bold transition-colors">×</button>
              </div>

              <!-- Timer not set warning: also uses invisible to preserve space -->
              <div id="accelNoTimerMsg" class="invisible w-full mt-1 text-center text-xs text-slate-400">타이머를 먼저 설정하세요</div>
          </div>
  ```

- [ ] **Step 3: Open `index.html` in browser, verify panel area**

  Expected: A small `⇢ Accel` pill button appears between the BPM slider row and the light visualizer. No visual regressions on existing UI.

- [ ] **Step 4: Commit**

  ```bash
  git add index.html
  git commit -m "feat: add accel panel HTML structure"
  ```

---

## Task 2: Add state variables and DOM references

**Files:**
- Modify: `index.html` JS section

- [ ] **Step 1: Add state variables**

  Find the Timer Variables block:
  ```js
      // --- Timer Variables ---
      let targetDuration = 0;
      let timerInterval = null;
      let secondsRemaining = 0;
      let isTimerActive = false;
  ```

  Add immediately after:
  ```js
      // --- Accel Variables ---
      let accelTargetBpm = null;      // null = feature disabled
      let accelStartBpm = null;       // captured at play start
      let accelStartAudioTime = null; // audioCtx.currentTime at play start
      let accelTotalSeconds = 0;      // targetDuration * 60, captured at play start
      let accelPanelOpen = false;     // UI toggle state
  ```

- [ ] **Step 2: Add DOM references**

  Find the last volume DOM ref line:
  ```js
      const volIconMenuMute = document.getElementById('volIconMenuMute');
  ```

  Add immediately after:
  ```js
      // Accel Elements
      const accelToggleBtn = document.getElementById('accelToggleBtn');
      const accelActiveDot = document.getElementById('accelActiveDot');
      const accelPanel = document.getElementById('accelPanel');
      const accelStartLabel = document.getElementById('accelStartLabel');
      const accelTargetInput = document.getElementById('accelTargetInput');
      const accelCloseBtn = document.getElementById('accelCloseBtn');
      const accelNoTimerMsg = document.getElementById('accelNoTimerMsg');
  ```

- [ ] **Step 3: Verify in browser console**

  Open DevTools → Console, type `accelToggleBtn` — should return the button element, not `undefined`.

- [ ] **Step 4: Commit**

  ```bash
  git add index.html
  git commit -m "feat: add accel state variables and DOM refs"
  ```

---

## Task 3: Add core logic functions

**Files:**
- Modify: `index.html` — add two functions after `updatePendulumSpeed()`

- [ ] **Step 1: Find `updatePendulumSpeed()`**

  ```js
      function updatePendulumSpeed() {
          visualLight.style.animationDuration = (60 / bpm) + 's';
      }
  ```

- [ ] **Step 2: Add `isAccelActive()` and `onMeasureEnd()` immediately after**

  ```js
      function isAccelActive() {
          return accelTargetBpm !== null
              && accelTargetBpm !== accelStartBpm
              && isTimerActive
              && isPlaying;
      }

      function onMeasureEnd() {
          if (!isAccelActive()) return;
          // Use audioCtx.currentTime for accurate elapsed — accelStartAudioTime is set
          // at the moment of play start, so elapsed is always >= 0 when this runs.
          const elapsed = audioCtx.currentTime - accelStartAudioTime;
          const ratio = Math.min(elapsed / accelTotalSeconds, 1);
          const newBpm = Math.round(accelStartBpm + (accelTargetBpm - accelStartBpm) * ratio);
          if (newBpm !== bpm) updateBpm(newBpm);
          // updateBpm() clamps to [30, 250]; accelActiveDot state is synced via updateBpm
      }
  ```

- [ ] **Step 3: Verify in browser console**

  Type `isAccelActive()` → should return `false` (not an error).

- [ ] **Step 4: Commit**

  ```bash
  git add index.html
  git commit -m "feat: add isAccelActive and onMeasureEnd functions"
  ```

---

## Task 4: Hook into `nextNote()` and `togglePlay()`

**Files:**
- Modify: `index.html` — three surgical edits

- [ ] **Step 1: Hook `onMeasureEnd()` into `nextNote()`**

  Find in `nextNote()`:
  ```js
          if (currentBeatIndex >= beatsPerMeasure) {
              currentBeatIndex = 0;
          }
  ```

  Replace with:
  ```js
          if (currentBeatIndex >= beatsPerMeasure) {
              onMeasureEnd();
              currentBeatIndex = 0;
          }
  ```

- [ ] **Step 2: Hook accel into `togglePlay()` — stop branch**

  The stop branch of `togglePlay()` looks like this in full (read it carefully before editing):
  ```js
      function togglePlay() {
          if (isPlaying) {
              isPlaying = false;
              clearTimeout(timerID);
              stopTimerCountdown();    // ← INSERT AFTER THIS LINE

              playText.innerText = "START";
              playIcon.classList.remove('hidden');
              pauseIcon.classList.add('hidden');
              playBtn.classList.remove('bg-rose-500', 'hover:bg-rose-600', 'shadow-rose-200');
              playBtn.classList.add('bg-indigo-500', 'hover:bg-indigo-600', 'shadow-indigo-200');

              visualLight.classList.remove('swinging');

              renderBeatIndicators();
              return;                  // ← insertion must be BEFORE this return
          }
          // ... play branch continues below
  ```

  Find `stopTimerCountdown();` inside the stop branch and add after it:
  ```js
              // Accel: reset BPM to start value so ramp can repeat
              if (accelStartBpm !== null) {
                  updateBpm(accelStartBpm);
              }
              accelStartBpm = null;
              accelStartAudioTime = null;
  ```

  The final stop branch should read:
  ```js
          if (isPlaying) {
              isPlaying = false;
              clearTimeout(timerID);
              stopTimerCountdown();
              // Accel: reset BPM to start value so ramp can repeat
              if (accelStartBpm !== null) {
                  updateBpm(accelStartBpm);
              }
              accelStartBpm = null;
              accelStartAudioTime = null;

              playText.innerText = "START";
              // ... rest unchanged ...
              return;
          }
  ```

- [ ] **Step 3: Hook accel capture into `togglePlay()` — play branch**

  In the play branch, find the line just before `scheduler()`:
  ```js
          scheduler();
      }
  ```

  Insert before `scheduler()`:
  ```js
          // Capture accel start state. Use + scheduleAheadTime to align with nextNoteTime offset
          // so elapsed at the first measure end reflects actual audio time, not the 100ms lookahead gap.
          // The first measure fires at nextNoteTime = audioCtx.currentTime + 0.1 (scheduleAheadTime),
          // so elapsed is always >= 0 when onMeasureEnd() first runs.
          accelStartBpm = bpm;
          accelStartAudioTime = audioCtx.currentTime + scheduleAheadTime;
          accelTotalSeconds = targetDuration * 60;

  ```

- [ ] **Step 4: Manual test — basic ramp**

  1. Set BPM to 80
  2. Set Timer to 1 min
  3. Click `⇢ Accel` to open panel, enter 120 in the target input
  4. Press START
  5. Watch the BPM display — it should gradually increase from 80 toward 120 over 1 minute
  6. Press STOP — BPM should snap back to 80

- [ ] **Step 5: Commit**

  ```bash
  git add index.html
  git commit -m "feat: hook accel into nextNote and togglePlay"
  ```

---

## Task 5: Add event listeners and UI behavior

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `updateAccelUI()` helper after `updateMasterVolume()`**

  Find the end of `updateMasterVolume()` and add after it:

  ```js
      function updateAccelUI() {
          // Sync start BPM label to current bpm
          accelStartLabel.textContent = bpm;

          // Show/hide timer-required warning and enable/disable input
          // Use 'invisible' (not 'hidden') so the panel row always reserves its vertical space
          const timerReady = isTimerActive;
          accelTargetInput.disabled = !timerReady;
          accelNoTimerMsg.classList.toggle('invisible', timerReady);
          if (!timerReady) {
              accelTargetInput.placeholder = '타이머 먼저';
              accelTargetInput.classList.add('text-slate-300');
              accelTargetInput.classList.remove('text-slate-700');
          } else {
              accelTargetInput.placeholder = '목표';
              accelTargetInput.classList.remove('text-slate-300');
              accelTargetInput.classList.add('text-slate-700');
          }

          // Active dot: show when accel is running
          accelActiveDot.classList.toggle('hidden', !isAccelActive());
      }
  ```

- [ ] **Step 2: Keep `accelStartLabel` in sync inside `updateBpm()`**

  Find `updateBpm()`:
  ```js
      function updateBpm(val) {
          bpm = Math.min(Math.max(val, 30), 250);
          bpmDisplay.innerText = bpm;
          bpmSlider.value = bpm;
          if(isPlaying) {
              updatePendulumSpeed();
          }
      }
  ```

  Add one line at the end:
  ```js
      function updateBpm(val) {
          bpm = Math.min(Math.max(val, 30), 250);
          bpmDisplay.innerText = bpm;
          bpmSlider.value = bpm;
          if(isPlaying) {
              updatePendulumSpeed();
          }
          accelStartLabel.textContent = bpm;
      }
  ```

- [ ] **Step 3: Call `updateAccelUI()` at the end of the stop branch in `togglePlay()`**

  After the accel reset block added in Task 4, Step 2 (just before `playText.innerText = "START"`), add:
  ```js
              updateAccelUI();
  ```

  The stop branch should now end like:
  ```js
              accelStartBpm = null;
              accelStartAudioTime = null;
              updateAccelUI();

              playText.innerText = "START";
              // ...
              return;
  ```

- [ ] **Step 4: Call `updateAccelUI()` at the end of `setTimer()`**

  Find the end of `setTimer()` and add `updateAccelUI();` as the last line before the closing `}`.

- [ ] **Step 5: Add accel event listeners before `initBeats()`**

  Find:
  ```js
      // Init
      initBeats();
  ```

  Add before `initBeats()`:
  ```js
      // Accel Toggle Button
      // Use 'invisible'+'pointer-events-none' (not 'hidden') to preserve card height
      accelToggleBtn.addEventListener('click', () => {
          accelPanelOpen = !accelPanelOpen;
          accelPanel.classList.toggle('invisible', !accelPanelOpen);
          accelPanel.classList.toggle('pointer-events-none', !accelPanelOpen);
          updateAccelUI();
      });

      // Accel Target Input
      accelTargetInput.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val) && val >= 30 && val <= 250) {
              accelTargetBpm = val;
          } else {
              accelTargetBpm = null;
          }
      });

      // Accel Close Button
      accelCloseBtn.addEventListener('click', () => {
          accelTargetBpm = null;
          accelTargetInput.value = '';
          // If playing, also clear start state so stop won't reset BPM
          if (isPlaying) {
              accelStartBpm = null;
              accelStartAudioTime = null;
          }
          accelPanelOpen = false;
          accelPanel.classList.add('invisible', 'pointer-events-none');
          accelActiveDot.classList.add('hidden');
      });
  ```

- [ ] **Step 6: Manual test — UI interactions**

  Open browser:
  1. **No timer**: Click `⇢ Accel` → panel opens → input is disabled, "타이머를 먼저 설정하세요" message visible
  2. **Set timer**: Set Timer to 5 min → input becomes enabled, placeholder shows "목표"
  3. **Enter target**: Type 150 → verify in DevTools: `accelTargetBpm` equals `150`
  4. **Active dot**: Set BPM 100, Timer 5 min, target 150, press START → small indigo dot appears on `⇢ Accel` button
  5. **Close while playing**: Press `×` while playing → panel hides, dot disappears, BPM does NOT reset on next STOP (stays at current BPM)
  6. **Close while not playing**: Press `×` while NOT playing → panel hides, `accelTargetBpm` clears, `accelStartBpm` is unchanged (still null if never played)

- [ ] **Step 7: Commit**

  ```bash
  git add index.html
  git commit -m "feat: add accel UI event listeners and updateAccelUI helper"
  ```

---

## Task 6: Final integration verification

- [ ] **Step 1: Full ramp test (short)**

  1. Set BPM to 100, Timer to 1 min, target BPM to 130
  2. Press START
  3. After ~30 seconds, BPM display should read approximately 115 (halfway)
  4. After 1 minute, timer stops metronome, BPM resets to 100

- [ ] **Step 2: Deceleration test**

  1. Set BPM to 140, Timer to 1 min, target BPM to 100
  2. Press START — BPM should decrease toward 100 over 1 minute

- [ ] **Step 3: No-change test (target = current)**

  1. Set BPM to 120, Timer to 1 min, target BPM to 120
  2. Press START — BPM stays constant (`isAccelActive` returns false)

- [ ] **Step 4: Timer-off mid-play test**

  1. Set BPM 80, Timer 5 min, target 140, START
  2. While playing, open Timer menu → set to OFF
  3. BPM should freeze at current value; dot disappears
  4. STOP → BPM resets to 80 (`accelStartBpm` was 80)

- [ ] **Step 5: Regression check**

  Verify all existing features still work normally:
  - Tap tempo, BPM slider, +/-1/+/-5 buttons
  - Beat circle clicks, beats +/- count
  - Rhythm subdivision selector
  - Volume slider and mute
  - Timer (without accel): counts down and stops metronome
  - Keyboard shortcuts: Space (play/stop), Arrow up/down (BPM)

- [ ] **Step 6: Final commit**

  ```bash
  git add index.html
  git commit -m "feat: BPM acceleration feature complete"
  ```
