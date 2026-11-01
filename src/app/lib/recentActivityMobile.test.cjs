const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/admin/dashboard/RecentActivityTable.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mod = { exports: {} };
const badges = new Proxy({}, { get: () => ({ badge: 'event-color', label: 'Status' }) });
new Function('require', 'module', 'exports', source)((name) => ({
  'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': { Activity: 'activity-icon' },
  '../ASNWithCopy': { default: 'copy-control' }, '../../../data/assignmentTypes': { parseStoredTimestamp: value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }, taskStatusConfig: {} },
  '../../../data/statusColors': { statusColors: badges },
})[name], mod, mod.exports);
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(''); return React.isValidElement(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }

test('mobile list and desktop table use the same newest-first real rows and existing copy controls', () => {
  const notifications = [
    { id: 'older', assignmentId: 'ASN-VERY-LONG-IDENTIFIER-123456789', driverName: 'Long Driver Name', truckPlate: 'ABC 1234', timestamp: '2026-10-01T01:00:00Z', type: 'delay_report' },
    { id: 'newer', assignmentId: 'ASN-002', driverName: 'Another Driver', truckPlate: 'DEF 1234', timestamp: '2026-10-02T01:00:00Z', type: 'status_update', statusUpdate: 'loading_completed' },
  ];
  const tree = nodes(mod.exports.default({ notifications, completed: [] }));
  const list = tree.find(node => node.type === 'ul');
  const items = nodes(list).filter(node => node.type === 'li');
  assert.match(list.props.className, /md:hidden/);
  assert.deepEqual(items.map(item => nodes(item).find(node => node.type === 'copy-control').props.value), ['ASN-002', 'ASN-VERY-LONG-IDENTIFIER-123456789']);
  assert.match(text(items[1]), /Long Driver Name/); assert.match(text(items[1]), /Delay/);
  assert.equal(nodes(items[1]).find(node => node.type === 'time').props.dateTime, '2026-10-01T01:00:00.000Z');
  assert.ok(tree.some(node => node.type === 'div' && /hidden.*md:block/.test(node.props.className ?? '') && nodes(node).some(child => child.type === 'table')));
  assert.deepEqual(tree.filter(node => node.type === 'th').map(text), ['Delivery', 'Driver', 'Event', 'Time']);
});

test('empty state stays shared without fabricated activity', () => {
  const tree = nodes(mod.exports.default({ notifications: [], completed: [] }));
  assert.ok(tree.some(node => node.type === 'p' && text(node) === 'No fleet events yet'));
  assert.equal(tree.some(node => node.type === 'ul' || node.type === 'table'), false);
});
