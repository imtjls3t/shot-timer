import { describe, expect, it } from 'vitest';
import { decodeData, encodeData } from './storage';
import { DEFAULT_CONFIG, DEFAULT_DETECTOR } from './domain';
import type { CalibrationProfile, SavedData, StageRecord } from './domain';

const profile: CalibrationProfile = { id: 'p1', name: 'Test AEG', notes: '', createdAt: '2026-09-21', settings: DEFAULT_DETECTOR, recommendedDb: -24, noiseDb: -65, shotDb: -18, cueGuardMs: 150, input: { label: 'Mic', deviceId: '', sampleRate: 48000 } };
const record: StageRecord = { id: 'r1', startedAt: '2026-09-21', delaySeconds: 2, config: DEFAULT_CONFIG, profile, shots: [], durationMs: 1000, interrupted: false };
describe('device storage', () => {
  it('round trips settings, profiles, and zero-shot stages', () => {
    const data: SavedData = { version: 1, config: { ...DEFAULT_CONFIG, activeProfileId: 'p1' }, profiles: [profile], history: [record] };
    expect(decodeData(encodeData(data))).toEqual({ data, warning: null });
  });
  it('limits retention to 100 newest stages', () => {
    const data: SavedData = { version: 1, config: DEFAULT_CONFIG, profiles: [profile], history: Array.from({ length: 130 }, (_, i) => ({ ...record, id: String(i) })) };
    const decoded = decodeData(encodeData(data)).data;
    expect(decoded.history).toHaveLength(100);
    expect(decoded.history[0].id).toBe('0');
    expect(decoded.history[99].id).toBe('99');
  });
  it('does not serialize injected transient waveform or raw audio fields', () => {
    const contaminated = { ...profile, trace: [{ peakDb: -20 }], rawAudio: [1, 2, 3] };
    const data: SavedData = { version: 1, config: DEFAULT_CONFIG, profiles: [contaminated], history: [{ ...record, profile: contaminated }] };
    const saved = encodeData(data);
    expect(saved).not.toContain('trace'); expect(saved).not.toContain('rawAudio');
  });
  it('recovers valid records and warns instead of trusting corrupt data', () => {
    expect(decodeData('{broken').warning).toBeTruthy();
    expect(decodeData('{"version":2}').warning).toBeTruthy();
    const result = decodeData(JSON.stringify({ version: 1, config: { ...DEFAULT_CONFIG, minDelay: 50 }, profiles: [profile, { bad: true }], history: [record, { id: 'bad' }] }));
    expect(result.warning).toBeTruthy();
    expect(result.data.profiles).toHaveLength(1);
    expect(result.data.history).toHaveLength(1);
    expect(result.data.config.minDelay).toBe(1);
    expect(result.data.config.activeProfileId).toBe('p1');
  });
});
