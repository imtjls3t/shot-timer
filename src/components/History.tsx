import { useState } from 'react';
import { ChevronDown, Clock3, Trash2 } from 'lucide-react';
import { seconds } from '../domain';
import type { CalibrationProfile, StageRecord } from '../domain';
import type { StageDebugTrace } from '../audio/debugTrace';
import { ShotTable, Summary } from './common';
import { StageDebugReview } from './StageDebugReview';

export function History({ history, debugTraces, profiles, onUpdateProfile, onDelete, onClear }: { history: StageRecord[]; debugTraces: StageDebugTrace[]; profiles: CalibrationProfile[]; onUpdateProfile: (id: string, thresholdDb: number) => void; onDelete: (id: string) => void; onClear: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(history[0]?.id ?? null);
  return <>
    <h1 className="sr-only">History</h1>
    <div className="history-toolbar"><span className="eyebrow">{history.length} SAVED {history.length === 1 ? 'STAGE' : 'STAGES'}</span>{history.length > 0 && <button className="text-button danger" onClick={() => { if (window.confirm('Delete all saved stages? This cannot be undone. Your calibration profiles will be kept.')) onClear(); }}><Trash2 size={15}/>Clear history</button>}</div>
    {!history.length && <section className="card empty-history"><Clock3 size={38}/><h2>Room for your next personal best.</h2><p>Complete a stage and its shot times and splits will be waiting here.</p></section>}
    <div className="history-list">{history.map(r => <section key={r.id} className="card history-card"><div className="history-row"><button className="history-expand" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}><span className="history-icon"><Clock3 size={20}/></span><span><strong>{r.profile.name}</strong><small>{new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></span><span className="history-stat"><strong>{seconds(r.shots.at(-1)?.elapsedMs ?? r.durationMs)}<small>s</small></strong><small>{r.shots.length} shots{r.interrupted ? ' · interrupted' : ''}</small></span><ChevronDown size={18} className={expanded === r.id ? 'rotated' : ''}/></button><button className="icon-button" aria-label={`Delete stage ${r.id}`} onClick={() => { if (window.confirm('Delete this stage?')) onDelete(r.id); }}><Trash2 size={16}/></button></div>{expanded === r.id && <div className="history-detail"><div className="history-meta"><span>Delay {r.delaySeconds.toFixed(2)}s</span><span>PAR {r.config.parSeconds === null ? 'off' : `${r.config.parSeconds.toFixed(2)}s`}</span><span>Threshold {r.profile.settings.thresholdDb.toFixed(1)} dBFS</span><span>Separation {r.profile.settings.lockoutMs} ms</span></div><ShotTable shots={r.shots}/><Summary shots={r.shots}/>{debugTraces.find(t => t.stageId === r.id) && <StageDebugReview record={r} trace={debugTraces.find(t => t.stageId === r.id)!} profile={profiles.find(p => p.id === r.profile.id) ?? null} onUpdateProfile={onUpdateProfile}/>}</div>}</section>)}</div>
  </>;
}
