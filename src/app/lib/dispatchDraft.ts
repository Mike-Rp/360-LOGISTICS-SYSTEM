/** Values the CSR intentionally enters in the two-step Dispatch Truck form. */
export type DispatchDraft = {
  driverId: string;
  truckId: string;
  originArea: string;
  pickupLocation: string;
  destinationArea: string;
  deliveryLocation: string;
  company: string;
  pickupDate: string;
  deliveryDate: string;
  pickupTime: string;
  scheduledArrivalTime: string;
  remarks: string;
  pickupDateInvalid: boolean;
  deliveryDateInvalid: boolean;
};

type LegacyDispatchDraft = Omit<DispatchDraft, 'scheduledArrivalTime'> & { eta: string };

/** Accept the old saved key without carrying it into current form state. */
export function normalizeDispatchDraft(draft: DispatchDraft | LegacyDispatchDraft): DispatchDraft {
  if ('scheduledArrivalTime' in draft) return draft;
  const { eta, ...fields } = draft;
  return { ...fields, scheduledArrivalTime: eta };
}

/** The form starts blank; passive resource refreshes and validation are not edits. */
export function hasUnsavedDispatchDetails(draft: DispatchDraft | LegacyDispatchDraft): boolean {
  return Object.values(normalizeDispatchDraft(draft)).some(Boolean);
}
