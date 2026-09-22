import { describe, expect, it } from 'vitest';
import { sampleDelay, shotFromDetection, summarize } from './domain';

describe('timer calculations', () => {
  it('samples the requested interval and handles a fixed start', () => {
    expect(sampleDelay(1, 8, () => 0)).toBe(1);
    expect(sampleDelay(1, 8, () => 1)).toBe(8);
    expect(sampleDelay(3, 7, () => .25)).toBe(4);
    expect(sampleDelay(4, 4, () => .2)).toBe(4);
    expect(() => sampleDelay(5, 4)).toThrow();
    expect(() => sampleDelay(0, 8)).toThrow();
  });
  it('derives first-shot and split times, distinguishing shots after PAR', () => {
    const first = shotFromDetection({ t: 2300, peakDb: -20, accepted: true }, 1000, [], 2);
    const boundary = shotFromDetection({ t: 3000, peakDb: -20, accepted: true }, 1000, [first], 2);
    const late = shotFromDetection({ t: 3100, peakDb: -20, accepted: true }, 1000, [first, boundary], 2);
    expect(first.elapsedMs).toBe(1300);
    expect(boundary.splitMs).toBe(700);
    expect(boundary.late).toBe(false);
    expect(late.late).toBe(true);
    expect(summarize([first, boundary, late])).toEqual({ first: 1300, last: 2100, fastest: 100, average: 400 });
    expect(summarize([first]).average).toBe(null);
  });
});
