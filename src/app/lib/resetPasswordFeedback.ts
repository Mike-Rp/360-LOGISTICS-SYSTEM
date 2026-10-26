export const CSR_RESET_ERROR_CODES = [
  'reset_link_invalid_or_expired', 'password_too_short', 'password_too_long',
  'weak_password', 'password_reused', 'invalid_request', 'reset_failed',
] as const;

export type CsrPasswordResetErrorCode = typeof CSR_RESET_ERROR_CODES[number];
export type ResetPasswordField = 'new' | 'confirm' | 'general';
export type ResetPasswordFeedback = { field: ResetPasswordField; message: string };

export function normalizeCsrPasswordResetError(code: unknown): CsrPasswordResetErrorCode {
  return typeof code === 'string' && (CSR_RESET_ERROR_CODES as readonly string[]).includes(code)
    ? code as CsrPasswordResetErrorCode
    : 'reset_failed';
}

const feedback: Record<CsrPasswordResetErrorCode, ResetPasswordFeedback> = {
  reset_link_invalid_or_expired: { field: 'general', message: 'This reset link is invalid or has expired. Ask your OPM administrator for a new reset link.' },
  password_too_short: { field: 'new', message: 'Password is too short.' },
  password_too_long: { field: 'new', message: 'Password is too long.' },
  weak_password: { field: 'new', message: 'Choose a stronger password.' },
  password_reused: { field: 'new', message: 'Your new password must be different from your current password.' },
  invalid_request: { field: 'general', message: 'This reset link is invalid or incomplete.' },
  reset_failed: { field: 'general', message: 'Password could not be changed. Please try again or request a new link.' },
};

export function resetPasswordFeedback(code: unknown): ResetPasswordFeedback {
  return feedback[normalizeCsrPasswordResetError(code)];
}

export function validateResetPassword(password: string, confirmation: string): ResetPasswordFeedback | null {
  if (!password) return { field: 'new', message: 'Enter a new password.' };
  if (password.length < 6) return { field: 'new', message: 'Password is too short.' };
  if (new TextEncoder().encode(password).length > 72) return { field: 'new', message: 'Password is too long.' };
  if (password !== confirmation) return { field: 'confirm', message: 'Passwords do not match.' };
  return null;
}

export function clearResetPasswordFeedback(
  error: ResetPasswordFeedback | null,
  field: 'new' | 'confirm',
): ResetPasswordFeedback | null {
  return error?.field === field ? null : error;
}
