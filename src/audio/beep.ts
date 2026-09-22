import beepUrl from '../../assets/beep.wav?url';

let beepBytes: Promise<ArrayBuffer> | null = null;

export async function loadBeep(context: BaseAudioContext): Promise<AudioBuffer> {
  beepBytes ??= fetch(beepUrl).then(response => {
    if (!response.ok) throw new Error(`Could not load the beep sound (${response.status}).`);
    return response.arrayBuffer();
  });
  // decodeAudioData may consume its input, so each AudioContext receives a copy.
  return context.decodeAudioData((await beepBytes).slice(0));
}

export function playBeep(context: AudioContext, buffer: AudioBuffer, atMs: number, volume: number) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), atMs / 1000);
  source.connect(gain).connect(context.destination);
  source.start(atMs / 1000);
  return { source, gain };
}
