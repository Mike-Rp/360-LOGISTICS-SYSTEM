import type { CsrPasswordResetRequest } from './db';

// This is an OPM review queue, not a persisted notification read state.
export function pendingPasswordResetRequests(requests: CsrPasswordResetRequest[]): CsrPasswordResetRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    if (request.status !== 'pending' || !request.id || seen.has(request.id)) return false;
    seen.add(request.id);
    return true;
  });
}

export function pageForPasswordResetRequest(requests: CsrPasswordResetRequest[], id: string, pageSize: number): number | null {
  const index = requests.findIndex((request) => request.id === id);
  return index < 0 ? null : Math.floor(index / pageSize) + 1;
}
