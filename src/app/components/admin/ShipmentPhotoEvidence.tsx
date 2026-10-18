import { Check, ChevronDown, ChevronUp, Eye, FileText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Assignment, StatusPhoto } from '../../data/assignmentTypes';
import { OPERATIONAL_PHOTO_GROUPS, formatOperationalStamp } from '../../lib/assignmentOperational';

function formatEvidenceTimestamp(value: string): string {
  const stamp = formatOperationalStamp(value) ?? value;
  const match = stamp.match(/^([A-Za-z]{3,9} \d{1,2}, \d{4})(?:,| ·)?\s+0?(\d{1,2}:\d{2}\s*[AP]M)$/i);
  return match ? `${match[1]} · ${match[2].replace(/\s+/g, ' ')}` : stamp;
}

export function OperationalPhotoItem({ groupTitle, label, photo, required = true, showRequiredLabel = false, onPreview }: {
  groupTitle: string;
  label: string;
  photo?: StatusPhoto;
  required?: boolean;
  showRequiredLabel?: boolean;
  onPreview: (url: string, type: string) => void;
}) {
  const labelRow = <div className="mt-2 flex items-baseline justify-between gap-2">
    <span className="break-words text-sm font-medium text-foreground">{label}</span>
    {showRequiredLabel && <span className="shrink-0 text-[13px] text-muted-foreground">{required ? 'Required' : 'Optional'}</span>}
  </div>;

  if (!photo?.url) return <div className="min-w-0 py-1">
    {labelRow}
    <p className={`mt-1 text-[13px] ${required ? 'text-red-700' : 'text-muted-foreground'}`}>
      {required ? 'Required photo missing' : 'Not provided'}
    </p>
  </div>;

  return <div className="min-w-0">
    <button type="button" onClick={() => onPreview(photo.url, `${groupTitle} · ${label}`)}
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
    {photo.timestamp && <p className="mt-0.5 text-[13px] text-muted-foreground">{formatEvidenceTimestamp(photo.timestamp)}</p>}
  </div>;
}

/** Shared read-only evidence accordion for active shipments and completed summaries. */
export function OperationalEvidence({ assignment, onPreview, expandedGroup, onExpand }: {
  assignment: Assignment;
  onPreview: (url: string, type: string) => void;
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
    ...OPERATIONAL_PHOTO_GROUPS.map((group) => ({
      title: group.title,
      slots: group.slots.map(([key, label]) => ({ key, label, photo: photos[key] })),
    })),
    ...(legacy.length ? [{ title: 'Earlier Status Photos', slots: legacy }] : []),
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
              groupTitle={group.title} label={label} photo={photo}
              showRequiredLabel={!isAngles && !isLegacy} onPreview={onPreview} />)}
          </div>
        </div>}
      </div>;
    })}
  </section>;
}

/** Shared viewer for operational photos and the existing shipment document preview. */
export function ImagePreviewModal({ url, docType, onClose }: { url: string; docType: string; onClose: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const isPdf = url.startsWith('data:application/pdf') || imgFailed;
  return <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{docType}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close image preview" className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/10">
        {isPdf ? <iframe src={url} className="w-full h-[500px] rounded-lg border border-border" title={docType} />
          : <img src={url} alt={docType} onError={() => setImgFailed(true)} className="max-w-full max-h-[500px] object-contain rounded-xl shadow-md" />}
      </div>
      <div className="px-5 py-3 border-t border-border flex-shrink-0">
        <a href={url} download={`${docType}.${isPdf ? 'pdf' : 'jpg'}`}
          className="text-xs text-primary underline hover:text-primary/80">Download file</a>
      </div>
    </div>
  </div>;
}
