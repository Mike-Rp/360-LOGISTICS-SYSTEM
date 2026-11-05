export type PrintableReportType = 'weekly' | 'monthly' | 'utilization' | 'delay';

const REPORT_NAMES: Record<PrintableReportType, string> = {
  weekly: 'Weekly-Performance',
  monthly: 'Monthly-Delivery-Summary',
  utilization: 'Fleet-Driver-Utilization',
  delay: 'Delay-Issues',
};

/** Browsers commonly use the document title as the Save as PDF filename. */
export function reportPdfPrintTitle(type: PrintableReportType, exportedAt: Date, reportId?: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(exportedAt).map(part => [part.type, part.value]));
  const stamp = `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
  const safeId = reportId?.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32);
  return `360LOGISTICS_${REPORT_NAMES[type]}_${stamp}${safeId ? `_${safeId}` : ''}`;
}
