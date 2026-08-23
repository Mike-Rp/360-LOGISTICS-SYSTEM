import { MapPin, Clock, Package, ChevronRight, AlertCircle } from 'lucide-react';
import { type Delivery, type DeliveryStatus } from '../../data/mockData';

interface TaskListProps {
  tasks: Delivery[];
  onSelectTask: (task: Delivery) => void;
}

const getStatusColor = (status: DeliveryStatus) => {
  switch (status) {
    case 'Pending':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'In Transit':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Delivered':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'Delayed':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'Cancelled':
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case 'High':
      return <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full">High Priority</span>;
    case 'Medium':
      return <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full">Medium</span>;
    default:
      return null;
  }
};

export default function TaskList({ tasks, onSelectTask }: TaskListProps) {
  const activeTasks = tasks.filter(t => t.status !== 'Delivered' && t.status !== 'Cancelled');
  const completedTasks = tasks.filter(t => t.status === 'Delivered');

  return (
    <div className="p-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-3 border border-border shadow-sm text-center">
          <p className="text-2xl font-semibold text-primary">{activeTasks.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Active</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-border shadow-sm text-center">
          <p className="text-2xl font-semibold text-green-600">{completedTasks.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Completed</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-border shadow-sm text-center">
          <p className="text-2xl font-semibold text-foreground">{tasks.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total</p>
        </div>
      </div>

      {/* Active Tasks */}
      {activeTasks.length > 0 && (
        <div>
          <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Active Deliveries
          </h2>
          
          <div className="space-y-3">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                onClick={() => onSelectTask(task)}
                className="bg-white rounded-xl border border-border shadow-sm overflow-hidden active:scale-[0.98] transition-transform cursor-pointer"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {task.trackingNumber}
                        </span>
                        {getPriorityBadge(task.priority)}
                      </div>
                      <h3 className="font-semibold text-foreground">{task.customer}</h3>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </div>

                  <div className="space-y-2 mb-3">
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-muted-foreground text-xs">{task.origin}</p>
                        <p className="text-foreground font-medium truncate">{task.destination}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      <span className="text-xs">
                        ETA: {new Date(task.estimatedDelivery).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className={`text-xs px-3 py-1 rounded-full border ${getStatusColor(task.status)}`}>
                      {task.status}
                    </span>
                    <span className="text-xs text-muted-foreground">{task.cargo} • {task.weight}</span>
                  </div>

                  {task.status === 'Delayed' && (
                    <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                      <p className="text-xs text-red-700">This delivery is delayed. Please update status.</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div>
          <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <Package className="w-5 h-5 text-green-600" />
            Completed Today
          </h2>
          
          <div className="space-y-2">
            {completedTasks.map((task) => (
              <div
                key={task.id}
                onClick={() => onSelectTask(task)}
                className="bg-white rounded-xl border border-border shadow-sm p-3 active:scale-[0.98] transition-transform cursor-pointer opacity-75"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">{task.customer}</p>
                    <p className="text-xs text-muted-foreground">{task.destination}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-1 rounded-full border ${getStatusColor(task.status)}`}>
                      {task.status}
                    </span>
                    {task.actualDelivery && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(task.actualDelivery).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
