import { Package, Truck, Users, CheckCircle, UserCheck, AlertTriangle } from 'lucide-react';
import type { Assignment, CompletedTask, LocalDriver, LocalTruck } from '../../data/assignmentTypes';

interface Props {
  drivers: LocalDriver[];
  trucks: LocalTruck[];
  assignments: Assignment[];
  completed: CompletedTask[];
}

/* Assignment is delayed when:
   1. A driver has submitted a delay report on it, OR
   2. Its delivery date has passed and it's still active */
function countDelayed(assignments: Assignment[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return assignments.filter((a) => {
    const active =
      a.taskStatus === 'Assigned' ||
      a.taskStatus === 'Picked Up' ||
      a.taskStatus === 'In Transit';
    if (!active) return false;
    // Has submitted delay report(s)
    if (a.delayReports && a.delayReports.length > 0) return true;
    // Delivery date has passed
    if (a.deliveryDate) {
      const [m, d, y] = a.deliveryDate.split('/').map(Number);
      const due = new Date(y, m - 1, d);
      if (due < today) return true;
    }
    return false;
  }).length;
}

export default function KPICards({ drivers, trucks, assignments, completed }: Props) {
  const availableTrucks   = trucks.filter((t) => t.status === 'Available').length;
  const unavailableTrucks = trucks.filter((t) => t.status === 'Assigned').length;
  const activeAssignments = assignments.length;
  const availableDrivers  = drivers.filter((d) => !assignments.find((a) => a.driverId === d.id)).length;
  const completedTotal    = completed.length;
  const delayedCount      = countDelayed(assignments);
  const docsPending       = assignments.reduce(
    (sum, a) => sum + a.documents.filter((d) => d.uploaded && d.docStatus === 'pending').length, 0
  );

  const kpis = [
    {
      title: 'Available Trucks',
      value: availableTrucks,
      icon: Truck,
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-600',
      subText: unavailableTrucks > 0
        ? `${unavailableTrucks} currently on task`
        : trucks.length === 0 ? 'No trucks registered' : 'All trucks available',
    },
    {
      title: 'Active Assignments',
      value: activeAssignments,
      icon: Package,
      bgColor: 'bg-[#0d9488]/10',
      textColor: 'text-[#0d9488]',
      subText: activeAssignments > 0
        ? `${assignments.filter((a) => a.taskStatus === 'In Transit').length} in transit`
        : 'No active deliveries',
    },
    {
      title: 'Available Drivers',
      value: availableDrivers,
      icon: UserCheck,
      bgColor: 'bg-green-50',
      textColor: 'text-green-600',
      subText: availableDrivers > 0 ? 'Ready to be assigned' : 'All drivers assigned',
    },
    {
      title: 'Completed Deliveries',
      value: completedTotal,
      icon: CheckCircle,
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-600',
      subText: completedTotal > 0 ? 'All time total' : 'No completions yet',
    },
    {
      title: 'Delayed Deliveries',
      value: delayedCount,
      icon: AlertTriangle,
      bgColor: delayedCount > 0 ? 'bg-amber-50' : 'bg-gray-50',
      textColor: delayedCount > 0 ? 'text-amber-600' : 'text-gray-400',
      subText: delayedCount > 0 ? 'Past due date, still active' : 'No delays right now',
      highlight: delayedCount > 0,
    },
    {
      title: 'Docs Pending Review',
      value: docsPending,
      icon: Users,
      bgColor: docsPending > 0 ? 'bg-amber-50' : 'bg-gray-50',
      textColor: docsPending > 0 ? 'text-amber-600' : 'text-gray-400',
      subText: docsPending > 0 ? 'Awaiting admin approval' : 'All documents reviewed',
      highlight: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {kpis.map((kpi, index) => {
        const Icon = kpi.icon;
        return (
          <div
            key={index}
            className={`bg-white rounded-xl p-5 border shadow-sm hover:shadow-md transition-shadow ${
              (kpi as any).highlight ? 'border-amber-200 ring-1 ring-amber-100' : 'border-border'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`${kpi.bgColor} p-3 rounded-lg`}>
                <Icon className={`w-5 h-5 ${kpi.textColor}`} />
              </div>
            </div>
            <div>
              <p className={`text-2xl font-semibold mb-0.5 ${kpi.textColor}`}>{kpi.value}</p>
              <p className="text-sm text-foreground font-medium">{kpi.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.subText}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}