# Shot Timer

An installable, offline PWA for semi-auto airsoft practice. React + TypeScript, Vite, Web Audio/AudioWorklet, and a precaching service worker. No backend or accounts.

## Run

Requires Node.js 22.12+ (Node 24 is used in CI).

```sh
npm ci
npm run icons
npm run dev
```

Open localhost on the development computer. Microphone APIs require a secure context: an HTTP LAN address on a phone will **not** work. Use the published HTTPS site or a trusted HTTPS development proxy for phone testing.

### Test on an Android phone over the local network

The phone and development computer must be on the same network. Generate a local certificate for the computer's current LAN address, build the production PWA, then run the certificate helper and HTTPS preview in separate terminals:

```sh
npm run phone:cert -- 192.168.1.50
npm run build
npm run phone:cert-server
npm run preview:phone
```

Replace the example address with the computer's LAN IPv4 address. On the phone, open the HTTP setup address printed by `phone:cert-server`, download the certificate, then use Android Settings to install it as a **CA certificate**. Restart Chrome and open the printed HTTPS address. The HTTPS preview includes the manifest and service worker, so microphone permission, installation, and offline reopening can all be tested.

The generated CA private key and server certificates stay in the ignored `.local-certs/` directory. Do not share the private key. Remove the CA from Android's trusted credentials after local testing. Re-run `phone:cert` if the computer's LAN IP changes.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests run against the production build. They inject a synthetic microphone MediaStream in the browser and exercise the actual AudioWorklet, calibration, waveform interaction, PAR timing, persistence, permissions, and offline cache. They do not add a fake detector or test mode to the published app.

## Install and deploy

Each deployment advances the displayed version by one minor step. Run `npm run version:next` before committing a deployment; this updates both package files from `0.1.0` to `0.2.0`, then through `0.9.0` to `0.10.0`, `0.11.0`, and so on. The UI formats these as `v0.1`, `v0.9`, and `v0.10`. Advancing to `v1.0` is deliberately manual.

The GitHub Actions workflow checks unit and browser tests, builds with the Pages base path, and deploys on pushes to `main`. In the destination GitHub repository, enable **Settings → Pages → Build and deployment → GitHub Actions**. Both a project path and a root/custom-domain Pages site are supported. No GitHub repository or remote is preconfigured in this workspace.

For other static HTTPS hosting, deploy `dist/`. Set `BASE_PATH=/your-path/` when building under a subdirectory. Regenerate PNG icons with `npm run icons` after changing the SVG source. The app precaches its own worklet, icons, and application assets; it has no runtime CDN dependencies.

Visit the HTTPS site in Android Chrome, then choose **Install app** or the browser menu’s **Add to Home screen**. After the offline-ready message appears, timer, calibration, and saved data work without network access. Updates are offered only while idle.

## Calibration and detection

1. Place the phone as it will be used, with its microphone unobstructed. Use its built-in microphone and speaker.
2. Measure five seconds of background sound.
3. Fire five individual shots at least one second apart. Press Done after the fifth. Tests have a 30-second limit and do not stop based on the detector count.
4. Review the sound envelope. The solid draggable line sets the shot threshold; the dashed line preserves the recommendation. A numeric field and arrow keys provide equivalent control. Zoom and pan to inspect closely spaced peaks.
5. Adjust minimum separation if needed. Numbered green markers are counted shots. Gray markers represent above-threshold peaks suppressed by the cue mask, lockout, or quiet-reset rule. dBFS is a relative digital input level, **not calibrated sound pressure**.
6. Run validation: stay quiet during the two-beep check, then fire five more shots and review the second plot. Both plots share settings. Changed settings create a preview; a new validation is needed before saving. Confirm the five markers really match the five shots.
7. Save a named profile. Recalibrate after changing guns, environment, microphone, speaker volume, or placement.

The worklet applies a 120 Hz high-pass filter and derives approximately 1 ms peak/RMS frames. The same pure detector processes those frames live and during calibration replay. A shot must cross the threshold upward, clear the minimum interval (60–500 ms), and be preceded by at least 25 ms below the lower reset level. Default/recommended separation begins at 100 ms and grows for longer reports. Long echoes that survive the interval and reset condition can still count, so phone testing and validation matter.

Start and PAR use the supplied 208 ms `assets/beep.wav` cue. A calibration-measured exclusion window (150–500 ms including cue playback and output/capture echo delay) follows each cue. **Shots inside that window are excluded**, including shots near the PAR beep. The plots mark cue exclusions where present. The timer shows the active guard. This is a deliberate tradeoff to prevent the phone counting its own speaker. Bluetooth timing and full-auto counting are not supported.

Timing is based on the audio context clock, not render ticks. Browser microphone/output latency and acoustic propagation are not fully compensated; displayed hundredths do not imply certified match timing accuracy. Splits share the same input path and are generally less sensitive to a constant input offset. The app interrupts a stage if it leaves the foreground or the microphone is lost. Android wake lock is requested but may be refused by the device.

## Data and privacy

No MediaRecorder, audio blobs, PCM recording, uploads, or analytics. Raw samples exist only in browser processing buffers. During calibration, the app keeps derived peak/RMS frames in memory to draw plots and replay threshold changes. Saving, restarting, canceling the workflow, or leaving calibration releases those traces; closing a capture stops microphone tracks. There is no playback function.

Only versioned settings, named profiles, and the newest 100 stages are stored in localStorage. Profile and shot serializers explicitly allowlist persisted fields. History snapshots preserve the settings used even if the original profile is deleted. Invalid/unknown storage is not silently overwritten; valid records are recovered in memory and Settings provides an explicit reset. Quota failures are surfaced. Clearing browser data can erase all local results.

## Physical-phone acceptance checklist

Automated tests cannot establish real acoustic accuracy. On the intended Android phone, check:

- Install from HTTPS, wait for offline readiness, then reopen offline and calibrate.
- Quiet and noisy rooms: five shots produce five correctly located markers, including after threshold adjustments.
- A single report with ringing/echo does not double-count; test pairs around 0.10 seconds with a profile that permits that separation.
- Test the phone’s speaker at the actual media volume; neither cue should register. Confirm the documented blind interval is acceptable.
- PAR marks late shots and ends after two seconds; stopping manually saves once, canceling standby saves nothing.
- Wake lock, denied permission, app switching, screen lock, calls, microphone disconnection, and reopening history behave clearly.
- Dragging and keyboard threshold controls agree, portrait layout fits, and no waveform data survives save/reload.

If echoes cannot be separated from real pairs in a particular setup, move the phone or increase lockout and repeat validation. This app cannot promise perfect detection on every phone or in every acoustic environment.
