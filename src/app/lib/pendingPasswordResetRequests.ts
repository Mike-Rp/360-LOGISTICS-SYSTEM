import type { CsrPasswordResetRequest } from './db';

export function pageForPasswordResetRequest(requests: CsrPasswordResetRequest[], id: string, pageSize: number): number | null {
  const index = requests.findIndex((request) => request.id === id);
  return index < 0 ? null : Math.floor(index / pageSize) + 1;
}
