import type { AdminRole } from '../../data/assignmentTypes';

/** Display the authenticated staff role without exposing the legacy internal `admin` label. */
export default function AccountRoleBadge({ role }: { role: AdminRole | null }) {
  const label = role === 'opm' ? 'OPM' : role === 'csr' || role === 'admin' ? 'CSR' : null;
  if (!label) return null;
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4 ${label === 'OPM'
    ? 'border-green-200 bg-green-50 text-green-800'
    : 'border-sky-200 bg-sky-50 text-sky-800'}`}>{label}</span>;
}
