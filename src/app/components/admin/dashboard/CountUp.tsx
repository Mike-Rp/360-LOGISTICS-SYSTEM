import { useEffect, useRef, useState } from 'react';

/* Adapted from React Bits Count Up for live Dashboard totals. */
export default function CountUp({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const currentValue = useRef(0);
  const formattedValue = value.toLocaleString('en-US');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      currentValue.current = value;
      setDisplayValue(value);
      return;
    }

    const from = currentValue.current;
    if (from === value) return;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / 1000, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (value - from) * eased);
      currentValue.current = next;
      setDisplayValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span aria-label={formattedValue} className="inline-block tabular-nums" style={{ minWidth: `${formattedValue.length}ch` }}>
      <span aria-hidden="true">{displayValue.toLocaleString('en-US')}</span>
    </span>
  );
}
