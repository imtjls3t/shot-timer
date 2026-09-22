import processorUrl from './processor.ts?worker&url';
import type { Detection, DetectorSettings, InputInfo, LevelFrame } from '../domain';
import { loadBeep, playBeep } from './beep';

export type AudioCallbacks = {
  frames?: (frames: LevelFrame[]) => void;
  detection?: (detection: Detection) => void;
  ended?: () => void;
  interrupted?: (reason: string) => void;
};
export class AudioEngine {
  context: AudioContext | null = null;
  input: InputInfo | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private beepBuffer: AudioBuffer | null = null;
  private beepSources: AudioBufferSourceNode[] = [];
  private callbacks: AudioCallbacks = {};
  private flushResolve: (() => void) | null = null;
  private closing = false;
  private origin = 0;

  async open(callbacks: AudioCallbacks) {
    this.callbacks = callbacks;
    this.closing = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS. Open the published app, or use localhost on this device.');
    this.context = new AudioContext({ latencyHint: 'interactive' });
    try {
      await this.context.resume();
      if (!this.context.audioWorklet) throw new Error('This browser cannot run the audio detector. Open Shot Timer in a current version of Chrome.');
      this.beepBuffer = await loadBeep(this.context);
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, autoGainControl: false, noiseSuppression: false }, video: false });
      if (this.closing) { this.stream.getTracks().forEach(t => t.stop()); throw new Error('Microphone setup canceled.'); }
      const track = this.stream.getAudioTracks()[0];
      const settings = track.getSettings();
      this.input = {
        label: track.label || 'Default microphone', deviceId: settings.deviceId || '',
        sampleRate: settings.sampleRate || this.context.sampleRate,
        echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      };
      track.onended = () => !this.closing && this.callbacks.interrupted?.('Microphone disconnected. Reconnect it and start a new stage.');
      track.onmute = () => !this.closing && this.callbacks.interrupted?.('Microphone was interrupted. Check that another app is not using it.');
      await this.context.audioWorklet.addModule(processorUrl);
      if (this.closing) throw new Error('Microphone setup canceled.');
      this.node = new AudioWorkletNode(this.context, 'field-detector', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.onprocessorerror = () => this.callbacks.interrupted?.('Audio processing stopped. Start a new stage to reconnect.');
      this.node.port.onmessage = ({ data }) => {
        if (data.type === 'frames') this.callbacks.frames?.((data.frames as LevelFrame[]).map(f => ({ ...f, t: f.t - this.origin })));
        if (data.type === 'detection') this.callbacks.detection?.({ ...data.detection, t: data.detection.t - this.origin });
        if (data.type === 'ended') this.callbacks.ended?.();
        if (data.type === 'flushed') this.flushResolve?.();
      };
      this.source = this.context.createMediaStreamSource(this.stream);
      this.source.connect(this.node);
      // Processor output is silence: the microphone is never played through the speaker.
      this.node.connect(this.context.destination);
      this.context.onstatechange = () => {
        if (!this.closing && this.context && this.context.state !== 'running') this.callbacks.interrupted?.('Audio was paused by the phone. Return to Shot Timer and start a new stage.');
      };
      if (this.context.state !== 'running') throw new Error('Audio could not start. Tap again to enable sound.');
      return this.input;
    } catch (error) {
      await this.close();
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('Microphone permission was denied. Allow microphone access in the browser’s site settings, then try again.');
      if (error instanceof DOMException && error.name === 'NotFoundError') throw new Error('No microphone was found. Connect one and try again.');
      if (error instanceof DOMException && error.name === 'NotReadableError') throw new Error('The microphone is busy. Close other apps using it and try again.');
      throw error;
    }
  }

  get nowMs() { return (this.context?.currentTime ?? 0) * 1000; }
  configure(mode: 'capture' | 'timer', settings: DetectorSettings | null, startMs: number, endMs: number, masks: { start: number; end: number }[] = [], debugFrames = false) {
    this.origin = startMs;
    this.node?.port.postMessage({ type: 'configure', mode, settings, startMs, endMs, masks, debugFrames });
  }
  capture(settings: DetectorSettings | null, durationMs: number, cue?: { volume: number; guardMs: number }) {
    const start = this.nowMs + 50;
    const masks = cue ? [{ start: start + 250, end: start + 250 + cue.guardMs }] : [];
    this.configure('capture', settings, start, start + durationMs, masks);
    if (cue) this.beep(start + 250, cue.volume);
    return start;
  }
  beep(atMs: number, volume: number) {
    const ctx = this.context;
    if (!ctx || !this.beepBuffer || this.closing) return;
    const { source, gain } = playBeep(ctx, this.beepBuffer, atMs, volume);
    this.beepSources.push(source);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.beepSources = this.beepSources.filter(item => item !== source);
    };
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    for (const source of this.beepSources) { try { source.stop(); } catch { /* already stopped */ } }
    this.beepSources = [];
    if (this.node && this.context?.state === 'running') {
      await new Promise<void>(resolve => {
        const timeout = window.setTimeout(resolve, 150);
        this.flushResolve = () => { clearTimeout(timeout); resolve(); };
        this.node?.port.postMessage({ type: 'flush' });
      });
    }
    this.flushResolve = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    this.stream?.getTracks().forEach(t => { t.onended = null; t.onmute = null; t.stop(); });
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.beepBuffer = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.callbacks = {};
  }
}

export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try { return navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; }
  catch { return null; }
}
