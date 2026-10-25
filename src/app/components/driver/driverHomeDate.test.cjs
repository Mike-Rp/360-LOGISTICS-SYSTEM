const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'driverHomeDate.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { formatDriverHomeDate, manilaDateKey, msUntilNextManilaDay } = loaded.exports;

test('all seven weekdays use full English and Filipino names', () => {
  const english = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const filipino = ['Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado', 'Linggo'];
  for (let day = 0; day < 7; day++) {
    const instant = new Date(Date.UTC(2026, 9, 25 + day, 16)); // Philippine midnight
    assert.match(formatDriverHomeDate(instant, 'en'), new RegExp(`^${english[day]}, `));
    assert.match(formatDriverHomeDate(instant, 'fil'), new RegExp(`^${filipino[day]}, `));
  }
  const monday = new Date('2026-10-25T16:00:00Z');
  assert.equal(formatDriverHomeDate(monday, 'en'), 'Monday, Oct 26, 2026');
  assert.equal(formatDriverHomeDate(monday, 'fil'), 'Lunes, Okt 26, 2026');
  assert.doesNotMatch(formatDriverHomeDate(monday, 'en'), /\d+:\d+|AM|PM|•/);
});

test('the semantic date and rollover timer follow Manila rather than the device timezone', () => {
  const before = new Date('2026-10-25T15:59:59.500Z');
  const after = new Date('2026-10-25T16:00:00.000Z');
  assert.equal(manilaDateKey(before), '2026-10-25');
  assert.equal(manilaDateKey(after), '2026-10-26');
  assert.equal(msUntilNextManilaDay(before), 550);
  assert.equal(msUntilNextManilaDay(after), 86_400_050);
});

test('Filipino weekday fallback handles browsers that return an abbreviation', () => {
  const OriginalFormatter = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (locale, options) {
    const formatter = new OriginalFormatter(locale, options);
    if (locale !== 'fil-PH' || options?.weekday !== 'long') return formatter;
    return { formatToParts(date) {
      return formatter.formatToParts(date).map(part => part.type === 'weekday' ? { ...part, value: 'Lun' } : part);
    } };
  };
  try {
    assert.equal(formatDriverHomeDate(new Date('2026-10-25T16:00:00Z'), 'fil'), 'Lunes, Okt 26, 2026');
  } finally {
    Intl.DateTimeFormat = OriginalFormatter;
  }
});
