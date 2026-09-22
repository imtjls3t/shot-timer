import type { DetectorSettings, LevelFrame } from '../domain';
import { replay } from './detector';

export interface Recommendation {
  settings: DetectorSettings;
  noiseDb: number;
  shotDb: number;
  warnings: string[];
  valid: boolean;
}
export function recommend(ambient: LevelFrame[], sample: LevelFrame[]): Recommendation {
  const noiseLevels = ambient.map(f => f.peakDb).sort((a, b) => a - b);
  const noiseDb = noiseLevels[Math.floor(noiseLevels.length * 0.99)] ?? -90;
  // Locate separated reports without assuming the final sensitivity beforehand.
  const seed: DetectorSettings = { thresholdDb: Math.min(-3, noiseDb + 10), resetDb: Math.min(-9, noiseDb + 4), lockoutMs: 350, quietMs: 25 };
  const candidates = replay(sample, seed).filter(e => e.accepted);
  const reports = candidates.map(e => {
    const frames = sample.filter(f => f.t >= e.t && f.t < e.t + 300);
    return { t: e.t, peak: Math.max(e.peakDb, ...frames.map(f => f.peakDb)), frames };
  });
  const shotDb = reports.length ? Math.min(...reports.map(r => r.peak)) : noiseDb;
  const thresholdDb = Math.round(Math.max(-90, Math.min(-3, (noiseDb + shotDb) / 2)) * 10) / 10;
  const resetDb = thresholdDb - 6;
  const tails = reports.map(r => {
    const last = r.frames.filter(f => f.peakDb >= thresholdDb).at(-1);
    return last ? last.t - r.t + 10 : 60;
  });
  const lockoutMs = Math.min(500, Math.max(100, Math.ceil(Math.max(0, ...tails) / 10) * 10));
  const warnings: string[] = [];
  if (reports.length !== 5) warnings.push(`Found ${reports.length} separated reports. Use five single shots, at least one second apart, then review the highlights.`);
  if (shotDb - noiseDb < 12) warnings.push('Shots and background noise overlap. Move the phone closer to the gun or try a quieter position.');
  if (sample.some(f => f.peakDb >= -0.5)) warnings.push('The input may be clipping. Move the phone farther away and repeat.');
  if (lockoutMs > 100) warnings.push(`This report needs about ${lockoutMs} ms of duplicate protection. Faster pairs may be missed; change placement and repeat if needed.`);
  return { settings: { thresholdDb, resetDb, lockoutMs, quietMs: 25 }, noiseDb, shotDb, warnings, valid: ambient.length > 0 && reports.length === 5 && shotDb - noiseDb >= 12 };
}
