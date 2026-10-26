import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Assignment, LocalTruck } from '../../data/assignmentTypes';
import { getAssignmentDocumentProgress } from '../../lib/assignmentWorkflow';
import { getAssignmentRoute, getDeliveryLocation } from '../../data/assignmentRoute';
import { formatOperationalStamp } from '../../lib/assignmentOperational';
import { splitDisplayDateTime } from '../../lib/displayDateTime';
import { statusColors } from '../../data/statusColors';
import { adminHref, pushAdminNavigation } from '../../lib/adminNavigation';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import ASNWithCopy from './ASNWithCopy';
import DocumentsSummaryCard from './DocumentsSummaryCard';
import { OperationalEvidence, type OperationalPhotoSelection } from './ShipmentPhotoEvidence';
import UploadedFilePreviewModal from './UploadedFilePreviewModal';

function SummaryField({ label, value, emphasized = false }: { label: string; value?: string | null; emphasized?: boolean }) {
  return <div className="min-w-0">
    <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
    <dd className={`mt-0.5 break-words [overflow-wrap:anywhere] text-sm text-foreground ${emphasized ? 'font-bold' : 'font-medium'}`}>{value || '—'}</dd>
  </div>;
}

function SummaryDateTimeField({ label, value }: { label: string; value?: string | null }) {
  const stamp = splitDisplayDateTime(value);
  return <div className="min-w-0">
    <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 flex flex-col text-sm font-medium text-foreground">
      <span className="whitespace-nowrap">{stamp?.date ?? '—'}</span>
      {stamp?.time && <span className="whitespace-nowrap">{stamp.time}</span>}
    </dd>
  </div>;
}

export default function CompletedDeliverySummary({ assignment, truck, onClose }: {
  assignment: Assignment | null;
  truck?: LocalTruck;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<OperationalPhotoSelection | null>(null);
  const [expandedPhotoGroup, setExpandedPhotoGroup] = useState<string | null>(null);
  useEffect(() => {
    setExpandedPhotoGroup(null);
    setPreview(null);
  }, [assignment?.id]);
  const docs = assignment ? getAssignmentDocumentProgress(assignment) : null;
  const deliveredAt = assignment
    ? formatOperationalStamp(assignment.unloadingCompletedAt) ?? assignment.statusPhotos?.Delivered?.timestamp ?? null
    : null;

  return <Dialog open={!!assignment} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent aria-describedby="delivery-summary-description"
      onEscapeKeyDown={(event) => { if (preview) { event.preventDefault(); setPreview(null); } }}
      className="top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(88vh,820px)] sm:max-h-[820px] sm:w-[94vw] sm:max-w-[960px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
      <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-4 pr-12 text-left sm:px-6 sm:py-5">
        <DialogTitle className="text-xl">Delivery Summary</DialogTitle>
        <DialogDescription id="delivery-summary-description" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {assignment && <ASNWithCopy value={assignment.id}>{assignment.id}</ASNWithCopy>}
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${statusColors.Completed.badge}`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed
          </span>
          {docs?.allApproved && <span>All {docs.required} required documents approved</span>}
        </DialogDescription>
      </DialogHeader>

      {assignment && <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div className="min-w-0 space-y-5">
            <section aria-labelledby="completed-shipment-heading" className="rounded-xl border border-border bg-white p-4">
              <h3 id="completed-shipment-heading" className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Shipment Details</h3>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 min-[430px]:grid-cols-2">
                <SummaryField label="Truck Plate" value={assignment.truckPlate} />
                <SummaryField label="Classification" value={truck?.classification} />
                <SummaryField label="Driver" value={assignment.driverName} emphasized />
                <SummaryField label="Client" value={assignment.company} />
              </dl>
              <dl className="mt-4 space-y-4 border-t border-border pt-4">
                <SummaryField label="Route" value={getAssignmentRoute(assignment)} />
                <SummaryField label="Pickup Location" value={assignment.pickupLocation} />
                <SummaryField label="Delivery Location" value={getDeliveryLocation(assignment)} />
              </dl>
              <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-border pt-4 min-[390px]:grid-cols-2">
                <SummaryDateTimeField label="Scheduled Pickup" value={[assignment.pickedUpDate, assignment.pickupTime].filter(Boolean).join(' · ')} />
                <SummaryDateTimeField label="Picked Up At" value={assignment.departedAt} />
                <SummaryDateTimeField label="Delivered At" value={deliveredAt} />
              </dl>
            </section>

            <DocumentsSummaryCard count={`${docs?.approved ?? 0} of ${docs?.required ?? 0} approved`}
              href={adminHref('Documents', { assignmentId: assignment.id })}
              onActivate={() => { onClose(); pushAdminNavigation('Documents', { assignmentId: assignment.id }); }} />
          </div>

          <OperationalEvidence assignment={assignment} expandedGroup={expandedPhotoGroup}
            onExpand={setExpandedPhotoGroup} onPreview={setPreview} />
        </div>
      </div>}

      <div className="shrink-0 border-t border-border bg-white px-4 py-3 text-right sm:px-6">
        <DialogClose className="min-h-10 rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground hover:bg-muted/30">Close</DialogClose>
      </div>
      {preview && <UploadedFilePreviewModal key={`${preview.assignmentId}:${preview.slotKey}`} url={preview.photo.url}
        title={preview.title} kind="image" timestamp={preview.photo.timestamp} operationalPhoto={preview.photo}
        assignmentId={preview.assignmentId} onClose={() => setPreview(null)} />}
    </DialogContent>
  </Dialog>;
}
