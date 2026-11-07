const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTs(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => dependencies[id] ?? require(id), loaded, loaded.exports);
  return loaded.exports;
}

const filename = loadTs('reportPdfFilename.ts');
const report = loadTs('reportExport.ts', { './reportPdfFilename': filename });
const ExcelJS = require('exceljs-community');

test('Reports cards and shared preview footer offer Excel without CSV controls', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  assert.doesNotMatch(source, /Export CSV|downloadReportCsv|handleExportFile\('csv'\)/i);
  assert.match(source, /onClick=\{onClose\}[\s\S]*?>\s*Close\s*</);
  assert.match(source, /onClick=\{handlePrint\}[\s\S]*?Print \/ PDF/);
  assert.match(source, /Export Excel \(\.xlsx\)/);
});

test('all report types get Manila filenames and repeated exports avoid collisions', () => {
  const instant = new Date('2026-11-05T08:45:22Z');
  const names = [
    ['weekly', 'Weekly-Performance'], ['monthly', 'Monthly-Delivery-Summary'],
    ['utilization', 'Fleet-Driver-Utilization'], ['delay', 'Delay-Issues'],
  ];
  for (const [type, label] of names) {
    const first = report.reportExportFilename(type, instant);
    assert.equal(first, `360LOGISTICS_${label}_2026-11-05_164522.xlsx`);
    assert.equal(report.reportExportFilename(type, instant), `360LOGISTICS_${label}_2026-11-05_164522_2.xlsx`);
  }
});

test('typed values use numeric cells only when safe; identifiers and formula text stay strings', () => {
  assert.equal(report.excelReportValue('95.5%', 'percent'), .955);
  assert.equal(report.excelReportValue(12, 'number'), 12);
  assert.equal(report.excelReportValue('08:30 AM', 'time'), 8.5 / 24);
  assert.equal(report.excelReportValue('0123', 'text'), '0123');
  assert.equal(report.excelReportValue('=1+1', 'text'), '=1+1');
  assert.equal(report.excelReportValue('2026-13-99', 'date'), '2026-13-99');
  assert.equal(report.excelReportValue('—', 'number'), '—');
});

