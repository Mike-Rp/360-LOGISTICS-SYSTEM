import type { MouseEvent } from 'react';
import type { Assignment } from '../data/assignmentTypes';

export const ADMIN_PATHS = {
  Dashboard: '/dashboard',
  Monitor: '/dispatch',
  Deliveries: '/deliveries',
  Documents: '/documents',
  Reports: '/reports',
  Accounts: '/drivers-trucks',
} as const;

export type AdminPage = keyof typeof ADMIN_PATHS;
export const ADMIN_NAVIGATION_EVENT = '360-admin-navigation';

// Dashboard review actions use an exact document target for one pending upload, otherwise the queue.
export function pendingDocumentReviewTarget(assignments: readonly Pick<Assignment, 'id' | 'documents'>[]) {
  const pending = assignments.flatMap((assignment) => assignment.documents
    .filter((doc) => doc.uploaded && doc.docStatus === 'pending')
    .map((doc) => ({ assignmentId: assignment.id, docType: doc.type })));
  return pending.length === 1 ? { ...pending[0], review: true } : { review: true };
}

export function adminPageFromUrl(url = new URL(window.location.href)): AdminPage {
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path === '/accounts') return 'Accounts'; // Keep existing bookmarks working.
  const page = (Object.keys(ADMIN_PATHS) as AdminPage[]).find((item) => ADMIN_PATHS[item] === path);
  if (page) return page;
  if (path === '/') {
    const legacyPage = url.searchParams.get('page');
    if (legacyPage && Object.prototype.hasOwnProperty.call(ADMIN_PATHS, legacyPage)) return legacyPage as AdminPage;
    try {
      const saved = localStorage.getItem('360_active_nav');
      if (saved && Object.prototype.hasOwnProperty.call(ADMIN_PATHS, saved)) return saved as AdminPage;
    } catch { /* The URL still works when storage is unavailable. */ }
  }
  return 'Dashboard';
}

export function adminHref(page: AdminPage, target?: { assignmentId?: string; docType?: string; review?: boolean; activityKey?: string }, tab?: 'completed'): string {
  const params = new URLSearchParams();
  if (target) {
    if (target.assignmentId !== undefined) params.set('assignment', target.assignmentId);
    if (target.docType) params.set('document', target.docType);
    if (target.review) params.set('review', 'true');
    if (target.activityKey) params.set('activity', target.activityKey);
  }
  if (page === 'Deliveries' && tab) params.set('tab', tab);
  const query = params.toString();
  return ADMIN_PATHS[page] + (query ? `?${query}` : '');
}

export function followAdminLink(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate();
}

export function pushAdminNavigation(page: AdminPage, target?: { assignmentId?: string; docType?: string; review?: boolean; activityKey?: string }, tab?: 'completed'): void {
  const href = adminHref(page, target, tab);
  if (!target && window.location.pathname + window.location.search === href) return;
  window.history.pushState({ ...window.history.state, adminNavigation: true }, '', href);
  window.dispatchEvent(new Event(ADMIN_NAVIGATION_EVENT));
}

export function startAdminNavigation(): AdminPage {
  let url = new URL(window.location.href);
  if (url.pathname === '/login') {
    const requested = url.searchParams.get('returnTo');
    const destination = requested?.startsWith('/') ? new URL(requested, url.origin) : null;
    url = destination?.origin === url.origin ? destination : new URL('/dashboard', url.origin);
  }
  const page = adminPageFromUrl(url);
  url.pathname = ADMIN_PATHS[page];
  url.searchParams.delete('page');
  // The login/session redirect establishes a landing entry before module visits.
  // Its duplicate keeps the first Back after login inside the authenticated app.
  const hasLanding = window.history.state?.adminNavigation === true;
  window.history.replaceState({ ...window.history.state, adminNavigation: true }, '', url);
  if (!hasLanding) window.history.pushState({ ...window.history.state }, '', url);
  return page;
}

export function redirectToAdminLogin(rememberDestination = true): void {
  if (window.location.pathname === '/login' && rememberDestination) return;
  const url = new URL(window.location.href);
  const login = new URL('/login', url.origin);
  if (rememberDestination) {
    url.pathname = ADMIN_PATHS[adminPageFromUrl(url)];
    url.searchParams.delete('page');
    login.searchParams.set('returnTo', url.pathname + url.search);
  }
  window.history.replaceState(null, '', login);
}
