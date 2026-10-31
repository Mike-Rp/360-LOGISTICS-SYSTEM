import { parsePhilippineMobile } from '../../lib/philippineMobile';

/* "+63 [ten digits]" field, behaving like the mobile field in Register Driver: digits only, stops at
   10, a counter, and pasted numbers (0917…, +63 917…) are cleaned up to the ten digits. `value` is
   just those ten digits. The parent owns the error text so it can also set it on submit. */
export default function MobileNumberField({ id, value, onChange, error, onError, ariaLabel, onBlur, disabled }: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  error: string;
  onError: (message: string) => void;
  ariaLabel: string;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  const handleInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const mobile = parsePhilippineMobile(raw);
    if (mobile && digits.length > 10) { onChange(mobile.subscriber); onError(''); return; }   // e.g. a pasted +63 917… or 0917…
    if (digits.length > 10) { onError('Enter only the 10-digit mobile number after +63.'); return; }
    onChange(digits);
    onError('');
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').trim();
    const mobile = parsePhilippineMobile(pasted);
    if (mobile) { onChange(mobile.subscriber); onError(''); }
    else if (/^\d{1,10}$/.test(pasted)) { onChange(pasted); onError(''); }
    else onError('Paste a valid Philippine mobile number.');
  };

  return (
    <div>
      <div className={`flex items-center rounded-xl border overflow-hidden focus-within:ring-2 focus-within:ring-primary/30 ${error ? 'border-red-400 bg-red-50' : 'border-border bg-white'} ${disabled ? 'opacity-60' : ''}`}>
        <span className="px-3 py-3 bg-muted/40 border-r border-border text-sm font-semibold text-foreground select-none whitespace-nowrap">+63</span>
        <input id={id} type="text" inputMode="numeric" autoComplete="off" value={value} maxLength={10} disabled={disabled}
          aria-label={ariaLabel} aria-invalid={error ? true : undefined} placeholder="9171234567"
          onChange={(e) => handleInput(e.target.value)} onPaste={handlePaste} onBlur={onBlur}
          className="min-w-0 flex-1 px-4 py-3 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-sm tracking-wider tabular-nums" />
        <span className={`px-3 text-xs font-medium tabular-nums ${value.length === 10 ? 'text-green-600' : 'text-muted-foreground'}`}>{value.length}/10</span>
      </div>
      {error && <p role="alert" className="text-xs text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}
