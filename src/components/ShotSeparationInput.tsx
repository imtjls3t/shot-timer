import { useEffect, useRef, useState } from 'react';

const MIN_SEPARATION = 60;
const MAX_SEPARATION = 500;

export function ShotSeparationInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  function commit() {
    focused.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!draft || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(MIN_SEPARATION, Math.min(MAX_SEPARATION, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onChange(next);
  }

  return <span className="input-with-unit">
    <input
      aria-label="Minimum shot separation"
      type="text"
      inputMode="numeric"
      value={draft}
      onFocus={() => { focused.current = true; }}
      onChange={event => { if (/^\d*$/.test(event.target.value)) setDraft(event.target.value); }}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); }
      }}
    />
    <small>ms</small>
  </span>;
}
