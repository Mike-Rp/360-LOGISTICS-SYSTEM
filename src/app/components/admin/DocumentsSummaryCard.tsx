import { ChevronRight, FileText } from 'lucide-react';
import { followAdminLink } from '../../lib/adminNavigation';

const actionClass = 'mt-3 flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default function DocumentsSummaryCard({ count, onActivate, href }: {
  count: string;
  onActivate: () => void;
  href?: string;
}) {
  const actionContent = <>
    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="min-w-0 flex-1">View Documents</span>
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </>;

  return <section className="min-w-0 rounded-xl border border-border/70 bg-muted/25 p-4">
    <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Documents</h3>
    <p className="mt-2 text-sm font-semibold text-foreground">{count}</p>
    {href
      ? <a href={href} onClick={(event) => followAdminLink(event, onActivate)} className={actionClass}>{actionContent}</a>
      : <button type="button" onClick={onActivate} className={actionClass}>{actionContent}</button>}
  </section>;
}
