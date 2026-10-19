import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Navigation, X } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { searchMapboxLocations } from '../../lib/mapboxLocations';

const accessToken = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? '').trim();

interface Destination {
  latitude?: number;
  longitude?: number;
  address: string;
}

export type RouteSnapshot =
  | { status: 'no_location' | 'location_denied' }
  | { status: 'route'; origin: [number, number]; geometry: { type: 'LineString'; coordinates: [number, number][] }; steps: RouteStep[] };

interface Props {
  destination: Destination;
  title: string;
  focusedTitle?: string;
  routeFromCurrentLocation?: boolean;
  enableRouteMode?: boolean;
  routeActive?: boolean;
  blockedByRoute?: string;
  onStartRoute?: (snapshot?: RouteSnapshot) => void;
  onStopRoute?: () => void;
  initialRoute?: RouteSnapshot;
  onRouteSnapshot?: (snapshot: RouteSnapshot) => void;
  onClose: () => void;
}

interface RouteStep {
  instruction: string;
  distance: number;
}

interface MapMessages {
  loading: string;
  unavailable: string;
  finding: string;
  notVerified: string;
  selected: string;
  gettingLocation: string;
  noLocation: string;
  routePreview: string;
  locationDenied: string;
  noRoute: string;
  close: string;
  startRoute: string;
  routeActive: string;
  resumeRoute: string;
  stopRoute: string;
  stopConfirm: string;
  cancel: string;
  backToPreview: string;
  nextDirection: string;
  allDirections: string;
}

const defaultMessages: MapMessages = {
  loading: 'Loading map…',
  unavailable: 'Mapbox is unavailable. Ask Dispatch to check the map setup.',
  finding: 'Finding the saved address on Mapbox…',
  notVerified: 'This saved location cannot be verified exactly. Ask Dispatch to select an exact Mapbox address.',
  selected: 'Selected location on Mapbox.',
  gettingLocation: 'Getting your current location for a driving route…',
  noLocation: 'Current location is unavailable. The destination is shown on the map.',
  routePreview: 'Route preview from your current location. This view does not provide live turn-by-turn guidance.',
  locationDenied: 'Location access is unavailable. The destination is shown on the map.',
  noRoute: 'No driving route was found.',
  close: 'Close map',
  startRoute: 'Start Route',
  routeActive: 'Route active',
  resumeRoute: 'Resume Route',
  stopRoute: 'Stop Route',
  stopConfirm: 'Stop this route?',
  cancel: 'Cancel',
  backToPreview: 'Back to route preview',
  nextDirection: 'Next direction',
  allDirections: 'All directions',
};

