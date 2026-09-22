import { useEffect, useRef, useState } from 'react';

const MIN_THRESHOLD = -90;
const MAX_THRESHOLD = -3;

function text(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function parse(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number) {
  return Math.round(Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, value)) * 10) / 10;
}

export function ThresholdEditor({ value, onChange, inputLabel = 'Shot threshold', stepLabel = 'shot threshold' }: {
  value: number;
  onChange: (value: number) => void;
  inputLabel?: string;
  stepLabel?: string;
}) {
  const [draft, setDraft] = useState(() => text(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(text(value));
  }, [value]);

  function apply(next: number) {
    const valid = clamp(next);
    setDraft(text(valid));
    onChange(valid);
  }

  function commit() {
    const number = parse(draft);
    if (number === null) setDraft(text(value));
    else apply(number);
  }

  function edit(next: string) {
    if (!/^-?\d*(?:[.,]\d*)?$/.test(next)) return;
    setDraft(next);
    const number = parse(next);
    // Preserve incomplete values such as "-" and out-of-range prefixes while
    // typing. Valid complete values still update the waveform immediately.
    if (number !== null && number >= MIN_THRESHOLD && number <= MAX_THRESHOLD) onChange(Math.round(number * 10) / 10);
  }

  function step(amount: number) {
    apply((parse(draft) ?? value) + amount);
  }

  return <div className="threshold-editor">
    <button type="button" className="threshold-step" aria-label={`Decrease ${stepLabel} by 1 dB`} disabled={value <= MIN_THRESHOLD} onClick={() => step(-1)}>−1</button>
    <span className="input-with-unit">
      <input
        aria-label={inputLabel}
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={() => { focused.current = true; }}
        onChange={event => edit(event.target.value)}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') { setDraft(text(value)); event.currentTarget.blur(); }
        }}
      />
      <small>dBFS</small>
    </span>
    <button type="button" className="threshold-step" aria-label={`Increase ${stepLabel} by 1 dB`} disabled={value >= MAX_THRESHOLD} onClick={() => step(1)}>+1</button>
  </div>;
}
