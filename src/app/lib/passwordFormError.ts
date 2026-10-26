import type { PasswordErrorCode } from './db';

export type PasswordField = 'current' | 'new' | 'confirm' | 'general';
export type PasswordFormError = { field: PasswordField; message: string };

export function validatePasswordForm(current: string, next: string, confirmation: string): PasswordFormError | null {
  if (!current) return { field: 'current', message: 'Enter your current password.' };
  if (next.length < 8) return { field: 'new', message: 'New password must be at least 8 characters.' };
  if (next !== confirmation) return { field: 'confirm', message: 'New passwords do not match.' };
  return null;
}

export function passwordUpdateError(code: PasswordErrorCode): PasswordFormError {
  switch (code) {
    case 'wrong_current': return { field: 'current', message: 'Your current password is incorrect.' };
    case 'same_password': return { field: 'new', message: 'The new password must be different from your current one.' };
    case 'weak_password': return { field: 'new', message: 'That password is too weak. Try a longer or less common one.' };
    case 'not_signed_in': return { field: 'general', message: 'Your session has expired. Please sign in again.' };
    case 'network': return { field: 'general', message: 'Could not update the password. Check your connection and try again.' };
  }
}
