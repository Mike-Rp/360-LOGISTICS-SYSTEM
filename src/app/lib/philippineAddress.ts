import indexData from '../data/psgcIndex.json';

export interface GeoOption { code: string; name: string }
export interface GeoCity extends GeoOption { type: 'city' | 'municipality'; barangays: [string, string, ...string[]][] }
export interface GeoArea extends GeoOption { kind: 'province' | 'independent_city'; cities: GeoCity[] }
export interface GeoRegion extends GeoOption {
  provinces: GeoOption[];
  independent: Array<GeoOption & { type: 'city' | 'municipality' }>;
}
export interface GeoSelection { regionCode: string; provinceCode: string; cityCode: string; barangayCode: string }
export type GeoCityPath = 'province' | 'independent' | 'regionCity';
export interface SavedGeoAddress {
  selection: GeoSelection;
  cityPath: GeoCityPath;
  specific: string;
  areaLabel: string;
  fullLocation: string;
  region: string;
  province: string | null;
  city: string;
  barangay: string;
}
export const EMPTY_GEO_SELECTION: GeoSelection = { regionCode: '', provinceCode: '', cityCode: '', barangayCode: '' };
export const PSGC_REGIONS = indexData.regions as GeoRegion[];

// PSA PSGC city-class lists: https://psa.gov.ph/classification/psgc/iccs and /hucs.
// The existing region-level bucket also contains Isabela (a component city) and NCR's Pateros.
// These five ICCs are stored in province JSON files, so retain their area file codes for lazy loading.
const ICC_CITIES = [
  { code: '0105518000', name: 'City of Dagupan', regionCode: '0100000000', areaCode: '0105500000' },
  { code: '0203135000', name: 'City of Santiago', regionCode: '0200000000', areaCode: '0203100000' },
  { code: '0501724000', name: 'City of Naga', regionCode: '0500000000', areaCode: '0501700000' },
  { code: '0803738000', name: 'Ormoc City', regionCode: '0800000000', areaCode: '0803700000' },
  { code: '1908703000', name: 'City of Cotabato', regionCode: '1900000000', areaCode: '1908700000' },
] as const;
const REGION_ONLY_COMPONENT_CITY_CODES = new Set(['0990101000']);

