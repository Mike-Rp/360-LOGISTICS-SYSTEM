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
  eta: string;
  remarks: string;
  pickupDateInvalid: boolean;
  deliveryDateInvalid: boolean;
};

/** The form starts blank; passive resource refreshes and validation are not edits. */
export function hasUnsavedDispatchDetails(draft: DispatchDraft): boolean {
  return Object.values(draft).some(Boolean);
}
