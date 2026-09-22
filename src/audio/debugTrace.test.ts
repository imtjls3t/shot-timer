import { describe, expect, it } from 'vitest';
import { replay } from './detector';
import { PackedLevelFrames } from './debugTrace';
import { DEFAULT_DETECTOR } from '../domain';
import type { LevelFrame } from '../domain';

describe('session-only debug levels', () => {
  it('retains a full stage across chunks and replays cue masks and duplicate protection', () => {
    const packed = new PackedLevelFrames();
    const frames: LevelFrame[] = Array.from({ length: 9000 }, (_, t) => ({
      t, duration: 1, peakDb: [100, 125, 155, 5100, 5300].includes(t) ? -12 : -70,
      rmsDb: -75, excluded: t >= 5000 && t < 5200,
    }));
    packed.append(frames.slice(0, 4500));
    packed.append(frames.slice(4500));
    expect(packed.length).toBe(9000);
    expect(packed.lastTime).toBe(8999);
    const restored = packed.toFrames();
    expect(restored.map(f => f.t)).toEqual(frames.map(f => f.t));
    expect(restored[5100].excluded).toBe(true);
    expect(packed.replay(DEFAULT_DETECTOR)).toEqual(replay(restored, DEFAULT_DETECTOR));
    expect(packed.replay(DEFAULT_DETECTOR).filter(d => d.accepted).map(d => d.t)).toEqual([100, 5300]);
    expect(packed.recent(8999, 1000, 100).length).toBeLessThanOrEqual(100);
    expect(Math.max(...packed.windowBuckets(0, 9000, 100).map(f => f.peakDb))).toBe(-12);
    expect(packed.windowBuckets(5000, 5200, 20).some(f => f.excluded)).toBe(true);
    expect(Object.keys(packed)).not.toContain('audio');
  });
});
