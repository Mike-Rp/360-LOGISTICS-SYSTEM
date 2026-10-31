import { useState } from 'react';
import { X, UserX, Wrench, AlertTriangle } from 'lucide-react';
import {
  DRIVER_REASONS, NOTE_MAX_LENGTH, checkUnavailabilityForm,
  type UnavailabilityKind, type UnavailableReason,
} from '../../lib/unavailability';
import { toLocalInputValue } from '../../lib/fleetDelegation';

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
  const [returnValue, setReturnValue] = useState(initial?.expectedReturnAt ? toLocalInputValue(new Date(initial.expectedReturnAt)) : '');
  const [errors, setErrors] = useState<{ reason?: string; note?: string; returnAt?: string }>({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const title = mode === 'edit' ? 'Edit details' : isDriver ? 'Mark driver unavailable' : 'Put truck under maintenance';
  const Icon = isDriver ? UserX : Wrench;
  const noteRequired = isDriver && reason === 'other';
  const inputClass = (bad?: string) => `w-full px-3.5 py-2.5 rounded-xl border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${bad ? 'border-red-400 bg-red-50/40' : 'border-border'}`;

  const handleSubmit = async () => {
    if (busy) return;
    setSubmitError('');
    const check = checkUnavailabilityForm({ kind, reason: isDriver ? reason : 'maintenance', note, returnValue, nowMs: Date.now() });
    if (!check.ok) { setErrors(check.errors); return; }
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!busy) onCancel(); }} />
      <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} role="dialog" aria-modal="true" aria-labelledby="unavailability-title"
        className="relative flex max-h-[92vh] w-full max-w-md flex-col rounded-2xl border border-border bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Icon className="h-4 w-4" aria-hidden="true" /></span>
            <div className="min-w-0">
              <h3 id="unavailability-title" className="text-base font-semibold text-foreground">{title}</h3>
              <p className="truncate text-xs text-muted-foreground">{name}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground">
            {isDriver
              ? 'While unavailable, this driver cannot be given a delivery. A driver with an active delivery cannot be marked until it is completed or cancelled.'
              : 'While under maintenance, this truck cannot be given a delivery. A truck on an active delivery cannot be marked until it is completed or cancelled.'}
          </p>

          {isDriver ? (
            <div>
              <label htmlFor="unavailable-reason" className="mb-1.5 block text-sm font-medium text-foreground">Reason <span className="text-red-500">*</span></label>
              {mode === 'edit'
                ? <p className="rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-sm text-foreground">{DRIVER_REASONS.find((r) => r.value === reason)?.label ?? reason}</p>
                : <select id="unavailable-reason" value={reason} aria-invalid={errors.reason ? true : undefined}
                    onChange={(e) => { setReason(e.target.value); setErrors((p) => ({ ...p, reason: undefined, note: undefined })); }}
                    className={inputClass(errors.reason)}>
                    <option value="">Choose a reason…</option>
                    {DRIVER_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>}
              {errors.reason && <p role="alert" className="mt-1 text-xs text-red-500">{errors.reason}</p>}
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
            <textarea id="unavailable-note" value={note} rows={2} maxLength={NOTE_MAX_LENGTH + 20} aria-invalid={errors.note ? true : undefined}
              onChange={(e) => { setNote(e.target.value); setErrors((p) => ({ ...p, note: undefined })); }}
              placeholder={isDriver ? 'e.g. Fever, back on Monday' : 'e.g. Brake repair at the shop'}
              className={`${inputClass(errors.note)} resize-none`} />
            <div className="mt-1 flex items-start justify-between gap-2">
              {errors.note ? <p role="alert" className="text-xs text-red-500">{errors.note}</p> : <span />}
              <span className={`text-xs tabular-nums ${note.trim().length > NOTE_MAX_LENGTH ? 'text-red-500' : 'text-muted-foreground'}`}>{note.trim().length}/{NOTE_MAX_LENGTH}</span>
            </div>
          </div>

          <div>
            <label htmlFor="unavailable-return" className="mb-1.5 block text-sm font-medium text-foreground">
              Expected return <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </label>
            <input id="unavailable-return" type="datetime-local" value={returnValue} aria-invalid={errors.returnAt ? true : undefined}
              onChange={(e) => { setReturnValue(e.target.value); setErrors((p) => ({ ...p, returnAt: undefined })); }}
              className={inputClass(errors.returnAt)} />
            {errors.returnAt && <p role="alert" className="mt-1 text-xs text-red-500">{errors.returnAt}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {returnValue ? 'It ends by itself at this time.' : isDriver && reason === 'no_show'
                ? 'Left empty, a no-show ends at the end of today.'
                : `Left empty, ${isDriver ? 'they stay' : 'it stays'} ${isDriver ? 'unavailable' : 'under maintenance'} until you mark ${isDriver ? 'them' : 'it'} back.`}
            </p>
          </div>

          {submitError && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
              <p className="break-words text-xs text-red-700">{submitError}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row">
          <button type="button" onClick={onCancel} disabled={busy}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm transition-colors hover:bg-accent disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy}
            className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50">
            {busy ? 'Saving…' : mode === 'edit' ? 'Save Changes' : isDriver ? 'Mark Unavailable' : 'Start Maintenance'}
          </button>
        </div>
      </form>
    </div>
  );
}
