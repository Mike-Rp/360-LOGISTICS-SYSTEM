import { formatOperationalStamp } from './assignmentOperational';

/** Split display timestamps without changing their stored time or timezone. */
export function splitDisplayDateTime(value?: string | null): { date: string; time: string | null } | null {
  if (!value?.trim()) return null;
  const stamp = formatOperationalStamp(value.trim()) ?? value.trim();
  const match = stamp.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})(?:\s*(?:,|·|at))?\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return { date: stamp, time: null };

  return {
    date: `${match[1].slice(0, 3)} ${Number(match[2])}, ${match[3]}`,
    time: `${Number(match[4])}:${match[5]} ${match[6].toUpperCase()}`,
  };
}
