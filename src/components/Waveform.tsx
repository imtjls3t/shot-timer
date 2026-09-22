import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { displayBuckets, replay } from '../audio/detector';
import { PackedLevelFrames } from '../audio/debugTrace';
import { dbText } from '../domain';
import type { DetectorSettings, LevelFrame } from '../domain';

interface Props {
  title: string;
  trace: { frames: LevelFrame[] | PackedLevelFrames; durationMs: number };
  settings: DetectorSettings;
  recommendedDb: number;
  noiseDb: number;
  onThreshold: (db: number) => void;
  targetShots?: number | null;
}
const H = 238, LEFT = 42, TOP = 20, BOTTOM = 200;
const y = (db: number) => TOP + (0 - Math.max(-100, Math.min(0, db))) / 100 * (BOTTOM - TOP);
export function Waveform({ title, trace, settings, recommendedDb, noiseDb, onThreshold, targetShots = 5 }: Props) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(650);
  const RIGHT = width - 64;
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width)));
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const detections = useMemo(() => trace.frames instanceof PackedLevelFrames ? trace.frames.replay(settings) : replay(trace.frames, settings), [trace.frames, settings]);
  const accepted = detections.filter(d => d.accepted);
  const acceptedNumbers = new Map(accepted.map((d, i) => [d, i + 1]));
  const span = Math.max(100, trace.durationMs / zoom);
  const start = Math.min(offset, Math.max(0, trace.durationMs - span));
  const end = start + span;
  const visible = useMemo(() => trace.frames instanceof PackedLevelFrames
    ? trace.frames.windowBuckets(start, end, Math.floor(RIGHT - LEFT))
    : displayBuckets(trace.frames.filter(f => f.t >= start && f.t <= end), Math.floor(RIGHT - LEFT)), [trace.frames, start, end, RIGHT]);
  const x = (t: number) => LEFT + (t - start) / span * (RIGHT - LEFT);
  const path = visible.map((f, i) => `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(f.peakDb).toFixed(1)}`).join(' ');
  const area = visible.length ? `${path}L${x(visible.at(-1)!.t)},${BOTTOM}L${x(visible[0].t)},${BOTTOM}Z` : '';
  function drag(clientY: number) {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return;
    const yy = (clientY - rect.top) / rect.height * H;
    onThreshold(Math.round(Math.max(-90, Math.min(-3, -(yy - TOP) / (BOTTOM - TOP) * 100)) * 10) / 10);
  }
  return <section className="waveform-panel" aria-label={title}>
    <div className="waveform-heading"><div><span className="eyebrow">SOUND ENVELOPE</span><h3>{title}</h3></div><span className={`pill ${targetShots !== null && accepted.length === targetShots ? 'good' : ''}`}>{targetShots === null ? `${accepted.length} preview shots` : `${accepted.length} / ${targetShots} shots`}</span></div>
    <svg ref={svg} viewBox={`0 0 ${width} ${H}`} className="waveform-svg" role="img" aria-label={`${title}: ${accepted.length} shots detected at ${dbText(settings.thresholdDb)}`}>
      <defs><clipPath id={id}><rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP}/></clipPath></defs>
      {[-20, -40, -60, -80, -100].map(db => <g key={db}><line x1={LEFT} x2={RIGHT} y1={y(db)} y2={y(db)} className="chart-grid"/><text x={LEFT - 10} y={y(db) + 4} textAnchor="end" className="chart-label">{db}</text></g>)}
      <text x={LEFT - 10} y={12} textAnchor="end" className="chart-label">dBFS</text>
      <g clipPath={`url(#${id})`}>
        <rect x={LEFT} y={y(noiseDb)} width={RIGHT - LEFT} height={BOTTOM - y(noiseDb)} className="noise-region"/>
        {visible.filter(f => f.excluded).map((f, i) => <rect key={i} x={x(f.t)} y={TOP} width={Math.max(2, (RIGHT - LEFT) / visible.length)} height={BOTTOM - TOP} fill="#ddd9c4"/>)}
        <path d={area} className="wave-area"/><path d={path} className="wave-line"/>
        {detections.filter(d => d.t >= start && d.t <= end).map((d, i) => <g key={i}><line x1={x(d.t)} x2={x(d.t)} y1={y(d.peakDb)} y2={BOTTOM} className={d.accepted ? 'shot-marker' : 'rejected-marker'}/>{d.accepted && <><circle cx={x(d.t)} cy={Math.max(TOP + 10, y(d.peakDb) - 12)} r={9} fill="#274a2b"/><text x={x(d.t)} y={Math.max(TOP + 10, y(d.peakDb) - 12) + 3} textAnchor="middle" className="shot-number">{acceptedNumbers.get(d)}</text></>}</g>)}
        <line x1={LEFT} x2={RIGHT} y1={y(recommendedDb)} y2={y(recommendedDb)} className="recommended-line"/>
        <line x1={LEFT} x2={RIGHT} y1={y(settings.resetDb)} y2={y(settings.resetDb)} className="reset-line"/>
      </g>
      <g pointerEvents="none">
        <line x1={LEFT} x2={RIGHT} y1={y(settings.thresholdDb)} y2={y(settings.thresholdDb)} className="threshold-line"/>
        <rect x={RIGHT - 6} y={y(settings.thresholdDb) - 15} width={61} height={30} rx={6} fill="#274a2b"/>
        <text x={RIGHT + 24} y={y(settings.thresholdDb) + 4} textAnchor="middle" className="threshold-label">{settings.thresholdDb.toFixed(1)}</text>
      </g>
      <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="transparent"
        role="slider" aria-label={`${title} threshold`} aria-valuemin={-90} aria-valuemax={-3} aria-valuenow={settings.thresholdDb} aria-valuetext={dbText(settings.thresholdDb)} tabIndex={0} className="threshold-drag"
        onKeyDown={e => { if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); onThreshold(Math.max(-90, Math.min(-3, settings.thresholdDb + (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1)))); } }}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag(e.clientY); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e.clientY); }}/>
      {[0, 1, 2, 3, 4].map(i => <text key={i} x={LEFT + i / 4 * (RIGHT - LEFT)} y={225} textAnchor="middle" className="chart-label">{((start + span * i / 4) / 1000).toFixed(1)}s</text>)}
    </svg>
    <div className="waveform-legend"><span><i className="dot green"/>Counted shot</span><span><i className="dot gray"/>Suppressed peak</span><span><i className="legend-dash"/>Recommended {dbText(recommendedDb)}</span></div>
    <div className="waveform-tools"><span>Press anywhere on the graph, then drag to adjust sensitivity</span><div className="segmented small" aria-label={`${title} zoom`}>{[1, 2, 4].map(v => <button key={v} className={zoom === v ? 'selected' : ''} onClick={() => { setZoom(v); setOffset(0); }}>{v}×</button>)}</div></div>
    {zoom > 1 && <label className="chart-pan">Time window<input aria-label={`${title} time window`} type="range" min={0} max={Math.max(0, trace.durationMs - span)} step={10} value={start} onChange={e => setOffset(+e.target.value)}/></label>}
  </section>;
}
