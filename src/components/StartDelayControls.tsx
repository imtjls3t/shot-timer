import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { TimerConfig } from '../domain';

type Bound = 'min' | 'max';
const MIN_DELAY = 1;
const MAX_DELAY = 8;
const percent = (seconds: number) => (seconds - MIN_DELAY) / (MAX_DELAY - MIN_DELAY) * 100;
const clamp = (seconds: number) => Math.max(MIN_DELAY, Math.min(MAX_DELAY, seconds));
const tenth = (seconds: number) => Math.round(seconds * 10) / 10;

export function StartDelayControls({ config, onConfig, disabled }: {
  config: TimerConfig;
  onConfig: (config: TimerConfig) => void;
  disabled: boolean;
}) {
  const [minDraft, setMinDraft] = useState(String(config.minDelay));
  const [maxDraft, setMaxDraft] = useState(String(config.maxDelay));
  const focused = useRef<Bound | null>(null);
  const cancelled = useRef<Bound | null>(null);
  const dragging = useRef<Bound | null>(null);
  const dragOffset = useRef(0);
  const rail = useRef<HTMLDivElement>(null);
  const latestConfig = useRef(config);
  latestConfig.current = config;

  useEffect(() => { if (focused.current !== 'min') setMinDraft(String(config.minDelay)); }, [config.minDelay]);
  useEffect(() => { if (focused.current !== 'max') setMaxDraft(String(config.maxDelay)); }, [config.maxDelay]);

  function setBound(bound: Bound, seconds: number) {
    const value = clamp(seconds);
    const current = latestConfig.current;
    const next = bound === 'min'
      ? { ...current, minDelay: value, maxDelay: Math.max(value, current.maxDelay) }
      : { ...current, minDelay: Math.min(value, current.minDelay), maxDelay: value };
    latestConfig.current = next;
    onConfig(next);
  }

  function commit(bound: Bound) {
    focused.current = null;
    if (cancelled.current === bound) {
      cancelled.current = null;
      if (bound === 'min') setMinDraft(String(config.minDelay));
      else setMaxDraft(String(config.maxDelay));
      return;
    }
    const draft = bound === 'min' ? minDraft : maxDraft;
    const value = Number(draft.trim().replace(',', '.'));
    if (draft.trim() && Number.isFinite(value)) setBound(bound, value);
    else if (bound === 'min') setMinDraft(String(config.minDelay));
    else setMaxDraft(String(config.maxDelay));
  }

  function edit(bound: Bound, draft: string) {
    if (!/^\d*(?:[.,]\d*)?$/.test(draft)) return;
    if (bound === 'min') setMinDraft(draft);
    else setMaxDraft(draft);
  }

  function valueAt(clientX: number) {
    const rect = rail.current?.getBoundingClientRect();
    if (!rect || !rect.width) return MIN_DELAY;
    return tenth(MIN_DELAY + (clientX - rect.left) / rect.width * (MAX_DELAY - MIN_DELAY));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && event.currentTarget.parentElement?.contains(active)) active.blur();
    const current = latestConfig.current;
    const value = valueAt(event.clientX);
    const rect = event.currentTarget.getBoundingClientRect();
    const target = event.target as Element;
    const handle = target.closest('[data-delay-handle]')?.getAttribute('data-delay-handle');
    const overlapping = current.minDelay === current.maxDelay;
    const center = rect.left + percent(current.minDelay) / 100 * rect.width;
    const bound: Bound = overlapping && handle ? event.clientX < center ? 'min' : 'max'
      : handle === 'min' || handle === 'max' ? handle
      : Math.abs(value - current.minDelay) <= Math.abs(value - current.maxDelay) ? 'min' : 'max';
    dragging.current = bound;
    dragOffset.current = handle ? event.clientX - (rect.left + percent(bound === 'min' ? current.minDelay : current.maxDelay) / 100 * rect.width) : 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!handle) setBound(bound, value);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !dragging.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setBound(dragging.current, valueAt(event.clientX - dragOffset.current));
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, bound: Bound) {
    const current = bound === 'min' ? latestConfig.current.minDelay : latestConfig.current.maxDelay;
    const value = event.key === 'Home' ? MIN_DELAY : event.key === 'End' ? MAX_DELAY
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? tenth(current + 0.1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? tenth(current - 0.1)
      : event.key === 'PageUp' ? tenth(current + 1) : event.key === 'PageDown' ? tenth(current - 1) : null;
    if (value === null) return;
    event.preventDefault();
    setBound(bound, value);
  }

  return <>
    <div className="two-columns delay-inputs">
      <label>Minimum<span className="input-with-unit"><input aria-label="Minimum start delay" type="text" inputMode="decimal" value={minDraft} onFocus={() => { focused.current = 'min'; }} onChange={event => edit('min', event.target.value)} onBlur={() => commit('min')} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelled.current = 'min'; event.currentTarget.blur(); } }}/><small>sec</small></span></label>
      <label>Maximum<span className="input-with-unit"><input aria-label="Maximum start delay" type="text" inputMode="decimal" value={maxDraft} onFocus={() => { focused.current = 'max'; }} onChange={event => edit('max', event.target.value)} onBlur={() => commit('max')} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelled.current = 'max'; event.currentTarget.blur(); } }}/><small>sec</small></span></label>
    </div>
    <div ref={rail} className="delay-range" role="group" aria-label="Start delay range" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
      <span className="delay-range-fill" style={{ left: `${percent(config.minDelay)}%`, right: `${100 - percent(config.maxDelay)}%` }}/>
      <button type="button" role="slider" data-delay-handle="min" aria-label="Minimum start delay slider" aria-valuemin={MIN_DELAY} aria-valuemax={MAX_DELAY} aria-valuenow={config.minDelay} aria-valuetext={`${config.minDelay} seconds`} className="delay-range-thumb" style={{ left: `${percent(config.minDelay)}%` }} onKeyDown={event => keyDown(event, 'min')}/>
      <button type="button" role="slider" data-delay-handle="max" aria-label="Maximum start delay slider" aria-valuemin={MIN_DELAY} aria-valuemax={MAX_DELAY} aria-valuenow={config.maxDelay} aria-valuetext={`${config.maxDelay} seconds`} className="delay-range-thumb" style={{ left: `${percent(config.maxDelay)}%` }} onKeyDown={event => keyDown(event, 'max')}/>
    </div>
    <div className="range-labels"><span>1 SEC</span><span>8 SEC</span></div>
  </>;
}
