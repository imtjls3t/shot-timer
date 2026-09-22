import { useEffect, useMemo, useState } from 'react';
import type { CalibrationProfile, StageRecord } from '../domain';
import { dbText } from '../domain';
import type { StageDebugTrace } from '../audio/debugTrace';
import { ThresholdEditor } from './ThresholdEditor';
import { Waveform } from './Waveform';

export function StageDebugReview({ record, trace, profile, onUpdateProfile }: {
  record: StageRecord;
  trace: StageDebugTrace;
  profile: CalibrationProfile | null;
  onUpdateProfile: (id: string, thresholdDb: number) => void;
}) {
  const [thresholdDb, setThresholdDb] = useState(record.profile.settings.thresholdDb);
  const [updated, setUpdated] = useState(false);
  useEffect(() => { setThresholdDb(record.profile.settings.thresholdDb); setUpdated(false); }, [record.id, record.profile.settings.thresholdDb]);
  const waveformTrace = useMemo(() => ({ frames: trace.frames, durationMs: trace.durationMs }), [trace]);
  const settings = useMemo(() => ({ ...record.profile.settings, thresholdDb, resetDb: thresholdDb - 6 }), [record.profile.settings, thresholdDb]);
  return <section className="stage-debug-review" aria-label="Stage debug review">
    <Waveform title="Stage waveform" trace={waveformTrace} settings={settings} recommendedDb={record.profile.recommendedDb} noiseDb={record.profile.noiseDb} onThreshold={db => { setThresholdDb(db); setUpdated(false); }} targetShots={null}/>
    <div className="stage-debug-controls">
      <label>Preview threshold<ThresholdEditor value={thresholdDb} inputLabel="Debug threshold" stepLabel="debug threshold" onChange={db => { setThresholdDb(db); setUpdated(false); }}/></label>
      <button className="button primary" disabled={!profile || profile.settings.thresholdDb === thresholdDb} onClick={() => { if (profile) { onUpdateProfile(profile.id, thresholdDb); setUpdated(true); } }}>Update profile</button>
      <p className="helper">Preview only: saved shot times stay as recorded. Updating changes future stages for {record.profile.name}.</p>
      {!profile && <p className="helper">This profile was deleted, so it cannot be updated.</p>}
      {updated && <p className="helper" role="status">Profile threshold updated to {dbText(thresholdDb)}.</p>}
    </div>
  </section>;
}
