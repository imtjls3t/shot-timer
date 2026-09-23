import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Crosshair, Mic, Play, Settings2, ShieldCheck, Square, Timer as TimerIcon } from 'lucide-react';
import { AudioEngine, requestWakeLock } from '../audio/engine';
import { PackedLevelFrames } from '../audio/debugTrace';
import type { StageDebugTrace } from '../audio/debugTrace';
import { dbText, newId, sampleDelay, seconds, shotFromDetection } from '../domain';
import type { CalibrationProfile, Phase, ShotEvent, StageRecord, TimerConfig } from '../domain';
import { LinkButton, Notice, ShotTable, Summary } from './common';
import { LiveWaveform } from './LiveWaveform';
import { StageDebugReview } from './StageDebugReview';
import { StartDelayControls } from './StartDelayControls';

interface Props {
  config: TimerConfig;
  profiles: CalibrationProfile[];
  debugMode: boolean;
  debugTraces: StageDebugTrace[];
  onConfig: (config: TimerConfig) => void;
  onRecord: (record: StageRecord) => void;
  onDebugTrace: (trace: StageDebugTrace) => void;
  onUpdateProfile: (id: string, thresholdDb: number) => void;
  onCalibrate: () => void;
  onBusy: (busy: boolean) => void;
}
export function Timer({ config, profiles, debugMode, debugTraces, onConfig, onRecord, onDebugTrace, onUpdateProfile, onCalibrate, onBusy }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [shots, setShots] = useState<ShotEvent[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saved, setSaved] = useState(false);
  const [finishedRecord, setFinishedRecord] = useState<StageRecord | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);
  const engine = useRef<AudioEngine | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const shotsRef = useRef<ShotEvent[]>([]);
  const startRef = useRef(Infinity);
  const endRef = useRef(Infinity);
  const wake = useRef<WakeLockSentinel | null>(null);
  const finishRef = useRef<(reason?: string) => Promise<void>>(async () => {});
  const mounted = useRef(true);
  const finishing = useRef(false);
  const record = useRef<StageRecord | null>(null);
  const debugFrames = useRef<PackedLevelFrames | null>(null);
  const lastLiveUpdate = useRef(0);
  const profile = profiles.find(p => p.id === config.activeProfileId) ?? null;
  const busy = ['preparing', 'standby', 'running'].includes(phase);
  function updatePhase(next: Phase) { phaseRef.current = next; if (mounted.current) setPhase(next); }
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden && ['preparing', 'standby', 'running'].includes(phaseRef.current)) void finishRef.current('Stage interrupted because Shot Timer left the foreground. Keep this screen open while timing.'); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; void engine.current?.close(); void wake.current?.release(); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    let raf: number;
    const tick = () => {
      const now = engine.current?.nowMs ?? 0;
      if (now >= startRef.current && phaseRef.current === 'standby') updatePhase('running');
      if (phaseRef.current === 'running') setElapsed(Math.max(0, Math.min(endRef.current, now) - startRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [busy]);

  async function start() {
    if (!profile || ['preparing', 'standby', 'running'].includes(phaseRef.current)) return;
    setError(''); setWarning(''); setSaved(false);
    setShots([]); shotsRef.current = []; setElapsed(0); setFinishedRecord(null); setLiveVersion(0);
    const captureDebug = debugMode;
    debugFrames.current = captureDebug ? new PackedLevelFrames() : null;
    lastLiveUpdate.current = 0;
    startRef.current = Infinity; endRef.current = Infinity; record.current = null; finishing.current = false;
    updatePhase('preparing');
    const audio = new AudioEngine(); engine.current = audio;
    let preflight = true;
    let ambientPeak = -120;
    const localConfig = { ...config };
    const localProfile = structuredClone(profile);
    function schedule() {
      if (finishing.current || !mounted.current) return;
      preflight = false;
      if (ambientPeak > profile!.settings.thresholdDb - 6) setWarning('Background noise is near your shot threshold. Recalibrate or move to a quieter position if extra shots appear.');
      const delay = sampleDelay(localConfig.minDelay, localConfig.maxDelay);
      const start = audio.nowMs + delay * 1000;
      const par = localConfig.parSeconds === null ? null : start + localConfig.parSeconds * 1000;
      startRef.current = start;
      endRef.current = par === null ? Infinity : par + 2000;
      record.current = { id: newId(), startedAt: new Date(Date.now() + delay * 1000).toISOString(), delaySeconds: delay, config: localConfig, profile: localProfile, shots: [], durationMs: 0, interrupted: false };
      const masks = [{ start, end: start + localProfile.cueGuardMs }];
      if (par !== null) masks.push({ start: par, end: par + localProfile.cueGuardMs });
      audio.configure('timer', localProfile.settings, start, endRef.current, masks, captureDebug);
      audio.beep(start, localConfig.volume);
      if (par !== null) audio.beep(par, localConfig.volume);
      updatePhase('standby');
    }
    try {
      wake.current = await requestWakeLock();
      if (!wake.current) setWarning('Screen wake lock is unavailable. Keep the phone awake and Shot Timer visible while timing.');
      const input = await audio.open({
        frames: frames => {
          if (preflight) { ambientPeak = Math.max(ambientPeak, ...frames.map(f => f.peakDb)); return; }
          debugFrames.current?.append(frames.filter(frame => frame.t >= 0 && frame.t <= endRef.current - startRef.current));
          const now = performance.now();
          if (mounted.current && now - lastLiveUpdate.current >= 100) { lastLiveUpdate.current = now; setLiveVersion(v => v + 1); }
        },
        detection: d => {
          if (!d.accepted || preflight || d.t < 0 || d.t > endRef.current - startRef.current) return;
          const shot = shotFromDetection(d, 0, shotsRef.current, localConfig.parSeconds);
          shotsRef.current = [...shotsRef.current, shot];
          if (mounted.current) setShots(shotsRef.current);
        },
        ended: () => { if (preflight) schedule(); else void finishRef.current(); },
        interrupted: message => void finishRef.current(message),
      });
      if (finishing.current || !mounted.current) { await audio.close(); return; }
      if (profile.input.deviceId && input.deviceId !== profile.input.deviceId) setWarning('The microphone differs from this profile. Recalibrate for this input to get reliable results.');
      audio.capture(null, 800);
    } catch (e) {
      await audio.close(); await wake.current?.release(); wake.current = null;
      debugFrames.current = null;
      if (mounted.current) { setError(e instanceof Error ? e.message : 'Could not start audio.'); updatePhase('idle'); }
    }
  }

  async function finish(reason?: string) {
    if (finishing.current || !['preparing', 'standby', 'running'].includes(phaseRef.current)) return;
    finishing.current = true;
    const now = engine.current?.nowMs ?? 0;
    const started = now >= startRef.current && record.current !== null;
    const duration = Math.max(0, Math.min(now, endRef.current) - startRef.current);
    endRef.current = Math.min(now, endRef.current);
    await engine.current?.close(); engine.current = null;
    await wake.current?.release(); wake.current = null;
    if (started && record.current) {
      const completed = { ...record.current, shots: [...shotsRef.current], durationMs: duration, interrupted: Boolean(reason) };
      onRecord(completed);
      if (debugFrames.current?.length) onDebugTrace({ stageId: completed.id, durationMs: duration, frames: debugFrames.current });
      setFinishedRecord(completed);
      setElapsed(duration); setSaved(true); updatePhase('finished');
    } else { updatePhase('idle'); setElapsed(0); }
    debugFrames.current = null;
    if (reason && mounted.current) setError(reason);
    finishing.current = false;
  }
  finishRef.current = finish;
  const afterPar = config.parSeconds !== null && elapsed >= config.parSeconds * 1000;
  const displayTime = phase === 'finished' ? (shots.at(-1)?.elapsedMs ?? elapsed) : elapsed;
  const finishedTrace = finishedRecord && debugTraces.find(trace => trace.stageId === finishedRecord.id);

  return <>
    <h1 className="sr-only">Shot Timer</h1>
    {error && <Notice tone="error" onClose={() => setError('')}>{error}</Notice>}
    {warning && <Notice onClose={() => setWarning('')}>{warning}</Notice>}
    <div className="timer-layout">
      <div className="timer-main">
        <section className={`timer-display ${phase === 'running' ? 'is-running' : ''} ${debugMode ? 'debug-enabled' : ''}`} aria-label="Shot timer">
          <div className="timer-topline"><span className="timer-state"><i className={`status-dot ${busy ? 'pulse' : ''}`}/>{phase === 'preparing' ? 'CHECKING MICROPHONE' : phase === 'standby' ? 'STAND BY' : phase === 'running' ? afterPar ? 'AFTER PAR' : 'LISTENING' : phase === 'finished' ? 'STAGE COMPLETE' : 'READY'}</span><span className="timer-mode">SEMI-AUTO</span></div>
          <div className="timer-digits" aria-live="off">{phase === 'standby' ? <span className="standby-text">Stand by.</span> : <>{seconds(displayTime)}<span>s</span></>}</div>
          <div className="timer-subline">{phase === 'standby' ? 'WAIT FOR START SIGNAL' : phase === 'finished' ? shots.length ? 'LAST SHOT TIME' : 'NO SHOTS RECORDED' : phase === 'preparing' ? 'CHECKING SIGNAL…' : 'ELAPSED TIME'}</div>
          <div className="timer-metrics"><div><span>SHOTS</span><strong>{String(shots.length).padStart(2, '0')}</strong></div><div><span>LAST SPLIT</span><strong>{shots.length > 1 ? seconds(shots.at(-1)!.splitMs) : '—'}<small>s</small></strong></div><div><span>PAR TIME</span><strong>{config.parSeconds === null ? 'OFF' : config.parSeconds.toFixed(2)}{config.parSeconds !== null && <small>s</small>}</strong></div></div>
          {debugMode && debugFrames.current && (phase === 'standby' || phase === 'running') && <LiveWaveform frames={debugFrames.current} shots={shots} thresholdDb={profile!.settings.thresholdDb} version={liveVersion}/>}
          {busy ? <button className="timer-start stop" onClick={() => void finish()}><Square size={19} fill="currentColor"/>{phase === 'standby' || phase === 'preparing' ? 'CANCEL' : 'STOP'}</button> : <button className="timer-start" onClick={profile ? () => void start() : onCalibrate}><Play size={21} fill="currentColor"/>{profile ? 'START' : 'CALIBRATE'}</button>}
          <div className="timer-foot"><span><Mic size={13}/>{busy ? 'Microphone active' : 'Microphone off'}</span><span>{saved ? 'Saved on this device' : profile ? `${config.minDelay.toFixed(1)}–${config.maxDelay.toFixed(1)}s random delay` : 'Calibration required'}</span></div>
        </section>
        {finishedRecord && finishedTrace && <StageDebugReview key={finishedRecord.id} record={finishedRecord} trace={finishedTrace} profile={profiles.find(p => p.id === finishedRecord.profile.id) ?? null} onUpdateProfile={onUpdateProfile}/>}
        <section className="card shots-card"><div className="section-heading"><h2>Shot breakdown</h2><span className="pill">{shots.length} SHOTS</span></div><ShotTable shots={shots}/><Summary shots={shots}/></section>
      </div>
      <aside className="timer-sidebar">
        <section className="card setup-card"><div className="section-heading"><h2>Session setup</h2><Settings2 size={19}/></div>
          <fieldset disabled={busy}><div className="setting-label"><span>Start delay</span><span className="mini-badge">RANDOM</span></div>
          <StartDelayControls config={config} onConfig={onConfig} disabled={busy}/>
          <div className="setting-divider"/>
          <div className="setting-label"><span><TimerIcon size={16}/>PAR time</span><button role="switch" aria-checked={config.parSeconds !== null} aria-label="Enable PAR time" className={`toggle ${config.parSeconds !== null ? 'on' : ''}`} onClick={() => onConfig({ ...config, parSeconds: config.parSeconds === null ? 5 : null })}><span/></button></div><p className="helper">Set a target. Hear a second beep when time is up.</p>
          {config.parSeconds !== null && <label className="par-input">Target time<span className="input-with-unit"><input aria-label="PAR seconds" type="number" min={0.1} max={999.99} step={0.1} value={config.parSeconds} onChange={e => onConfig({ ...config, parSeconds: Math.max(0.1, Math.min(999.99, +e.target.value)) })}/><small>sec</small></span><span className="helper">Late shots are marked during a 2-second grace period.</span></label>}
          </fieldset>
        </section>
        <section className="card active-profile-card"><div className="section-heading"><h2>Sound profile</h2><Crosshair size={19}/></div>{profile ? <><label className="sr-only" htmlFor="active-profile">Active sound profile</label><select id="active-profile" disabled={busy} value={profile.id} onChange={e => onConfig({ ...config, activeProfileId: e.target.value })}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="profile-stats"><div><span>THRESHOLD</span><strong>{dbText(profile.settings.thresholdDb)}</strong></div><div><span>SEPARATION</span><strong>{profile.settings.lockoutMs} ms</strong></div></div><div className="profile-status"><ShieldCheck size={15}/>Calibrated for your setup</div><p className="helper">Cue sounds and their {profile.cueGuardMs} ms echo guard are excluded from detection.</p></> : <><div className="uncalibrated-icon"><ActivityIcon/></div><p className="helper">Calibrate the microphone to detect shots and reject duplicate reports.</p></>}
          <button className="text-button" disabled={busy} onClick={onCalibrate}>{profile ? 'Manage calibration' : 'Set up your sound profile'}<ArrowRight size={15}/></button>
        </section>
      </aside>
    </div>
    <div className="page-bottom-note"><ShieldCheck size={15}/><span>Offline ready after your first visit. Your stages stay on your phone.</span><LinkButton onClick={onCalibrate}>Fine-tune detection</LinkButton></div>
  </>;
}
function ActivityIcon() { return <svg width="54" height="26" viewBox="0 0 54 26" fill="none" aria-hidden="true"><path d="M1 13h10l4-6 5 14 7-20 6 24 5-12h15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
