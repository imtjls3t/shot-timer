import { useRef, useState } from 'react';
import { Download, ShieldCheck, Trash2, Volume2 } from 'lucide-react';
import type { TimerConfig } from '../domain';
import { Notice } from './common';
import { loadBeep, playBeep } from '../audio/beep';
import packageJson from '../../package.json';
const displayVersion = packageJson.version.replace(/\.0$/, '');
export function Settings({ config, onConfig, onClear, onInstall, installed }: { config: TimerConfig; onConfig: (config: TimerConfig) => void; onClear: () => void; onInstall: () => void; installed: boolean }) {
  const [message, setMessage] = useState('');
  const testing = useRef(false);
  async function testBeep() {
    if (testing.current) return;
    testing.current = true;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext(); await context.resume();
      const buffer = await loadBeep(context);
      const { source } = playBeep(context, buffer, context.currentTime, config.volume);
      await new Promise<void>(resolve => { source.onended = () => resolve(); });
    } catch { setMessage('Sound could not start. Check your browser and phone volume.'); }
    finally { await context?.close(); testing.current = false; }
  }
  return <><h1 className="sr-only">Settings</h1>
    {message && <Notice onClose={() => setMessage('')}>{message}</Notice>}
    <div className="settings-grid"><section className="card settings-card"><Volume2 size={24}/><h2>Start & PAR beeps</h2><p>Use your phone’s speaker and media volume. Bluetooth output can add unpredictable delay.</p><label>Beep volume <strong>{Math.round(config.volume * 100)}%</strong><input type="range" aria-label="Beep volume" min={0.05} max={1} step={0.05} value={config.volume} onChange={e => onConfig({ ...config, volume: +e.target.value })}/></label><button className="button secondary" onClick={() => void testBeep()}><Volume2 size={16}/>Test beep</button><p className="helper">Revalidate calibration after changing speaker volume or phone placement, so cue echo protection stays accurate.</p></section>
    <section className="card settings-card"><Download size={24}/><h2>Made for your home screen</h2><p>Install Shot Timer from your browser for a full-screen experience. Timer, calibration, and history work offline after the app is cached.</p><button className="button secondary" disabled={installed} onClick={onInstall}><Download size={16}/>{installed ? 'App installed' : 'Install Shot Timer'}</button><p className="helper">On Android Chrome, open the browser menu and choose “Add to Home screen” or “Install app” if no prompt appears.</p></section>
    <section className="card settings-card"><ShieldCheck size={24}/><h2>Your practice stays here.</h2><p>No accounts. No uploads. Microphone audio is processed as it arrives and is never recorded. Waveforms use temporary level measurements.</p><p className="helper">Only your profiles, settings, and latest 100 stages are saved. Clearing browser data or uninstalling may remove them.</p></section>
    <section className="card settings-card"><Trash2 size={24}/><h2>A fresh start</h2><p>Remove all settings, calibration profiles, and saved stages from this device.</p><button className="button secondary danger" onClick={() => { if (window.confirm('Delete all Shot Timer settings, calibration profiles, and saved stages? This cannot be undone.')) onClear(); }}>Clear all stored data</button></section></div>
    <p className="settings-footnote">Shot Timer / v{displayVersion} · Built for semi-auto airsoft practice. Keep the app visible while timing.</p>
  </>;
}
