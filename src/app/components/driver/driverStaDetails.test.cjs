const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const details = readFileSync(join(__dirname, 'DriverInterface.tsx'), 'utf8');
const translations = readFileSync(join(__dirname, 'driverI18n.tsx'), 'utf8');
const db = readFileSync(join(__dirname, '../../lib/db.ts'), 'utf8');

test('driver assignment data carries the persisted scheduled arrival time', () => {
  assert.match(db, /scheduledArrivalTime:\s*r\.scheduled_arrival_time\s*\?\?\s*''/);
  assert.match(db, /loadDriverData[\s\S]*?assignment\s*=\s*assignmentFromRow\(chosen,/);
});

test('Delivery Details shows the selected assignment STA below Delivery Date without substituting ATA', () => {
  const rows = details.match(/<DetailRow label=\{t\('task\.deliveryDate'\)\}[\s\S]*?<DetailRow label=\{t\('task\.instructions'\)\} value=\{a\.remarks\} \/>/)?.[0];
  assert.ok(rows);
  assert.match(rows, /task\.deliveryDate[\s\S]*?task\.sta[\s\S]*?task\.instructions/);
  assert.match(rows, /label=\{t\('task\.sta'\)\} value=\{a\.scheduledArrivalTime\?\.trim\(\) \|\| t\('task\.staNotProvided'\)\}/);
  assert.doesNotMatch(rows.match(/<DetailRow label=\{t\('task\.sta'\)\}[^\n]*/)[0], /\bata\b|\beta\b/i);
});

test('STA label and missing-value fallback are available in both driver languages', () => {
  assert.match(translations, /'task\.sta': 'Scheduled Time of Arrival \(STA\)', 'task\.staNotProvided': 'Not provided'/);
  assert.match(translations, /'task\.sta': 'Nakatakdang Oras ng Pagdating \(STA\)', 'task\.staNotProvided': 'Hindi ibinigay'/);
});
