import { type Assignment, type CompletedTask, type LocalDriver, type LocalTruck } from '../data/assignmentTypes';
import { completionTime } from './completedOrdering';
import { getAssignmentDocumentProgress } from './assignmentWorkflow';

export type ContinuationSnapshot = {
  completed: CompletedTask[];
  active: Assignment[];
  cancelled: Assignment[];
  drivers: LocalDriver[];
  trucks: LocalTruck[];
};

/** A conservative display candidate. The server must repeat these checks before creation. */
export function continuationCandidate(source: CompletedTask, snapshot: ContinuationSnapshot): boolean {
  const finishedAt = completionTime(source);
  if (!finishedAt || source.taskStatus !== 'Delivered' || !source.driverId || !source.truckId) return false;
  if (!getAssignmentDocumentProgress(source).allApproved) return false;
  const driver = snapshot.drivers.find((item) => item.id === source.driverId);
  const truck = snapshot.trucks.find((item) => item.id === source.truckId);
  if (!driver || driver.archivedAt || driver.unavailable ||
      !truck || truck.archivedAt || truck.unavailable || truck.status !== 'Available') return false;
  if (snapshot.active.some((item) => item.driverId === source.driverId || item.truckId === source.truckId)) return false;
  // A source with a later assignment for either resource is historical, not a current continuation.
  if (snapshot.completed.some((item) => item.id !== source.id &&
      (item.driverId === source.driverId || item.truckId === source.truckId) &&
      (completionTime(item) ?? Infinity) >= finishedAt)) return false;
  if (snapshot.cancelled.some((item) =>
      (item.driverId === source.driverId || item.truckId === source.truckId) &&
      (!item.createdAt || Date.parse(item.createdAt) >= finishedAt))) return false;
  return true;
}

export function latestRecordedPhotoLocation(source: CompletedTask): { location: string; observedAt: string } | null {
  const photos = Object.values(source.statusPhotos ?? {}).filter((photo) =>
    photo?.coords && photo.gpsObservedAt && Number.isFinite(Date.parse(photo.gpsObservedAt)));
  const latest = photos.sort((a, b) => Date.parse(b.gpsObservedAt!) - Date.parse(a.gpsObservedAt!))[0];
  return latest ? { location: latest.location || `${latest.coords!.lat}, ${latest.coords!.lng}`, observedAt: latest.gpsObservedAt! } : null;
}
