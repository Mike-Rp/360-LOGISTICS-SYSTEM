import { ArrowLeft, Bell, Package, AlertCircle, CheckCircle, FileText, Clock } from 'lucide-react';

interface NotificationsProps {
  onClose: () => void;
}

export default function Notifications({ onClose }: NotificationsProps) {
  const notifications = [
    {
      id: 1,
      type: 'new_task',
      title: 'New Delivery Assigned',
      message: 'You have been assigned delivery TRK-2026-009 to Sacramento',
      time: '5 minutes ago',
      icon: Package,
      color: 'bg-blue-100 text-blue-600',
      unread: true,
    },
    {
      id: 2,
      type: 'reminder',
      title: 'Delivery Reminder',
      message: 'TRK-2026-001 to Los Angeles is due in 2 hours',
      time: '30 minutes ago',
      icon: Clock,
      color: 'bg-amber-100 text-amber-600',
      unread: true,
    },
    {
      id: 3,
      type: 'alert',
      title: 'Delay Alert',
      message: 'Traffic reported on route to Los Angeles. Update ETA.',
      time: '1 hour ago',
      icon: AlertCircle,
      color: 'bg-red-100 text-red-600',
      unread: true,
    },
    {
      id: 4,
      type: 'success',
      title: 'Document Approved',
      message: 'Your POD for TRK-2026-002 has been approved',
      time: '2 hours ago',
      icon: CheckCircle,
      color: 'bg-green-100 text-green-600',
      unread: false,
    },
    {
      id: 5,
      type: 'info',
      title: 'Upload Required',
      message: 'Please upload Bill of Lading for TRK-2026-001',
      time: '3 hours ago',
      icon: FileText,
      color: 'bg-purple-100 text-purple-600',
      unread: false,
    },
  ];

  const unreadCount = notifications.filter(n => n.unread).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-white border-b border-border p-4 sticky top-0 z-10">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-primary font-medium mb-3"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Bell className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground">Notifications</h1>
              <p className="text-sm text-muted-foreground">{unreadCount} unread</p>
            </div>
          </div>
          <button className="text-sm text-primary font-medium">Mark all read</button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="p-4 space-y-3">
        {notifications.map((notification) => {
          const Icon = notification.icon;
          return (
            <div
              key={notification.id}
              className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${
                notification.unread ? 'border-primary/30 bg-primary/5' : 'border-border'
              }`}
            >
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`${notification.color} p-2 rounded-lg flex-shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-semibold text-foreground">{notification.title}</h3>
                      {notification.unread && (
                        <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5"></div>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{notification.message}</p>
                    <p className="text-xs text-muted-foreground">{notification.time}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State (if no notifications) */}
      {notifications.length === 0 && (
        <div className="p-8 text-center">
          <Bell className="w-16 h-16 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium mb-1">No notifications</p>
          <p className="text-sm text-muted-foreground">You're all caught up!</p>
        </div>
      )}
    </div>
  );
}
