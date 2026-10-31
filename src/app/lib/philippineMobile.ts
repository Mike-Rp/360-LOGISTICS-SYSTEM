export interface PhilippineMobile {
  subscriber: string;
  international: string;
  display: string;
}

/** Parse supported PH mobile formats without changing the stored value. */
export function parsePhilippineMobile(raw: string): PhilippineMobile | null {
  const value = raw.trim();
  if (!value || !/^\+?[\d\s().-]+$/.test(value)) return null;

  const digits = value.replace(/\D/g, '');
  let subscriber: string;
  if (/^639\d{9}$/.test(digits)) subscriber = digits.slice(2);
  else if (/^09\d{9}$/.test(digits)) subscriber = digits.slice(1);
  else if (/^9\d{9}$/.test(digits)) subscriber = digits;
  else return null;

  if (value.startsWith('+') && !digits.startsWith('63')) return null;
  return { subscriber, international: `+63${subscriber}`, display: `+63 ${subscriber}` };
}

/** Why the 10 digits typed after "+63" are not a usable mobile number yet — '' when they are.
    Shared by the forms that use the "+63 [ten digits]" field. */
export function subscriberProblem(digits: string): string {
  if (digits.length !== 10) return 'Enter a valid 10-digit mobile number.';
  if (!digits.startsWith('9')) return 'Mobile number must start with 9 (e.g. 9XX XXX XXXX).';
  return '';
}
