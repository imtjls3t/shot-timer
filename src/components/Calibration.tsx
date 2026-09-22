import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Check, Crosshair, Mic, Plus, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Trash2, Volume2 } from 'lucide-react';
import { AudioEngine, requestWakeLock } from '../audio/engine';
import { recommend } from '../audio/calibration';
import type { Recommendation } from '../audio/calibration';
import { replay } from '../audio/detector';
import { dbText, DEFAULT_DETECTOR, newId } from '../domain';
import type { CalibrationProfile, CalibrationTrace, DetectorSettings, InputInfo, LevelFrame } from '../domain';
import { LinkButton, Notice } from './common';
import { ThresholdEditor } from './ThresholdEditor';
import { Waveform } from './Waveform';

type CaptureKind = 'ambient' | 'sample' | 'cue' | 'validation';
type Stage = 'intro' | 'ready' | 'review';
interface Props {
  profiles: CalibrationProfile[];
  activeId: string | null;
  volume: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onSave: (profile: CalibrationProfile) => void;
  onUpdate: (profile: CalibrationProfile) => void;
  onBusy: (busy: boolean) => void;
}
const sameSettings = (a: DetectorSettings | null, b: DetectorSettings) => a !== null && a.thresholdDb === b.thresholdDb && a.resetDb === b.resetDb && a.lockoutMs === b.lockoutMs && a.quietMs === b.quietMs;

