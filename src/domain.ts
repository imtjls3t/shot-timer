export type Screen = 'timer' | 'calibration' | 'history' | 'settings';
export type Phase = 'idle' | 'preparing' | 'standby' | 'running' | 'finished';

export interface DetectorSettings {
  thresholdDb: number;
  resetDb: number;
  lockoutMs: number;
  quietMs: number;
}
export interface InputInfo {
  label: string;
  deviceId: string;
  sampleRate: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}
export interface CalibrationProfile {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  settings: DetectorSettings;
  recommendedDb: number;
  noiseDb: number;
  shotDb: number;
  cueGuardMs: number;
  input: InputInfo;
}
export interface TimerConfig {
  minDelay: number;
  maxDelay: number;
  parSeconds: number | null;
  volume: number;
  activeProfileId: string | null;
}
/** Derived levels only. Never PCM, audio blobs, or a recording. */
export interface LevelFrame {
  t: number;
  duration: number;
  peakDb: number;
  rmsDb: number;
  excluded: boolean;
}
export interface Detection {
  t: number;
  peakDb: number;
  accepted: boolean;
  reason?: 'lockout' | 'reset' | 'cue';
}
export interface CalibrationTrace {
  frames: LevelFrame[];
  durationMs: number;
  originalSettings: DetectorSettings | null;
  originalDetections: Detection[];
}
export interface ShotEvent {
  number: number;
  elapsedMs: number;
  splitMs: number;
  peakDb: number;
  late: boolean;
}
export interface StringRecord {
  id: string;
  startedAt: string;
  delaySeconds: number;
  config: TimerConfig;
  profile: CalibrationProfile;
  shots: ShotEvent[];
  durationMs: number;
  interrupted: boolean;
}
export interface SavedData {
  version: 1;
  config: TimerConfig;
  profiles: CalibrationProfile[];
  history: StringRecord[];
}
export const DEFAULT_CONFIG: TimerConfig = {
  minDelay: 1, maxDelay: 8, parSeconds: null, volume: 0.8, activeProfileId: null,
};
export const DEFAULT_DETECTOR: DetectorSettings = {
  thresholdDb: -24, resetDb: -30, lockoutMs: 100, quietMs: 25,
};
export const newId = () => crypto.randomUUID();
export const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(2);
export const dbText = (db: number) => `${db.toFixed(1)} dBFS`;

export function sampleDelay(min: number, max: number, random = Math.random): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max > 8 || min > max) {
    throw new Error('Start delay must satisfy 1 ≤ minimum ≤ maximum ≤ 8 seconds.');
  }
  return min + Math.min(1, Math.max(0, random())) * (max - min);
}
export function summarize(shots: ShotEvent[]) {
  const splits = shots.slice(1).map(s => s.splitMs);
  return {
    first: shots[0]?.elapsedMs ?? null,
    last: shots.at(-1)?.elapsedMs ?? null,
    fastest: splits.length ? Math.min(...splits) : null,
    average: splits.length ? splits.reduce((a, b) => a + b, 0) / splits.length : null,
  };
}
export function shotFromDetection(d: Detection, start: number, shots: ShotEvent[], par: number | null): ShotEvent {
  const elapsedMs = Math.max(0, d.t - start);
  return { number: shots.length + 1, elapsedMs, splitMs: elapsedMs - (shots.at(-1)?.elapsedMs ?? 0), peakDb: d.peakDb, late: par !== null && elapsedMs > par * 1000 };
}
