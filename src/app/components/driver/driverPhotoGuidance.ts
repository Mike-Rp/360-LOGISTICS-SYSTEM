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

/** Navigation only: mirrors the photos already required by each operational stage. */
export function getNextRequiredPhoto(
  phase: string,
  photos: Assignment['statusPhotos'],
): string | null {
  const pickup = ['pickup_front', 'pickup_left', 'pickup_right', 'pickup_rear'];
  const pretrip = ['pretrip_front', 'pretrip_left', 'pretrip_right', 'pretrip_rear'];
  const keys = phase === 'pickup' ? [...pickup, 'loading_before']
    : phase === 'loading' ? ['loading_after']
      : phase === 'pretrip' ? pretrip
        : phase === 'arrived' ? ['unloading_before']
          : phase === 'unloading' ? ['unloading_after'] : [];
  return getRequiredPhotoProgress(keys, photos).nextMissing;
}

/** True only when this successful save finishes a previously incomplete group. */
export function completedPhotoGroup(
  keys: readonly string[],
  before: Assignment['statusPhotos'],
  savedKey: string,
): boolean {
  return keys.includes(savedKey)
    && getRequiredPhotoProgress(keys, before).captured === keys.length - 1
    && keys.every((key) => key === savedKey || !!before?.[key]?.url);
}

/** Navigation priority matches the existing document shortcut: corrections, then missing uploads. */
export function getNextRequiredDocument(
  documents: Assignment['documents'] | undefined, requiredDocumentTypes: readonly string[],
): string | null {
  return requiredDocumentTypes.find((type) => documents?.some((document) =>
    document.type === type && document.uploaded && document.docStatus === 'rejected'))
    ?? requiredDocumentTypes.find((type) => !documents?.find((document) => document.type === type)?.uploaded)
    ?? null;
}

/** Documents become an on-page action only after delivery is persisted. */
export function getNextRequiredAction(
  phase: string,
  photos: Assignment['statusPhotos'],
  documents: Assignment['documents'],
  requiredDocumentTypes: readonly string[],
): string | null {
  const photo = getNextRequiredPhoto(phase, photos);
  if (photo) return photo;
  return phase === 'delivered' && getNextRequiredDocument(documents, requiredDocumentTypes) ? 'documents' : null;
}
