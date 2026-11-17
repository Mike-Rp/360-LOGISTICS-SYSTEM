import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, MapPin, Pencil } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandInput, CommandItem, CommandList } from '../ui/command';
import {
  PSGC_REGIONS, canSelectGeoCity, changeGeoSelection, geoProvinceOptions, geoCityOptions, geoBarangayOptions,
  geoIndependentCityOptions, geoRegionCityOptions, selectedGeoAreaCode,
  type GeoArea, type GeoCityPath, type GeoOption, type GeoSelection, type SavedGeoAddress,
} from '../../lib/philippineAddress';

const areaRequests = new Map<string, Promise<GeoArea>>();
function loadArea(code: string): Promise<GeoArea> {
  const cached = areaRequests.get(code);
  if (cached) return cached;
  const request = fetch(`${import.meta.env.BASE_URL}psgc/areas/${code}.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error('Geographic data is unavailable. Try again.');
      const area = await response.json() as GeoArea;
      if (area.code !== code || !Array.isArray(area.cities)) throw new Error('Geographic data is invalid.');
      return area;
    }).catch((error: unknown) => { areaRequests.delete(code); throw error; });
  areaRequests.set(code, request);
  return request;
}

export function usePsgcArea(selection: GeoSelection, enabled: boolean) {
  const code = enabled ? selectedGeoAreaCode(selection) : '';
  const [state, setState] = useState<{ code: string; area: GeoArea | null; error: string }>({ code: '', area: null, error: '' });
  const [retryCount, setRetryCount] = useState(0);
  useEffect(() => {
    if (!code) return;
    let active = true;
    void loadArea(code).then((area) => { if (active) setState({ code, area, error: '' }); })
      .catch((error: unknown) => { if (active) setState({ code, area: null, error: error instanceof Error ? error.message : 'Geographic data is unavailable.' }); });
    return () => { active = false; };
  }, [code, retryCount]);
  return { area: state.code === code ? state.area : null, loading: !!code && state.code !== code,
    error: state.code === code ? state.error : '',
    retry: () => { setState({ code: '', area: null, error: '' }); setRetryCount((count) => count + 1); } };
}

function SearchableGeoSelect({ scope, label, value, options, placeholder, disabled, error, required = true, onChange }: {
  scope: 'pickup' | 'delivery'; label: string; value: string; options: GeoOption[]; placeholder: string; disabled?: boolean;
  error?: string; required?: boolean; onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const selected = options.find((item) => item.code === value);
  const filtered = options.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const errorId = `${scope}-${label.replace(/\W/g, '-').toLowerCase()}-error`;
  return <div className="min-w-0">
    <label className="mb-1 block text-sm font-medium text-foreground">{label} {required && <span className="text-red-500">*</span>}</label>
    <Popover open={open} onOpenChange={(next) => {
      if (next) setDialogContainer(triggerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? null);
      setOpen(next);
      if (!next) setQuery('');
    }}>
      <PopoverTrigger asChild>
        <button ref={triggerRef} type="button" role="combobox" aria-expanded={open} aria-label={`${scope} ${label}`}
          aria-invalid={!!error || undefined} aria-describedby={error ? errorId : undefined}
          disabled={disabled} className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-green-700 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${error ? 'border-red-400' : 'border-gray-200'}`}>
          <span className="min-w-0 truncate">{selected?.name ?? placeholder}</span><ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent container={dialogContainer} data-geo-popover-scope={scope} align="start" sideOffset={4} collisionPadding={12}
        className="w-[min(var(--radix-popover-trigger-width),calc(100vw-24px))] p-0">
        <Command shouldFilter={false}>
          <CommandInput aria-label={`Search ${scope} ${label}`} placeholder={`Search ${label.toLowerCase()}...`} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[min(260px,var(--radix-popover-content-available-height))] touch-pan-y overscroll-y-contain">
            {filtered.length === 0 && <p className="px-3 py-5 text-center text-sm text-gray-500">No matching locations</p>}
            {filtered.slice(0, 150).map((item) => <CommandItem key={item.code} value={item.code}
              onSelect={() => { onChange(item.code); setOpen(false); setQuery(''); }}
              className="min-h-11 cursor-pointer px-3 py-2">
              <Check className={`h-4 w-4 ${item.code === value ? 'text-green-700' : 'invisible'}`} />
              <span className="min-w-0 break-words">{item.name}</span>
            </CommandItem>)}
            {filtered.length > 150 && <p className="px-3 py-2 text-xs text-gray-500">Showing 150 of {filtered.length}. Search to narrow the list.</p>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {error && <p id={errorId} className="mt-1 text-xs text-red-500">{error}</p>}
  </div>;
}

export function CompactAddressSummary({ kind, address, onEdit }: {
  kind: 'pickup' | 'delivery'; address: SavedGeoAddress; onEdit: () => void;
}) {
  return <div className="min-w-0 rounded-xl border border-[#1DBF73]/30 bg-[#f8fcfa] p-3.5">
    <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <MapPin className="h-4 w-4 shrink-0 text-[#0d8f5d]" aria-hidden="true" />
        <p className="text-sm font-bold text-foreground">{kind === 'pickup' ? 'Pickup Address' : 'Delivery Address'}</p>
      </div>
      <button type="button" onClick={onEdit} aria-label={`Edit ${kind} address`}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#0d8f5d] hover:bg-green-50 focus-visible:outline-2 focus-visible:outline-[#0d8f5d]">
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit Address
      </button>
    </div>
    <p className="mt-1.5 break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{address.specific}</p>
    <p className="break-words text-xs leading-5 text-foreground/80 [overflow-wrap:anywhere]">
      Barangay {address.barangay}, {address.city}{address.province ? `, ${address.province}` : ''}
    </p>
    <p className="break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{address.region}</p>
  </div>;
}

export function PhilippineAddressFields({ kind, selection, onChange, cityPath, onCityPathChange, area, loading, error, retry, fieldErrors }: {
  kind: 'pickup' | 'delivery'; selection: GeoSelection; onChange: (next: GeoSelection) => void;
  cityPath: GeoCityPath; onCityPathChange: (path: GeoCityPath) => void;
  area: GeoArea | null; loading: boolean; error: string; retry: () => void; fieldErrors: Record<string, string>;
}) {
  const region = PSGC_REGIONS.find((item) => item.code === selection.regionCode);
  const provinceOptions = geoProvinceOptions(selection.regionCode);
  const independentOptions = geoIndependentCityOptions(selection.regionCode);
  const regionCityOptions = geoRegionCityOptions(selection.regionCode);
  const cityOptions = geoCityOptions(selection, area, cityPath);
  const barangayOptions = geoBarangayOptions(selection, area);
  const prefix = kind === 'pickup' ? 'pickup' : 'delivery';
  const update = (level: keyof GeoSelection) => (code: string) => onChange(changeGeoSelection(selection, level, code));
  return <div className="space-y-3">
    <SearchableGeoSelect scope={kind} label="Region" value={selection.regionCode} options={PSGC_REGIONS}
      placeholder="Select region" error={fieldErrors[`${prefix}Region`]} onChange={update('regionCode')} />
    {region && provinceOptions.length > 0 && cityPath === 'province' && <SearchableGeoSelect scope={kind}
      label={region.code === '1900000000' ? 'Province / Special Geographic Area' : 'Province'}
      value={selection.provinceCode} options={provinceOptions} placeholder="Select province"
      error={fieldErrors[`${prefix}Province`]} required
      onChange={update('provinceCode')} />}
    {region && provinceOptions.length > 0 && (independentOptions.length > 0 || regionCityOptions.length > 0) &&
      <div className="flex flex-col gap-2">
        {independentOptions.length > 0 && cityPath !== 'independent' && <button type="button"
          onClick={() => { onChange(changeGeoSelection(selection, 'provinceCode', '')); onCityPathChange('independent'); }}
          className="flex min-h-11 w-full items-center justify-center rounded-lg border border-[#1DBF73]/50 bg-white px-3 text-center text-xs font-semibold text-[#0d8f5d] hover:bg-green-50 active:bg-green-100 focus-visible:outline-2 focus-visible:outline-[#0d8f5d]">
          Choose independent city
        </button>}
        {regionCityOptions.length > 0 && cityPath !== 'regionCity' && <button type="button"
          onClick={() => { onChange(changeGeoSelection(selection, 'provinceCode', '')); onCityPathChange('regionCity'); }}
          className="flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-white px-3 text-center text-xs font-semibold text-foreground hover:bg-accent active:bg-muted focus-visible:outline-2 focus-visible:outline-[#0d8f5d]">
          Choose city without province
        </button>}
        {cityPath !== 'province' && <button type="button"
          onClick={() => { onChange(changeGeoSelection(selection, 'provinceCode', '')); onCityPathChange('province'); }}
          className="flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-white px-3 text-center text-xs font-semibold text-foreground hover:bg-accent active:bg-muted focus-visible:outline-2 focus-visible:outline-[#0d8f5d]">
          Choose province instead
        </button>}
      </div>}
    {region && <SearchableGeoSelect scope={kind} label="City / Municipality" value={selection.cityCode}
      options={cityOptions} placeholder={loading ? 'Loading locations…' : canSelectGeoCity(selection, cityPath) ? 'Select city / municipality' : 'Select province or city path first'}
      disabled={loading || !!error || !canSelectGeoCity(selection, cityPath)}
      error={fieldErrors[`${prefix}City`]} onChange={update('cityCode')} />}
    {region && <SearchableGeoSelect scope={kind} label="Barangay" value={selection.barangayCode}
      options={barangayOptions} placeholder={loading ? 'Loading barangays…' : 'Select barangay'}
      disabled={!selection.cityCode || loading || !!error} error={fieldErrors[`${prefix}Barangay`]}
      onChange={update('barangayCode')} />}
    {error && <div role="alert" className="text-xs text-red-500">{error} <button type="button" onClick={retry} className="ml-1 font-semibold underline">Try again</button></div>}
  </div>;
}
