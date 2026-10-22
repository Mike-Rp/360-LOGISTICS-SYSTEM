interface Props {
  reportId: string | null;
  qrDataUrl: string | null;
}

/* Shared with WeeklyPrintReport/MonthlyPrintReport/DelayPrintReport/FleetUtilizationPrintReport —
   same .wpr-verification box, now filled in once a Report ID has actually been issued. */
export default function ReportVerificationBox({ reportId, qrDataUrl }: Props) {
  if (!reportId) {
    return (
      <div className="wpr-verification">
        <strong>Verification unavailable</strong>
        <span>No report ID or verification record has been issued.</span>
      </div>
    );
  }
  return (
    <div className="wpr-verification wpr-verification-issued">
      {qrDataUrl && <img src={qrDataUrl} alt="Scan to verify this report" className="wpr-qr" />}
      <strong>Report ID: {reportId}</strong>
      <span>Scan to verify online</span>
    </div>
  );
}
