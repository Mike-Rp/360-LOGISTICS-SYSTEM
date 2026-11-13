import { isValidPersonName, PERSON_NAME_MAX_LENGTH } from './personName';

export type TeamMemberField = 'name' | 'email';
export type TeamMemberFieldErrors = Partial<Record<TeamMemberField, string>>;

export function teamMemberNameError(value: string): string | undefined {
  if (!value.trim()) return 'Name is required.';
  if (value.trim().length > PERSON_NAME_MAX_LENGTH) return `Name must be ${PERSON_NAME_MAX_LENGTH} characters or fewer.`;
  if (!isValidPersonName(value)) return 'Names can only contain letters, spaces, apostrophes, hyphens and periods.';
}

export function teamMemberEmailError(value: string): string | undefined {
  if (!value.trim()) return 'Email is required.';
  // Keep the form's basic email policy while rejecting extra @ signs and empty domain labels.
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value.trim())) return 'Enter a valid email address.';
}

export function validateTeamMemberFields(name: string, email: string): TeamMemberFieldErrors {
  return { name: teamMemberNameError(name), email: teamMemberEmailError(email) };
}

/** Preserve canonical backend field errors through the data layer. Unknown failures
 * remain general; never infer a field by matching a user's name or email in text. */
export class TeamMemberCreationError extends Error {
  readonly field: TeamMemberField | 'general';
  constructor(code: string) {
    const errors: Record<string, { field: TeamMemberField | 'general'; message: string }> = {
      invalid_name: { field: 'name', message: 'Names can only contain letters, spaces, apostrophes, hyphens and periods.' },
      name_too_long: { field: 'name', message: `Name must be ${PERSON_NAME_MAX_LENGTH} characters or fewer.` },
      invalid_email: { field: 'email', message: 'Enter a valid email address.' },
      email_exists: { field: 'email', message: 'A member with that email already exists' },
      not_authorized: { field: 'general', message: 'Only the Operation Manager can add team members.' },
      missing_fields: { field: 'general', message: 'Name and email are required.' },
    };
    const error = errors[code] ?? { field: 'general' as const, message: 'Could not add this team member. Please try again.' };
    super(error.message);
    this.name = 'TeamMemberCreationError';
    this.field = error.field;
  }
}

export function teamMemberCreationFailure(message: string): TeamMemberCreationError {
  const code = ['email_exists', 'not_authorized', 'invalid_name', 'name_too_long', 'invalid_email', 'missing_fields']
    .find((candidate) => new RegExp(`\\b${candidate}\\b`).test(message));
  return new TeamMemberCreationError(code ?? 'unknown');
}
