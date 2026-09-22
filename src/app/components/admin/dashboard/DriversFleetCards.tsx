import { ArrowRight, Truck } from 'lucide-react';
import type { Assignment, LocalDriver, LocalTruck } from '../../../data/assignmentTypes';
import { availabilityConfig } from '../../../data/assignmentTypes';

interface Props {
  drivers: LocalDriver[];     // active only — archived are loaded separately (App.tsx)
  trucks: LocalTruck[];       // active only
  assignments: Assignment[];
  onViewAll: () => void;      // → Accounts (driver and truck management)
}

const DRIVER_ROWS = 4;
const TRUCK_ROWS  = 6;

const initials = (name: string) =>
  name.split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2);

function ViewAll({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
      View all <ArrowRight className="w-3.5 h-3.5" />
    </button>
  );
}

export default function DriversFleetCards({ drivers, trucks, assignments, onViewAll }: Props) {
  /* Same rules as the old KPI cards: a driver is available when not on an active
     delivery; a truck is available when its status is 'Available'. */
  const availableDrivers = drivers.filter((d) => !assignments.find((a) => a.driverId === d.id));
  const availableTrucks  = trucks.filter((t) => t.status === 'Available').length;
  /* Available trucks first, then the rest, keeping the loaded order within each group */
  const fleet = [...trucks].sort((a, b) => Number(b.status === 'Available') - Number(a.status === 'Available'));

  return (
    /* `contents`: no box of its own — the two cards sit directly in DashboardHome's
       shared grid (second row), lined up with Delivery Overview + Recent Activity */
    <div className="contents">

      {/* ── Available Drivers ── */}
      <div className="bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold text-foreground leading-tight">Available Drivers</h3>
          <ViewAll onClick={onViewAll} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="text-2xl font-semibold text-foreground mr-1.5">{availableDrivers.length}</span>
          of {drivers.length} driver{drivers.length !== 1 ? 's' : ''} available
        </p>

        {availableDrivers.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {drivers.length === 0 ? 'No drivers registered yet.' : 'All drivers are on a delivery.'}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {availableDrivers.slice(0, DRIVER_ROWS).map((d) => (
              <li key={d.id} className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[#0d9488] text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                  {initials(d.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{d.phone}</p>
                </div>
                {d.shift && (
                  <span className="text-xs font-medium text-[#0d9488] bg-[#0d9488]/10 rounded-md px-2 py-0.5 whitespace-nowrap flex-shrink-0">
                    {d.shift}
                  </span>
                )}
              </li>
            ))}
            {availableDrivers.length > DRIVER_ROWS && (
              <li className="text-xs text-muted-foreground">+{availableDrivers.length - DRIVER_ROWS} more</li>
            )}
          </ul>
        )}
      </div>

      {/* ── Fleet ── (@container: tile columns follow the card's width, not the screen's) */}
      <div className="@container bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold text-foreground leading-tight">Fleet</h3>
          <ViewAll onClick={onViewAll} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="text-2xl font-semibold text-foreground mr-1.5">{availableTrucks}</span>
          of {trucks.length} truck{trucks.length !== 1 ? 's' : ''} available
        </p>

        {trucks.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No trucks registered yet.</p>
        ) : (
          <>
            {/* Tiles: 1 column while the card is narrower than 28rem (448px), 2 above.
                Trucks only track Available / Assigned (= On Delivery) — no maintenance status. */}
            <ul className="mt-4 grid grid-cols-1 @md:grid-cols-2 gap-3">
              {fleet.slice(0, TRUCK_ROWS).map((t) => {
                /* Same badge as the Accounts truck list (shared availabilityConfig) */
                const cfg = t.status !== 'Assigned' ? availabilityConfig.available : availabilityConfig.onDelivery;
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl bg-gray-50 border border-border/60 px-3 py-2.5 min-w-0">
                    {/* Same icon style as the Monitor cards, a size smaller */}
                    <div className="w-9 h-9 bg-[#0d9488]/10 rounded-full flex items-center justify-center flex-shrink-0 border-[0.5px] border-[#0d9488]/25">
                      <Truck className="w-4 h-4 text-[#0d9488]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{t.plateNumber}</p>
                      {t.classification && <p className="text-xs text-muted-foreground truncate">{t.classification}</p>}
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium whitespace-nowrap flex-shrink-0 ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                  </li>
                );
              })}
              {trucks.length > TRUCK_ROWS && (
                /* Not a link (as before) — "View all" opens Accounts */
                <li className="flex items-center justify-center rounded-xl border border-dashed border-border px-3 py-2.5 min-h-[58px] text-xs text-muted-foreground">
                  +{trucks.length - TRUCK_ROWS} more
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
