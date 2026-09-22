import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const expectedVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version.replace(/\.0$/, '');

async function mockMicrophone(page: Page) {
  await page.addInitScript(() => {
    const host = window as unknown as { fieldTestShot: (delay?: number) => void; fieldTestFive: () => Promise<void>; fieldTestTimerShots: () => void };
    let currentContext: AudioContext;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(target, args) {
        currentContext = Reflect.construct(target, args) as AudioContext;
        return currentContext;
      },
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const context = currentContext;
      await context.resume();
      let scheduledCue = 0;
      const createBufferSource = context.createBufferSource.bind(context);
      context.createBufferSource = () => {
        const source = createBufferSource();
        const start = source.start.bind(source);
        source.start = (at = 0, offset, duration) => {
          if (source.buffer && source.buffer.duration < .5 && scheduledCue === 0) scheduledCue = at;
          start(at, offset, duration);
        };
        return source;
      };
      const destination = context.createMediaStreamDestination();
      const buffer = context.createBuffer(1, 48000, 48000);
      let seed = 1;
      for (let i = 0; i < 48000; i++) { seed = (seed * 16807) % 2147483647; buffer.getChannelData(0)[i] = (seed / 2147483647 - .5) * .0005; }
      const noise = context.createBufferSource(); noise.buffer = buffer; noise.loop = true; noise.connect(destination); noise.start();
      // Keep the producer rendering even when Chromium optimizes a silent
      // MediaStream-only graph in a headless environment.
      const silent = context.createGain(); silent.gain.value = 0;
      noise.connect(silent).connect(context.destination);
      const pulse = (at: number, amplitude: number) => {
        const osc = context.createOscillator(), gain = context.createGain(); osc.frequency.value = 1500;
        gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(amplitude, at + .001); gain.gain.setValueAtTime(amplitude, at + .006); gain.gain.linearRampToValueAtTime(0, at + .009);
        osc.connect(gain).connect(destination); osc.start(at); osc.stop(at + .012);
      };
      host.fieldTestShot = (delay = .05) => { const t = context.currentTime + delay; pulse(t, .35); pulse(t + .025, .075); pulse(t + .055, .025); };
      host.fieldTestFive = () => { for (let i = 0; i < 5; i++) host.fieldTestShot(.2 + i * 1.05); return new Promise(resolve => setTimeout(resolve, 4900)); };
      host.fieldTestTimerShots = () => {
        for (const offset of [.25, .5, 1.5]) host.fieldTestShot(scheduledCue + offset - context.currentTime);
      };
      const track = destination.stream.getAudioTracks()[0];
      Object.defineProperty(track, 'getSettings', { value: () => ({ deviceId: 'test-mic', sampleRate: 48000, echoCancellation: true, autoGainControl: false, noiseSuppression: false }) });
      return destination.stream;
    } });
  });
}
async function fiveShots(page: Page) {
  await page.evaluate(() => (window as unknown as { fieldTestFive: () => Promise<void> }).fieldTestFive());
}
async function go(page: Page, label: string) {
  await page.getByRole('navigation', { name: page.viewportSize()!.width < 760 ? 'Mobile navigation' : 'Main navigation' }).getByRole('button', { name: label, exact: true }).click();
}

