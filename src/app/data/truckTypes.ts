/* ── Truck classifications — the ONE place the type → image / capacity mapping lives ──
   Used by Register New Truck and by every screen that shows a truck picture.
   Images live in public/trucks/ (served from the site root). Capacity comes from the
   type — the admin no longer picks it — and is saved as text via formatCapacity().
   imageSrc     = uploaded profile artwork (small slots across the app)
   fullImageSrc = uploaded full truck artwork (Register New Truck Step 2 + Step 3) */

export const TRUCK_CLASSIFICATIONS = [
  { value: 'Pickup Truck',     desc: 'Light cargo, small deliveries',     imageSrc: '/trucks/truck%20profiles/PICKUP%20TRUCK%20-%20IMAGE%20TRUCK.png', fullImageSrc: '/trucks/Pickup%20Truck%20(2).png',     capacityMinKg: 500,    capacityMaxKg: 1_000,  capacityLabel: 'Payload capacity' },
  { value: 'Closed Van',       desc: 'Enclosed, weather-protected cargo', imageSrc: '/trucks/truck%20profiles/CLOSED%20VAN%20-%20IMAGE%20TRUCK.png', fullImageSrc: '/trucks/Closed%20Van%20(2).png',       capacityMinKg: 1_000,  capacityMaxKg: 10_000, capacityLabel: 'Payload capacity' },
  { value: 'Wing Van',         desc: 'Side-opening, easy loading',        imageSrc: '/trucks/truck%20profiles/WING%20VAN%20TRUCK%20-%20IMAGE%20TRUCK.png', fullImageSrc: '/trucks/Wing%20Van%20(2).png',         capacityMinKg: 8_000,  capacityMaxKg: 20_000, capacityLabel: 'Payload capacity' },
  { value: 'Boom Truck',       desc: 'Crane-equipped for heavy lifts',    imageSrc: '/trucks/truck%20profiles/BOOM%20TRUCK%20-%20IMAGE%20TRUCK.png', fullImageSrc: '/trucks/Boom%20Truck%20(2).png',       capacityMinKg: 3_000,  capacityMaxKg: 15_000, capacityLabel: 'Lifting capacity' },
  { value: 'Semi-Trailer',     desc: 'Long-haul, high-volume cargo',      imageSrc: '/trucks/truck%20profiles/SEMI%20TRAILER%20TRUCK%20-%20IMAGE%20TRUCK.png', fullImageSrc: '/trucks/Semi-Trailer%20(2).png',     capacityMinKg: 20_000, capacityMaxKg: 35_000, capacityLabel: 'Payload capacity' },
  { value: 'Refrigerated Van', desc: 'Temperature-controlled cargo',      imageSrc: '/trucks/truck%20profiles/REFRIGINATED%20VAN%20-%20IMAGE%20TRUCK.png', fullImageSrc: '/trucks/Refrigerated%20Van%20(2).png', capacityMinKg: 1_000,  capacityMaxKg: 12_000, capacityLabel: 'Payload capacity' },
  { value: 'Flatbed Truck',    desc: 'Open bed, oversized freight',       imageSrc: '/trucks/truck%20profiles/FLATBED%20TRUCK%20-%20IMAGE%20TRUCK.png', fullImageSrc: '/trucks/Flatbed%20Truck%20(2).png',    capacityMinKg: 5_000,  capacityMaxKg: 30_000, capacityLabel: 'Payload capacity' },
];

/* 8000, 20000 → "8,000 – 20,000 kg (8–20 t)";  500, 1000 → "500 – 1,000 kg (0.5–1 t)" */
export const formatCapacity = (minKg: number, maxKg: number) => {
  const t = (kg: number) => String(Number((kg / 1000).toFixed(1)));
  return `${minKg.toLocaleString('en-US')} – ${maxKg.toLocaleString('en-US')} kg (${t(minKg)}–${t(maxKg)} t)`;
};

/* Keep stored capacity text intact; omit its ton equivalent only when displaying it. */
export const capacityKgOnly = (capacity?: string | null): string =>
  capacity?.replace(/\s*\([^)]*\s(?:t|tons?|tonnes?)\)\s*$/i, '').trim() ?? '';

/* Picture for a stored classification. undefined for a missing or retired type
   (e.g. older trucks saved as "Tanker") — callers then show a neutral fallback. */
export const truckImageFor = (classification?: string | null): string | undefined =>
  TRUCK_CLASSIFICATIONS.find((c) => c.value === classification)?.imageSrc;

export const truckFullImageFor = (classification?: string | null): string | undefined =>
  TRUCK_CLASSIFICATIONS.find((c) => c.value === classification)?.fullImageSrc;

/* Legacy side-view pictures retained for callers that need wide artwork. */
const SIDE_IMAGES: Record<string, string> = {
  'Pickup Truck':     '/trucks/pickup-truck-side.png',
  'Closed Van':       '/trucks/closed-van-side.png',
  'Wing Van':         '/trucks/wing-van-side.png',
  'Boom Truck':       '/trucks/boom-truck-side.png',
  'Semi-Trailer':     '/trucks/semi-trailer-side.png',
  'Refrigerated Van': '/trucks/refrigerated-van-side.png',
  'Flatbed Truck':    '/trucks/flatbed-truck-side.png',
};
export const truckSideImageFor = (classification?: string | null): string | undefined =>
  classification ? SIDE_IMAGES[classification] : undefined;
