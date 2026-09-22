import type { Detection, DetectorSettings, LevelFrame } from '../domain';

export const amplitudeDb = (v: number) => 20 * Math.log10(Math.max(0.000001, v));

/** Pure state machine shared verbatim by the worklet and calibration replay. */
export class ShotDetector {
  private lastShot = -Infinity;
  private quietFor = 0;
  private armed = true;
  private above = false;
  constructor(readonly settings: DetectorSettings) {}

  process(frame: LevelFrame): Detection | null {
    const { thresholdDb, resetDb, lockoutMs, quietMs } = this.settings;
    // Use the preceding quiet run before this frame's attack resets it. This
    // preserves legitimate shots exactly at the minimum separation boundary.
    if (!this.armed && frame.t - this.lastShot >= lockoutMs - 0.0001 && this.quietFor >= quietMs) this.armed = true;
    if (frame.peakDb < resetDb) this.quietFor += frame.duration;
    else this.quietFor = 0;
    if (frame.excluded) {
      const crossing = frame.peakDb >= thresholdDb && !this.above;
      this.above = frame.peakDb >= thresholdDb;
      this.armed = false;
      this.quietFor = 0;
      return crossing ? { t: frame.t, peakDb: frame.peakDb, accepted: false, reason: 'cue' } : null;
    }
    const high = frame.peakDb >= thresholdDb;
    const crossing = high && !this.above;
    this.above = high;
    if (!crossing) return null;
    const withinLockout = frame.t - this.lastShot < lockoutMs - 0.0001;
    if (withinLockout || !this.armed) return { t: frame.t, peakDb: frame.peakDb, accepted: false, reason: withinLockout ? 'lockout' : 'reset' };
    this.lastShot = frame.t;
    this.armed = false;
    this.quietFor = 0;
    return { t: frame.t, peakDb: frame.peakDb, accepted: true };
  }
}

export function replay(frames: LevelFrame[], settings: DetectorSettings): Detection[] {
  const detector = new ShotDetector(settings);
  const result: Detection[] = [];
  for (const frame of frames) {
    const event = detector.process(frame);
    if (event) result.push(event);
  }
  return result;
}

/** Accumulates ~1ms envelopes across variable-sized rendering blocks. No PCM retained. */
export class LevelExtractor {
  private count = 0;
  private peak = 0;
  private sum = 0;
  private start = 0;
  private previousInput = 0;
  private previousOutput = 0;
  private readonly windowSize: number;
  private readonly alpha: number;
  constructor(readonly sampleRate: number) {
    this.windowSize = Math.max(1, Math.round(sampleRate / 1000));
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * 120);
    this.alpha = rc / (rc + dt);
  }
  process(samples: Float32Array, blockStartMs: number, emit: (frame: LevelFrame) => void) {
    for (let i = 0; i < samples.length; i++) {
      if (this.count === 0) this.start = blockStartMs + i / this.sampleRate * 1000;
      const input = samples[i];
      const filtered = this.alpha * (this.previousOutput + input - this.previousInput);
      this.previousInput = input;
      this.previousOutput = filtered;
      this.peak = Math.max(this.peak, Math.abs(filtered));
      this.sum += filtered * filtered;
      this.count++;
      if (this.count >= this.windowSize) {
        emit({ t: this.start, duration: this.count / this.sampleRate * 1000, peakDb: amplitudeDb(this.peak), rmsDb: amplitudeDb(Math.sqrt(this.sum / this.count)), excluded: false });
        this.count = 0;
        this.peak = 0;
        this.sum = 0;
      }
    }
  }
}

export function displayBuckets(frames: LevelFrame[], count: number): LevelFrame[] {
  if (frames.length <= count) return frames;
  const stride = frames.length / count;
  return Array.from({ length: count }, (_, i) => {
    const slice = frames.slice(Math.floor(i * stride), Math.floor((i + 1) * stride));
    const peak = slice.reduce((a, b) => a.peakDb > b.peakDb ? a : b);
    return { ...peak, excluded: slice.some(f => f.excluded) };
  });
}
