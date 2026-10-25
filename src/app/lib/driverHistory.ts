export interface CancelledHistoryItem {
  id: string;
  truckPlate: string;
  driverName: string | null;
  company: string;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  deliveryDate: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

interface CancelledHistoryRow {
  id: string;
  driver_id: string | null;
  state: string;
  truck_plate: string | null;
  driver_name: string | null;
  company: string | null;
  pickup_location: string | null;
  delivery_location: string | null;
  delivery_date: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

/** Use only rows returned for the signed-in driver; keep the ownership check here too. */
export function cancelledHistoryForDriver(rows: CancelledHistoryRow[], driverId: string): CancelledHistoryItem[] {
  return rows
    .filter((row) => row.driver_id === driverId && row.state === 'cancelled')
    .map((row) => ({
      id: row.id,
      truckPlate: row.truck_plate ?? '',
      driverName: row.driver_name ?? null,
      company: row.company ?? '',
      pickupLocation: row.pickup_location ?? null,
      deliveryLocation: row.delivery_location ?? null,
      deliveryDate: row.delivery_date ?? '',
      cancelledAt: row.cancelled_at ?? null,
      cancelReason: row.cancel_reason ?? null,
    }))
    .sort((a, b) => {
      const timestamp = (value: string | null) => {
        const parsed = value && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
        return Number.isNaN(parsed) ? -Infinity : parsed;
      };
      return timestamp(b.cancelledAt) - timestamp(a.cancelledAt) || a.id.localeCompare(b.id);
    });
}
