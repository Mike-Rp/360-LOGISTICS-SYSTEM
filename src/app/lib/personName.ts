/* The one rule for a person's name (drivers, team members, own profile).
   Letters of any language (so Ñ, ñ, é and the like are fine), spaces, apostrophes,
   hyphens and periods; it must start with a letter. Mirrors the database's
   '^[[:alpha:]][[:alpha:][:space:]''.-]*$' — the server is the real gate. */
export const PERSON_NAME_PATTERN = /^\p{L}[\p{L}\s'.-]*$/u;
export const PERSON_NAME_MAX_LENGTH = 100;

export function isValidPersonName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= PERSON_NAME_MAX_LENGTH && PERSON_NAME_PATTERN.test(trimmed);
}
