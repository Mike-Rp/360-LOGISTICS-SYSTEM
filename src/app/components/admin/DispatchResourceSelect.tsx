import { useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandInput, CommandItem, CommandList } from '../ui/command';

type ResourceOption = { id: string; label: string };

const searchKey = (text: string, compact: boolean) => {
  const normalized = text.trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return compact ? normalized.replace(/\s+/g, '') : normalized;
};

export function filterDispatchResources(options: ResourceOption[], query: string, compact = false) {
  const needle = searchKey(query, compact);
  return needle ? options.filter((option) => searchKey(option.label, compact).includes(needle)) : options;
}

export default function DispatchResourceSelect({ label, value, onChange, options, placeholder, searchPlaceholder,
  emptyLabel, noResultsLabel, disabled = false, hasError, compactSearch = false }: {
  label: string; value: string; onChange: (id: string) => void;
  options: ResourceOption[]; placeholder: string; searchPlaceholder: string;
  emptyLabel: string; noResultsLabel: string; disabled?: boolean; hasError?: boolean; compactSearch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const unavailable = disabled || options.length === 0;
  const selected = options.find((option) => option.id === value);
  const filtered = filterDispatchResources(options, query, compactSearch);

  return <Popover open={open} onOpenChange={(next) => {
    if (next) setDialogContainer(triggerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? null);
    setOpen(next);
    if (!next) setQuery('');
  }}>
    <PopoverTrigger asChild>
      <button ref={triggerRef} type="button" role="combobox" aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? (unavailable ? emptyLabel : placeholder)}`}
        aria-invalid={hasError || undefined} disabled={unavailable}
        className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-green-700 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${hasError ? 'border-red-400' : 'border-gray-200'}`}>
        <span className="min-w-0 truncate">{selected?.label ?? (unavailable ? emptyLabel : placeholder)}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent container={dialogContainer} align="start" sideOffset={4} collisionPadding={12}
      onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}
      className="w-[min(var(--radix-popover-trigger-width),calc(100vw-24px))] p-0">
      <Command shouldFilter={false}>
        <CommandInput ref={searchRef} aria-label={`Search ${label}`} placeholder={searchPlaceholder}
          value={query} onValueChange={setQuery}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); } }} />
        <CommandList className="max-h-[min(260px,var(--radix-popover-content-available-height))] touch-pan-y overscroll-y-contain">
          {filtered.length === 0 && <p role="status" className="px-3 py-5 text-center text-sm text-gray-500">{noResultsLabel}</p>}
          {filtered.map((option) => <CommandItem key={option.id} value={option.id}
            aria-selected={option.id === value}
            onSelect={() => { onChange(option.id); setOpen(false); setQuery(''); }}
            className="min-h-11 cursor-pointer px-3 py-2">
            <Check className={`h-4 w-4 ${option.id === value ? 'text-green-700' : 'invisible'}`} aria-hidden="true" />
            <span className="min-w-0 break-words">{option.label}</span>
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
