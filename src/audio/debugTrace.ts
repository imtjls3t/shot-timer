import { ShotDetector } from './detector';
import type { Detection, DetectorSettings, LevelFrame } from '../domain';

const CHUNK_SIZE = 4096;
type Chunk = {
  time: Float64Array;
  duration: Float32Array;
  peak: Float32Array;
  excluded: Uint8Array;
  length: number;
};

/** Session-only, derived sound levels. No PCM or playable audio. */
export class PackedLevelFrames {
  private chunks: Chunk[] = [];
  length = 0;
  get lastTime() {
    const chunk = this.chunks.at(-1);
    return chunk && chunk.length ? chunk.time[chunk.length - 1] : 0;
  }

  append(frames: LevelFrame[]) {
    for (const frame of frames) {
      let chunk = this.chunks.at(-1);
      if (!chunk || chunk.length === CHUNK_SIZE) {
        chunk = { time: new Float64Array(CHUNK_SIZE), duration: new Float32Array(CHUNK_SIZE), peak: new Float32Array(CHUNK_SIZE), excluded: new Uint8Array(CHUNK_SIZE), length: 0 };
        this.chunks.push(chunk);
      }
      const i = chunk.length++;
      chunk.time[i] = frame.t;
      chunk.duration[i] = frame.duration;
      chunk.peak[i] = frame.peakDb;
      chunk.excluded[i] = frame.excluded ? 1 : 0;
      this.length++;
    }
  }

  private frameAt(index: number): LevelFrame {
    const chunk = this.chunks[Math.floor(index / CHUNK_SIZE)];
    const i = index % CHUNK_SIZE;
    return { t: chunk.time[i], duration: chunk.duration[i], peakDb: chunk.peak[i], rmsDb: chunk.peak[i], excluded: Boolean(chunk.excluded[i]) };
  }

  private timeAt(index: number): number {
    const chunk = this.chunks[Math.floor(index / CHUNK_SIZE)];
    return chunk.time[index % CHUNK_SIZE];
  }

  private firstAtOrAfter(timeMs: number): number {
    let lo = 0, hi = this.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.timeAt(mid) < timeMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  toFrames(): LevelFrame[] {
    return Array.from({ length: this.length }, (_, i) => this.frameAt(i));
  }

  replay(settings: DetectorSettings): Detection[] {
    const detector = new ShotDetector(settings);
    const detections: Detection[] = [];
    for (let i = 0; i < this.length; i++) {
      const detection = detector.process(this.frameAt(i));
      if (detection) detections.push(detection);
    }
    return detections;
  }

  windowBuckets(startMs: number, endMs: number, points: number): LevelFrame[] {
    if (points <= 0 || endMs <= startMs) return [];
    const buckets: (LevelFrame | undefined)[] = Array(points);
    for (let i = this.firstAtOrAfter(startMs); i < this.length; i++) {
      const frame = this.frameAt(i);
      if (frame.t > endMs) break;
      const index = Math.min(points - 1, Math.floor((frame.t - startMs) / (endMs - startMs) * points));
      const previous = buckets[index];
      buckets[index] = previous ? {
        ...(frame.peakDb > previous.peakDb ? frame : previous),
        excluded: previous.excluded || frame.excluded,
      } : frame;
    }
    return buckets.filter((frame): frame is LevelFrame => Boolean(frame));
  }

  recent(endMs: number, spanMs: number, points: number): LevelFrame[] {
    return this.windowBuckets(endMs - spanMs, endMs, points);
  }
}

export interface StageDebugTrace {
  stageId: string;
  durationMs: number;
  frames: PackedLevelFrames;
}
