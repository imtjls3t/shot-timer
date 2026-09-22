import { DEFAULT_CONFIG } from './domain';
import type { CalibrationProfile, DetectorSettings, SavedData, StageRecord, TimerConfig } from './domain';

export const STORAGE_KEY = 'shot-timer:v1';
const fresh = (): SavedData => ({ version: 1, config: { ...DEFAULT_CONFIG }, profiles: [], history: [] });
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const num = (x: unknown, min: number, max: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
export function validSettings(x: unknown): x is DetectorSettings {
  return obj(x) && num(x.thresholdDb, -100, 0) && num(x.resetDb, -120, 0) && x.resetDb < x.thresholdDb && num(x.lockoutMs, 60, 500) && num(x.quietMs, 1, 100);
}
export function validProfile(x: unknown): x is CalibrationProfile {
  return obj(x) && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.notes === 'string' && typeof x.createdAt === 'string' && validSettings(x.settings) && num(x.recommendedDb, -100, 0) && num(x.noiseDb, -120, 0) && num(x.shotDb, -120, 10) && num(x.cueGuardMs, 60, 500) && obj(x.input) && typeof x.input.label === 'string' && typeof x.input.deviceId === 'string' && num(x.input.sampleRate, 8000, 384000);
}
function validConfig(x: unknown): x is TimerConfig {
  return obj(x) && num(x.minDelay, 1, 8) && num(x.maxDelay, 1, 8) && x.minDelay <= x.maxDelay && (x.parSeconds === null || num(x.parSeconds, 0.1, 999.99)) && num(x.volume, 0.05, 1) && (x.activeProfileId === null || typeof x.activeProfileId === 'string');
}
function validRecord(x: unknown): x is StageRecord {
  return obj(x) && typeof x.id === 'string' && typeof x.startedAt === 'string' && num(x.delaySeconds, 1, 8) && validConfig(x.config) && validProfile(x.profile) && num(x.durationMs, 0, Number.MAX_SAFE_INTEGER) && typeof x.interrupted === 'boolean' && Array.isArray(x.shots) && x.shots.every(s => obj(s) && num(s.number, 1, 1000000) && num(s.elapsedMs, 0, Number.MAX_SAFE_INTEGER) && num(s.splitMs, 0, Number.MAX_SAFE_INTEGER) && num(s.peakDb, -120, 10) && typeof s.late === 'boolean');
}
export function decodeData(raw: string | null): { data: SavedData; warning: string | null } {
  if (!raw) return { data: fresh(), warning: null };
  try {
    const value: unknown = JSON.parse(raw);
    if (!obj(value) || value.version !== 1) return { data: fresh(), warning: 'Saved data uses an unsupported format. It has not been overwritten. Clear stored data in Settings to start fresh.' };
    const profiles = Array.isArray(value.profiles) ? value.profiles.filter(validProfile) : [];
    const history = Array.isArray(value.history) ? value.history.filter(validRecord).slice(0, 100) : [];
    const config = validConfig(value.config) ? { ...value.config } : { ...DEFAULT_CONFIG };
    if (!profiles.some(p => p.id === config.activeProfileId)) config.activeProfileId = profiles[0]?.id ?? null;
    const recovered = !validConfig(value.config) || !Array.isArray(value.profiles) || !Array.isArray(value.history) || profiles.length !== value.profiles.length || history.length !== Math.min(100, value.history.length);
    return { data: { version: 1, config, profiles, history }, warning: recovered ? 'Some saved data could not be read. Valid profiles and stages were recovered; the original data has not been overwritten. Clear stored data in Settings to resume saving.' : null };
  } catch {
    return { data: fresh(), warning: 'Saved data could not be read and has not been overwritten. Clear stored data in Settings to resume saving.' };
  }
}
/** Explicit allowlist prevents transient calibration traces ever entering persistence. */
export function encodeData(data: SavedData): string {
  const profile = (p: CalibrationProfile): CalibrationProfile => ({ id: p.id, name: p.name, notes: p.notes, createdAt: p.createdAt, settings: { thresholdDb: p.settings.thresholdDb, resetDb: p.settings.resetDb, lockoutMs: p.settings.lockoutMs, quietMs: p.settings.quietMs }, recommendedDb: p.recommendedDb, noiseDb: p.noiseDb, shotDb: p.shotDb, cueGuardMs: p.cueGuardMs, input: { label: p.input.label, deviceId: p.input.deviceId, sampleRate: p.input.sampleRate, echoCancellation: p.input.echoCancellation, autoGainControl: p.input.autoGainControl, noiseSuppression: p.input.noiseSuppression } });
  return JSON.stringify({ version: 1, config: data.config, profiles: data.profiles.map(profile), history: data.history.slice(0, 100).map(r => ({ id: r.id, startedAt: r.startedAt, delaySeconds: r.delaySeconds, config: r.config, profile: profile(r.profile), durationMs: r.durationMs, interrupted: r.interrupted, shots: r.shots.map(s => ({ number: s.number, elapsedMs: s.elapsedMs, splitMs: s.splitMs, peakDb: s.peakDb, late: s.late })) })) });
}
