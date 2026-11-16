const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const component = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
const picker = readFileSync(join(__dirname, '../components/admin/PhilippineAddressFields.tsx'), 'utf8');
const db = readFileSync(join(__dirname, 'db.ts'), 'utf8');
const popover = readFileSync(join(__dirname, '../components/ui/popover.tsx'), 'utf8');

test('pickup and delivery have separate cascading selection state in Dispatch Truck Step 1', () => {
  assert.match(component, /\[pickupGeo, setPickupGeo\]/);
  assert.match(component, /\[deliveryGeo, setDeliveryGeo\]/);
  assert.match(component, /<PhilippineAddressFields kind="pickup" selection=\{pickupGeo\}/);
  assert.match(component, /<PhilippineAddressFields kind="delivery" selection=\{deliveryGeo\}/);
  assert.match(picker, /changeGeoSelection\(selection, level, code\)/);
  assert.match(picker, /geoCityOptions\(selection, area, cityPath\)/);
  assert.match(picker, /geoBarangayOptions\(selection, area\)/);
  assert.match(picker, /SearchableGeoSelect scope=\{kind\} label="Barangay"/);
});

test('existing address columns receive selected geography and the editable specific address', () => {
  assert.match(component, /destination: `\$\{pickupConfirmed\.areaLabel\} → \$\{deliveryConfirmed\.fullLocation\}`/);
  assert.match(component, /destinationArea: deliveryConfirmed\.areaLabel/);
  assert.match(component, /pickupLocation: pickupConfirmed\.fullLocation/);
  assert.match(component, /deliveryLocation: deliveryConfirmed\.fullLocation/);
  assert.match(db, /destination: 'destination', destinationArea: 'destination_area'/);
  assert.match(db, /pickupLocation: 'pickup_location', deliveryLocation: 'delivery_location'/);
  assert.doesNotMatch(component, /setTaskFrom\(|setTaskDestinationArea\(/);
});

test('incomplete selections block Next while Client and exact addresses stay editable', () => {
  assert.match(component, /if \(!pickupConfirmed \|\| !pickupAddressCompact\)/);
  assert.match(component, /if \(!deliveryConfirmed \|\| !deliveryAddressCompact\)/);
  assert.match(component, /addressDraftErrors\('pickup'\)/);
  assert.match(component, /addressDraftErrors\('delivery'\)/);
  assert.match(component, /const handleNextStep = \(\) => \{ if \(validateStep1\(\)\)/);
  assert.match(component, /<FieldLabel required>Pickup Location<\/FieldLabel>[\s\S]*?value=\{taskPickupLocation\}/);
  assert.match(component, /<FieldLabel required>Delivery Location<\/FieldLabel>[\s\S]*?value=\{taskTo\}/);
  assert.match(component, /<FieldLabel required>Client<\/FieldLabel>[\s\S]*?value=\{taskCompany\}/);
  assert.match(picker, /<PopoverContent[^>]*collisionPadding=\{12\}/);
  assert.match(picker, /<CommandInput aria-label=\{`Search \$\{scope\} \$\{label\}`\}/);
});

test('only address popovers portal inside the scroll-locked Dispatch dialog and keep their own scroll list', () => {
  assert.match(picker, /closest<HTMLElement>\('\[data-slot="dialog-content"\]'\)/);
  assert.match(picker, /<PopoverContent container=\{dialogContainer\}/);
  assert.match(popover, /<PopoverPrimitive\.Portal container=\{container\}>/);
  assert.match(picker, /CommandList className="[^"]*touch-pan-y overscroll-y-contain/);
  assert.match(component, /className="flex max-h-\[94dvh\][^"]*overflow-visible/);
  assert.match(component, /className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-5/);
  assert.match(component, /onPointerDownOutside=\{\(event\) => event\.preventDefault\(\)\}/);
});

test('province selection is required before province-based cities; independent city is an explicit path', () => {
  assert.match(picker, /!canSelectGeoCity\(selection, cityPath\)/);
  assert.match(picker, /Choose independent city/);
  assert.match(picker, /Choose province instead/);
  assert.match(picker, /independentOptions\.length > 0 && cityPath !== 'independent'/);
  assert.match(picker, /region && provinceOptions\.length > 0/);
  assert.match(component, /setPickupCityPath\('province'\); else setDeliveryCityPath\('province'\)/);
  assert.match(component, /cityPath=\{pickupCityPath\}/);
  assert.match(component, /cityPath=\{deliveryCityPath\}/);
});

test('addresses collapse only after a valid local save and summaries preserve confirmed values', () => {
  assert.match(component, /\[pickupAddressCompact, setPickupAddressCompact\]/);
  assert.match(component, /\[deliveryAddressCompact, setDeliveryAddressCompact\]/);
  assert.match(component, /\[pickupConfirmed, setPickupConfirmed\]/);
  assert.match(component, /\[deliveryConfirmed, setDeliveryConfirmed\]/);
  assert.match(component, /pickupAddressCompact && pickupConfirmed \? <CompactAddressSummary/);
  assert.match(component, /deliveryAddressCompact && deliveryConfirmed \? <CompactAddressSummary/);
  assert.match(component, /Save Pickup Address/);
  assert.match(component, /Save Delivery Address/);
  assert.match(component, /onClick=\{\(\) => saveAddress\('pickup'\)\}/);
  assert.match(component, /onClick=\{\(\) => saveAddress\('delivery'\)\}/);
  assert.match(component, /onEdit=\{\(\) => editAddress\('pickup'\)\}/);
  assert.match(component, /onEdit=\{\(\) => editAddress\('delivery'\)\}/);
  assert.doesNotMatch(component, /onBlurCapture=\{handleDispatchAddressBlur\}/);
  assert.doesNotMatch(component, /Use Address/);
  assert.match(picker, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(picker, /truncate text-xs text-muted-foreground/);
  assert.match(component, /setPickupGeo\(EMPTY_GEO_SELECTION\); setDeliveryGeo\(EMPTY_GEO_SELECTION\)/);
  assert.match(component, /setPickupConfirmed\(null\); setDeliveryConfirmed\(null\)/);
  assert.match(component, /pickupLocation: pickupConfirmed\.fullLocation/);
  assert.match(component, /deliveryLocation: deliveryConfirmed\.fullLocation/);
});