test('first use, delay/PAR settings, install guidance and responsive layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Shot timer' })).toBeVisible();
  await expect(page.getByText('AIRSOFT PRACTICE', { exact: true })).toHaveCount(0);
  await expect(page.getByText('BUILT FOR BETTER PRACTICE', { exact: true })).toHaveCount(0);
  await expect(page.getByText('READY', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CALIBRATE', exact: true })).toBeVisible();
  await page.getByLabel('Minimum start delay').fill('3');
  await page.getByLabel('Maximum start delay').fill('6');
  await page.getByRole('switch', { name: 'Enable PAR time' }).click();
  await page.getByLabel('PAR seconds').fill('2.5');
  await page.reload();
  await expect(page.getByLabel('Minimum start delay')).toHaveValue('3');
  await expect(page.getByLabel('Maximum start delay')).toHaveValue('6');
  await expect(page.getByLabel('PAR seconds')).toHaveValue('2.5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await go(page, 'Settings');
  await expect(page.getByText(`Shot Timer / v${expectedVersion}`, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Install Shot Timer', exact: true }).click();
  await expect(page.getByText(/In Android Chrome, open/)).toBeVisible();
  await go(page, 'History');
  await expect(page.getByText('Room for your next personal best.')).toBeVisible();
});

test('permission denial has an actionable recovery and leaves navigation usable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'CALIBRATE', exact: true }).click();
  await page.getByRole('button', { name: 'Start calibration', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone permission was denied');
  await go(page, 'Timer');
  await expect(page.getByRole('region', { name: 'Shot timer' })).toBeVisible();
});

test('real worklet calibration, interactive replay, validation, timer and private persistence', async ({ page }, testInfo) => {
  await mockMicrophone(page);
  await page.goto('/');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'CALIBRATE', exact: true }).click();
  await page.getByRole('button', { name: 'Start calibration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start five-shot test' })).toBeVisible({ timeout: 12000 });
  await page.getByRole('button', { name: 'Start five-shot test' }).click();
  await expect(page.getByRole('heading', { name: 'Fire five single shots.' })).toBeVisible();
  await fiveShots(page);
  await page.getByRole('button', { name: 'Done — review test' }).click();
  const sample = page.getByRole('region', { name: 'Calibration test', exact: true });
  await expect(sample.getByText('5 / 5 shots')).toBeVisible();
  const thresholdInput = page.getByLabel('Shot threshold', { exact: true });
  const recommended = await thresholdInput.inputValue();
  // Transient values such as "-" and "-2" must remain editable while the
  // user types the complete negative threshold instead of being clamped.
  await thresholdInput.click();
  await thresholdInput.press('ControlOrMeta+A');
  await thresholdInput.pressSequentially('-26');
  await expect(thresholdInput).toHaveValue('-26');
  await page.getByRole('button', { name: 'Increase shot threshold by 1 dB' }).click();
  await expect(thresholdInput).toHaveValue('-25');
  await page.getByRole('button', { name: 'Decrease shot threshold by 1 dB' }).click();
  await expect(thresholdInput).toHaveValue('-26');
  await page.getByRole('button', { name: 'Reset to recommended' }).click();
  await expect(thresholdInput).toHaveValue(recommended);
  await sample.getByRole('slider').focus();
  await page.keyboard.press('ArrowUp');
  await expect(thresholdInput).toHaveValue(String(Number(recommended) + 1));
  // The entire graph is a drag surface. Verify updates happen continuously
  // while held, including on the mobile SVG scaling used by the second project.
  const slider = sample.getByRole('slider');
  const dragArea = await slider.boundingBox();
  const dragX = dragArea!.x + dragArea!.width * .5;
  await page.mouse.move(dragX, dragArea!.y + dragArea!.height * .8);
  await page.mouse.down();
  await expect(page.getByLabel('Shot threshold', { exact: true })).toHaveValue('-80');
  await page.mouse.move(dragX, dragArea!.y + dragArea!.height * .5);
  await expect(page.getByLabel('Shot threshold', { exact: true })).toHaveValue('-50');
  await page.mouse.move(dragX, dragArea!.y + dragArea!.height * .1);
  await expect(page.getByLabel('Shot threshold', { exact: true })).toHaveValue('-10');
  await page.mouse.move(dragX, dragArea!.y + dragArea!.height * .01);
  await expect(page.getByLabel('Shot threshold', { exact: true })).toHaveValue('-3');
  await page.mouse.up();
  await expect(sample.getByText('0 / 5 shots')).toBeVisible();
  await page.getByRole('button', { name: 'Reset to recommended' }).click();
  await expect(sample.getByText('5 / 5 shots')).toBeVisible();
  await sample.getByRole('button', { name: '4×' }).click();
  await expect(sample.getByLabel('Calibration test time window')).toBeVisible();
  await sample.getByRole('button', { name: '1×' }).click();
  await page.getByRole('button', { name: 'Validate with five more shots' }).click();
  await expect(page.getByRole('heading', { name: 'Fire five single shots.' })).toBeVisible();
  await fiveShots(page);
  await page.getByRole('button', { name: 'Done — review test' }).click();
  const validation = page.getByRole('region', { name: 'Validation test', exact: true });
  await expect.poll(() => validation.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeGreaterThanOrEqual(0);
  await expect.poll(() => validation.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeLessThanOrEqual(80);
  await expect(validation.getByText('5 / 5 shots')).toBeVisible();
  await page.getByLabel('Shot threshold', { exact: true }).fill(String(Number(recommended) - 1));
  await expect(page.getByText(/Preview with adjusted settings/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save calibration profile' })).toBeDisabled();
  await expect(validation.getByRole('slider')).toHaveAttribute('aria-valuenow', String(Number(recommended) - 1));
  await page.getByRole('button', { name: 'Repeat validation' }).click();
  await expect(page.getByRole('heading', { name: 'Fire five single shots.' })).toBeVisible();
  await fiveShots(page);
  await page.getByRole('button', { name: 'Done — review test' }).click();
  await expect(validation.getByText('5 / 5 shots')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('calibration.png'), fullPage: true });
  await page.getByLabel('Profile name').fill('Indoor AEG');
  await page.getByRole('checkbox', { name: /five highlights match/ }).check();
  await page.getByRole('button', { name: 'Save calibration profile' }).click();
  await expect(page.getByText('Profile saved. Temporary waveform measurements have been cleared.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Calibration test', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Indoor AEG' }).click();
  const savedThreshold = page.getByLabel('Threshold for Indoor AEG');
  await savedThreshold.click();
  await savedThreshold.press('ControlOrMeta+A');
  await savedThreshold.pressSequentially('-26');
  await expect(savedThreshold).toHaveValue('-26');
  await page.screenshot({ path: testInfo.outputPath('profile-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Increase Indoor AEG threshold by 1 dB' }).click();
  await expect(savedThreshold).toHaveValue('-25');
  await page.getByRole('button', { name: 'Decrease Indoor AEG threshold by 1 dB' }).click();
  await page.getByRole('button', { name: 'Save threshold' }).click();
  await expect(page.getByText('Indoor AEG threshold updated.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('shot-timer:v1')!).profiles[0].settings)).toMatchObject({ thresholdDb: -26, resetDb: -32 });
  const saved = await page.evaluate(() => localStorage.getItem('shot-timer:v1'));
  expect(saved).not.toMatch(/frames|originalDetections|originalSettings|rawAudio/);
  expect(JSON.parse(saved!).profiles).toHaveLength(1);
  await go(page, 'Timer');
  await page.getByLabel('Maximum start delay').fill('1');
  await page.getByRole('switch', { name: 'Enable PAR time' }).click();
  await page.getByLabel('PAR seconds').fill('1');
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByText('STAND BY', { exact: true })).toBeVisible();
  // Schedule against the audio cue, not Playwright's UI polling latency: the
  // second shot must not accidentally fall inside the intentional PAR guard.
  await page.evaluate(() => (window as unknown as { fieldTestTimerShots: () => void }).fieldTestTimerShots());
  await expect(page.getByText('STAGE COMPLETE')).toBeVisible();
  await expect(page.getByText('3 SHOTS', { exact: true })).toBeVisible();
  await expect(page.getByText('AFTER PAR', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('timer.png'), fullPage: true });
  await go(page, 'History');
  await expect(page.getByText('Indoor AEG', { exact: true })).toBeVisible();
  await page.reload();
  await go(page, 'History');
  await expect(page.getByText('Indoor AEG', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('production service worker, manifest, icons and worklet are available offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toHaveLength(2);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  const cached = await page.evaluate(async () => {
    const cachesList = await caches.keys();
    const urls: string[] = [];
    for (const name of cachesList) { const cache = await caches.open(name); for (const req of await cache.keys()) urls.push(req.url); }
    return urls;
  });
  expect(cached.some(url => /processor.*\.js/.test(url))).toBe(true);
  expect(cached.some(url => /beep.*\.wav/.test(url))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Shot timer' })).toBeVisible();
  await go(page, 'Calibration');
  await expect(page.getByRole('button', { name: 'Start calibration', exact: true })).toBeVisible();
});

test('standby cancellation, zero-shot save and interruption save exactly once', async ({ page }) => {
  await mockMicrophone(page);
  await page.addInitScript(() => {
    const host = window as unknown as { fieldTestWakeLock: { requested: number; released: number } };
    host.fieldTestWakeLock = { requested: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      host.fieldTestWakeLock.requested += 1;
      return { release: async () => { host.fieldTestWakeLock.released += 1; } };
    } } });
  });
  await page.addInitScript(() => {
    const key = 'shot-timer:v1';
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, config: { minDelay: 1, maxDelay: 1, parSeconds: null, volume: .8, activeProfileId: 'fixture' }, profiles: [{ id: 'fixture', name: 'Test setup', notes: '', createdAt: new Date().toISOString(), settings: { thresholdDb: -30, resetDb: -36, lockoutMs: 100, quietMs: 25 }, recommendedDb: -30, noiseDb: -65, shotDb: -15, cueGuardMs: 150, input: { label: 'Synthetic mic', deviceId: 'test-mic', sampleRate: 48000 } }], history: [] }));
  });
  await page.goto('/');
  await expect(page.getByText('READY', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fieldTestWakeLock: { requested: number } }).fieldTestWakeLock.requested)).toBe(1);
  await expect(page.getByText('STAND BY', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fieldTestWakeLock: { released: number } }).fieldTestWakeLock.released)).toBe(1);
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shot-timer:v1')!).history.length)).toBe(0);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByText('LISTENING', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'STOP', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fieldTestWakeLock: { released: number } }).fieldTestWakeLock.released)).toBe(2);
  await expect(page.getByText('STAGE COMPLETE')).toBeVisible();
  let history = await page.evaluate(() => JSON.parse(localStorage.getItem('shot-timer:v1')!).history);
  expect(history).toHaveLength(1);
  expect(history[0].shots).toHaveLength(0);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByText('LISTENING', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
  await expect(page.getByRole('alert')).toContainText('left the foreground');
  await expect(page.getByText('STAGE COMPLETE')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fieldTestWakeLock: { released: number } }).fieldTestWakeLock.released)).toBe(3);
  history = await page.evaluate(() => JSON.parse(localStorage.getItem('shot-timer:v1')!).history);
  expect(history).toHaveLength(2);
  expect(history[0].interrupted).toBe(true);
});

