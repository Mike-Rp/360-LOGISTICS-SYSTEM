import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type RecordKind = 'assignment' | 'driver';
const ADD_EVENT = '360-local-record-added';
const localAdds = new Map<string, { kind: RecordKind; id: string; createdAt?: string; highlightedUntil?: number }>();
const recordKey = (kind: RecordKind, id: string) => `${kind}:${id}`;

export function creationTime(createdAt: string | undefined, id: string, kind: RecordKind = 'assignment'): number | null {
  const stored = createdAt ?? localAdds.get(recordKey(kind, id))?.createdAt;
  const time = stored ? Date.parse(stored) : NaN;
  return Number.isFinite(time) ? time : null;
}

export function sortNewestFirst<T extends { createdAt?: string }>(records: readonly T[], getId: (record: T) => string, kind: RecordKind = 'assignment'): T[] {
  return [...records].sort((left, right) => {
    const leftId = getId(left), rightId = getId(right);
    const leftTime = creationTime(left.createdAt, leftId, kind);
    const rightTime = creationTime(right.createdAt, rightId, kind);
    if (leftTime === null && rightTime !== null) return 1;
    if (rightTime === null && leftTime !== null) return -1;
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime;
    return leftId < rightId ? 1 : leftId > rightId ? -1 : 0;
  });
}

export function markLocalRecordAdded(kind: RecordKind, id: string): void {
  localAdds.set(recordKey(kind, id), { kind, id });
}

export function pendingLocalRecordIds(kind: RecordKind): string[] {
  return [...localAdds.values()].filter((record) => record.kind === kind && !record.createdAt).map((record) => record.id);
}

export function confirmLocalRecordCreated(kind: RecordKind, id: string, createdAt: string): void {
  const record = localAdds.get(recordKey(kind, id));
  if (!record || record.createdAt || !Number.isFinite(Date.parse(createdAt))) return;
  record.createdAt = createdAt; // Read from the saved row, never inferred from its ID or display dates.
  record.highlightedUntil = Date.now() + 3000;
  window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail: { kind } }));
}

function latestHighlight(kind: RecordKind) {
  return sortNewestFirst([...localAdds.values()].filter((record) => record.kind === kind && (record.highlightedUntil ?? 0) > Date.now()),
    (record) => record.id, kind)[0];
}

export function useLocalAddedHighlight(kind: RecordKind, onLocalAdded: () => void): string | null {
  const [highlightedId, setHighlightedId] = useState<string | null>(() => latestHighlight(kind)?.id ?? null);
  const onAdded = useRef(onLocalAdded);
  onAdded.current = onLocalAdded;
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      const record = latestHighlight(kind);
      setHighlightedId(record?.id ?? null);
      if (record) timer = setTimeout(() => setHighlightedId(null), Math.max(0, (record.highlightedUntil ?? 0) - Date.now()));
    };
    const added = (event: Event) => {
      if ((event as CustomEvent<{ kind: RecordKind }>).detail.kind !== kind) return;
      onAdded.current();
      update();
    };
    update();
    window.addEventListener(ADD_EVENT, added);
    return () => { clearTimeout(timer); window.removeEventListener(ADD_EVENT, added); };
  }, [kind]);
  return highlightedId;
}

export function newRecordHighlight(id: string, highlightedId: string | null): CSSProperties {
  return { backgroundColor: id === highlightedId ? '#ecfdf5' : undefined, transition: 'background-color 300ms' };
}
