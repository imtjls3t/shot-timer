import { LevelExtractor, ShotDetector } from './detector';
import type { DetectorSettings, LevelFrame } from '../domain';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor { port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class FieldProcessor extends AudioWorkletProcessor {
  private extractor = new LevelExtractor(sampleRate);
  private detector: ShotDetector | null = null;
  private frames: LevelFrame[] = [];
  private mode: 'capture' | 'timer' = 'capture';
  private debugFrames = false;
  private startMs = Infinity;
  private endMs = Infinity;
  private masks: { start: number; end: number }[] = [];
  private finished = false;
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'configure') {
        this.mode = data.mode;
        this.debugFrames = Boolean(data.debugFrames);
        this.detector = data.settings ? new ShotDetector(data.settings as DetectorSettings) : null;
        this.startMs = data.startMs;
        this.endMs = data.endMs;
        this.masks = data.masks ?? [];
        this.finished = false;
        this.frames = [];
      }
      if (data.type === 'flush') {
        this.finished = true;
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  private flush() {
    if (this.frames.length) this.port.postMessage({ type: 'frames', frames: this.frames });
    this.frames = [];
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    const input = inputs[0]?.[0];
    if (!input) return true;
    this.extractor.process(input, currentTime * 1000, frame => {
      if (frame.t < this.startMs || this.finished) return;
      if (frame.t >= this.endMs) {
        this.finished = true;
        this.flush();
        this.port.postMessage({ type: 'ended' });
        return;
      }
      frame.excluded = this.masks.some(m => frame.t >= m.start && frame.t < m.end);
      if (this.mode === 'capture' || this.debugFrames) this.frames.push(frame);
      if (this.detector) {
        const detection = this.detector.process(frame);
        if (detection) this.port.postMessage({ type: 'detection', detection });
      }
      if (this.frames.length >= 50) this.flush();
    });
    return true;
  }
}
registerProcessor('field-detector', FieldProcessor);
