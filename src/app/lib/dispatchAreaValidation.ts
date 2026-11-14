const AREA_CHARACTERS = /^[A-Za-zñÑ .,]*$/;
const AREA_LETTER = /[A-Za-zñÑ]/;

export function dispatchAreaError(value: string, requiredMessage: string, final = false): string {
  if (!AREA_CHARACTERS.test(value)) return 'Only letters, spaces, periods (.), commas (,), and ñ are allowed.';
  if (!final) return '';
  if (!value.trim()) return requiredMessage;
  if (!AREA_LETTER.test(value)) return 'Enter an area with at least one letter.';
  return '';
}