export default function MapboxMapPanel({ destination, title, focusedTitle, routeFromCurrentLocation = false,
  enableRouteMode = false, routeActive = false, blockedByRoute, onStartRoute, onStopRoute,
  initialRoute, onRouteSnapshot,
  onClose, messages }: Props & { messages?: Partial<MapMessages> }) {
  const mapHost = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const copy = { ...defaultMessages, ...messages };
  const [message, setMessage] = useState(copy.loading);
  const [steps, setSteps] = useState<RouteStep[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [routeMode, setRouteMode] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const routeSnapshot = useRef<RouteSnapshot | undefined>(initialRoute);
  const routeDestinationKey = useRef(`${destination.address}|${destination.latitude}|${destination.longitude}`);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (routeMode) setRouteMode(false); else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, routeMode]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => mapRef.current?.resize());
    return () => window.cancelAnimationFrame(frame);
  }, [routeMode]);

  useEffect(() => {
    if (!accessToken || !mapHost.current) {
      setMessage(copy.unavailable);
      return;
    }
    let cancelled = false;
    let map: mapboxgl.Map | null = null;
    const controller = new AbortController();
    const destinationKey = `${destination.address}|${destination.latitude}|${destination.longitude}`;
    if (routeDestinationKey.current !== destinationKey) {
      routeDestinationKey.current = destinationKey;
      routeSnapshot.current = undefined;
      setSteps([]);
    }

    const load = async () => {
      try {
        let longitude = destination.longitude;
        let latitude = destination.latitude;
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          setMessage(copy.finding);
          const results = await searchMapboxLocations(destination.address, accessToken, controller.signal);
          const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
          const result = results.find((candidate) => normalize(candidate.formatted) === normalize(destination.address));
          if (!result) {
            throw new Error(copy.notVerified);
          }
          longitude = result.longitude;
          latitude = result.latitude;
        }
        if (cancelled || longitude === undefined || latitude === undefined) return;

        mapboxgl.accessToken = accessToken;
        map = new mapboxgl.Map({
          container: mapHost.current!,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [longitude, latitude],
          zoom: 14,
        });
        mapRef.current = map;
        setMapReady(true);
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        new mapboxgl.Marker({ color: '#16803c' }).setLngLat([longitude, latitude]).addTo(map);
        setMessage(routeFromCurrentLocation ? copy.gettingLocation : copy.selected);

        if (!routeFromCurrentLocation) return;
        const drawRoute = (snapshot: Extract<RouteSnapshot, { status: 'route' }>) => {
          if (cancelled || !map) return;
          new mapboxgl.Marker({ color: '#2563eb' }).setLngLat(snapshot.origin).addTo(map);
          const addLine = () => {
            if (cancelled || !map) return;
            map.addSource('driver-route', { type: 'geojson',
              data: { type: 'Feature', properties: {}, geometry: snapshot.geometry } });
            map.addLayer({ id: 'driver-route', type: 'line', source: 'driver-route',
              paint: { 'line-color': '#1677d2', 'line-width': 5 } });
            map.fitBounds(new mapboxgl.LngLatBounds().extend(snapshot.origin).extend([longitude!, latitude!]),
              { padding: 56, maxZoom: 14 });
          };
          if (map.isStyleLoaded()) addLine(); else map.once('load', addLine);
          setSteps(snapshot.steps);
          setMessage(copy.routePreview);
        };
        if (routeSnapshot.current?.status === 'route') {
          drawRoute(routeSnapshot.current);
          return;
        }
        if (routeSnapshot.current?.status === 'no_location' || routeSnapshot.current?.status === 'location_denied') {
          setMessage(routeSnapshot.current.status === 'no_location' ? copy.noLocation : copy.locationDenied);
          return;
        }
        if (!navigator.geolocation) {
          const snapshot: RouteSnapshot = { status: 'no_location' };
          routeSnapshot.current = snapshot;
          onRouteSnapshot?.(snapshot);
          setMessage(copy.noLocation);
          return;
        }
        navigator.geolocation.getCurrentPosition(async (position) => {
          if (cancelled || !map) return;
          const fromLon = position.coords.longitude;
          const fromLat = position.coords.latitude;
          try {
            const params = new URLSearchParams({
              access_token: accessToken, geometries: 'geojson', overview: 'full', steps: 'true',
            });
            const response = await fetch(
              `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLon},${fromLat};${longitude},${latitude}?${params}`,
              { signal: controller.signal },
            );
            if (!response.ok) throw new Error(`Mapbox directions failed (${response.status}).`);
            const data = await response.json();
            const route = data.routes?.[0];
            if (!route?.geometry) throw new Error(copy.noRoute);
            const routeSteps: RouteStep[] = (route.legs ?? []).flatMap((leg: { steps?: Array<{ maneuver?: { instruction?: string }; distance?: number }> }) =>
              (leg.steps ?? []).map((step) => ({ instruction: step.maneuver?.instruction ?? '', distance: step.distance ?? 0 }))
                .filter((step) => step.instruction));
            const snapshot: RouteSnapshot = { status: 'route', origin: [fromLon, fromLat],
              geometry: route.geometry as Extract<RouteSnapshot, { status: 'route' }>['geometry'], steps: routeSteps };
            routeSnapshot.current = snapshot;
            onRouteSnapshot?.(snapshot);
            drawRoute(snapshot);
          } catch (error) {
            if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not load a driving route.');
          }
        }, () => {
          if (!cancelled) {
            const snapshot: RouteSnapshot = { status: 'location_denied' };
            routeSnapshot.current = snapshot;
            onRouteSnapshot?.(snapshot);
            setMessage(copy.locationDenied);
          }
        }, { enableHighAccuracy: true, timeout: 12000 });
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not load this location.');
      }
    };
    void load();
    return () => { cancelled = true; controller.abort(); if (mapRef.current === map) mapRef.current = null; map?.remove(); };
  }, [destination.address, destination.latitude, destination.longitude, routeFromCurrentLocation]);

  return createPortal(
    <div className={`fixed inset-0 z-[200] flex items-center justify-center bg-black/55 ${routeMode ? 'p-0' : 'p-0 sm:p-5'}`}
      role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={routeMode ? focusedTitle ?? title : title}
        className={`flex h-dvh w-full flex-col overflow-hidden bg-white ${routeMode ? '' : 'sm:h-[min(88vh,800px)] sm:max-w-[900px] sm:rounded-2xl sm:shadow-xl'}`}>
        <header className={`flex shrink-0 items-start gap-3 border-b border-gray-200 px-4 sm:px-5 ${enableRouteMode ? 'py-3' : 'py-4'}`}>
          {routeMode && <button type="button" onClick={() => setRouteMode(false)} aria-label={copy.backToPreview}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-green-700">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900">{routeMode ? focusedTitle ?? title : title}</h2>
            <p className="mt-1 break-words text-sm text-gray-600">{destination.address}</p>
          </div>
          {!routeMode && <button type="button" onClick={onClose} aria-label={copy.close}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-green-700">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>}
        </header>
        <div ref={mapHost} className="min-h-0 flex-1 bg-gray-100" aria-label="Mapbox map" />
        <div className={`${routeMode ? 'max-h-[35dvh] pb-[calc(0.75rem+env(safe-area-inset-bottom))]' : 'max-h-[32%] pb-3'} shrink-0 overflow-y-auto border-t border-gray-200 px-4 pt-3 sm:px-5`}>
          {routeMode && steps.length > 0 && <>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{copy.nextDirection}</p>
            <p className="mt-1 text-base font-semibold leading-snug text-gray-900">{steps[0].instruction}</p>
            {steps[0].distance >= 1 && <p className="mt-1 text-sm text-gray-600">{Math.round(steps[0].distance)} m</p>}
          </>}
          <p className={`${routeMode && steps.length > 0 ? 'mt-2' : ''} text-sm font-medium text-gray-700`} role="status">{message}</p>
          {routeMode && steps.length > 1 ? <details className="mt-2 border-t border-gray-100 pt-2">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-green-800 focus-visible:outline-2 focus-visible:outline-green-700">{copy.allDirections}</summary>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-gray-700">
              {steps.map((step, index) => <li key={index}>{step.instruction}{step.distance >= 100 ? ` · ${Math.round(step.distance)} m` : ''}</li>)}
            </ol>
          </details> : !routeMode && steps.length > 0 && <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
            {steps.map((step, index) => <li key={index}>{step.instruction}{step.distance >= 100 ? ` · ${Math.round(step.distance)} m` : ''}</li>)}
          </ol>}
        </div>
        {enableRouteMode && !routeMode && <footer className="shrink-0 border-t border-gray-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5">
          {routeActive && <p className="mb-2 text-sm font-semibold text-green-800" role="status">{copy.routeActive}</p>}
          {blockedByRoute && <p className="mb-2 text-sm text-amber-800" role="status">{blockedByRoute}</p>}
          {confirmStop ? <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900">{copy.stopConfirm}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmStop(false)}
                className="min-h-12 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700">{copy.cancel}</button>
              <button type="button" onClick={() => { onStopRoute?.(); setConfirmStop(false); }}
                className="min-h-12 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700">{copy.stopRoute}</button>
            </div>
          </div> : <div className="space-y-2">
            {!blockedByRoute && <button type="button" disabled={!mapReady} onClick={() => {
              if (!routeActive) onStartRoute?.(routeSnapshot.current);
              setRouteMode(true);
            }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-4 text-base font-bold text-white hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600">
              <Navigation className="h-5 w-5" aria-hidden="true" />{routeActive ? copy.resumeRoute : copy.startRoute}
            </button>}
            {routeActive && <button type="button" onClick={() => setConfirmStop(true)}
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700">{copy.stopRoute}</button>}
          </div>}
        </footer>}
      </section>
    </div>, document.body,
  );
}
