const MANILA_TIME_ZONE = 'Asia/Manila';
const FILIPINO_WEEKDAYS: Record<string, string> = {
  Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miyerkules', Thursday: 'Huwebes',
  Friday: 'Biyernes', Saturday: 'Sabado', Sunday: 'Linggo',
};

function dateParts(date: Date, locale: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: MANILA_TIME_ZONE, ...options })
    .formatToParts(date).map(({ type, value }) => [type, value]));
}

export function manilaDateKey(date: Date): string {
  const parts = dateParts(date, 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDriverHomeDate(date: Date, language: 'en' | 'fil'): string {
  const parts = dateParts(date, language === 'fil' ? 'fil-PH' : 'en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });
  const weekday = language === 'fil' && !Object.values(FILIPINO_WEEKDAYS).includes(parts.weekday)
    ? FILIPINO_WEEKDAYS[dateParts(date, 'en-US', { weekday: 'long' }).weekday] ?? parts.weekday
    : parts.weekday;
  return `${weekday}, ${parts.month} ${parts.day}, ${parts.year}`;
}

export function msUntilNextManilaDay(date: Date): number {
  const parts = dateParts(date, 'en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000
    + date.getMilliseconds();
  return Math.max(1, 86_400_000 - elapsed + 50);
}