export function geoIndependentCityOptions(regionCode: string): GeoOption[] {
  const region = PSGC_REGIONS.find((item) => item.code === regionCode);
  if (!region) return [];
  return [
    ...region.independent.filter((city) => city.type === 'city' && !REGION_ONLY_COMPONENT_CITY_CODES.has(city.code)),
    ...ICC_CITIES.filter((city) => city.regionCode === regionCode),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export function geoRegionCityOptions(regionCode: string): GeoOption[] {
  return PSGC_REGIONS.find((item) => item.code === regionCode)?.independent
    .filter((city) => REGION_ONLY_COMPONENT_CITY_CODES.has(city.code)) ?? [];
}

export function geoProvinceOptions(regionCode: string): GeoOption[] {
  return PSGC_REGIONS.find((item) => item.code === regionCode)?.provinces ?? [];
}

export function canSelectGeoCity(selection: GeoSelection, cityPath: GeoCityPath): boolean {
  const region = PSGC_REGIONS.find((item) => item.code === selection.regionCode);
  if (!region) return false;
  if (!region.provinces.length) return true;
  if (cityPath === 'independent') return !selection.provinceCode && geoIndependentCityOptions(region.code).length > 0;
  if (cityPath === 'regionCity') return !selection.provinceCode && geoRegionCityOptions(region.code).length > 0;
  return region.provinces.some((item) => item.code === selection.provinceCode);
}

export function geoCityOptions(selection: GeoSelection, area: GeoArea | null, cityPath: GeoCityPath = 'province'): GeoOption[] {
  const region = PSGC_REGIONS.find((item) => item.code === selection.regionCode);
  if (!region) return [];
  if (!region.provinces.length) return region.independent;
  if (cityPath === 'independent' && !selection.provinceCode) return geoIndependentCityOptions(region.code);
  if (cityPath === 'regionCity' && !selection.provinceCode) return geoRegionCityOptions(region.code);
  return area?.code === selection.provinceCode ? area.cities : [];
}

export function geoBarangayOptions(selection: GeoSelection, area: GeoArea | null): GeoOption[] {
  if (!area || area.code !== selectedGeoAreaCode(selection)) return [];
  return area.cities.find((item) => item.code === selection.cityCode)?.barangays
    .map(([code, name]) => ({ code, name })) ?? [];
}

export function changeGeoSelection(current: GeoSelection, level: keyof GeoSelection, code: string): GeoSelection {
  if (level === 'regionCode') return { regionCode: code, provinceCode: '', cityCode: '', barangayCode: '' };
  if (level === 'provinceCode') return { ...current, provinceCode: code, cityCode: '', barangayCode: '' };
  if (level === 'cityCode') return { ...current, cityCode: code, barangayCode: '' };
  return { ...current, barangayCode: code };
}

export function selectedGeoAreaCode(selection: GeoSelection): string {
  if (selection.provinceCode) return selection.provinceCode;
  const icc = ICC_CITIES.find((city) => city.code === selection.cityCode && city.regionCode === selection.regionCode);
  if (icc) return icc.areaCode;
  const region = PSGC_REGIONS.find((item) => item.code === selection.regionCode);
  return region?.independent.some((city) => city.code === selection.cityCode) ? selection.cityCode : '';
}

export function resolveGeoSelection(selection: GeoSelection, area: GeoArea | null) {
  const region = PSGC_REGIONS.find((item) => item.code === selection.regionCode);
  if (!region || !area || area.code !== selectedGeoAreaCode(selection)) return null;
  const province = selection.provinceCode
    ? region.provinces.find((item) => item.code === selection.provinceCode) : null;
  if (selection.provinceCode && (!province || area.kind !== 'province')) return null;
  if (!selection.provinceCode && !region.independent.some((item) => item.code === selection.cityCode)
      && !ICC_CITIES.some((item) => item.code === selection.cityCode && item.regionCode === region.code)) return null;
  const city = area.cities.find((item) => item.code === selection.cityCode);
  const barangay = city?.barangays.find(([code]) => code === selection.barangayCode);
  if (!city || !barangay) return null;
  return { region, province, city, barangay: { code: barangay[0], name: barangay[1] } };
}

export function formatGeoArea(selection: GeoSelection, area: GeoArea | null): string {
  const parts = resolveGeoSelection(selection, area);
  return parts ? [parts.city.name, parts.province?.name ?? parts.region.name].join(', ') : '';
}

export function formatGeoLocation(specificAddress: string, selection: GeoSelection, area: GeoArea | null): string {
  const parts = resolveGeoSelection(selection, area);
  if (!parts || !specificAddress.trim()) return '';
  return [specificAddress.trim(), parts.barangay.name, parts.city.name, parts.province?.name, parts.region.name]
    .filter(Boolean).join(', ');
}

export function confirmGeoAddress(specificAddress: string, selection: GeoSelection, area: GeoArea | null,
  cityPath: GeoCityPath): SavedGeoAddress | null {
  const parts = resolveGeoSelection(selection, area);
  if (!parts || !specificAddress.trim() || !geoCityOptions(selection, area, cityPath)
      .some((city) => city.code === selection.cityCode) ||
      (cityPath !== 'province' && !!selection.provinceCode)) return null;
  return {
    selection: { ...selection }, cityPath, specific: specificAddress.trim(),
    areaLabel: formatGeoArea(selection, area), fullLocation: formatGeoLocation(specificAddress, selection, area),
    region: parts.region.name, province: parts.province?.name ?? null,
    city: parts.city.name, barangay: parts.barangay.name,
  };
}

export function geoSelectionErrors(selection: GeoSelection, area: GeoArea | null, prefix: string,
  cityPath: GeoCityPath = 'province'): Record<string, string> {
  const region = PSGC_REGIONS.find((item) => item.code === selection.regionCode);
  if (!region) return { [`${prefix}Region`]: 'Select a region.' };
  const province = region.provinces.find((item) => item.code === selection.provinceCode);
  if (selection.provinceCode && !province) return { [`${prefix}Province`]: 'Select a province or special geographic area.' };
  if (cityPath !== 'province' && selection.provinceCode)
    return { [`${prefix}Province`]: 'Choose a city without a province for this address.' };
  if (region.provinces.length && cityPath === 'province' && !province)
    return { [`${prefix}Province`]: 'Select a province.' };
  if (region.provinces.length && cityPath === 'independent' && !geoIndependentCityOptions(region.code).length)
    return { [`${prefix}City`]: 'No independent cities are available in this region.' };
  if (region.provinces.length && cityPath === 'regionCity' && !geoRegionCityOptions(region.code).length)
    return { [`${prefix}City`]: 'No province-free cities are available in this region.' };
  if (!selection.cityCode || !geoCityOptions(selection, area, cityPath).some((city) => city.code === selection.cityCode))
    return { [`${prefix}City`]: cityPath === 'independent' ? 'Select an independent city.' : 'Select a city or municipality.' };
  if (!selection.cityCode || !area || area.code !== selectedGeoAreaCode(selection)
      || !area.cities.some((city) => city.code === selection.cityCode)) {
    return { [`${prefix}City`]: 'Select a city or municipality.' };
  }
  if (!resolveGeoSelection(selection, area)) return { [`${prefix}Barangay`]: 'Select a barangay.' };
  return {};
}