export function Calibration({ profiles, activeId, volume, onSelect, onDelete, onSave, onUpdate, onBusy }: Props) {
  const [stage, setStage] = useState<Stage>('intro');
  const [capturing, setCapturing] = useState<CaptureKind | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sample, setSample] = useState<CalibrationTrace | null>(null);
  const [validation, setValidation] = useState<CalibrationTrace | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [settings, setSettings] = useState<DetectorSettings>({ ...DEFAULT_DETECTOR });
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(-100);
  const [liveCount, setLiveCount] = useState(0);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [editingProfile, setEditingProfile] = useState<{ id: string; thresholdDb: number } | null>(null);
  const [updatedProfile, setUpdatedProfile] = useState('');
  const engine = useRef<AudioEngine | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const validationRef = useRef<HTMLDivElement | null>(null);
  const input = useRef<InputInfo | null>(null);
  const ambient = useRef<LevelFrame[]>([]);
  const frames = useRef<LevelFrame[]>([]);
  const kindRef = useRef<CaptureKind | null>(null);
  const settingsRef = useRef(settings);
  const captureStart = useRef(0);
  const finishRef = useRef<(aborted?: string) => Promise<void>>(async () => {});
  const mounted = useRef(true);
  const guard = useRef(150);
  settingsRef.current = settings;

  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden && kindRef.current) void finishRef.current('Calibration interrupted. Keep Shot Timer visible and repeat this test.'); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      kindRef.current = null;
      void engine.current?.close();
      void wake.current?.release();
      ambient.current = [];
      frames.current = [];
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    onBusy(capturing !== null || preparing);
    return () => onBusy(false);
  }, [capturing, preparing, onBusy]);
  useEffect(() => {
    if (!capturing) return;
    const timer = window.setInterval(() => setElapsed(Math.max(0, (engine.current?.nowMs ?? 0) - captureStart.current)), 100);
    return () => clearInterval(timer);
  }, [capturing]);
  useEffect(() => {
    if (!validation) return;
    let settledFrame = 0;
    const layoutFrame = requestAnimationFrame(() => {
      settledFrame = requestAnimationFrame(() => {
        const target = validationRef.current;
        if (!target) return;
        const top = window.scrollY + target.getBoundingClientRect().top - 20;
        window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      });
    });
    return () => { cancelAnimationFrame(layoutFrame); cancelAnimationFrame(settledFrame); };
  }, [validation]);

  async function begin(kind: CaptureKind) {
    if (kindRef.current) return;
    kindRef.current = kind;
    setPreparing(true);
    setError(''); setWarning(''); setSaved(false); setConfirmed(false);
    frames.current = [];
    setLiveCount(0); setElapsed(0); setLevel(-100);
    const audio = new AudioEngine();
    engine.current = audio;
    try {
      const currentInput = await audio.open({
        frames: incoming => {
          if (!mounted.current) return;
          frames.current.push(...incoming);
          if (mounted.current) setLevel(Math.max(...incoming.map(f => f.peakDb)));
        },
        detection: event => { if (event.accepted && mounted.current) setLiveCount(n => n + 1); },
        ended: () => void finishRef.current(),
        interrupted: message => void finishRef.current(message),
      });
      if (!mounted.current || kindRef.current !== kind) { await audio.close(); return; }
      if (kind !== 'ambient' && input.current?.deviceId && currentInput.deviceId !== input.current.deviceId) throw new Error('Microphone changed. Restart calibration with the current microphone.');
      input.current = currentInput;
      wake.current = await requestWakeLock();
      if (!wake.current) setWarning('Keep the screen on during the test. Automatic screen wake lock is unavailable.');
      if (currentInput.autoGainControl || currentInput.noiseSuppression) setWarning('This phone is applying automatic audio processing. Keep placement consistent and check the validation highlights carefully.');
      if (kind === 'cue') {
        const start = audio.nowMs + 50;
        captureStart.current = start;
        audio.configure('capture', null, start, start + 1600, [{ start: start + 250, end: start + 400 }, { start: start + 900, end: start + 1050 }]);
        audio.beep(start + 250, volume);
        audio.beep(start + 900, volume);
      } else {
        captureStart.current = audio.capture(kind === 'validation' ? settingsRef.current : null, kind === 'ambient' ? 5000 : 30000);
      }
      setCapturing(kind); setPreparing(false);
    } catch (e) {
      await audio.close();
      kindRef.current = null;
      if (mounted.current) { setPreparing(false); setCapturing(null); setError(e instanceof Error ? e.message : 'Microphone setup failed. Please try again.'); }
    }
  }

  async function finish(aborted?: string) {
    const kind = kindRef.current;
    if (!kind) return;
    kindRef.current = null;
    const audio = engine.current;
    await audio?.close();
    engine.current = null;
    await wake.current?.release(); wake.current = null;
    if (!mounted.current) { frames.current = []; return; }
    setCapturing(null); setPreparing(false); setLevel(-100);
    const captured = frames.current;
    frames.current = [];
    if (aborted) { setError(aborted); return; }
    const duration = (captured.at(-1)?.t ?? 0) + (captured.at(-1)?.duration ?? 0);
    if (!captured.length) { setError('No microphone levels arrived. Check the microphone and repeat.'); return; }
    if (kind === 'ambient') { ambient.current = captured; setStage('ready'); return; }
    if (kind === 'sample') {
      const suggestion = recommend(ambient.current, captured);
      setRecommendation(suggestion);
      setSettings(suggestion.settings);
      setSample({ frames: captured, durationMs: duration, originalSettings: null, originalDetections: [] });
      setValidation(null); setStage('review');
    }
    if (kind === 'cue') {
      const threshold = settingsRef.current.thresholdDb;
      const lags = [250, 900].map(t => Math.max(0, ...captured.filter(f => f.t >= t && f.t < t + 600 && f.peakDb >= threshold).map(f => f.t - t)));
      guard.current = Math.max(150, Math.ceil((Math.max(...lags) + 30) / 10) * 10);
      if (guard.current > 500) { setError('The cue echo lasts too long for reliable detection. Lower the beep volume in Settings or change placement, then validate again.'); return; }
      await begin('validation');
    }
    if (kind === 'validation') {
      const originalSettings = { ...settingsRef.current };
      setValidation({ frames: captured, durationMs: duration, originalSettings, originalDetections: replay(captured, originalSettings) });
    }
  }
  finishRef.current = finish;
  const validationEvents = useMemo(() => validation ? replay(validation.frames, settings).filter(d => d.accepted) : [], [validation, settings]);
  const changed = validation !== null && !sameSettings(validation.originalSettings, settings);
  const validationPasses = validation !== null && !changed && validationEvents.length === 5;
  function threshold(db: number) { setSettings(s => ({ ...s, thresholdDb: db, resetDb: db - 6 })); setConfirmed(false); }
  function clear() {
    ambient.current = []; frames.current = [];
    setSample(null); setValidation(null); setRecommendation(null); setStage('intro');
    setConfirmed(false); setError(''); setWarning(''); setName(''); setNotes('');
  }
  function save() {
    if (!validationPasses || !confirmed || !recommendation || !input.current || !name.trim()) return;
    onSave({ id: newId(), name: name.trim(), notes: notes.trim(), createdAt: new Date().toISOString(), settings: { ...settings }, recommendedDb: recommendation.settings.thresholdDb, noiseDb: recommendation.noiseDb, shotDb: recommendation.shotDb, cueGuardMs: guard.current, input: { ...input.current } });
    clear(); setSaved(true);
  }
  const isBusy = capturing !== null || preparing;
  return <>
    <h1 className="sr-only">Calibration</h1>
    {saved && <Notice tone="success">Profile saved. Temporary waveform measurements have been cleared.</Notice>}
    {updatedProfile && <Notice tone="success" onClose={() => setUpdatedProfile('')}>{updatedProfile} threshold updated.</Notice>}
    {error && <Notice tone="error" onClose={() => setError('')}>{error}</Notice>}
    {warning && <Notice>{warning}</Notice>}
    <div className="calibration-layout">
      <div className="calibration-main">
        <div className="stepper">{['Background', 'Five shots', 'Fine-tune', 'Validate'].map((label, i) => {
          const step = stage === 'intro' ? 0 : stage === 'ready' ? 1 : validation || capturing === 'validation' || capturing === 'cue' ? 3 : 2;
          return <div key={label} className={i <= step ? 'active' : ''}><span>{i < step ? <Check size={14}/> : i + 1}</span><small>{label}</small></div>;
        })}</div>
        {isBusy ? <section className="card capture-card">
          <div className="capture-icon"><Mic size={32}/></div>
          <span className="eyebrow">{preparing ? 'CONNECTING MICROPHONE' : capturing === 'ambient' ? 'LISTENING TO YOUR ENVIRONMENT' : capturing === 'cue' ? 'CHECKING BOTH CUE TONES' : 'MICROPHONE ACTIVE'}</span>
          <h2>{preparing ? 'Getting ready…' : capturing === 'ambient' ? 'Stay quiet for five seconds.' : capturing === 'cue' ? 'Stay quiet. Two quick beeps.' : 'Fire five single shots.'}</h2>
          <p>{capturing === 'sample' || capturing === 'validation' ? 'Leave at least one second between shots. Tap Done after the fifth shot.' : 'Keep your phone where it will be during your practice.'}</p>
          <div className="live-meter"><div style={{ width: `${Math.max(0, Math.min(100, level + 100))}%` }}/></div>
          <div className="meter-labels"><span>{dbText(level)}</span><span>{(elapsed / 1000).toFixed(1)} s{capturing === 'validation' ? ` · ${liveCount} detected` : ''}</span></div>
          {(capturing === 'sample' || capturing === 'validation') && <button className="button primary" onClick={() => void finish()}><Check size={18}/>Done — review test</button>}
          <button className="button subtle" onClick={() => void finish('Test canceled. No test audio was recorded.')} >Cancel test</button>
        </section> : stage === 'intro' ? <section className="card calibration-intro">
          <span className="feature-icon"><Activity size={30}/></span>
          <div className="setup-points"><div><span>01</span><p>Place the phone beside your practice position, with the microphone uncovered.</p></div><div><span>02</span><p>Use the same gun, distance, and room you plan to practice in.</p></div><div><span>03</span><p>Have ten shots ready: five to calibrate, five to validate.</p></div></div>
          <button className="button primary" onClick={() => void begin('ambient')}><Mic size={18}/>Start calibration<ArrowRight size={18}/></button>
          <span className="privacy-caption"><ShieldCheck size={14}/>On your device. No audio recordings.</span>
        </section> : stage === 'ready' ? <section className="card calibration-intro"><span className="feature-icon"><Crosshair size={30}/></span><h2>Let’s hear five shots.</h2><p>Background measured. Start the test, fire five single shots at least one second apart, then tap Done. You’ll review the waveform before saving anything.</p><button className="button primary" onClick={() => void begin('sample')}>Start five-shot test<ArrowRight size={18}/></button><button className="button subtle" onClick={clear}>Start over</button></section> : <>
          {sample && recommendation && <>
            <Waveform title="Calibration test" trace={sample} settings={settings} recommendedDb={recommendation.settings.thresholdDb} noiseDb={recommendation.noiseDb} onThreshold={threshold}/>
            <section className="card tuning-controls"><div className="section-heading"><h3><SlidersHorizontal size={18}/>Dial it in</h3><button className="text-button" onClick={() => { setSettings({ ...recommendation.settings }); setConfirmed(false); }}><RotateCcw size={14}/>Reset to recommended</button></div>
              <div className="two-columns"><label>Shot threshold <ThresholdEditor value={settings.thresholdDb} onChange={threshold}/></label><label>Minimum shot separation <span className="input-with-unit"><input aria-label="Minimum shot separation" type="number" min={60} max={500} step={10} value={settings.lockoutMs} onChange={e => { setSettings(s => ({ ...s, lockoutMs: Math.max(60, Math.min(500, +e.target.value)) })); setConfirmed(false); }}/><small>ms</small></span></label></div>
              <p className="helper">Lower dBFS values pick up quieter sounds. Separation suppresses echoes but also sets the fastest split that can be detected. Reset level: {dbText(settings.resetDb)}.</p>
              {recommendation.warnings.map(w => <Notice key={w}>{w}</Notice>)}
              {settings.thresholdDb < recommendation.noiseDb + 6 && <Notice tone="error">This threshold is close to background noise. False detections are likely.</Notice>}
            </section>
          </>}
          {validation && recommendation && <>
            <div className="validation-results" ref={validationRef}><Waveform title="Validation test" trace={validation} settings={settings} recommendedDb={recommendation.settings.thresholdDb} noiseDb={recommendation.noiseDb} onThreshold={threshold}/></div>
            <Notice tone={changed ? 'info' : validationPasses ? 'success' : 'error'}>{changed ? `Preview with adjusted settings. The original test detected ${validation.originalDetections.filter(d => d.accepted).length} shots at ${dbText(validation.originalSettings!.thresholdDb)}. Run validation again before saving.` : validationPasses ? 'Five shots detected. Check that the numbered highlights match your five actual shots.' : `Detected ${validationEvents.length} of five expected shots. Adjust the threshold or separation, then repeat validation.`}</Notice>
          </>}
          <div className="calibration-actions"><button className="button primary" onClick={() => void begin('cue')}><Volume2 size={18}/>{validation ? 'Repeat validation' : 'Validate with five more shots'}<ArrowRight size={18}/></button><button className="button secondary" onClick={() => { setValidation(null); void begin('sample'); }}>Repeat calibration shots</button></div>
          {validation && <section className="card save-profile"><h3>Keep this setup.</h3><div className="two-columns"><label>Profile name<input placeholder="e.g. Indoor · AEG" maxLength={48} value={name} onChange={e => setName(e.target.value)}/></label><label>Notes <small>optional</small><input placeholder="Gun, room, phone position…" maxLength={160} value={notes} onChange={e => setNotes(e.target.value)}/></label></div><label className="check-label"><input type="checkbox" checked={confirmed} disabled={!validationPasses} onChange={e => setConfirmed(e.target.checked)}/>The five highlights match my five shots, with no extra detections.</label><button className="button primary" disabled={!validationPasses || !confirmed || !name.trim()} onClick={save}><Save size={18}/>Save calibration profile</button><p className="helper">Saving clears both waveforms. Only the settings and summary measurements are kept.</p></section>}
          <button className="button subtle" onClick={clear}><RotateCcw size={15}/>Discard tests and start over</button>
        </>}
      </div>
      <aside className="calibration-sidebar">
        <section className="card profiles-card"><div className="section-heading"><h3>Saved profiles</h3><span className="count-badge">{profiles.length}</span></div>{!profiles.length ? <p className="muted">Your first profile starts here. Save different setups for different guns or environments.</p> : profiles.map(p => <div className={`profile-item editable-profile ${p.id === activeId ? 'active' : ''}`} key={p.id}>
          <div className="profile-item-row"><button disabled={isBusy} onClick={() => onSelect(p.id)}><span className="profile-radio">{p.id === activeId && <Check size={12}/>}</span><span><strong>{p.name}</strong><small>{dbText(p.settings.thresholdDb)} · {p.settings.lockoutMs} ms</small></span></button><button className="icon-button" disabled={isBusy} aria-label={`Edit ${p.name}`} onClick={() => { setSaved(false); setUpdatedProfile(''); setEditingProfile(current => current?.id === p.id ? null : { id: p.id, thresholdDb: p.settings.thresholdDb }); }}><SlidersHorizontal size={15}/></button><button className="icon-button" disabled={isBusy} aria-label={`Delete ${p.name}`} onClick={() => { if (window.confirm(`Delete profile “${p.name}”? Saved strings retain their settings.`)) { if (editingProfile?.id === p.id) setEditingProfile(null); onDelete(p.id); } }}><Trash2 size={15}/></button></div>
          {editingProfile?.id === p.id && <form className="saved-profile-editor" onSubmit={event => { event.preventDefault(); const thresholdDb = editingProfile.thresholdDb; onUpdate({ ...p, settings: { ...p.settings, thresholdDb, resetDb: thresholdDb - 6 } }); setEditingProfile(null); setUpdatedProfile(p.name); }}><label>Shot threshold<ThresholdEditor value={editingProfile.thresholdDb} inputLabel={`Threshold for ${p.name}`} stepLabel={`${p.name} threshold`} onChange={thresholdDb => setEditingProfile({ id: p.id, thresholdDb })}/></label><p className="helper">Reset level follows at {dbText(editingProfile.thresholdDb - 6)}. Validate again after a large adjustment.</p><div className="profile-edit-actions"><button type="button" className="button subtle" onClick={() => setEditingProfile(null)}>Cancel</button><button type="submit" className="button primary">Save threshold</button></div></form>}
        </div>)}{stage !== 'intro' && !isBusy && <LinkButton onClick={clear}><Plus size={15}/>New calibration</LinkButton>}</section>
        <section className="field-note"><ShieldCheck size={23}/><h3>A waveform, without a recording.</h3><p>We keep temporary loudness measurements while you fine-tune. No playable audio is saved or uploaded.</p><p>Leaving calibration clears the test measurements. Your saved profiles stay on this phone.</p></section>
        <div className="small-note"><strong>Why dBFS?</strong><p>These numbers describe your phone’s input level. They aren’t a measurement of real-world sound pressure.</p></div>
      </aside>
    </div>
  </>;
}
