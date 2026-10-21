import { createPortal } from 'react-dom';
import logo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';
import { formatOperationalStamp } from '../../lib/assignmentOperational';
import './WeeklyPrintReport.css';
import './FleetUtilizationPrintReport.css';

interface TruckRow {
  plate: string;
  classification: string;
  timesAssigned: number;
  completedTrips: number;
  cancelledAssignments: number;
  lastDriver: string;
  lastUsedDate: string;
}

interface DriverRow {
  key: string;
  name: string;
  timesAssigned: number;
  completedDeliveries: number;
  cancelledAssignments: number;
  lastTruck: string;
  lastRoute: string;
  lastDeliveryDate: string;
}

interface Props {
  trucks: TruckRow[];
  drivers: DriverRow[];
  fleetSummary: { trucks: number; assigned: number; completed: number; cancelled: number };
  driverSummary: { drivers: number; assigned: number; completed: number; cancelled: number };
  formatCompletionRate: (completed: number, assigned: number) => string;
  generatedAt: Date;
  generatedBy: string;
  role: 'OPM' | 'CSR';
}

export default function FleetUtilizationPrintReport({
  trucks, drivers, fleetSummary, driverSummary, formatCompletionRate, generatedAt, generatedBy, role,
}: Props) {
  const generatedStamp = formatOperationalStamp(generatedAt.toISOString()) ?? generatedAt.toISOString();
  const fleetRate = formatCompletionRate(fleetSummary.completed, fleetSummary.assigned);
  const driverRate = formatCompletionRate(driverSummary.completed, driverSummary.assigned);

  return createPortal(
    <article className="weekly-print-report fleet-utilization-print-report" aria-label="Printable Fleet and Driver Utilization Report">
      <header className="wpr-header">
        <div className="wpr-header-main">
          <img src={logo} alt="360 Logistics" className="wpr-logo" />
          <h1>Fleet &amp; Driver Utilization Report</h1>
          <p>Reporting period: All available assignment history</p>
          <p>Generated on: {generatedStamp}</p>
          <p>Report ID: Not issued</p>
        </div>
        <div className="wpr-verification">
          <strong>Verification unavailable</strong>
          <span>No report ID or verification record has been issued.</span>
        </div>
      </header>

      <section className="wpr-section fdu-summary-section">
        <h2>Fleet Summary</h2>
        <table className="wpr-summary fdu-summary">
          <thead><tr>
            <th>Trucks Used</th><th>Total Assignments</th><th>Completed Trips</th>
            <th>Cancelled</th><th>Completion Rate</th>
          </tr></thead>
          <tbody><tr>
            <td>{fleetSummary.trucks}</td><td>{fleetSummary.assigned}</td>
            <td className="wpr-completed">{fleetSummary.completed}</td>
            <td>{fleetSummary.cancelled}</td><td>{fleetRate}</td>
          </tr></tbody>
        </table>
      </section>

      <section className="wpr-section fdu-table-section">
        <h2>Fleet Utilization</h2>
        {trucks.length === 0 ? (
          <p className="fdu-empty">No truck utilization data is available in the current assignment history.</p>
        ) : (
          <table className="fdu-table fdu-trucks">
            <colgroup>
              <col className="fdu-truck-plate" /><col className="fdu-truck-class" />
              <col className="fdu-truck-assigned" /><col className="fdu-truck-completed" />
              <col className="fdu-truck-cancelled" /><col className="fdu-truck-rate" />
              <col className="fdu-truck-driver" /><col className="fdu-truck-date" />
            </colgroup>
            <thead><tr>
              <th>Plate Number</th><th>Classification</th><th>Assigned</th><th>Completed</th>
              <th>Cancelled</th><th>Rate</th><th>Last Driver</th><th>Last Used</th>
            </tr></thead>
            <tbody>{trucks.map((row) => (
              <tr key={row.plate}>
                <td className="fdu-identity">{row.plate}</td><td>{row.classification}</td>
                <td>{row.timesAssigned}</td><td>{row.completedTrips}</td>
                <td>{row.cancelledAssignments}</td>
                <td>{formatCompletionRate(row.completedTrips, row.timesAssigned)}</td>
                <td>{row.lastDriver}</td><td>{row.lastUsedDate}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="wpr-section fdu-summary-section">
        <h2>Driver Summary</h2>
        <table className="wpr-summary fdu-summary">
          <thead><tr>
            <th>Drivers Used</th><th>Total Assignments</th><th>Completed Trips</th>
            <th>Cancelled</th><th>Completion Rate</th>
          </tr></thead>
          <tbody><tr>
            <td>{driverSummary.drivers}</td><td>{driverSummary.assigned}</td>
            <td className="wpr-completed">{driverSummary.completed}</td>
            <td>{driverSummary.cancelled}</td><td>{driverRate}</td>
          </tr></tbody>
        </table>
      </section>

      <section className="wpr-section fdu-table-section">
        <h2>Driver Utilization</h2>
        {drivers.length === 0 ? (
          <p className="fdu-empty">No driver utilization data is available in the current assignment history.</p>
        ) : (
          <table className="fdu-table fdu-drivers">
            <colgroup>
              <col className="fdu-driver-name" /><col className="fdu-driver-assigned" />
              <col className="fdu-driver-completed" /><col className="fdu-driver-cancelled" />
              <col className="fdu-driver-rate" /><col className="fdu-driver-truck" />
              <col className="fdu-driver-route" /><col className="fdu-driver-date" />
            </colgroup>
            <thead><tr>
              <th>Driver</th><th>Assigned</th><th>Completed</th><th>Cancelled</th>
              <th>Rate</th><th>Last Truck</th><th>Last Route</th><th>Last Delivery</th>
            </tr></thead>
            <tbody>{drivers.map((row) => (
              <tr key={row.key}>
                <td className="fdu-identity">{row.name}</td><td>{row.timesAssigned}</td>
                <td>{row.completedDeliveries}</td><td>{row.cancelledAssignments}</td>
                <td>{formatCompletionRate(row.completedDeliveries, row.timesAssigned)}</td>
                <td>{row.lastTruck}</td><td>{row.lastRoute}</td><td>{row.lastDeliveryDate}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="wpr-section wpr-notes fdu-notes">
        <h2>Utilization Summary</h2>
        <dl>
          <div><dt>Trucks used</dt><dd>{fleetSummary.trucks}</dd></div>
          <div><dt>Drivers used</dt><dd>{driverSummary.drivers}</dd></div>
          <div><dt>Fleet assignments / completed / cancelled</dt><dd>{fleetSummary.assigned} / {fleetSummary.completed} / {fleetSummary.cancelled}</dd></div>
          <div><dt>Driver assignments / completed / cancelled</dt><dd>{driverSummary.assigned} / {driverSummary.completed} / {driverSummary.cancelled}</dd></div>
          <div><dt>Fleet completion rate</dt><dd>{fleetRate}</dd></div>
          <div><dt>Driver completion rate</dt><dd>{driverRate}</dd></div>
        </dl>
        <p>Completion rate = completed trips / assignments. Last dates use completion time for completed assignments and scheduled pickup or delivery dates for active or cancelled assignments.</p>
      </section>

      <footer className="wpr-audit">
        <strong>360 Logistics PH</strong>
        <span>Generated by: {generatedBy}</span>
        <span>Role: {role}</span>
        <span>Generated on: {generatedStamp}</span>
        <span>Report ID: Not issued</span>
      </footer>
    </article>,
    document.body,
  );
}
