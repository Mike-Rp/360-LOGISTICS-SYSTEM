import { useEffect, useId, useState } from 'react';
import { searchMapboxLocations, type SelectedLocation } from '../../lib/mapboxLocations';

const accessToken = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? '').trim();

interface Props {
  value: string;
  selected: SelectedLocation | null;
  onChange: (value: string) => void;
  onSelect: (place: SelectedLocation) => void;
  placeholder: string;
  hasError?: boolean;
}

export default function MapboxLocationInput({ value, selected, onChange, onSelect, placeholder, hasError }: Props) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<SelectedLocation[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'empty' | 'error' | 'unauthorized'>('idle');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = value.trim();
  const selectedMatches = selected?.formatted === value;

  useEffect(() => {
    if (!accessToken || selectedMatches || query.length < 3) {
      setSuggestions([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('searching');
    const timer = window.setTimeout(() => {
      searchMapboxLocations(query, accessToken, controller.signal)
        .then((results) => {
          setSuggestions(results);
          setActiveIndex(-1);
          setStatus(results.length ? 'idle' : 'empty');
          setOpen(true);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error('[location search] failed:', error);
          setSuggestions([]);
          setStatus(error instanceof Error && /\((401|403)\)/.test(error.message) ? 'unauthorized' : 'error');
          setOpen(true);
        });
    }, 320);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectedMatches]);

  const choose = (place: SelectedLocation) => {
    onSelect(place);
    setSuggestions([]);
    setOpen(false);
    setStatus('idle');
  };

  return <div className="relative min-w-0">
    <div className="relative">
      <input type="text" value={value} autoComplete="off" placeholder={placeholder}
        role="combobox" aria-autocomplete="list" aria-controls={listId}
        aria-expanded={open && suggestions.length > 0}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); return; }
          if (!open || !suggestions.length) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
          if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); choose(suggestions[activeIndex]); }
        }}
        className={`w-full rounded-[10px] border px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#1DBF73] focus:outline-none focus:ring-2 focus:ring-[#1DBF73]/25 ${hasError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
      />
    </div>
    {!accessToken && <p className="mt-1 text-xs text-amber-800">Location search is unavailable. Ask an administrator to check the Mapbox setup.</p>}
    {accessToken && !selectedMatches && status === 'searching' && <p className="mt-1 text-xs text-muted-foreground" role="status">Searching locations…</p>}
    {accessToken && open && status === 'error' && <p className="mt-1 text-xs text-amber-800" role="status">Location search failed. Please try again.</p>}
    {accessToken && open && status === 'unauthorized' && <p className="mt-1 text-xs text-amber-800" role="status">Location search key was rejected. Ask an administrator to check the Mapbox setup.</p>}
    {accessToken && open && status === 'empty' && <p className="mt-1 text-xs text-muted-foreground" role="status">No matching locations. Try another exact address.</p>}
    {accessToken && open && suggestions.length > 0 && <div id={listId} role="listbox"
      className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
      {suggestions.map((place, index) => <button key={`${place.formatted}-${index}`} type="button" role="option"
        aria-selected={activeIndex === index}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(place)}
        className={`block min-h-12 w-full border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-green-50 focus:bg-green-50 focus:outline-none ${activeIndex === index ? 'bg-green-50' : ''}`}>
        <span className="block text-sm font-medium text-foreground">{place.name}</span>
        <span className="block break-words text-xs text-muted-foreground">{place.formatted}</span>
      </button>)}
    </div>}
    {accessToken && <p className="mt-1 text-xs text-muted-foreground">Search results © Mapbox</p>}
  </div>;
}
