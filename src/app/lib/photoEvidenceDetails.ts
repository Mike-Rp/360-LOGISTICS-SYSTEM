import type { StatusPhoto } from '../data/assignmentTypes';
import { formatOperationalStamp } from './assignmentOperational';

export type PhotoDetailRow = { label: string; value: string };
export type OperationalPhotoSelection = {
  assignmentId: string;
  slotKey: string;
  title: string;
  photo: StatusPhoto;
};

export function selectOperationalPhoto(
  assignmentId: string, slotKey: string, title: string, photo: StatusPhoto,
): OperationalPhotoSelection {
  return { assignmentId, slotKey, title, photo };
}

/** Presentation only: every value comes from the selected, persisted photo. */
export function getPhotoEvidenceDetails(photo: StatusPhoto): { rows: PhotoDetailRow[]; locationNote: string | null } {
  const label = photo.location?.trim();
  const location = label && !['location unavailable', 'location not supported'].includes(label.toLowerCase())
    ? label : null;
  const coords = photo.coords && Number.isFinite(photo.coords.lat) && Number.isFinite(photo.coords.lng)
    && Math.abs(photo.coords.lat) <= 90 && Math.abs(photo.coords.lng) <= 180
    ? `${photo.coords.lat.toFixed(5)}, ${photo.coords.lng.toFixed(5)}` : null;
  const accuracy = typeof photo.gpsAccuracyM === 'number' && Number.isFinite(photo.gpsAccuracyM)
    && photo.gpsAccuracyM >= 0
    ? `±${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(photo.gpsAccuracyM)} meters`
    : 'Not available';
  const source = photo.source === 'camera' ? 'Camera'
    : photo.source === 'gallery' ? 'Gallery'
      : photo.source === 'unknown' ? 'Unknown' : 'Not available';
  const rows: PhotoDetailRow[] = [
    { label: 'Recorded Location', value: location ?? coords ?? 'Location unavailable' },
    ...(location && coords ? [{ label: 'GPS Coordinates', value: coords }] : []),
    { label: 'GPS Accuracy', value: accuracy },
    { label: 'Photo Source', value: source },
    { label: 'Uploaded At', value: formatOperationalStamp(photo.uploadedAt) ?? 'Not available' },
  ];
  const gpsChecked = formatOperationalStamp(photo.gpsObservedAt);
  if (gpsChecked) rows.push({ label: 'GPS Checked At', value: gpsChecked });
  const received = photo.source === 'camera' ? formatOperationalStamp(photo.captureObservedAt) : null;
  if (received) rows.push({ label: 'Photo Received by App', value: received });
  const locationNote = location || coords
    ? photo.source === 'gallery'
      ? 'Device location recorded during upload, not the original photo location.'
      : 'Device location recorded during upload.'
    : null;
  return { rows, locationNote };
}
