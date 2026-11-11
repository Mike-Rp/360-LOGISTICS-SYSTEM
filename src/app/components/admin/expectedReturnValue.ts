import { parsePhilippineInputValue, philippineDateKey } from '../../lib/philippineTime';

/** Calendar months are zero-based in DateField; ISO months are one-based. */
export function isAtOrBeforeMinMonth(year: number, month: number, minIso: string): boolean {
  const [minYear, minMonth] = minIso.split('-').map(Number);
  return year < minYear || (year === minYear && month + 1 <= minMonth);
}

/** Keep the optional expected return as the existing Philippine wall-time form value. */
export function withExpectedReturnDate(current: string, date: string, bad = false): string {
  if (bad) return 'invalid';
  if (!date) return ''; // Calendar Clear removes the optional date and time together.
  const [, time = ''] = current.split('T');
  return `${date}T${time}`;
}

export function withExpectedReturnTime(current: string, time: string): string {
  const [date = ''] = current.split('T');
  if (!time) return date ? `${date}T` : '';
  return `${date}T${time}`;
}

export function expectedReturnError(value: string, error?: string, nowMs = Date.now()): string | undefined {
  if (!error) return undefined;
  const [date = '', time = ''] = value.split('T');
  if ((!date || /^\d{4}-\d{2}-\d{2}$/.test(date)) && (!date || !time)) {
    return 'Please select both a date and time, or leave both empty.';
  }
  if (error === 'The return time must be in the future.') {
    const today = philippineDateKey(new Date(nowMs));
    if (date < today) return 'Please select today or a future date.';
    if (date === today && time && parsePhilippineInputValue(value)) {
      return 'Expected return must be later than the current Philippine time.';
    }
  }
  return error;
}
