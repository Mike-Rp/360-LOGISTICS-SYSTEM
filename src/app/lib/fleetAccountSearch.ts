export function normalizeFleetSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesDriverSearch(driver: { name: string; phone: string }, query: string): boolean {
  return !query || driver.name.toLowerCase().includes(query) || driver.phone.includes(query);
}

export function matchesTruckSearch(truck: { plateNumber: string }, query: string): boolean {
  return !query || truck.plateNumber.toLowerCase().includes(query);
}
