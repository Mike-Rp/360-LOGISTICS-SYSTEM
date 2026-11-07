import { reportPdfPrintTitle, type PrintableReportType } from './reportPdfFilename';

export type ReportCell = string | number | null;
export type ReportColumn = { header: string; width: number; kind?: 'text' | 'number' | 'percent' | 'date' | 'month' | 'time'; wrap?: boolean };
export type ReportSheet = { name: string; columns: ReportColumn[]; rows: ReportCell[][] };
export type ReportExport = {
  type: PrintableReportType;
  period?: string;
  generatedBy?: string;
  generatedAt: Date;
  sheets: ReportSheet[];
};

const REPORT_TITLES: Record<PrintableReportType, string> = {
  weekly: 'Weekly Performance Report',
  monthly: 'Monthly Delivery Summary',
  utilization: 'Fleet & Driver Utilization Report',
  delay: 'Delay & Issues Report',
};

const exportCounts = new Map<string, number>();

export function reportExportFilename(type: PrintableReportType, extension: 'csv' | 'xlsx', at: Date): string {
  const base = reportPdfPrintTitle(type, at);
  const key = `${base}.${extension}`;
  const count = (exportCounts.get(key) ?? 0) + 1;
  exportCounts.set(key, count);
  return `${base}${count > 1 ? `_${count}` : ''}.${extension}`;
}

/** A leading apostrophe stops Excel from evaluating an untrusted CSV cell as a formula. */
export function safeCsvCell(value: ReportCell): string {
  const text = value == null ? '' : String(value);
  if (typeof value === 'number') return text;
  return /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text;
}

export function serializeReportCsv(sheet: ReportSheet): string {
  const quote = (value: ReportCell) => `"${safeCsvCell(value).replace(/"/g, '""')}"`;
  return `\uFEFF${[sheet.columns.map((column) => column.header), ...sheet.rows]
    .map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`;
}

export function downloadReportBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadReportCsv(report: ReportExport): void {
  // CSV has one table; fleet card exports use a combined sheet to preserve its old columns.
  const csv = serializeReportCsv(report.sheets[0]);
  downloadReportBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), reportExportFilename(report.type, 'csv', report.generatedAt));
}

function manilaParts(date: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function excelDateFromDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function excelReportValue(value: ReportCell, kind: ReportColumn['kind']): string | number | Date {
  if (value == null) return '';
  if (kind === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : String(value);
  }
  if (kind === 'percent' && typeof value === 'string' && /^\d+(?:\.\d+)?%$/.test(value)) return Number(value.slice(0, -1)) / 100;
  if (kind === 'date' && typeof value === 'string') return excelDateFromDay(value) ?? value;
  if (kind === 'month' && typeof value === 'string') {
    const match = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/.exec(value);
    if (match) return new Date(Date.UTC(Number(match[2]), ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(match[1]), 1));
  }
  if (kind === 'time' && typeof value === 'string') {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(value.trim());
    if (match) {
      let hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3] ?? 0);
      if (match[4]) hours = hours % 12 + (match[4].toUpperCase() === 'PM' ? 12 : 0);
      if (hours < 24 && minutes < 60 && seconds < 60) return (hours * 3600 + minutes * 60 + seconds) / 86400;
    }
  }
  // Strings remain explicit string cells, including identifiers and formula-like input.
  return value;
}

