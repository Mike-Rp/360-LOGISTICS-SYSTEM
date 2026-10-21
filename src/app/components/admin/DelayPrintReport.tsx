import { createPortal } from 'react-dom';
import logo from 'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png';
import { formatOperationalStamp } from '../../lib/assignmentOperational';
import './WeeklyPrintReport.css';
import './DelayPrintReport.css';

interface IncidentRow {
  date: string;
  asn: string;
  driver: string;
  truck: string;
  route: string;
  client: string;
  scheduledTime: string;
  reportedStamp: string;
  reason: string;
  type: string;
  status: 'Resolved' | 'Ongoing';
}

interface Props {
  rows: IncidentRow[];
  summary: { total: number; resolved: number; ongoing: number; affected: number };
  issueCounts: [string, number][];
  mostCommonIssues: string | null;
  generatedAt: Date;
  generatedBy: string;
  role: 'OPM' | 'CSR';
}

export default function DelayPrintReport({
  rows, summary, issueCounts, mostCommonIssues, generatedAt, generatedBy, role,
}: Props) {
  const generatedStamp = formatOperationalStamp(generatedAt.toISOString()) ?? generatedAt.toISOString();

  return createPortal(
    <article className="weekly-print-report delay-print-report" aria-label="Printable Delay and Issues Report">
      <header className="wpr-header">
        <div className="wpr-header-main">
          <img src={logo} alt="360 Logistics" className="wpr-logo" />
          <h1>Delay &amp; Issues Report</h1>
          <p>Reporting scope: All available delay reports</p>
          <p>Generated on: {generatedStamp}</p>
          <p>Report ID: Not issued</p>
        </div>
        <div className="wpr-verification">
          <strong>Verification unavailable</strong>
          <span>No report ID or verification record has been issued.</span>
        </div>
      </header>

      <section className="wpr-section">
        <h2>Incident Summary</h2>
        <table className="wpr-summary dir-summary">
          <thead><tr>
            <th>Total Incidents</th><th>Resolved</th><th>Ongoing</th><th>Affected Deliveries</th>
          </tr></thead>
          <tbody><tr>
            <td>{summary.total}</td>
            <td className="wpr-completed">{summary.resolved}</td>
            <td className={summary.ongoing > 0 ? 'wpr-delayed' : ''}>{summary.ongoing}</td>
            <td>{summary.affected}</td>
          </tr></tbody>
        </table>
      </section>

      {rows.length === 0 ? (
        <p className="dir-empty">No delay reports are available in the current assignment history.</p>
      ) : (
        <>
          <section className="wpr-section dir-breakdown">
            <h2>Issue Type Breakdown</h2>
            <table>
              <thead><tr><th>Issue Type</th><th>Count</th></tr></thead>
              <tbody>{issueCounts.map(([type, count]) => (
                <tr key={type}><td>{type}</td><td>{count}</td></tr>
              ))}</tbody>
            </table>
          </section>

          <section className="wpr-section dir-details">
            <h2>Incident Details</h2>
            <table>
              <colgroup>
                <col className="dir-col-date" /><col className="dir-col-asn" />
                <col className="dir-col-driver" /><col className="dir-col-truck" />
                <col className="dir-col-route" /><col className="dir-col-type" />
                <col className="dir-col-status" />
              </colgroup>
              <thead><tr>
                <th>Date</th><th>ASN</th><th>Driver</th><th>Truck</th>
                <th>Route</th><th>Issue Type</th><th>Status</th>
              </tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr className="dir-incident" key={`${row.asn}-${index}`}><td colSpan={7}>
                  <div className="dir-incident-main">
                    <div>{row.date}</div><div className="dir-asn">{row.asn}</div>
                    <div>{row.driver}</div><div>{row.truck}</div><div>{row.route}</div>
                    <div>{row.type}</div>
                    <div className={row.status === 'Resolved' ? 'wpr-completed' : 'wpr-delayed'}>{row.status}</div>
                  </div>
                  <div className="dir-incident-detail">
                    <div><strong>Reason:</strong> {row.reason || '—'}</div>
                    <div><strong>Client:</strong> {row.client} <span>·</span> <strong>Scheduled:</strong> {row.scheduledTime}</div>
                    <div><strong>Reported:</strong> {row.reportedStamp} <span>·</span> <strong>Resolved at:</strong> — <span>·</span> <strong>Delay duration:</strong> —</div>
                  </div>
                </td></tr>
              ))}</tbody>
            </table>
          </section>

          <section className="wpr-section wpr-notes dir-notes">
            <h2>Incident Notes</h2>
            <dl>
              <div><dt>Total incidents</dt><dd>{summary.total}</dd></div>
              <div><dt>Resolved</dt><dd>{summary.resolved}</dd></div>
              <div><dt>Ongoing</dt><dd>{summary.ongoing}</dd></div>
              <div><dt>Affected deliveries</dt><dd>{summary.affected}</dd></div>
              {mostCommonIssues && <div><dt>Most common issue</dt><dd>{mostCommonIssues}</dd></div>}
            </dl>
            <p>Resolved follows the completed-delivery rule. Incident-level resolution times and durations are not recorded.</p>
          </section>
        </>
      )}

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