test('export row dates and incident times use Manila while date-only fields keep their day', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  const start = source.indexOf('function exportDay(');
  const end = source.indexOf('/* REQ-007:', start);
  assert.ok(start >= 0 && end > start, 'the Reports export date helpers should exist');
  const compiled = ts.transpileModule(`${source.slice(start, end)}\nexports.exportDay = exportDay; exports.exportTime = exportTime;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const helpers = {};
  new Function('exports', 'parseStoredTimestamp', compiled)(helpers,
    (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; });
  const { exportDay, exportTime } = helpers;
  assert.equal(exportDay('2026-11-04T16:30:00Z', 'wrong'), '2026-11-05');
  assert.equal(exportTime('2026-11-04T16:30:00Z', 'wrong'), '12:30 AM');
  assert.equal(exportDay('2026-11-05', 'wrong'), '2026-11-05');
  assert.equal(exportDay('', 'fallback'), 'fallback');
});

test('four styled workbooks round-trip as real XLSX with readable metadata and data', async () => {
  const at = new Date('2026-11-05T08:45:22Z');
  const cases = [
    ['weekly', [{ header: 'Driver', width: 28 }, { header: 'Route', width: 42, wrap: true }, { header: 'STA', width: 16, kind: 'time' }], ['Niño', 'Makati → Pasay', '08:30 AM']],
    ['monthly', [{ header: 'Month', width: 24, kind: 'month' }, { header: 'Total', width: 14, kind: 'number' }, { header: 'Rate', width: 14, kind: 'percent' }], ['November 2026', 12, '91.7%']],
    ['utilization', [{ header: 'Plate Number', width: 21 }, { header: 'Classification', width: 28 }, { header: 'Times Assigned', width: 19, kind: 'number' }], ['0123', 'Heavy Truck', 4]],
    ['delay', [{ header: 'Driver', width: 28 }, { header: 'Reason', width: 54, wrap: true }, { header: 'Status', width: 17 }], ['Ñora', '=HYPERLINK("bad")', 'Ongoing']],
  ];
  for (const [type, columns, row] of cases) {
    const bytes = await report.createReportWorkbook({ type, generatedAt: at, generatedBy: 'Test OPM', period: 'Test period', sheets: [{ name: 'Report', columns, rows: [row, row] }] });
    assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), 'PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    const sheet = workbook.getWorksheet('Report');
    assert.equal(sheet.getCell('A1').value, '360 LOGISTICS SYSTEM');
    assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FF065F46');
    assert.equal(sheet.getCell('A2').font.color.argb, 'FFFFFFFF');
    assert.equal(sheet.getCell('A2').fill.fgColor.argb, 'FF065F46');
    assert.equal(sheet.getCell('B5').value.toISOString(), '2026-11-05T16:45:22.000Z');
    assert.match(sheet.getCell('B5').numFmt, /PHT/);
    assert.equal(sheet.getCell('B6').value, 'Test OPM');
    assert.equal(sheet.getCell('A8').value, columns[0].header);
    assert.equal(sheet.getCell('A10').value instanceof Date ? 'date' : sheet.getCell('A10').value, type === 'monthly' ? 'date' : row[0]);
    assert.equal(sheet.getColumn(2).width, columns[1].width);
    assert.equal(sheet.getRow(8).height, 32);
    assert.equal(sheet.getCell('A8').fill.fgColor.argb, 'FFE4F3EC');
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.autoFilter, 'A8:C8');
    assert.equal(sheet.getCell('A4').border.bottom.color.argb, 'FFDDE5E2');
    assert.equal(sheet.getCell('B5').border.bottom.style, 'hair');
    assert.equal(sheet.getCell('A8').border.left.color.argb, 'FFB8C9C2');
    assert.equal(sheet.getCell('A8').border.bottom.color.argb, 'FF7DB39B');
    assert.equal(sheet.getCell('B8').border.right.style, 'hair');
    assert.equal(sheet.getCell('C8').border.right.color.argb, 'FFB8C9C2');
    assert.equal(sheet.getCell('A9').border.left.style, 'thin');
    assert.equal(sheet.getCell('A9').border.bottom.color.argb, 'FFDDE5E2');
    assert.equal(sheet.getCell('B9').border.right.color.argb, 'FFDDE5E2');
    assert.equal(sheet.getCell('C10').border.right.color.argb, 'FFB8C9C2');
    assert.equal(sheet.getCell('C10').border.bottom.color.argb, 'FFB8C9C2');
    assert.equal(sheet.getCell('A10').fill.fgColor.argb, 'FFF6F8F7');
    assert.equal(sheet.getCell('A9').value instanceof Date ? 'date' : sheet.getCell('A9').value, type === 'monthly' ? 'date' : row[0]);
    if (type === 'monthly') {
      assert.equal(sheet.getCell('B9').value, 12);
      assert.equal(sheet.getCell('C9').value, .917);
      assert.equal(sheet.getCell('C9').numFmt, '0.0%');
    }
    if (type === 'utilization') assert.equal(sheet.getCell('A9').value, '0123');
    if (type === 'delay') {
      assert.equal(sheet.getCell('B9').value, '=HYPERLINK("bad")');
      assert.equal(sheet.getCell('B9').type, ExcelJS.ValueType.String);
    }
  }
});

test('long names and routes wrap in the existing workbook without losing characters', async () => {
  const driver = 'María del Rosario Niño Santos';
  const route = 'Quezon City → Makati City → Pasay City → Parañaque City → Las Piñas City';
  const bytes = await report.createReportWorkbook({
    type: 'weekly', generatedAt: new Date('2026-11-05T08:45:22Z'),
    sheets: [{ name: 'Weekly Performance', columns: [
      { header: 'Driver', width: 32, wrap: true }, { header: 'Route', width: 46, wrap: true },
    ], rows: [[driver, route]] }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('A9').value, driver);
  assert.equal(sheet.getCell('B9').value, route);
  assert.equal(sheet.getCell('A9').alignment.wrapText, true);
  assert.equal(sheet.getCell('B9').alignment.wrapText, true);
  assert.equal(sheet.getColumn(1).width, 32);
  assert.equal(sheet.getColumn(2).width, 46);
  assert.ok(sheet.getRow(9).height > 23);
});

test('Reports export mapping produces complete XLSX rows for every report type', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  const start = source.indexOf('function reportExportSheets(');
  const end = source.indexOf('async function exportReport(', start);
  assert.ok(start >= 0 && end > start, 'the visible Reports export mapping should exist');
  const compiled = ts.transpileModule(`${source.slice(start, end)}\nexports.reportExportSheets = reportExportSheets;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mapped = {};
  new Function('exports', 'exportDay', 'exportTime', compiled)(mapped,
    (stamp, fallback) => stamp || fallback, (stamp, fallback) => stamp || fallback);

  const rows = {
    weekly: [{ date: 'Nov 5', dateStamp: '2026-11-05', driver: 'Niño Reyes', truck: '0123', route: 'Makati → Pasay', client: 'Client, Inc.', pickupTime: '08:00 AM', scheduledArrivalTime: '09:00 AM', ata: '09:15 AM', status: 'Delayed' }],
    monthly: [{ week: 'November 2026', total: 2, onTime: 1, delayed: 1, cancelled: 0, rate: '50.0%' }],
    delays: [{ date: 'Nov 5', dateStamp: '2026-11-05', driver: 'Ñora Cruz', truck: '0456', route: 'Cebu → Mandaue', client: 'Client', scheduledTime: '09:00 AM', reportedStamp: '10:00 AM', reportedAt: '10:00 AM', type: 'Pickup Delay', reason: 'Traffic, heavy', status: 'Ongoing' }],
    trucks: [{ plate: '0123', classification: 'Heavy', timesAssigned: 2, completedTrips: 1, cancelledAssignments: 0, lastDriver: 'Niño Reyes', lastUsedStamp: '2026-11-05', lastUsedDate: 'Nov 5' }],
    drivers: [{ name: 'Niño Reyes', timesAssigned: 2, completedDeliveries: 1, cancelledAssignments: 0, lastTruck: '0123', lastDeliveryStamp: '2026-11-05', lastDeliveryDate: 'Nov 5' }],
  };
  const cases = [
    ['weekly', 1],
    ['monthly', 1],
    ['utilization', 2],
    ['delay', 1],
  ];
  for (const [type, expectedRows] of cases) {
    const sheets = mapped.reportExportSheets(type, 'combined', rows.weekly, rows.monthly, rows.delays, rows.trucks, rows.drivers);
    assert.equal(sheets[0].rows.length, expectedRows);
    const xlsxBytes = await report.createReportWorkbook({ type, generatedAt: new Date('2026-11-05T08:45:22Z'), sheets });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(xlsxBytes));
    const worksheet = workbook.worksheets[0];
    assert.equal(worksheet.rowCount, 8 + expectedRows);
    assert.equal(worksheet.getCell('A1').value, '360 LOGISTICS SYSTEM');
    if (type === 'weekly') {
      assert.equal(worksheet.getCell('A9').value.toISOString(), '2026-11-05T00:00:00.000Z');
      assert.equal(worksheet.getCell('B9').value, 'Niño Reyes');
      assert.equal(worksheet.getCell('D9').value, 'Makati → Pasay');
    } else if (type === 'monthly') {
      assert.equal(worksheet.getCell('A9').value.toISOString(), '2026-11-01T00:00:00.000Z');
      assert.equal(worksheet.getCell('B9').value, 2);
      assert.equal(worksheet.getCell('F9').value, 0.5);
    } else if (type === 'utilization') {
      assert.equal(worksheet.getCell('A9').value, 'Truck');
      assert.equal(worksheet.getCell('B9').value, '0123');
      assert.equal(worksheet.getCell('B10').value, 'Niño Reyes');
    } else {
      assert.equal(worksheet.getCell('A9').value.toISOString(), '2026-11-05T00:00:00.000Z');
      assert.equal(worksheet.getCell('B9').value, 'Ñora Cruz');
      assert.equal(worksheet.getCell('I9').value, 'Traffic, heavy');
    }
  }
});

