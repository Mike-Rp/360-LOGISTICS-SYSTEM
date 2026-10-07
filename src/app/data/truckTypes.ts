/* ── Truck classifications — the ONE place the type → image / capacity mapping lives ──
   Used by Register New Truck and by every screen that shows a truck picture.
   Images live in public/trucks/ (served from the site root). Capacity comes from the
   type — the admin no longer picks it — and is saved as text via formatCapacity().
   imageSrc     = close-up (small slots across the app)
   fullImageSrc = whole truck, 800×600 (Register New Truck Step 2 panel + Step 3 receipt) */

export const TRUCK_CLASSIFICATIONS = [
  { value: 'Pickup Truck',     desc: 'Light cargo, small deliveries',     imageSrc: '/trucks/pickup-truck-front-right-1024.png', fullImageSrc: '/trucks/pickup-truck-full.png',     capacityMinKg: 500,    capacityMaxKg: 1_000,  capacityLabel: 'Payload capacity' },
  { value: 'Closed Van',       desc: 'Enclosed, weather-protected cargo', imageSrc: '/trucks/closed-van-front-right-1024.png', fullImageSrc: '/trucks/closed-van-full.png',       capacityMinKg: 1_000,  capacityMaxKg: 10_000, capacityLabel: 'Payload capacity' },
  { value: 'Wing Van',         desc: 'Side-opening, easy loading',        imageSrc: '/trucks/wing-van-front-right-1024.png', fullImageSrc: '/trucks/wing-van-full.png',         capacityMinKg: 8_000,  capacityMaxKg: 20_000, capacityLabel: 'Payload capacity' },
  { value: 'Boom Truck',       desc: 'Crane-equipped for heavy lifts',    imageSrc: '/trucks/boom-truck-front-right-1024.png', fullImageSrc: '/trucks/boom-truck-full.png',       capacityMinKg: 3_000,  capacityMaxKg: 15_000, capacityLabel: 'Lifting capacity' },
  { value: 'Semi-Trailer',     desc: 'Long-haul, high-volume cargo',      imageSrc: '/trucks/semi-trailer-front-right-1024.png', fullImageSrc: '/trucks/semi-trailer-full.png',     capacityMinKg: 20_000, capacityMaxKg: 35_000, capacityLabel: 'Payload capacity' },
  { value: 'Refrigerated Van', desc: 'Temperature-controlled cargo',      imageSrc: '/trucks/refrigerated-van-front-right-1024.png', fullImageSrc: '/trucks/refrigerated-van-full.png', capacityMinKg: 1_000,  capacityMaxKg: 12_000, capacityLabel: 'Payload capacity' },
  { value: 'Flatbed Truck',    desc: 'Open bed, oversized freight',       imageSrc: '/trucks/flatbed-truck-front-right-1024.png', fullImageSrc: '/trucks/flatbed-truck-full.png',    capacityMinKg: 5_000,  capacityMaxKg: 30_000, capacityLabel: 'Payload capacity' },
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

/* Side-view pictures — used only by the View Details truck card.
   Canvas 1200×400 with the truck on the left; the card shows that left part. */
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
