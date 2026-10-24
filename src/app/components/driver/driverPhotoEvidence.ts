import type { StatusPhoto } from '../../data/assignmentTypes';

export type GpsAccuracyLevel = 'good' | 'approximate' | 'low';

/** The original time and location of a gallery file are unverified. */
export function galleryPhotoMetadata(url: string): StatusPhoto {
  return { url, timestamp: '', location: '' };
}

/** The gallery's existing image timestamp is unknown; stamp only after Storage succeeds. */
export function savedPhotoMetadata(photo: StatusPhoto, source: 'camera' | 'gallery', url: string, uploadedAt: string): StatusPhoto {
  return { ...photo, url, timestamp: source === 'gallery' ? uploadedAt : photo.timestamp };
}

/** Geolocation API accuracy is a reported radius in meters, not proof of an exact address. */
export function gpsAccuracyLevel(meters?: number | null): GpsAccuracyLevel | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  if (meters <= 50) return 'good';
  if (meters <= 100) return 'approximate';
  return 'low';
}

/** Keep a delayed GPS response tied to both the selected image and latest refresh. */
export function isCurrentPhotoLocationRequest(
  selection: number, request: number, currentSelection: number, currentRequest: number,
): boolean {
  return selection === currentSelection && request === currentRequest;
}

/** A preview reading older than five minutes needs a fresh check before submission. */
export function isPhotoLocationStale(observedAt: string | null, now: number): boolean {
  if (!observedAt) return false;
  const time = Date.parse(observedAt);
  return !Number.isFinite(time) || now - time > 5 * 60_000 || time - now > 60_000;
}