test('an exported file carries its Report ID in the file name', () => {
  const at = new Date('2026-11-05T08:45:22Z');
  assert.equal(report.reportExportFilename('weekly', at, 'RPT-AB12CD34EF56AB12'),
    '360LOGISTICS_Weekly-Performance_2026-11-05_164522_RPT-AB12CD34EF56AB12.xlsx');
  // ids from elsewhere are cleaned the same way as for the printed PDF title
  assert.equal(report.reportExportFilename('delay', at, 'RPT-..//bad id'), '360LOGISTICS_Delay-Issues_2026-11-05_164522_RPT-badid.xlsx');
});

test('the workbook shows the Report ID with a link to verify it, and the table does not move', async () => {
  const at = new Date('2026-11-05T08:45:22Z');
  const columns = [{ header: 'Driver', width: 28 }, { header: 'Route', width: 42 }];
  const base = { type: 'weekly', generatedAt: at, generatedBy: 'Test OPM', period: 'Test period', sheets: [{ name: 'Report', columns, rows: [['Niño', 'Makati']] }] };
  const read = async (extra) => {
    const bytes = await report.createReportWorkbook({ ...base, ...extra });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    return workbook.getWorksheet('Report');
  };

  const withId = await read({ reportId: 'RPT-AB12CD34EF56AB12', verifyUrl: 'https://example.test/verify-report?id=RPT-AB12CD34EF56AB12' });
  assert.equal(withId.getCell('A7').value, 'Report ID');
  assert.equal(withId.getCell('B7').value.text, 'RPT-AB12CD34EF56AB12');
  assert.equal(withId.getCell('B7').value.hyperlink, 'https://example.test/verify-report?id=RPT-AB12CD34EF56AB12');
  // everything the existing layout promises is still where it was
  assert.equal(withId.getCell('A8').value, 'Driver');
  assert.equal(withId.getCell('A9').value, 'Niño');
  assert.equal(withId.autoFilter, 'A8:B8');
  assert.equal(withId.getCell('B6').value, 'Test OPM');

  const plain = await read({});
  assert.equal(plain.getCell('A7').value, null);          // no id → the spacer row stays empty
  assert.equal(plain.getRow(7).height, 12);
  assert.equal(plain.getCell('A8').value, 'Driver');

  const noLink = await read({ reportId: 'RPT-AB12CD34EF56AB12' });
  assert.equal(noLink.getCell('B7').value, 'RPT-AB12CD34EF56AB12');
});