export async function createReportWorkbook(report: ReportExport): Promise<ArrayBuffer> {
  const { Workbook } = await import('exceljs-community');
  const workbook = new Workbook();
  workbook.creator = '360 Logistics';
  workbook.created = report.generatedAt;
  const stamp = manilaParts(report.generatedAt);
  // Excel stores timezone-free serial dates. Encode the Manila wall-clock fields
  // as the serial date so a foreign device still displays the intended PHT time.
  const generatedForExcel = new Date(Date.UTC(Number(stamp.year), Number(stamp.month) - 1, Number(stamp.day),
    Number(stamp.hour), Number(stamp.minute), Number(stamp.second)));

  for (const sheet of report.sheets) {
    const ws = workbook.addWorksheet(sheet.name, {
      views: [{ state: 'frozen', ySplit: 8, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const last = sheet.columns.length;
    ws.columns = sheet.columns.map((column) => ({ width: column.width }));
    const brandFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF065F46' } };
    const cellLine = { style: 'hair' as const, color: { argb: 'FFDDE5E2' } };
    const rowLine = { style: 'thin' as const, color: { argb: 'FFDDE5E2' } };
    const outerLine = { style: 'thin' as const, color: { argb: 'FFB8C9C2' } };
    const headerUnderline = { style: 'thin' as const, color: { argb: 'FF7DB39B' } };
    ws.mergeCells(1, 1, 1, last);
    ws.getCell(1, 1).value = '360 LOGISTICS SYSTEM';
    ws.getCell(1, 1).font = { name: 'Aptos', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell(1, 1).fill = brandFill;
    ws.getCell(1, 1).alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 32;
    ws.mergeCells(2, 1, 2, last);
    ws.getCell(2, 1).value = REPORT_TITLES[report.type];
    ws.getCell(2, 1).font = { name: 'Aptos', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell(2, 1).fill = brandFill;
    ws.getCell(2, 1).alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(2).height = 34;
    ws.getRow(3).height = 12;
    const meta: [string, string | Date | undefined][] = [
      ['Reporting Period', report.period], ['Generated At', generatedForExcel], ['Generated By', report.generatedBy],
    ];
    meta.forEach(([label, value], index) => {
      if (!value) return;
      const row = ws.getRow(index + 4);
      row.getCell(1).value = label;
      row.getCell(1).font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF64748B' } };
      row.getCell(2).value = value;
      row.getCell(2).font = { name: 'Aptos', size: 10, color: { argb: 'FF1A2B3C' } };
      if (value instanceof Date) row.getCell(2).numFmt = 'mmm d, yyyy h:mm:ss AM/PM "PHT"';
      row.getCell(1).border = { bottom: cellLine };
      row.getCell(2).border = { bottom: cellLine };
      row.height = 21;
    });
    ws.getRow(7).height = 12;
    const header = ws.getRow(8);
    sheet.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.value = column.header;
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF065F46' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4F3EC' } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: column.kind === 'number' || column.kind === 'percent' ? 'right' : 'left' };
      cell.border = {
        top: outerLine,
        bottom: headerUnderline,
        left: index === 0 ? outerLine : undefined,
        right: index === last - 1 ? outerLine : cellLine,
      };
    });
    header.height = 32;
    ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: last } };
    ws.pageSetup.printTitlesRow = '1:8';
    sheet.rows.forEach((values, rowIndex) => {
      const row = ws.getRow(rowIndex + 9);
      let height = 23;
      sheet.columns.forEach((column, columnIndex) => {
        const cell = row.getCell(columnIndex + 1);
        const value = excelReportValue(values[columnIndex], column.kind);
        cell.value = value;
        cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1A2B3C' } };
        cell.alignment = { vertical: 'middle', horizontal: column.kind === 'number' || column.kind === 'percent' ? 'right' : 'left', wrapText: !!column.wrap };
        cell.border = {
          bottom: rowIndex === sheet.rows.length - 1 ? outerLine : rowLine,
          left: columnIndex === 0 ? outerLine : undefined,
          right: columnIndex === last - 1 ? outerLine : cellLine,
        };
        if (rowIndex % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8F7' } };
        if (value instanceof Date) cell.numFmt = column.kind === 'month' ? 'mmmm yyyy' : 'mmm d, yyyy';
        else if (typeof value === 'number') cell.numFmt = column.kind === 'percent' ? '0.0%' : column.kind === 'time' ? 'h:mm AM/PM' : '#,##0';
        if (column.wrap && typeof value === 'string') {
          const lines = value.split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(line.length / Math.max(8, column.width - 4))), 0);
          height = Math.max(height, Math.min(409, 19 * lines + 4));
        }
      });
      row.height = height;
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  // The browser returns an ArrayBuffer; Node tests receive a Buffer. Copy either
  // form into an exact-length ArrayBuffer for Blob and round-trip checks.
  return new Uint8Array(buffer as ArrayBuffer).slice().buffer;
}

export async function downloadReportExcel(report: ReportExport): Promise<void> {
  const buffer = await createReportWorkbook(report);
  downloadReportBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), reportExportFilename(report.type, 'xlsx', report.generatedAt));
}
