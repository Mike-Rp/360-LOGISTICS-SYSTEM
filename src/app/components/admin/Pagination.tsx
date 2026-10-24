import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE = 10;

type PageItem = number | 'start-ellipsis' | 'end-ellipsis';

function pageItems(current: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'end-ellipsis', total];
  if (current >= total - 3) return [1, 'start-ellipsis', ...Array.from({ length: 5 }, (_, index) => total - 4 + index)];
  return [1, 'start-ellipsis', current - 1, current, current + 1, 'end-ellipsis', total];
}

export function usePagination<T>(items: readonly T[], pageSize = PAGE_SIZE) {
  const [requestedPage, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, totalPages);

  // Live data can shrink while the user is looking at the final page.
  useEffect(() => {
    if (requestedPage > totalPages) setPage(totalPages);
  }, [requestedPage, totalPages]);

  return {
    page,
    setPage,
    totalPages,
    pageItems: items.slice((page - 1) * pageSize, page * pageSize),
  };
}

export function useStablePageHeight(page: number, totalItems: number, pageSize: number, scope = '') {
  const areaRef = useRef<HTMLDivElement>(null);
  const fullPageHeight = useRef(0);
  const areaWidth = useRef(0);
  const previousScope = useRef(scope);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      fullPageHeight.current = 0;
      area.style.minHeight = '';
    }

    const hasMoreThanOnePage = totalItems > pageSize;
    const pageIsFull = hasMoreThanOnePage && page * pageSize <= totalItems;
    const measure = () => {
      const width = area.clientWidth;
      if (width !== areaWidth.current) {
        areaWidth.current = width;
        if (pageIsFull) fullPageHeight.current = 0;
      }
      if (pageIsFull) area.style.minHeight = '';
      if (hasMoreThanOnePage && area.scrollHeight > fullPageHeight.current) {
        fullPageHeight.current = area.scrollHeight;
      }
      area.style.minHeight = hasMoreThanOnePage && fullPageHeight.current
        ? `${fullPageHeight.current}px` : '';
    };

    measure();
    const observer = new ResizeObserver(() => {
      if (area.clientWidth !== areaWidth.current || area.scrollHeight > fullPageHeight.current) measure();
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [page, totalItems, pageSize, scope]);

  return areaRef;
}

interface PaginationFooterProps {
  page: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  singular: string;
  plural: string;
  className?: string;
  children?: ReactNode;
  readable?: boolean;
}

export function PaginationFooter({ page, totalItems, pageSize = PAGE_SIZE, onPageChange, singular, plural, className = '', children, readable = false }: PaginationFooterProps) {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className={`grid grid-cols-1 items-center gap-1.5 px-4 py-2 print:hidden lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-0 lg:py-2.5 ${className}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <p className={`${readable ? 'text-sm' : 'text-xs'} text-muted-foreground`}>
          <span className="font-semibold text-foreground">{start}–{end}</span> of{' '}
          <span className="font-semibold text-foreground">{totalItems}</span> {totalItems === 1 ? singular : plural}
        </p>
        {children}
      </div>

      {totalPages > 1 && (
        <nav aria-label={`${plural} pages`} className="flex max-w-full flex-wrap items-center justify-center justify-self-center gap-1">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Previous page"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-white text-foreground/70 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageItems(page, totalPages).map(item => typeof item === 'number' ? (
            <button key={item} type="button" onClick={() => onPageChange(item)} aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              className={`h-10 min-w-10 rounded-md border px-1 ${readable ? 'text-sm' : 'text-xs'} font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${item === page ? 'inline-flex' : 'hidden sm:inline-flex'} items-center justify-center ${
                item === page
                  ? 'border-primary bg-primary text-white'
                  : 'border-transparent text-foreground/70 hover:border-border hover:bg-white'
              }`}>
              {item}
            </button>
          ) : (
            <span key={item} aria-hidden="true" className={`hidden w-5 text-center text-muted-foreground sm:inline ${readable ? 'text-sm' : 'text-xs'}`}>…</span>
          ))}
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page === totalPages} aria-label="Next page"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-white text-foreground/70 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
      {totalPages > 1 && <span aria-hidden="true" className="hidden lg:block" />}
    </div>
  );
}
