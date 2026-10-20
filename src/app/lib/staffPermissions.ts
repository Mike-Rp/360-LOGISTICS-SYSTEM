import type { AdminRole } from '../data/assignmentTypes';

// Mirrors public.can_write() and public.is_opm() in the Supabase migrations.
// UI capabilities guide presentation; database policies remain the authority.
export const canDispatchAssignments = (role: AdminRole | null): boolean =>
  role === 'admin' || role === 'csr';

export const canManageFleetAccounts = (role: AdminRole | null): boolean =>
  role === 'opm';
