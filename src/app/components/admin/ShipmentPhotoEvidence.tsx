import { AlertTriangle, Check, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Assignment, StatusPhoto } from '../../data/assignmentTypes';
import { OPERATIONAL_PHOTO_GROUPS, findGroupLocationOutliers } from '../../lib/assignmentOperational';
import { splitDisplayDateTime } from '../../lib/displayDateTime';

export function OperationalPhotoItem({ groupTitle, label, photo, required = true, locationFlagged = false, onPreview }: {
  groupTitle: string;
  label: string;
  photo?: StatusPhoto;
  required?: boolean;
  /** This photo's own GPS is far from the rest of its group's — a derived cross-check, not proof of anything wrong. */
  locationFlagged?: boolean;
  onPreview: (url: string, type: string, timestamp?: string) => void;
}) {
  const labelRow = <div className="mt-2">
    <span className="break-words text-sm font-medium text-foreground">{label}</span>
  </div>;

  if (!photo?.url) return <div className="min-w-0 py-1">
    {labelRow}
    <p className={`mt-1 text-[13px] ${required ? 'text-red-700' : 'text-muted-foreground'}`}>
      {required ? 'Required photo missing' : 'Not provided'}
    </p>
  </div>;

  const timestamp = splitDisplayDateTime(photo.timestamp);
  const recordedLocation = photo.location && !['Location unavailable', 'Location not supported'].includes(photo.location)
    ? photo.location : null;
  const deviceLocation = recordedLocation || (photo.coords
    ? `${photo.coords.lat.toFixed(5)}, ${photo.coords.lng.toFixed(5)}` : null);
  return <div className="min-w-0">
    <button type="button" onClick={() => onPreview(photo.url, `${groupTitle} · ${label}`, photo.timestamp)}
      className="group relative block w-full overflow-hidden rounded-md bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      aria-label={`View ${groupTitle} ${label} photo`}>
      <span className="flex h-28 w-full items-center justify-center sm:h-32">
        <img src={photo.url} alt="" loading="lazy" className="h-full w-full object-contain" />
      </span>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 bg-slate-900/45 text-sm font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <Eye className="h-4 w-4" /> View image
      </span>
    </button>
    {labelRow}
    {timestamp && <div className="mt-0.5 flex flex-col text-xs leading-[1.35] sm:text-[13px]">
      <span className="whitespace-nowrap text-muted-foreground">{timestamp.date}</span>
      {timestamp.time && <span className="whitespace-nowrap text-foreground/65">{timestamp.time}</span>}
    </div>}
    {deviceLocation && <p className="mt-1 break-words text-xs text-muted-foreground">
      Recorded location: {deviceLocation}
    </p>}
    {locationFlagged && (
      <p className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Far from this group's other photos — worth a second look.
      </p>
    )}
  </div>;
}

/** Shared read-only evidence accordion for active shipments and completed summaries. */
export function OperationalEvidence({ assignment, onPreview, expandedGroup, onExpand }: {
  assignment: Assignment;
  onPreview: (url: string, type: string, timestamp?: string) => void;
  expandedGroup: string | null;
  onExpand: (group: string | null) => void;
}) {
  const photos = assignment.statusPhotos ?? {};
  const groupRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (!expandedGroup) return;
    const button = groupRefs.current[expandedGroup];
    button?.scrollIntoView({ block: 'nearest' });
    button?.focus({ preventScroll: true });
  }, [expandedGroup]);
  const legacy = (['Picked Up', 'In Transit', 'Delivered'] as const)
    .map((key) => ({ key, label: key, photo: photos[key] })).filter((slot) => !!slot.photo?.url);
  const groups = [
    ...OPERATIONAL_PHOTO_GROUPS.map((group) => {
      const slots = group.slots.map(([key, label]) => ({ key, label, photo: photos[key] }));
      // Legacy single-milestone photos are taken at genuinely different times/places —
      // outlier detection only makes sense within one same-moment photo group.
      return { title: group.title, slots, outliers: findGroupLocationOutliers(slots.map((s) => ({ key: s.key, coords: s.photo?.coords }))) };
    }),
    ...(legacy.length ? [{ title: 'Earlier Status Photos', slots: legacy, outliers: new Set<string>() }] : []),
  ];
  return <section aria-label="Operational Photos" className="space-y-2">
    <p className="text-sm font-semibold text-foreground">Operational Photos</p>
    {groups.map((group) => {
      const count = group.slots.filter((slot) => !!slot.photo?.url).length;
      const open = expandedGroup === group.title;
      const isAngles = group.title === 'At Pickup' || group.title === 'Pre-trip';
      const isLegacy = group.title === 'Earlier Status Photos';
      const complete = count === group.slots.length;
      const description = group.title === 'At Pickup'
        ? `${count}/4 required truck-condition photos`
        : group.title === 'Pre-trip' ? `${count}/4 required photos`
        : group.title === 'Unloading' ? `${count}/2 required photos`
        : group.title === 'Loading' ? `${count}/2 required photos` : `${count} earlier status photos`;
      return <div key={group.title} className="overflow-hidden rounded-xl border border-border bg-white">
        <button type="button" aria-expanded={open} ref={(node) => { groupRefs.current[group.title] = node; }}
          onClick={() => onExpand(open ? null : group.title)}
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-blue-500">
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${complete ? 'bg-green-100 text-green-700' : 'border border-amber-300 bg-amber-50 text-amber-700'}`}>
              {complete && <Check className="h-3.5 w-3.5" />}
            </span>
            <span className="text-[15px] font-semibold text-foreground">{group.title}</span>
            {group.outliers.size > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700" title="A photo's GPS is far from the rest of this group's">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Location mismatch
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
            {count}{isLegacy ? '' : `/${group.slots.length}`}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
        {open && <div className="border-t border-border px-4 pb-4 pt-3">
          <p className="mb-3 text-[13px] text-muted-foreground">{description}</p>
          <div className={`grid gap-x-3 gap-y-4 sm:gap-x-4 ${isAngles ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 min-[430px]:grid-cols-2'}`}>
            {group.slots.map(({ key, label, photo }) => <OperationalPhotoItem key={key}
              groupTitle={group.title} label={label} photo={photo} locationFlagged={group.outliers.has(key)}
              onPreview={onPreview} />)}
          </div>
          {group.title === 'Loading' && assignment.loadingRemark && (
            <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-[13px] text-foreground">
              <span className="font-medium">Driver's note:</span> {assignment.loadingRemark}
            </p>
          )}
          {group.title === 'Unloading' && assignment.unloadingRemark && (
            <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-[13px] text-foreground">
              <span className="font-medium">Driver's note:</span> {assignment.unloadingRemark}
            </p>
          )}
        </div>}
      </div>;
    })}
  </section>;
}
