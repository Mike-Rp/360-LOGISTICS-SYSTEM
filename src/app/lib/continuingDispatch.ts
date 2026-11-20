import { type Assignment, type CompletedTask, type LocalDriver, type LocalTruck } from '../data/assignmentTypes';
import { completionTime } from './completedOrdering';
import { getAssignmentDocumentProgress } from './assignmentWorkflow';
import { PSGC_REGIONS, type GeoSelection } from './philippineAddress';

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
  const sourceCreatedAt = Date.parse(source.createdAt ?? '');
  if (!finishedAt || !Number.isFinite(sourceCreatedAt) || source.taskStatus !== 'Delivered'
      || !source.driverId || !source.truckId) return false;
  if (!getAssignmentDocumentProgress(source).allApproved) return false;
  const driver = snapshot.drivers.find((item) => item.id === source.driverId);
  const truck = snapshot.trucks.find((item) => item.id === source.truckId);
  if (!driver || driver.archivedAt || driver.unavailable ||
      !truck || truck.archivedAt || truck.unavailable || truck.status !== 'Available') return false;
  if (snapshot.active.some((item) => item.driverId === source.driverId || item.truckId === source.truckId)) return false;
  // The database checks creation order, not the potentially later completion order.
  if ([...snapshot.completed, ...snapshot.cancelled].some((item) => {
    if (item.id === source.id || (item.driverId !== source.driverId && item.truckId !== source.truckId)) return false;
    const createdAt = Date.parse(item.createdAt ?? '');
    const completedAt = 'completedAt' in item ? completionTime(item as CompletedTask) : null;
    const cancelledAt = Date.parse(item.cancelledAt ?? '');
    return !Number.isFinite(createdAt) || createdAt >= sourceCreatedAt
      || (completedAt !== null && completedAt >= finishedAt)
      || (Number.isFinite(cancelledAt) && cancelledAt >= finishedAt);
  })) return false;
  return true;
}

export function latestRecordedPhotoLocation(source: CompletedTask): { location: string; observedAt: string } | null {
  const photos = Object.values(source.statusPhotos ?? {}).filter((photo) =>
    photo?.coords && photo.gpsObservedAt && Number.isFinite(Date.parse(photo.gpsObservedAt)));
  const latest = photos.sort((a, b) => Date.parse(b.gpsObservedAt!) - Date.parse(a.gpsObservedAt!))[0];
  return latest ? { location: latest.location || `${latest.coords!.lat}, ${latest.coords!.lng}`, observedAt: latest.gpsObservedAt! } : null;
}

const geographicName = (value: string) => value.normalize('NFC').toLocaleLowerCase('en-PH')
  .replace(/[()\u2013\u2014.-]/g, ' ').replace(/\s+/g, ' ').trim();

function regionFromDestinationText(value: string | null | undefined): string | null {
  const parts = value?.split(',').map(geographicName).filter(Boolean) ?? [];
  // A single free-text place name cannot establish its administrative parent.
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const byRegion = PSGC_REGIONS.filter((region) => geographicName(region.name) === last);
  if (byRegion.length === 1) {
    const precedingProvince = PSGC_REGIONS.flatMap((region) => region.provinces.map((province) =>
      ({ regionCode: region.code, name: geographicName(province.name) })))
      .filter((province) => province.name === parts[parts.length - 2]);
    if (precedingProvince.length && !precedingProvince.some((province) => province.regionCode === byRegion[0].code)) return null;
    return byRegion[0].code;
  }
  const byProvince = PSGC_REGIONS.filter((region) => region.provinces.some((province) =>
    geographicName(province.name) === last));
  return byProvince.length === 1 ? byProvince[0].code : null;
}

/** Return a PSGC code only when saved destination text names one unambiguous region or province. */
export function suggestedPickupRegionCode(destinationArea: string | null | undefined,
  deliveryLocation: string | null | undefined, routeDestination?: string | null): string | null {
  const matches = [destinationArea, deliveryLocation, routeDestination]
    .map(regionFromDestinationText).filter((code): code is string => !!code);
  return matches.length && matches.every((code) => code === matches[0]) ? matches[0] : null;
}

/** An untouched form may take a suggestion; a CSR draft or saved address always wins. */
export function canSuggestPickupRegion(selection: GeoSelection, specific: string, saved: boolean,
  previousSuggestionOnly: boolean): boolean {
  return !saved && !specific.trim() && !selection.provinceCode && !selection.cityCode && !selection.barangayCode
    && (!selection.regionCode || previousSuggestionOnly);
}
