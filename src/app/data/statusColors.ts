/** Presentation colors only. These labels do not change persisted task or operational statuses. */
const atPickup = {
  badge: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500',
  activeStep: 'border-sky-600 bg-sky-50 text-sky-700', activeDot: 'bg-sky-600', activeLabel: 'text-sky-700',
  chart: '#38bdf8',
};

export const statusColors = {
  Assigned: {
    badge: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500',
    activeStep: 'border-purple-600 bg-purple-50 text-purple-700', activeDot: 'bg-purple-600', activeLabel: 'text-purple-700',
    chart: '#a855f7',
  },
  'At Pickup': atPickup,
  'Picked Up': atPickup,
  Loading: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500',
    activeStep: 'border-amber-600 bg-amber-50 text-amber-800', activeDot: 'bg-amber-600', activeLabel: 'text-amber-800',
    chart: '#f59e0b',
  },
  'In Transit': {
    badge: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-700',
    activeStep: 'border-blue-600 bg-blue-50 text-blue-800', activeDot: 'bg-blue-600', activeLabel: 'text-blue-800',
    chart: '#1d4ed8',
  },
  Arrived: {
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500',
    activeStep: 'border-indigo-600 bg-indigo-50 text-indigo-700', activeDot: 'bg-indigo-600', activeLabel: 'text-indigo-700',
    chart: '#6366f1',
  },
  Unloading: {
    badge: 'bg-orange-50 text-orange-800 border-orange-200', dot: 'bg-orange-500',
    activeStep: 'border-orange-600 bg-orange-50 text-orange-800', activeDot: 'bg-orange-600', activeLabel: 'text-orange-800',
    chart: '#f97316',
  },
  Delivered: {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500',
    activeStep: 'border-emerald-600 bg-emerald-50 text-emerald-700', activeDot: 'bg-emerald-600', activeLabel: 'text-emerald-700',
    chart: '#10b981',
  },
  'Awaiting Documents': {
    badge: 'bg-yellow-50 text-yellow-800 border-yellow-200', dot: 'bg-yellow-500',
    activeStep: 'border-yellow-600 bg-yellow-50 text-yellow-800', activeDot: 'bg-yellow-600', activeLabel: 'text-yellow-800',
    chart: '#eab308',
  },
  'Under Review': {
    badge: 'bg-cyan-50 text-cyan-800 border-cyan-200', dot: 'bg-cyan-500',
    activeStep: 'border-cyan-600 bg-cyan-50 text-cyan-800', activeDot: 'bg-cyan-600', activeLabel: 'text-cyan-800',
    chart: '#06b6d4',
  },
  'Needs Correction': {
    badge: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500',
    activeStep: 'border-red-600 bg-red-50 text-red-700', activeDot: 'bg-red-600', activeLabel: 'text-red-700',
    chart: '#ef4444',
  },
  Completed: {
    badge: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500',
    activeStep: 'border-green-600 bg-green-50 text-green-700', activeDot: 'bg-green-600', activeLabel: 'text-green-700',
    chart: '#15803d',
  },
  Cancelled: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400',
    activeStep: 'border-slate-600 bg-slate-50 text-slate-600', activeDot: 'bg-slate-600', activeLabel: 'text-slate-600',
    chart: '#94a3b8',
  },
  'Failed / Issue': {
    badge: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500',
    activeStep: 'border-red-600 bg-red-50 text-red-700', activeDot: 'bg-red-600', activeLabel: 'text-red-700',
    chart: '#b91c1c',
  },
} as const;
