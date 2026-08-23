import { Truck, Bell, Menu } from 'lucide-react';

interface DriverHeaderProps {
  showNotifications: boolean;
  setShowNotifications: (show: boolean) => void;
}

export default function DriverHeader({ showNotifications, setShowNotifications }: DriverHeaderProps) {
  return (
    <header className="bg-gradient-to-r from-primary to-secondary text-white p-4 sticky top-0 z-10 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-semibold text-lg">360 Logistics</h1>
            <p className="text-xs text-white/80">Driver Portal</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Bell className="w-6 h-6" />
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full"></span>
          </button>
          <button className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/80">Welcome back,</p>
            <p className="font-semibold">John Martinez</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-white/80">Truck</p>
            <p className="font-semibold">TRK-101</p>
          </div>
        </div>
      </div>
    </header>
  );
}
