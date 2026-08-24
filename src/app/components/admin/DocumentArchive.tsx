import { useState, useMemo } from 'react';
import {
  FileText, X, CheckCircle2, Clock, XCircle,
  Truck, User, Eye, Search, Calendar, Package,
  AlertCircle, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { Assignment, CompletedTask, DocStatus } from '../../data/assignmentTypes';

interface Props {
  assignments:     Assignment[];
  completed:       CompletedTask[];
  setAssignments?: React.Dispatch<React.SetStateAction<Assignment[]>>;
  isViewOnly?:     boolean;
}

type DocFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_CFG: Record<DocStatus, { label: string; badge: string; icon: React.ReactNode }> = {
  pending:  { label: 'Pending',  badge: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock        className="w-3 h-3" /> },
  approved: { label: 'Approved', badge: 'bg-green-50 text-green-700 border-green-200', icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected: { label: 'Rejected', badge: 'bg-red-50   text-red-700   border-red-200',   icon: <XCircle      className="w-3 h-3" /> },
};

/* ── Image Preview Modal ── */
function ImagePreviewModal({ url, docType, onClose }: { url: string; docType: string; onClose: () => void }) {
  const isPdf = url.startsWith('data:application/pdf');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">{docType}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/10">
          {isPdf
            ? <iframe src={url} className="w-full h-[500px] rounded-lg border border-border" title={docType} />
            : <img src={url} alt={docType} className="max-w-full max-h-[500px] object-contain rounded-xl shadow-md" />
          }
        </div>
        <div className="px-5 py-3 border-t border-border flex-shrink-0">
          <a href={url} download={`${docType}.jpg`} className="text-xs text-primary underline hover:text-primary/80">
            Download file
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Highlight helper ── */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5 not-italic font-semibold">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

interface DocGroup {
  assignmentId: string;
  driverName:   string;
  truckPlate:   string;
  deliveryDate: string;
  isCompleted:  boolean;
  docs: Array<{
    type:          string;
    docStatus:     DocStatus;
    fileUrl?:      string;
    rejectReason?: string;
  }>;
}

/* ── Accordion row ── */
function GroupRow({
  group, filter, search, open, onToggle, onPreview,
}: {
  group:     DocGroup;
  filter:    DocFilter;
  search:    string;
  open:      boolean;
  onToggle:  () => void;
  onPreview: (url: string, type: string) => void;
}) {
  const q = search.trim().toLowerCase();

  const visibleDocs = group.docs.filter(d => filter === 'all' || d.docStatus === filter);
  if (visibleDocs.length === 0) return null;

  const approved = group.docs.filter(d => d.docStatus === 'approved').length;
  const pending  = group.docs.filter(d => d.docStatus === 'pending').length;
  const rejected = group.docs.filter(d => d.docStatus === 'rejected').length;

  return (
    <>
      {/* ── Assignment header row (5 cols) ── */}
      <tr
        onClick={onToggle}
        className={`cursor-pointer select-none transition-colors border-b border-border/60
          ${open ? 'bg-primary/5' : 'bg-white hover:bg-muted/30'}`}
      >
        {/* Chevron + Assignment ID */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 transition-colors ${open ? 'text-primary' : 'text-muted-foreground'}`}>
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </div>
            <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${group.isCompleted ? 'bg-purple-100' : 'bg-primary/10'}`}>
              <Package className={`w-3.5 h-3.5 ${group.isCompleted ? 'text-purple-600' : 'text-primary'}`} />
            </div>
            <span className="font-bold font-mono text-sm text-foreground">
              <Hi text={group.assignmentId} q={q} />
            </span>
            {group.isCompleted && (
              <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full font-medium leading-none">Done</span>
            )}
          </div>
        </td>

        {/* Driver */}
        <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground font-medium">
          <Hi text={group.driverName} q={q} />
        </td>

        {/* Truck */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-sm font-semibold text-foreground bg-slate-100 px-2 py-0.5 rounded-md">
            <Hi text={group.truckPlate} q={q} />
          </span>
        </td>

        {/* Date */}
        <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
          {group.deliveryDate || '—'}
        </td>

        {/* Docs summary */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {group.docs.length} doc{group.docs.length !== 1 ? 's' : ''}
            </span>
            {approved > 0 && (
              <span className="text-[11px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-full font-medium">
                {approved} approved
              </span>
            )}
            {pending > 0 && (
              <span className="text-[11px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-medium">
                {pending} pending
              </span>
            )}
            {rejected > 0 && (
              <span className="text-[11px] px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded-full font-medium">
                {rejected} rejected
              </span>
            )}
          </div>
        </td>
      </tr>

      {/* ── Expanded area — spans all 5 cols ── */}
      {open && (
        <tr className="border-b border-border/40">
          <td colSpan={5} className="p-0">
            <div className="ml-10 border-l-2 border-primary/20">

              {/* Sub-header: DOCUMENT · STATUS · REASON/NOTES · FILE */}
              <div className="flex items-center gap-3 px-4 py-1.5 bg-muted/40 border-b border-border/40">
                <div className="flex-1 min-w-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Document
                </div>
                <div className="w-24 flex-shrink-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </div>
                <div className="w-44 flex-shrink-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Remarks
                </div>
                <div className="w-16 flex-shrink-0 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-right">
                  File
                </div>
              </div>

              {/* Document rows */}
              {visibleDocs.map((doc, i) => {
                const cfg = STATUS_CFG[doc.docStatus];
                const isLast = i === visibleDocs.length - 1;
                return (
                  <div
                    key={`${group.assignmentId}-${doc.type}`}
                    className={`flex items-center gap-3 px-4 py-2 ${!isLast ? 'border-b border-border/30' : ''} ${
                      doc.docStatus === 'rejected' ? 'bg-red-50/40'
                      : doc.docStatus === 'approved' ? 'bg-green-50/20'
                      : 'bg-amber-50/15'
                    }`}
                  >
                    {/* Doc name */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-5 h-5 bg-primary/10 rounded flex items-center justify-center flex-shrink-0">
                        <FileText className="w-3 h-3 text-primary" />
                      </div>
                      <span className="text-sm text-foreground font-medium truncate">
                        <Hi text={doc.type} q={q} />
                      </span>
                    </div>

                    {/* Status */}
                    <div className="w-24 flex-shrink-0">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.badge}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </div>

                    {/* Reason */}
                    <div className="w-44 flex-shrink-0">
                      {doc.docStatus === 'rejected' && doc.rejectReason ? (
                        <div className="flex items-start gap-1">
                          <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-red-600 leading-snug line-clamp-2">
                            {doc.rejectReason}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </div>

                    {/* File */}
                    <div className="w-16 flex-shrink-0 text-right">
                      {doc.fileUrl && doc.fileUrl !== '[image-data-stripped]' ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onPreview(doc.fileUrl!, doc.type); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/8 hover:bg-primary/15 border border-primary/20 text-primary rounded-lg text-xs font-medium transition-colors"
                        >
                          <Eye className="w-3 h-3" /> View
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground/40 italic">No file</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Mobile card (replaces GroupRow's table markup below `sm`) ── */
function GroupCard({
  group, filter, search, open, onToggle, onPreview,
}: {
  group:     DocGroup;
  filter:    DocFilter;
  search:    string;
  open:      boolean;
  onToggle:  () => void;
  onPreview: (url: string, type: string) => void;
}) {
  const q = search.trim().toLowerCase();

  const visibleDocs = group.docs.filter(d => filter === 'all' || d.docStatus === filter);
  if (visibleDocs.length === 0) return null;

  const approved = group.docs.filter(d => d.docStatus === 'approved').length;
  const pending  = group.docs.filter(d => d.docStatus === 'pending').length;
  const rejected = group.docs.filter(d => d.docStatus === 'rejected').length;

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden">
      <div onClick={onToggle} className={`flex items-start gap-3 p-4 cursor-pointer select-none transition-colors ${open ? 'bg-primary/5' : 'hover:bg-muted/30'}`}>
        <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${open ? 'text-primary' : 'text-muted-foreground'}`}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${group.isCompleted ? 'bg-purple-100' : 'bg-primary/10'}`}>
          <Package className={`w-4 h-4 ${group.isCompleted ? 'text-purple-600' : 'text-primary'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold font-mono text-sm text-foreground"><Hi text={group.assignmentId} q={q} /></span>
            {group.isCompleted && (
              <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full font-medium leading-none">Done</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            <Hi text={group.driverName} q={q} /> · <Hi text={group.truckPlate} q={q} /> · {group.deliveryDate || '—'}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            {approved > 0 && (
              <span className="text-[11px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-full font-medium">{approved} approved</span>
            )}
            {pending > 0 && (
              <span className="text-[11px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-medium">{pending} pending</span>
            )}
            {rejected > 0 && (
              <span className="text-[11px] px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded-full font-medium">{rejected} rejected</span>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-muted/10 divide-y divide-border/40">
          {visibleDocs.map((doc) => {
            const cfg = STATUS_CFG[doc.docStatus];
            return (
              <div key={`${group.assignmentId}-${doc.type}`} className="flex items-center gap-2 px-4 py-2.5">
                <div className="w-5 h-5 bg-primary/10 rounded flex items-center justify-center flex-shrink-0">
                  <FileText className="w-3 h-3 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-foreground font-medium truncate block"><Hi text={doc.type} q={q} /></span>
                  {doc.docStatus === 'rejected' && doc.rejectReason && (
                    <div className="flex items-start gap-1 mt-0.5">
                      <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-red-600 leading-snug">{doc.rejectReason}</span>
                    </div>
                  )}
                </div>
                <span className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.badge}`}>
                  {cfg.icon} {cfg.label}
                </span>
                {doc.fileUrl && doc.fileUrl !== '[image-data-stripped]' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onPreview(doc.fileUrl!, doc.type); }}
                    className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-primary/8 hover:bg-primary/15 border border-primary/20 text-primary rounded-lg text-xs font-medium transition-colors"
                  >
                    <Eye className="w-3 h-3" /> View
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main export ── */
export default function DocumentArchive({ assignments, completed }: Props) {
  const [filter,  setFilter]  = useState<DocFilter>('all');
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const [search,  setSearch]  = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setOpenIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const q = search.trim().toLowerCase();

  const { groups, counts } = useMemo(() => {
    const all: DocGroup[] = [];

    const push = (
      id: string, driverName: string, truckPlate: string,
      deliveryDate: string, isCompleted: boolean,
      docs: Assignment['documents']
    ) => {
      const uploaded = docs.filter(d => d.uploaded);
      if (!uploaded.length) return;
      const matchesSearch =
        !q || [id, driverName, truckPlate].some(f => f.toLowerCase().includes(q)) ||
        uploaded.some(d => d.type.toLowerCase().includes(q));
      if (!matchesSearch) return;
      all.push({
        assignmentId: id, driverName, truckPlate, deliveryDate, isCompleted,
        docs: uploaded.map(d => ({
          type: d.type, docStatus: d.docStatus, fileUrl: d.fileUrl, rejectReason: d.rejectReason,
        })),
      });
    };

    for (const a of assignments) push(a.id, a.driverName, a.truckPlate, a.deliveryDate, false, a.documents);
    for (const c of completed)   push(c.id, c.driverName, c.truckPlate, c.deliveryDate, true,  c.documents);

    const flatDocs = all.flatMap(g => g.docs);
    const counts = {
      all:      flatDocs.length,
      pending:  flatDocs.filter(d => d.docStatus === 'pending').length,
      approved: flatDocs.filter(d => d.docStatus === 'approved').length,
      rejected: flatDocs.filter(d => d.docStatus === 'rejected').length,
    };

    return { groups: all, counts };
  }, [assignments, completed, q]);

  const visibleGroups = groups.filter(g =>
    filter === 'all' || g.docs.some(d => d.docStatus === filter)
  );

  const allOpen = visibleGroups.length > 0 && visibleGroups.every(g => openIds.has(g.assignmentId));
  const toggleAll = () => {
    if (allOpen) setOpenIds(new Set());
    else setOpenIds(new Set(visibleGroups.map(g => g.assignmentId)));
  };

  const emptyAll    = counts.all === 0;
  const emptyFilter = !emptyAll && visibleGroups.length === 0;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Document Archive</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Click any assignment row to expand its documents.</p>
        </div>
        <div className="flex items-center gap-1.5 border border-border rounded-xl px-3 py-2 bg-white shadow-sm min-w-[220px]">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search driver, truck, assignment…"
            className="text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground/60 flex-1 min-w-0"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: 'all',      label: 'All'      },
          { key: 'pending',  label: 'Pending'  },
          { key: 'approved', label: 'Approved' },
          { key: 'rejected', label: 'Rejected' },
        ] as { key: DocFilter; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
              filter === key
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-foreground border-border hover:bg-accent'
            }`}
          >
            {label}
            <span className={`text-xs rounded-full px-1.5 min-w-[18px] text-center ${
              filter === key ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {counts[key]}
            </span>
          </button>
        ))}

        {visibleGroups.length > 0 && (
          <button onClick={toggleAll} className="ml-auto text-xs text-primary font-medium hover:underline">
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {/* Empty states */}
      {emptyAll ? (
        <div className="bg-white rounded-2xl border border-dashed border-border py-16 text-center">
          <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-medium text-foreground">No documents uploaded yet</p>
          <p className="text-sm text-muted-foreground mt-1">Documents uploaded by drivers will appear here.</p>
        </div>
      ) : emptyFilter ? (
        <div className="bg-white rounded-2xl border border-dashed border-border py-16 text-center">
          <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-medium text-foreground">
            {q ? `No results for "${search}"` : `No ${filter} documents`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">Try a different search term or filter.</p>
          {q && (
            <button onClick={() => setSearch('')}
              className="mt-3 px-4 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors">
              Clear Search
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          {/* Desktop/tablet table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    <div className="flex items-center gap-1.5 pl-7"><Package className="w-3.5 h-3.5" /> Assignment</div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Driver</div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    <div className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Truck</div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Date</div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    Docs
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => (
                  <GroupRow
                    key={group.assignmentId}
                    group={group}
                    filter={filter}
                    search={search}
                    open={openIds.has(group.assignmentId)}
                    onToggle={() => toggle(group.assignmentId)}
                    onPreview={(url, type) => setPreview({ url, type })}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="sm:hidden p-3 space-y-3">
            {visibleGroups.map((group) => (
              <GroupCard
                key={group.assignmentId}
                group={group}
                filter={filter}
                search={search}
                open={openIds.has(group.assignmentId)}
                onToggle={() => toggle(group.assignmentId)}
                onPreview={(url, type) => setPreview({ url, type })}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{visibleGroups.length}</span> assignment{visibleGroups.length !== 1 ? 's' : ''}
              {filter !== 'all' && <> · <span className="capitalize">{filter}</span> filter active</>}
            </p>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="text-xs text-primary hover:underline font-medium">
                Show all
              </button>
            )}
          </div>
        </div>
      )}

      {preview && (
        <ImagePreviewModal url={preview.url} docType={preview.type} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}