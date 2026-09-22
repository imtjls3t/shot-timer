import type { ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Check, X } from 'lucide-react';
import { seconds, summarize } from '../domain';
import type { ShotEvent } from '../domain';

export function Notice({ children, tone = 'info', onClose }: { children: ReactNode; tone?: 'info' | 'error' | 'success'; onClose?: () => void }) {
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'success' ? <Check size={18}/> : <AlertCircle size={18}/>}<div>{children}</div>{onClose && <button className="icon-button" aria-label="Dismiss message" onClick={onClose}><X size={17}/></button>}</div>;
}
export function ShotTable({ shots }: { shots: ShotEvent[] }) {
  return <div className="table-wrap"><table><thead><tr><th>SHOT</th><th>TIME <small>s</small></th><th>SPLIT <small>s</small></th><th>STATUS</th></tr></thead><tbody>{shots.map(s => <tr key={s.number}><td><span className="shot-index">{String(s.number).padStart(2, '0')}</span></td><td className="numeric">{seconds(s.elapsedMs)}</td><td className="numeric">{s.number === 1 ? '—' : seconds(s.splitMs)}</td><td><span className={`table-status ${s.late ? 'late' : ''}`}>{s.late ? 'AFTER PAR' : s.number === 1 ? 'FIRST SHOT' : 'RECORDED'}</span></td></tr>)}</tbody></table>{!shots.length && <div className="table-empty"><span className="empty-cross">+</span><p>Your shots will appear here.</p></div>}</div>;
}
export function Summary({ shots }: { shots: ShotEvent[] }) {
  const stats = summarize(shots);
  return <div className="summary-grid">{[['First shot', stats.first], ['Fastest split', stats.fastest], ['Average split', stats.average]].map(([label, val]) => <div key={String(label)}><span>{label}</span><strong>{val === null ? '—' : seconds(val as number)}<small>s</small></strong></div>)}</div>;
}
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-button" onClick={onClick}>{children}<ArrowUpRight size={16}/></button>;
}