test('every way a report leaves the system is recorded first (PDF and both Excel buttons)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  const record = (source.match(/issueReportRecord\(/g) || []).length;
  assert.ok(record >= 4, 'the helper is defined once and used by print, the preview Excel export and the card Excel export');
  // the id is issued before the file is built, and handed to the workbook
  assert.match(source, /const issued = await issueReportRecord\(reportKey, buildIssueInput\(\)\);[\s\S]*?await exportReport\(\{[\s\S]*?reportId: issued\.id/);
  assert.match(source, /const issued = await issueReportRecord\(reportKey,\s*\n[\s\S]*?await exportReport\(\{[\s\S]*?reportId: issued\.id/);
});

test('Excel exports tell the database they are Excel; printing sends no format and stays a PDF', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  const db = fs.readFileSync(path.join(__dirname, 'db.ts'), 'utf8');
  // both Excel paths (the preview button and the report cards) record the report as excel
  assert.match(source, /issueReportRecord\(reportKey, buildIssueInput\(\), 'excel'\)/);
  assert.match(source, /\.sort\(\)\.join\(','\) \},\s*'excel'\);/);
  // the print path is unchanged: no format argument
  assert.match(source, /the QR is only created once a record has actually been issued\.\s*const issued = await issueReportRecord\(reportKey, buildIssueInput\(\)\);/);
  // only Excel adds p_format to the call, so printing works before and after the migration
  assert.match(db, /\.\.\.\(input\.format === 'excel' \? \{ p_format: 'excel' \} : \{\}\)/);
});

test('the history table shows a PDF or Excel badge, and a row without a format reads as PDF', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  assert.match(source, /r\.format === 'excel' \? 'Excel' : 'PDF'/);
});

test('the weekly summary counts the same week as its table (not every delivery in the system)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/admin/Reports.tsx'), 'utf8');
  // every weekly row says whether it is a finished delivery; a delayed row can be either, so status alone is not enough
  assert.match(source, /status: isDelayed \? 'Delayed' : 'Completed',\s*finished: true,/);
  assert.match(source, /status: isDelayed \? 'Delayed' : \(statusMap\[a\.taskStatus\] \?\? 'Assigned'\),\s*finished: false,/);
  // all four summary numbers come from those rows
  assert.match(source, /total:\s+weeklyRows\.length,\s*completed: weeklyRows\.filter\(\(r\) => r\.finished\)\.length,/);
  assert.match(source, /active:\s+weeklyRows\.filter\(\(r\) => !r\.finished\)\.length,/);
  // and the old all-time counts are gone from the weekly summary
  assert.doesNotMatch(source, /const weeklySummary = \{[^}]*completed: completed\.length/);
  assert.doesNotMatch(source, /const weeklySummary = \{[^}]*active:\s+assignments\.length/);
});
