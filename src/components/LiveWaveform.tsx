import { memo } from 'react';
import type { ShotEvent } from '../domain';
import { dbText } from '../domain';
import type { PackedLevelFrames } from '../audio/debugTrace';

interface Props {
  frames: PackedLevelFrames;
  shots: ShotEvent[];
  thresholdDb: number;
  version: number;
}

const LEFT = 3, RIGHT = 317, TOP = 5, BOTTOM = 67, WINDOW_MS = 8000;
const y = (db: number) => TOP + Math.max(0, Math.min(100, -db)) / 100 * (BOTTOM - TOP);

export const LiveWaveform = memo(function LiveWaveform({ frames, shots, thresholdDb, version }: Props) {
  const end = Math.max(WINDOW_MS, frames.lastTime);
  const start = end - WINDOW_MS;
  const visible = frames.recent(end, WINDOW_MS, 160);
  const x = (t: number) => LEFT + (t - start) / WINDOW_MS * (RIGHT - LEFT);
  const path = visible.map((frame, i) => `${i ? 'L' : 'M'}${x(frame.t).toFixed(1)},${y(frame.peakDb).toFixed(1)}`).join(' ');
  return <div className="live-debug" aria-label="Live debug waveform" data-frame-version={version}>
    <div className="live-debug-label"><span>LIVE WAVEFORM</span><span>THRESHOLD {dbText(thresholdDb)}</span></div>
    <svg viewBox="0 0 320 76" preserveAspectRatio="none" role="img" aria-label={`Live waveform with ${shots.length} detected shots and threshold ${dbText(thresholdDb)}`}>
      <line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} className="live-baseline"/>
      {visible.filter(frame => frame.excluded).map((frame, i) => <rect key={i} x={x(frame.t)} y={TOP} width={2} height={BOTTOM - TOP} className="live-exclusion"/>)}
      <path d={path} className="live-wave-line"/>
      <line x1={LEFT} x2={RIGHT} y1={y(thresholdDb)} y2={y(thresholdDb)} className="live-threshold"/>
      {shots.filter(shot => shot.elapsedMs >= start && shot.elapsedMs <= end).map(shot => <g key={shot.number}><line x1={x(shot.elapsedMs)} x2={x(shot.elapsedMs)} y1={TOP} y2={BOTTOM} className="live-shot"/><circle cx={x(shot.elapsedMs)} cy={TOP + 6} r={3} className="live-shot-dot"/></g>)}
    </svg>
    <div className="live-debug-time"><span>{(start / 1000).toFixed(1)}s</span><span>{(end / 1000).toFixed(1)}s</span></div>
  </div>;
});
