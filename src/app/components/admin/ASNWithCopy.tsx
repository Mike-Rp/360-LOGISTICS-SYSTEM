import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function ASNWithCopy({ value, children }: { value: string; children?: ReactNode }) {
  const asn = value.trim();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const session = useRef<object | null>(null);

  useEffect(() => {
    session.current = {};
    setCopied(false);
    return () => {
      session.current = null;
      clearTimeout(timer.current);
    };
  }, [asn]);

  if (!asn) return <>{children ?? value}</>;

  return (
    <span className="group/asn inline-flex min-w-0 max-w-full items-center gap-1 align-middle">
      <span className="min-w-0 break-all whitespace-normal transition-colors duration-150 motion-reduce:transition-none group-hover/asn:text-primary group-focus-within/asn:text-primary group-hover/asn:[&_mark]:text-primary group-focus-within/asn:[&_mark]:text-primary">{children ?? asn}</span>
      <button type="button" aria-label={`Copy ${asn}`} title={`Copy ${asn}`}
        onKeyDown={event => event.stopPropagation()}
        onClick={async event => {
          event.stopPropagation();
          const currentSession = session.current;
          try {
            await navigator.clipboard.writeText(asn);
            if (session.current !== currentSession) return;
            clearTimeout(timer.current);
            setCopied(true);
            timer.current = setTimeout(() => setCopied(false), 1800);
            toast('Copied', { id: 'asn-copy', duration: 1800 });
          } catch {
            if (session.current === currentSession) toast.error('Unable to copy', { id: 'asn-copy', duration: 1800 });
          }
        }}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <span className="relative h-3.5 w-3.5" aria-hidden="true">
          <Copy className={`absolute inset-0 h-3.5 w-3.5 group-hover/asn:text-primary group-focus-within/asn:text-primary transition-[opacity,transform] duration-150 motion-reduce:transition-none motion-reduce:transform-none ${copied ? 'scale-75 opacity-0' : 'scale-100 opacity-0 group-hover/asn:opacity-100 group-focus-within/asn:opacity-100 [@media(hover:none)]:opacity-100 [@media(any-pointer:coarse)]:opacity-100'}`} />
          <Check className={`absolute inset-0 h-3.5 w-3.5 text-muted-foreground transition-[opacity,transform] duration-150 motion-reduce:transition-none motion-reduce:transform-none ${copied ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`} />
        </span>
      </button>
    </span>
  );
}
