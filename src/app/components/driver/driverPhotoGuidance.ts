import type { Assignment } from '../../data/assignmentTypes';

/** Uses only photos that have a saved URL from the existing upload flow. */
export function getRequiredPhotoProgress(
  keys: readonly string[],
  photos: Assignment['statusPhotos'],
) {
  const captured = keys.filter((key) => !!photos?.[key]?.url).length;
  const nextMissing = keys.find((key) => !photos?.[key]?.url) ?? null;
  return { captured, total: keys.length, nextMissing };
}
