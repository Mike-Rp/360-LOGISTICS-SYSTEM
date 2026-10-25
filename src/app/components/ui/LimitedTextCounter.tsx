export const STANDARD_REMARK_LIMIT = 255;

export function withinTextLimit(value: string, max = STANDARD_REMARK_LIMIT): boolean {
  return value.length <= max;
}

export function validRequiredLimitedText(value: string, max = STANDARD_REMARK_LIMIT): boolean {
  return value.trim().length > 0 && withinTextLimit(value, max);
}

export function LimitedTextCounter({ value, max = STANDARD_REMARK_LIMIT }: { value: string; max?: number }) {
  const count = value.length;
  const tone = count >= max ? 'text-amber-700' : count >= max - 25 ? 'text-amber-600' : 'text-muted-foreground';
  return <span className={`block text-right text-sm font-medium tabular-nums ${tone}`}>{count}/{max}</span>;
}
