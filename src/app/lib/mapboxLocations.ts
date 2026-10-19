import { coordinatePair, fromMapboxPosition } from './assignmentLocation';

export interface SelectedLocation {
  formatted: string;
  name: string;
  city: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  featureId: string | null;
}

/** A route label must come from Mapbox's structured geography, never address text. */
export function mapboxRouteArea(place: SelectedLocation | null): string {
  return place?.city?.trim() || place?.region?.trim() || '';
}

interface MapboxFeature {
  id?: unknown;
  geometry?: { coordinates?: unknown };
  properties?: {
    mapbox_id?: unknown;
    feature_type?: unknown;
    full_address?: unknown;
    name?: unknown;
    name_preferred?: unknown;
    place_formatted?: unknown;
    coordinates?: { latitude?: unknown; longitude?: unknown };
    context?: Record<string, { name?: unknown } | undefined>;
  };
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function selectedLocationFromMapbox(feature: MapboxFeature): SelectedLocation | null {
  const props = feature.properties;
  const name = clean(props?.name_preferred) || clean(props?.name);
  const formatted = clean(props?.full_address)
    || [name, clean(props?.place_formatted)].filter(Boolean).join(', ');
  const point = coordinatePair(props?.coordinates?.latitude, props?.coordinates?.longitude)
    ?? (Array.isArray(feature.geometry?.coordinates)
      ? fromMapboxPosition(feature.geometry.coordinates) : null);
  if (!formatted || !point) return null;
  const city = clean(props?.context?.place?.name)
    || (props?.feature_type === 'place' ? name : '')
    || clean(props?.context?.locality?.name)
    || (props?.feature_type === 'locality' ? name : '');
  return {
    formatted,
    name: name || formatted,
    city: city || null,
    region: clean(props?.context?.region?.name) || null,
    latitude: point.latitude,
    longitude: point.longitude,
    featureId: clean(props?.mapbox_id) || clean(feature.id) || null,
  };
}

export async function searchMapboxLocations(query: string, accessToken: string, signal: AbortSignal): Promise<SelectedLocation[]> {
  const params = new URLSearchParams({
    q: query, country: 'PH', autocomplete: 'true', permanent: 'true', limit: '5', access_token: accessToken,
  });
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`, { signal });
  if (!response.ok) throw new Error(`Location search failed (${response.status}).`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('features' in data) || !Array.isArray(data.features)) return [];
  return data.features.flatMap((result: MapboxFeature) => {
    const selected = selectedLocationFromMapbox(result);
    return selected ? [selected] : [];
  });
}
