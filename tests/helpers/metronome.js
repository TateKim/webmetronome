/**
 * Shared helpers for web metronome e2e tests.
 * All state access uses page.evaluate() on global variables in src/index.html.
 */

/** Navigate to the metronome page and wait for it to be ready */
async function navigateAndWait(page) {
  await page.goto('/index.html');
  await page.waitForSelector('#playBtn');
}

/** Read the current BPM from internal state */
async function getBpm(page) {
  return page.evaluate(() => bpm);
}

/** Set BPM via the app's updateBpm function */
async function setBpm(page, value) {
  await page.evaluate((v) => updateBpm(v), value);
}

/** Click the play/stop button */
async function clickPlay(page) {
  await page.click('#playBtn');
}

/** Check if metronome is currently playing */
async function getIsPlaying(page) {
  return page.evaluate(() => isPlaying);
}

/**
 * Set up a short timer via direct state manipulation.
 * @param {number} seconds - duration in seconds
 */
async function setupShortTimer(page, seconds) {
  await page.evaluate((secs) => {
    isTimerActive = true;
    targetDuration = secs / 60;
    secondsRemaining = secs;
    timerActiveDot.classList.remove('hidden');
    timerDisplayContainer.classList.remove('hidden');
    updateTimerDisplay();
    syncTimerUI();
  }, seconds);
}

/**
 * Set up acceleration test with short duration.
 * Must be called BEFORE togglePlay() so that accelTotalSeconds is computed correctly.
 */
async function setupAccelTest(page, { startBpm, targetBpm, durationSecs, mode = 'linear', weight }) {
  await page.evaluate((opts) => {
    updateBpm(opts.startBpm);
    isTimerActive = true;
    targetDuration = opts.durationSecs / 60;
    secondsRemaining = opts.durationSecs;
    accelTargetBpm = opts.targetBpm;
    accelLastTargetBpm = opts.targetBpm;
    accelMode = opts.mode;
    if (opts.weight !== undefined) accelWeight = opts.weight;
    timerActiveDot.classList.remove('hidden');
    timerDisplayContainer.classList.remove('hidden');
    updateTimerDisplay();
    updateAccelTrigger();
    syncTimerUI();
  }, { startBpm, targetBpm, durationSecs, mode, weight });
}

/** Start playback via the app's togglePlay function */
async function startPlayback(page) {
  await page.evaluate(() => togglePlay());
}

/** Stop playback via the app's togglePlay function */
async function stopPlayback(page) {
  const playing = await getIsPlaying(page);
  if (playing) {
    await page.evaluate(() => togglePlay());
  }
}

/** Wait for metronome to auto-stop (timer expiry) */
async function waitForAutoStop(page, timeoutMs = 15000) {
  await page.waitForFunction(() => !isPlaying, { timeout: timeoutMs });
}

/** Build accel schedule without playing (for schedule-only tests) */
async function buildSchedule(page, { startBpm, targetBpm, durationSecs, mode = 'linear', weight }) {
  return page.evaluate((opts) => {
    accelStartBpm = opts.startBpm;
    accelTargetBpm = opts.targetBpm;
    accelTotalSeconds = opts.durationSecs;
    accelMode = opts.mode;
    if (opts.weight !== undefined) accelWeight = opts.weight;
    updateBpm(opts.startBpm);
    return buildAccelSchedule();
  }, { startBpm, targetBpm, durationSecs, mode, weight });
}

/** Get the precomputed accel schedule */
async function getAccelSchedule(page) {
  return page.evaluate(() => accelSchedule);
}

/** Get the accel measure count */
async function getAccelMeasureCount(page) {
  return page.evaluate(() => accelMeasureCount);
}

module.exports = {
  navigateAndWait,
  getBpm,
  setBpm,
  clickPlay,
  getIsPlaying,
  setupShortTimer,
  setupAccelTest,
  startPlayback,
  stopPlayback,
  waitForAutoStop,
  buildSchedule,
  getAccelSchedule,
  getAccelMeasureCount,
};
