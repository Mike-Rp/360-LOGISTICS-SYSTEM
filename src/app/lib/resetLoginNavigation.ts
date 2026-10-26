const RESET_LOGIN_INTENT = 'reset-password';

export const resetLoginHref = '/login?account=staff&intent=reset-password';

export function isResetLoginIntent(url: URL): boolean {
  return url.pathname === '/login'
    && url.searchParams.get('account') === 'staff'
    && url.searchParams.get('intent') === RESET_LOGIN_INTENT;
}

export function clearResetTokenFromHistory(): void {
  if (window.location.pathname === '/reset-password' && window.location.search) {
    window.history.replaceState(window.history.state, '', '/reset-password');
  }
}
