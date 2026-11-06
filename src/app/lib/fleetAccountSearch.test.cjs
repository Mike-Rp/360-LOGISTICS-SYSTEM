const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, 'fleetAccountSearch.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const { normalizeFleetSearch, matchesDriverSearch, matchesTruckSearch } = moduleForTest.exports;

const driver = { id: 'DRV-001', name: 'María Peña', phone: '09171234567' };
const truck = { id: 'TRK-001', plateNumber: 'ABC 1234', classification: 'Wing Van', capacity: '10t' };

test('driver search matches partial names, Ñ/ñ and phone numbers', () => {
  for (const term of ['MARÍA', 'peÑ', 'Ña', '0917', '34567']) {
    assert.equal(matchesDriverSearch(driver, normalizeFleetSearch(term)), true, term);
  }
  assert.equal(matchesDriverSearch(driver, normalizeFleetSearch('DRV-001')), false);
  assert.equal(matchesDriverSearch(driver, normalizeFleetSearch('0999')), false);
});

test('truck search matches only plate numbers, ignoring case and outer spaces', () => {
  assert.equal(matchesTruckSearch(truck, normalizeFleetSearch('  abc 12  ')), true);
  assert.equal(matchesTruckSearch(truck, normalizeFleetSearch('1234')), true);
  assert.equal(matchesTruckSearch(truck, normalizeFleetSearch('wing van')), false);
  assert.equal(matchesTruckSearch(truck, normalizeFleetSearch('TRK-001')), false);
});

test('cleared queries match all records for either tab', () => {
  assert.equal(matchesDriverSearch(driver, normalizeFleetSearch('   ')), true);
  assert.equal(matchesTruckSearch(truck, normalizeFleetSearch('')), true);
});
