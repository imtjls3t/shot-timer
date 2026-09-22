import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Check, Download, History as HistoryIcon, Settings2, Timer as TimerIcon, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { SavedData, Screen } from './domain';
import { DEFAULT_CONFIG } from './domain';
import { decodeData, encodeData, STORAGE_KEY } from './storage';
import { Timer } from './components/Timer';
import { Calibration } from './components/Calibration';
import { History } from './components/History';
import { Settings } from './components/Settings';
import { Notice } from './components/common';

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>; }
const screens: { id: Screen; label: string; icon: typeof TimerIcon }[] = [
  { id: 'timer', label: 'Timer', icon: TimerIcon }, { id: 'calibration', label: 'Calibration', icon: Activity },
  { id: 'history', label: 'History', icon: HistoryIcon }, { id: 'settings', label: 'Settings', icon: Settings2 },
];
function load() {
  try { return decodeData(localStorage.getItem(STORAGE_KEY)); }
  catch { return { data: { version: 1, config: { ...DEFAULT_CONFIG }, profiles: [], history: [] } as SavedData, warning: 'Device storage is unavailable. Your changes will only last while Shot Timer stays open.' }; }
}
export default function App() {
  const [initial] = useState(load);
  const [data, setData] = useState(initial.data);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [storageBlocked, setStorageBlocked] = useState(Boolean(initial.warning));
  const [screen, setScreen] = useState<Screen>('timer');
  const [busy, setBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(matchMedia('(display-mode: standalone)').matches);
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('');
  const { offlineReady: [offlineReady], needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const markBusy = useCallback((value: boolean) => setBusy(value), []);
  useEffect(() => {
    if (storageBlocked) return;
    try { localStorage.setItem(STORAGE_KEY, encodeData(data)); }
    catch { setStorageWarning('Could not save to this device. Storage may be full or disabled. Keep Shot Timer open to retain this session.'); }
  }, [data, storageBlocked]);
  useEffect(() => {
    const prompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const complete = () => { setInstalled(true); setInstallPrompt(null); };
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('beforeinstallprompt', prompt); window.addEventListener('appinstalled', complete);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    return () => { window.removeEventListener('beforeinstallprompt', prompt); window.removeEventListener('appinstalled', complete); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, []);
  async function install() {
    if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }
    else setMessage('In Android Chrome, open the ⋮ browser menu and choose “Add to Home screen” or “Install app.” Visit the HTTPS site first so it can be saved offline.');
  }
  function navigate(next: Screen) { if (!busy) { setScreen(next); window.scrollTo({ top: 0 }); } }
  function clearData() {
    try { localStorage.removeItem(STORAGE_KEY); setStorageBlocked(false); setStorageWarning(null); }
    catch { setStorageWarning('Storage could not be cleared. Check your browser’s storage settings.'); return; }
    setData({ version: 1, config: { ...DEFAULT_CONFIG }, profiles: [], history: [] });
    setMessage('All Shot Timer settings, profiles, and strings were deleted from this device. This cannot be undone.');
  }
  return <div className="app-shell">
    <header className="app-header"><div className="header-inner"><button className="brand" disabled={busy} onClick={() => navigate('timer')} aria-label="Shot Timer home"><span className="brand-mark"><TimerIcon size={21}/></span><span>Shot Timer</span></button>
      <nav className="desktop-nav" aria-label="Main navigation">{screens.map(({ id, label, icon: Icon }) => <button key={id} aria-current={screen === id ? 'page' : undefined} disabled={busy && screen !== id} className={screen === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={16}/>{label}</button>)}</nav>
      <button className="install-button" disabled={installed || busy} onClick={() => void install()}>{installed ? <Check size={15}/> : <Download size={15}/>}<span>{installed ? 'Installed' : 'Install app'}</span></button></div></header>
    <main className="main-content">
      {storageWarning && <Notice tone="error">{storageWarning}</Notice>}
      {message && <Notice onClose={() => setMessage('')}>{message}</Notice>}
      {!online && <Notice><WifiOff size={15}/> You’re offline. Cached timer features and saved profiles are available.</Notice>}
      {needRefresh && !busy && <Notice>A new Shot Timer version is available. Updating clears unfinished calibration tests. <button className="text-button" onClick={() => { if (screen !== 'calibration' || window.confirm('Update Shot Timer and discard unfinished calibration tests?')) void updateServiceWorker(true); }}>Update now<ArrowUpRight size={14}/></button></Notice>}
      {screen === 'timer' && <Timer config={data.config} profiles={data.profiles} onConfig={config => setData(d => ({ ...d, config }))} onRecord={record => setData(d => ({ ...d, history: [record, ...d.history].slice(0, 100) }))} onCalibrate={() => navigate('calibration')} onBusy={markBusy}/>}
      {screen === 'calibration' && <Calibration profiles={data.profiles} activeId={data.config.activeProfileId} volume={data.config.volume} onBusy={markBusy} onSelect={id => setData(d => ({ ...d, config: { ...d.config, activeProfileId: id } }))} onDelete={id => setData(d => ({ ...d, profiles: d.profiles.filter(p => p.id !== id), config: { ...d.config, activeProfileId: d.config.activeProfileId === id ? d.profiles.find(p => p.id !== id)?.id ?? null : d.config.activeProfileId } }))} onSave={profile => setData(d => ({ ...d, profiles: [...d.profiles, profile], config: { ...d.config, activeProfileId: profile.id } }))} onUpdate={profile => setData(d => ({ ...d, profiles: d.profiles.map(p => p.id === profile.id ? profile : p) }))}/>} 
      {screen === 'history' && <History history={data.history} onDelete={id => setData(d => ({ ...d, history: d.history.filter(r => r.id !== id) }))} onClear={() => setData(d => ({ ...d, history: [] }))}/>}
      {screen === 'settings' && <Settings config={data.config} onConfig={config => setData(d => ({ ...d, config }))} onClear={clearData} onInstall={() => void install()} installed={installed}/>}
    </main>
    <footer className="app-footer"><span>Shot Timer</span><span><i className={`status-dot ${offlineReady || installed ? 'available' : ''}`}/>{offlineReady ? 'Ready to work offline' : 'PRIVATE BY DESIGN'}</span></footer>
    <nav className="mobile-nav" aria-label="Mobile navigation">{screens.map(({ id, label, icon: Icon }) => <button key={id} aria-current={screen === id ? 'page' : undefined} disabled={busy && screen !== id} className={screen === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
  </div>;
}
