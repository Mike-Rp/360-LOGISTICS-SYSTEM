import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

export default function ASNWithCopy({ value, children, noWrap = false, label, alignTextStart = false, readableFeedback = false }: { value: string; children?: ReactNode; noWrap?: boolean; label?: string; alignTextStart?: boolean; readableFeedback?: boolean }) {
  const asn = value.trim();
  const [feedback, setFeedback] = useState<'copied' | 'error' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const session = useRef<object | null>(null);

  useEffect(() => {
    session.current = {};
    setFeedback(null);
    return () => {
      session.current = null;
      clearTimeout(timer.current);
    };
  }, [asn]);

  if (!asn) return <>{children ?? value}</>;

  // Cancel the button's 12px or 8px left padding only where text must align
  // with its parent. The padded button still extends left as a copy hitbox.
  const startOffset = alignTextStart ? (label ? '-ml-3' : '-ml-2') : '';

  return (
    <span className={`relative inline-flex min-w-0 max-w-full align-middle ${startOffset}`}>
      <button type="button" aria-label={`Copy assignment number ${asn}`}
        onKeyDown={event => event.stopPropagation()}
        onClick={async event => {
          event.stopPropagation();
          const currentSession = session.current;
          try {
            await navigator.clipboard.writeText(asn);
            if (session.current !== currentSession) return;
            clearTimeout(timer.current);
            setFeedback('copied');
            timer.current = setTimeout(() => setFeedback(null), 1800);
          } catch {
            if (session.current !== currentSession) return;
            clearTimeout(timer.current);
            setFeedback('error');
            timer.current = setTimeout(() => setFeedback(null), 1800);
          }
        }}
        className={`asn-copy-target inline-flex min-h-10 min-w-0 max-w-full cursor-pointer flex-wrap items-center gap-x-1 gap-y-0 rounded-lg text-foreground transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${label ? 'px-3 py-1.5' : 'px-2 py-1'}`}>
        {label && <span className="shrink-0 whitespace-nowrap font-medium text-slate-600">{label}</span>}
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className={`asn-copy-value ${noWrap ? 'whitespace-nowrap' : 'min-w-0 break-all whitespace-normal'}`}>{children ?? asn}</span>
          <span className="relative h-4 w-4 shrink-0" aria-hidden="true">
            {feedback === 'copied'
              ? <Check className="absolute inset-0 h-4 w-4 text-muted-foreground" />
              : <Copy className="asn-copy-icon absolute inset-0 h-4 w-4 transition-[color,opacity] duration-150 motion-reduce:transition-none" />}
          </span>
        </span>
      </button>
      {feedback && <span role="status" className={`pointer-events-none absolute left-0 top-full z-20 -mt-0.5 whitespace-nowrap rounded-md border border-border bg-white px-2 py-1 font-medium shadow-sm ${readableFeedback ? 'text-sm' : 'text-xs'} ${feedback === 'copied' ? 'text-foreground' : 'text-red-700'}`}>
        {feedback === 'copied' ? 'Copied!' : 'Unable to copy'}
      </span>}
    </span>
  );
}
