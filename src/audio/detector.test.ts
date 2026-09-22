import { describe, expect, it } from 'vitest';
import { LevelExtractor, ShotDetector, displayBuckets, replay } from './detector';
import { recommend } from './calibration';
import { DEFAULT_DETECTOR } from '../domain';
import type { LevelFrame } from '../domain';

function fixture(duration: number, peaks: [number, number, number][], floor = -70): LevelFrame[] {
  return Array.from({ length: duration }, (_, t) => {
    const db = peaks.find(([start, width]) => t >= start && t < start + width)?.[2] ?? floor;
    return { t, duration: 1, peakDb: db, rmsDb: db - 3, excluded: false };
  });
}
const shots = (frames: LevelFrame[], settings = DEFAULT_DETECTOR) => replay(frames, settings).filter(d => d.accepted);
describe('duplicate protection', () => {
  it('counts a shot with multiple echo peaks exactly once', () => {
    const frames = fixture(500, [[100, 6, -12], [122, 4, -18], [153, 7, -20]]);
    expect(shots(frames).map(s => s.t)).toEqual([100]);
    expect(replay(frames, DEFAULT_DETECTOR).filter(d => !d.accepted)).toHaveLength(2);
  });
  it('preserves two shots exactly 100ms apart after quiet reset', () => {
    expect(shots(fixture(350, [[100, 5, -12], [200, 5, -12]])).map(s => s.t)).toEqual([100, 200]);
    expect(shots(fixture(350, [[100, 5, -12], [199, 5, -12]]))).toHaveLength(1);
  });
  it('does not rearm in sustained noise or between high ringing peaks without enough quiet', () => {
    const frames = fixture(700, [[100, 150, -12], [255, 150, -12], [450, 5, -12]]);
    expect(shots(frames).map(s => s.t)).toEqual([100, 450]);
  });
  it('rejects subthreshold noise and masked beeps, requiring quiet after the cue', () => {
    const frames = fixture(600, [[100, 60, -5], [175, 4, -15], [320, 6, -12]]);
    frames.forEach(f => { f.excluded = f.t >= 100 && f.t < 250; });
    expect(shots(frames).map(s => s.t)).toEqual([320]);
  });
  it('replays exactly the same events as incrementally processed live frames', () => {
    const frames = fixture(800, [[100, 4, -12], [123, 2, -18], [230, 4, -12], [420, 30, -22], [620, 2, -16]]);
    for (const thresholdDb of [-28, -20, -10]) {
      const settings = { ...DEFAULT_DETECTOR, thresholdDb, resetDb: thresholdDb - 6 };
      const detector = new ShotDetector(settings);
      const live = frames.flatMap(f => { const result = detector.process(f); return result ? [result] : []; });
      expect(replay(frames, settings)).toEqual(live);
    }
  });
  it('preserves a narrow peak in drawing decimation', () => {
    const reduced = displayBuckets(fixture(10000, [[5251, 1, -8]]), 300);
    expect(Math.max(...reduced.map(f => f.peakDb))).toBe(-8);
    expect(reduced).toHaveLength(300);
  });
});
describe('level extraction', () => {
  it('works across variable blocks without retaining PCM and identifies a physical impulse only once', () => {
    const samples = new Float32Array(48000);
    samples[4800] = .5;
    samples[14400] = .5;
    const extractor = new LevelExtractor(48000);
    const frames: LevelFrame[] = [];
    let offset = 0;
    const sizes = [128, 64, 256, 99];
    let i = 0;
    while (offset < samples.length) {
      const size = sizes[i++ % sizes.length];
      extractor.process(samples.slice(offset, offset + size), offset / 48, f => frames.push(f));
      offset += size;
    }
    expect(frames).toHaveLength(1000);
    expect(shots(frames)).toHaveLength(2);
    expect(shots(frames).map(s => s.t)).toEqual([100, 300]);
    expect(frames.every(f => Number.isFinite(f.peakDb) && Number.isFinite(f.rmsDb))).toBe(true);
  });
  it('respects actual sample rate and block boundaries at 44.1kHz', () => {
    const extractor = new LevelExtractor(44100);
    const frames: LevelFrame[] = [];
    for (let t = 0; t < 44100; t += 128) extractor.process(new Float32Array(Math.min(128, 44100 - t)), t / 44.1, f => frames.push(f));
    expect(frames.length).toBe(1002);
    expect(frames.at(-1)!.t + frames.at(-1)!.duration).toBeCloseTo(999.728, 2);
  });
});
describe('calibration recommendations', () => {
  it('separates noise from five single reports and suggests a usable threshold', () => {
    const rec = recommend(fixture(5000, []), fixture(6000, [500, 1500, 2500, 3500, 4500].flatMap(t => [[t, 6, -20], [t + 25, 4, -27]] as [number, number, number][])));
    expect(rec.valid).toBe(true);
    expect(rec.settings.thresholdDb).toBeGreaterThan(-70);
    expect(rec.settings.thresholdDb).toBeLessThan(-20);
    expect(rec.settings.lockoutMs).toBe(100);
  });
  it('refuses to present missing or overlapping samples as a good calibration', () => {
    const rec = recommend(fixture(5000, [], -25), fixture(5000, [[500, 6, -22]], -25));
    expect(rec.valid).toBe(false);
    expect(rec.warnings.length).toBeGreaterThan(0);
  });
  it('warns about clipping and longer duplicate-protection windows', () => {
    const rec = recommend(fixture(5000, []), fixture(6000, [500, 1500, 2500, 3500, 4500].flatMap(t => [[t, 6, -.1], [t + 140, 3, -10]] as [number, number, number][])));
    expect(rec.settings.lockoutMs).toBeGreaterThan(140);
    expect(rec.warnings.join(' ')).toContain('clipping');
  });
});