test('debug waveform is live, reviewable, editable, and cleared on reload or disable', async ({ page }, testInfo) => {
  await mockMicrophone(page);
  await page.addInitScript(() => {
    const key = 'shot-timer:v1';
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, config: { minDelay: 1, maxDelay: 1, parSeconds: null, volume: .8, activeProfileId: 'fixture' }, profiles: [{ id: 'fixture', name: 'Test setup', notes: '', createdAt: new Date().toISOString(), settings: { thresholdDb: -30, resetDb: -36, lockoutMs: 100, quietMs: 25 }, recommendedDb: -30, noiseDb: -65, shotDb: -15, cueGuardMs: 150, input: { label: 'Synthetic mic', deviceId: 'test-mic', sampleRate: 48000 } }], history: [] }));
  });
  await page.goto('/');
  await go(page, 'Settings');
  const debugToggle = page.getByRole('button', { name: 'Debug mode' });
  await expect(debugToggle).toHaveText('OFF');
  await expect(debugToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(debugToggle).toHaveCSS('background-color', 'rgb(255, 254, 249)');
  await expect(page.getByText('Show live and review waveforms for new stages.')).toBeVisible();
  await debugToggle.click();
  await expect(debugToggle).toHaveText('ON');
  await expect(debugToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(debugToggle).toHaveCSS('background-color', /rgb\((41, 75, 48|60, 97, 61)\)/);
  await go(page, 'Timer');
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 393, height: 640 });
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByText('STAND BY', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Live debug waveform')).toBeVisible();
  await expect(page.getByText('LISTENING', { exact: true })).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    const fit = await page.evaluate(() => ({ buttonBottom: document.querySelector('.timer-start')!.getBoundingClientRect().bottom, navTop: document.querySelector('.mobile-nav')!.getBoundingClientRect().top }));
    expect(fit.buttonBottom).toBeLessThan(fit.navTop);
  }
  await page.waitForTimeout(200);
  await page.evaluate(() => (window as unknown as { fieldTestShot: () => void }).fieldTestShot());
  await expect(page.getByLabel(/Live waveform with 1 detected shots/)).toBeVisible();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'STOP', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Stage debug review' })).toBeVisible();
  const review = page.getByRole('region', { name: 'Stage debug review' });
  await expect(review.getByText('1 preview shots')).toBeVisible();
  await expect(review.getByRole('slider', { name: 'Stage waveform threshold' })).toHaveAttribute('aria-valuenow', '-30');
  const threshold = review.getByRole('textbox', { name: 'Debug threshold' });
  await threshold.fill('-28');
  await expect(review.getByText('1 preview shots')).toBeVisible();
  await review.getByRole('button', { name: 'Increase debug threshold by 1 dB' }).click();
  await expect(threshold).toHaveValue('-27');
  await review.getByRole('button', { name: 'Decrease debug threshold by 1 dB' }).click();
  await expect(threshold).toHaveValue('-28');
  await review.getByRole('button', { name: 'Update profile' }).click();
  await expect(review.getByText('Profile threshold updated to -28.0 dBFS.')).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('shot-timer:v1')!));
  expect(stored.debugMode).toBe(true);
  expect(stored.profiles[0].settings).toMatchObject({ thresholdDb: -28, resetDb: -34 });
  expect(stored.history[0].profile.settings.thresholdDb).toBe(-30);
  expect(JSON.stringify(stored)).not.toMatch(/frames|rawAudio|originalDetections/);
  await go(page, 'History');
  await expect(page.getByRole('region', { name: 'Stage debug review' })).toBeVisible();
  await expect(page.getByText('Threshold -30.0 dBFS')).toBeVisible();
  await page.reload();
  await go(page, 'Settings');
  await expect(debugToggle).toHaveText('ON');
  await go(page, 'History');
  await expect(page.getByRole('region', { name: 'Stage debug review' })).toHaveCount(0);
  await go(page, 'Settings');
  await debugToggle.click();
  await expect(debugToggle).toHaveText('OFF');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('shot-timer:v1')!).debugMode)).toBe(false);
  if (testInfo.project.name === 'mobile') {
    // Shared chart surface: browser-native touch gestures must move the
    // threshold without panning the page underneath.
    await debugToggle.click();
    await go(page, 'Timer');
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await expect(page.getByText('LISTENING', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'STOP', exact: true }).click();
    const chart = page.getByRole('region', { name: 'Stage debug review' }).getByRole('slider');
    await chart.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    const box = await chart.boundingBox();
    const before = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    const x = Math.round(box!.x + box!.width / 2);
    const startY = Math.round(box!.y + box!.height * .75);
    const endY = Math.round(box!.y + box!.height * .25);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('class'), { x, y: startY })).toBe('threshold-drag');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    const first = Number(await chart.getAttribute('aria-valuenow'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: endY }] });
    await expect.poll(async () => Number(await chart.getAttribute('aria-valuenow'))).toBeGreaterThan(first + 20);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  }
});

test('discarding or leaving calibration releases the displayed traces', async ({ page }) => {
  await mockMicrophone(page);
  await page.goto('/');
  await go(page, 'Calibration');
  await page.getByRole('button', { name: 'Start calibration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start five-shot test' })).toBeVisible();
  await page.getByRole('button', { name: 'Start five-shot test' }).click();
  await expect(page.getByRole('heading', { name: 'Fire five single shots.' })).toBeVisible();
  await fiveShots(page);
  await page.getByRole('button', { name: 'Done — review test' }).click();
  await expect(page.getByRole('region', { name: 'Calibration test', exact: true })).toBeVisible();
  await go(page, 'Timer');
  await go(page, 'Calibration');
  await expect(page.getByRole('region', { name: 'Calibration test', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start calibration', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('shot-timer:v1'))).not.toMatch(/frames|peakDb|originalDetections/);
});
