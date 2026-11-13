import { useEffect, useState, useRef } from 'react';
import { X, UserX, Wrench, AlertTriangle } from 'lucide-react';
import {
  DRIVER_REASONS, NOTE_MAX_LENGTH, checkUnavailabilityForm,
  type UnavailabilityKind, type UnavailableReason,
} from '../../lib/unavailability';
import { toLocalInputValue } from '../../lib/fleetDelegation';
import { PHILIPPINE_TIME_LABEL, persistedTimestamp, philippineDateKey } from '../../lib/philippineTime';
import { useModalFocus } from './useModalFocus';
import { useModalBodyLock } from './useModalBodyLock';
import DiscardChangesDialog from './DiscardChangesDialog';
import { DateField, TimeField } from './ScheduleFields';
import { expectedReturnError, withExpectedReturnDate, withExpectedReturnTime } from './expectedReturnValue';

/* "Mark unavailable" (driver) / "Put under maintenance" (truck), and the same form to edit an active period.
   The database re-checks everything; this only explains problems before sending. `onSubmit` runs the real call
   and throws on failure — `errorText` turns that into the message shown here. */
export interface UnavailabilityDraft {
  reason: UnavailableReason;
  note: string;
  expectedReturn: Date | null;
}

export default function UnavailabilityDialog({
  kind, name, mode, initial, onSubmit, onCancel, errorText,
}: {
  kind: UnavailabilityKind;
  /** Driver name or truck plate. */
  name: string;
  /** 'edit' changes the note / return of an active period; the reason can't be changed. */
  mode: 'mark' | 'edit';
  initial?: { reason: UnavailableReason; note: string; expectedReturnAt: string | null };
  onSubmit: (draft: UnavailabilityDraft) => Promise<void>;
  onCancel: () => void;
  errorText: (err: unknown) => string;
}) {
  const isDriver = kind === 'driver';
  const [reason, setReason] = useState<string>(initial?.reason ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [returnValue, setReturnValue] = useState(() => {
    const saved = persistedTimestamp(initial?.expectedReturnAt);
    return saved ? toLocalInputValue(saved) : '';
  });
  const [returnDate = '', returnTime = ''] = returnValue.split('T');
  const useExpectedReturnPicker = mode === 'mark';
  const [nowMs, setNowMs] = useState(() => Date.now());
  const todayPht = philippineDateKey(new Date(nowMs));
  const [errors, setErrors] = useState<{ reason?: string; note?: string; returnAt?: string }>({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const modalRef = useRef<HTMLFormElement>(null);
  const original = useRef({ reason, note, returnValue });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const returnErrorFor = (value: string, atMs: number) => {
    const check = checkUnavailabilityForm({ kind, reason: isDriver ? reason : 'maintenance', note, returnValue: value, nowMs: atMs });
    return check.ok ? undefined : expectedReturnError(value, check.errors.returnAt, atMs);
  };
  useEffect(() => {
    if (!useExpectedReturnPicker) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [useExpectedReturnPicker]);
  useEffect(() => {
    if (useExpectedReturnPicker && returnValue) {
      setErrors((previous) => ({ ...previous, returnAt: returnErrorFor(returnValue, nowMs) }));
    }
  }, [nowMs]);
  const requestClose = () => {
    if (busy) return;
    if (reason !== original.current.reason || note !== original.current.note || returnValue !== original.current.returnValue) setConfirmDiscard(true);
    else onCancel();
  };
  useModalFocus(true, modalRef);
  useModalBodyLock(true);

  const title = mode === 'edit' ? 'Edit details' : isDriver ? 'Mark driver unavailable' : 'Put truck under maintenance';
  const Icon = isDriver ? UserX : Wrench;
  const noteRequired = isDriver && reason === 'other';
  const inputClass = (bad?: string) => `w-full px-3.5 py-2.5 rounded-xl border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${bad ? 'border-red-400 bg-red-50/40' : 'border-border'}`;

  const handleSubmit = async () => {
    if (busy) return;
    setSubmitError('');
    const submittedAt = Date.now();
    const check = checkUnavailabilityForm({ kind, reason: isDriver ? reason : 'maintenance', note, returnValue, originalReturnAt: initial?.expectedReturnAt, nowMs: submittedAt });
    if (!check.ok) {
      setErrors({ ...check.errors, returnAt: useExpectedReturnPicker ? expectedReturnError(returnValue, check.errors.returnAt, submittedAt) : check.errors.returnAt });
      const id = check.errors.reason ? 'unavailable-reason' : check.errors.note ? 'unavailable-note' : 'unavailable-return';
      modalRef.current?.querySelector<HTMLElement>(`#${id}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit({ reason: check.reason, note: check.note, expectedReturn: check.expectedReturn });
    } catch (err) {
      setSubmitError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <><div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />
      <form ref={modalRef} tabIndex={-1} noValidate onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} role="dialog" aria-modal="true" aria-labelledby="unavailability-title"
        className="relative flex max-h-[92dvh] min-w-0 w-full max-w-md flex-col rounded-2xl border border-border bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Icon className="h-4 w-4" aria-hidden="true" /></span>
            <div className="min-w-0">
              <h3 id="unavailability-title" className="text-base font-semibold text-foreground">{title}</h3>
              <p className="break-words text-sm text-muted-foreground">{name}</p>
            </div>
          </div>
          <button type="button" onClick={requestClose} disabled={busy} aria-label={`Close ${title.toLowerCase()}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto overflow-x-hidden px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {isDriver
              ? 'While unavailable, this driver cannot be given a delivery. A driver with an active delivery cannot be marked until it is completed or cancelled.'
              : 'While under maintenance, this truck cannot be given a delivery. A truck on an active delivery cannot be marked until it is completed or cancelled.'}
          </p>

          {isDriver ? (
            <div>
              <label htmlFor="unavailable-reason" className="mb-1.5 block text-sm font-medium text-foreground">Reason <span className="text-red-500">*</span></label>
              {mode === 'edit'
                ? <p className="rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-sm text-foreground">{DRIVER_REASONS.find((r) => r.value === reason)?.label ?? reason}</p>
                : <select id="unavailable-reason" value={reason} aria-invalid={errors.reason ? true : undefined} aria-describedby={errors.reason ? 'unavailable-reason-error' : undefined}
                    onChange={(e) => { setReason(e.target.value); setErrors((p) => ({ ...p, reason: undefined, note: undefined })); }}
                    className={inputClass(errors.reason)}>
                    <option value="">Choose a reason…</option>
                    {DRIVER_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>}
              {errors.reason && <p id="unavailable-reason-error" role="alert" className="mt-1 text-sm text-red-600">{errors.reason}</p>}
            </div>
          ) : (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-foreground">Reason</span>
              <p className="rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-sm text-foreground">Maintenance</p>
            </div>
          )}

          <div>
            <label htmlFor="unavailable-note" className="mb-1.5 block text-sm font-medium text-foreground">
              Note {noteRequired ? <span className="text-red-500">*</span> : <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
            </label>
            <textarea id="unavailable-note" value={note} rows={2} maxLength={NOTE_MAX_LENGTH + 20} aria-invalid={errors.note ? true : undefined} aria-describedby={errors.note ? 'unavailable-note-error' : undefined}
              onChange={(e) => { setNote(e.target.value); setErrors((p) => ({ ...p, note: undefined })); }}
              placeholder={isDriver ? 'e.g. Fever, back on Monday' : 'e.g. Brake repair at the shop'}
              className={`${inputClass(errors.note)} resize-none`} />
            <div className="mt-1 flex items-start justify-between gap-2">
              {errors.note ? <p id="unavailable-note-error" role="alert" className="text-sm text-red-600">{errors.note}</p> : <span />}
              <span className={`shrink-0 text-sm tabular-nums ${note.trim().length > NOTE_MAX_LENGTH ? 'text-red-600' : 'text-muted-foreground'}`}>{note.trim().length}/{NOTE_MAX_LENGTH}</span>
            </div>
          </div>

          <div>
            <label htmlFor="unavailable-return" className="mb-1.5 block text-sm font-medium text-foreground">
              Expected return <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </label>
            {useExpectedReturnPicker ? <div className="grid min-w-0 grid-cols-2 gap-2">
              <div className="min-w-0"><DateField id="unavailable-return" label="Expected return date" value={returnDate} layer compact popoverSide="top"
                minIso={todayPht} calendarToday={todayPht} restrictToday constrainMinMonth hasError={!!errors.returnAt}
                describedBy={`unavailable-return-help${errors.returnAt ? ' unavailable-return-error' : ''}`}
                onChange={(date, bad) => { const next = withExpectedReturnDate(returnValue, date, bad); setReturnValue(next); setErrors((p) => ({ ...p, returnAt: returnErrorFor(next, Date.now()) })); }} /></div>
              <div className="min-w-0"><TimeField id="unavailable-return-time" label="Expected return time" value={returnTime} layer compact popoverSide="top" hasError={!!errors.returnAt}
                describedBy={`unavailable-return-help${errors.returnAt ? ' unavailable-return-error' : ''}`}
                onChange={(time) => { const next = withExpectedReturnTime(returnValue, time); setReturnValue(next); setErrors((p) => ({ ...p, returnAt: returnErrorFor(next, Date.now()) })); }} /></div>
            </div> : <input id="unavailable-return" type="datetime-local" value={returnValue} aria-invalid={errors.returnAt ? true : undefined} aria-describedby={`unavailable-return-help${errors.returnAt ? ' unavailable-return-error' : ''}`}
              onChange={(e) => { setReturnValue(e.target.value); setErrors((p) => ({ ...p, returnAt: undefined })); }}
              className={`${inputClass(errors.returnAt)} min-w-0 max-w-full`} />}
            <p id="unavailable-return-help" className="mt-1 text-sm text-muted-foreground">{PHILIPPINE_TIME_LABEL}</p>
            {errors.returnAt && <p id="unavailable-return-error" role="alert" className="mt-1 text-sm text-red-600">{errors.returnAt}</p>}
            <p className="mt-1 text-sm text-muted-foreground">
              {useExpectedReturnPicker && returnValue && (!returnDate || !returnTime) ? 'Choose both a date and time, or clear Expected return.'
                : returnValue ? 'It ends by itself at this time.' : isDriver && reason === 'no_show'
                ? 'Left empty, a no-show ends at the end of today.'
                : `Left empty, ${isDriver ? 'they stay' : 'it stays'} ${isDriver ? 'unavailable' : 'under maintenance'} until you mark ${isDriver ? 'them' : 'it'} back.`}
            </p>
          </div>

          {submitError && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
              <p className="break-words text-sm text-red-700">{submitError}</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row">
          <button type="button" onClick={requestClose} disabled={busy}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm transition-colors hover:bg-accent disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy}
            className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50">
            {busy ? 'Saving…' : mode === 'edit' ? 'Save Changes' : isDriver ? 'Mark Unavailable' : 'Start Maintenance'}
          </button>
        </div>
      </form>
    </div>
    <DiscardChangesDialog open={confirmDiscard} onKeepEditing={() => setConfirmDiscard(false)} onDiscard={onCancel} />
    </>
  );
}
