import { Truck, Package, ArrowRight } from 'lucide-react';
import { taskStatusConfig, type TaskStatus } from '../../data/assignmentTypes';
import type { Assignment, CompletedTask } from '../../data/assignmentTypes';

interface Props {
  assignments: Assignment[];
  completed: CompletedTask[];
  cancelled: Assignment[];
  onNavigateToDeliveries: () => void;
}

interface StatusCard {
  status: TaskStatus;
  count: number;
  gradient: string;
  iconBg: string;
  ring: string;
}

export default function DeliveryStatusBoard({ assignments, completed, cancelled, onNavigateToDeliveries }: Props) {
  const statusCounts: StatusCard[] = [
    {
      status: 'Assigned',
      count: assignments.filter((a) => a.taskStatus === 'Assigned').length,
      gradient: 'from-green-50 to-emerald-50',
      iconBg: 'bg-green-100',
      ring: 'ring-green-200',
    },
    {
      status: 'Picked Up',
      count: assignments.filter((a) => a.taskStatus === 'Picked Up').length,
      gradient: 'from-amber-50 to-yellow-50',
      iconBg: 'bg-amber-100',
      ring: 'ring-amber-200',
    },
    {
      status: 'In Transit',
      count: assignments.filter((a) => a.taskStatus === 'In Transit').length,
      gradient: 'from-blue-50 to-sky-50',
      iconBg: 'bg-blue-100',
      ring: 'ring-blue-200',
    },
    {
      status: 'Delivered',
      count: completed.length,
      gradient: 'from-purple-50 to-violet-50',
      iconBg: 'bg-purple-100',
      ring: 'ring-purple-200',
    },
    {
      status: 'Failed / Issue',
      count: assignments.filter((a) => a.taskStatus === 'Failed / Issue').length,
      gradient: 'from-red-50 to-rose-50',
      iconBg: 'bg-red-100',
      ring: 'ring-red-200',
    },
    {
      status: 'Cancelled',
      count: cancelled.length,
      gradient: 'from-gray-50 to-slate-50',
      iconBg: 'bg-gray-100',
      ring: 'ring-gray-200',
    },
  ];

  const total = assignments.length + completed.length + cancelled.length;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm mb-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-[#0d9488]/15 rounded-lg flex items-center justify-center">
            <Package className="w-4 h-4 text-[#0d9488]" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground text-sm">Delivery Status Overview</h2>
            <p className="text-xs text-muted-foreground">
              {total} total deliveries across all statuses
            </p>
          </div>
        </div>
        <button
          onClick={onNavigateToDeliveries}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors px-3 py-1.5 rounded-lg hover:bg-primary/5 border border-primary/20"
        >
          View All <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Status Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 divide-border sm:divide-x">
        {statusCounts.map(({ status, count, gradient, iconBg, ring }) => {
          const cfg = taskStatusConfig[status];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <button
              key={status}
              onClick={onNavigateToDeliveries}
              className={`flex flex-col items-center justify-center gap-2 px-4 py-5 bg-gradient-to-b ${gradient} hover:brightness-95 transition-all group relative overflow-hidden`}
            >
              {/* Count */}
              <div className={`w-11 h-11 ${iconBg} ring-2 ${ring} rounded-full flex items-center justify-center transition-transform group-hover:scale-105`}>
                <span className={`text-lg font-bold ${cfg.badge.split(' ')[1]}`}>{count}</span>
              </div>

              {/* Status label */}
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <span className="text-xs font-semibold text-foreground leading-tight">
                    {cfg.label}
                  </span>
                </div>
                <span className="text-[12px] text-muted-foreground">{pct}% of total</span>
              </div>

              {/* Bottom accent bar */}
              <div className={`absolute bottom-0 left-0 h-0.5 ${cfg.dot} transition-all duration-300`}
                style={{ width: `${pct}%` }} />
            </button>
          );
        })}
      </div>

      {/* Mini progress bar across all statuses */}
      {total > 0 && (
        <div className="px-5 py-3 border-t border-border bg-muted/10">
          <div className="flex items-center gap-2">
            <Truck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 flex h-2 rounded-full overflow-hidden gap-px bg-muted/30">
              {statusCounts.filter((s) => s.count > 0).map(({ status, count }) => {
                const cfg = taskStatusConfig[status];
                const width = (count / total) * 100;
                return (
                  <div
                    key={status}
                    className={`h-full ${cfg.dot} transition-all`}
                    style={{ width: `${width}%` }}
                    title={`${cfg.label}: ${count}`}
                  />
                );
              })}
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">{total} total</span>
          </div>
        </div>
      )}
    </div>
  );
}
