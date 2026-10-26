export interface DriverCancellationNotice {
  id: string;
  reason: string | null;
  cancelledAt: string | null;
}

interface CancellationRow {
  id: string;
  driver_id: string | null;
  state: string;
  cancel_reason?: string | null;
  cancel_acknowledged_at?: string | null;
  cancelled_at?: string | null;
  created_at?: string | null;
}

/** Keep all outstanding notices; never infer a reason or event time. */
export function unacknowledgedDriverCancellations(
  rows: CancellationRow[], driverId: string,
): DriverCancellationNotice[] {
  return rows
    .filter((row) => row.driver_id === driverId && row.state === 'cancelled' && !row.cancel_acknowledged_at)
    .sort((a, b) => {
      const aOrder = a.cancelled_at ?? a.created_at ?? '';
      const bOrder = b.cancelled_at ?? b.created_at ?? '';
      return aOrder.localeCompare(bOrder) || a.id.localeCompare(b.id);
    })
    .map((row) => ({
      id: row.id,
      reason: row.cancel_reason ?? null,
      cancelledAt: row.cancelled_at ?? null,
    }));
}

/** A failed backend write must leave the same notices available for retry. */
export async function afterCancellationAcknowledged(
  notices: DriverCancellationNotice[], id: string, persist: () => Promise<void>,
): Promise<DriverCancellationNotice[]> {
  await persist();
  return notices.filter((notice) => notice.id !== id);
}
