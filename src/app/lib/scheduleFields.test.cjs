const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(join(__dirname, '../components/admin/ScheduleFields.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mod = { exports: {} };
const imports = {
  react: { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] },
  'react/jsx-runtime': require('react/jsx-runtime'),
  'lucide-react': { Calendar: 'svg', Clock: 'svg', ChevronLeft: 'svg', ChevronRight: 'svg' },
  '../ui/popover': { Popover: 'popover', PopoverAnchor: 'anchor', PopoverContent: 'popup' },
};
new Function('require', 'module', 'exports', source)((id) => imports[id], mod, mod.exports);
const { DateField, TimeField } = mod.exports;
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
}

test('shared calendar locks dates outside the supplied range and keeps permitted dates selectable', () => {
  let selected;
  const tree = nodes(DateField({ value: '2026-11-15', minIso: '2026-11-10', maxIso: '2026-11-20', onChange: (value) => { selected = value; } }));
  assert.equal(tree.find((node) => node.key === '2026-11-09').props.disabled, true);
  assert.equal(tree.find((node) => node.key === '2026-11-21').props.disabled, true);
  const valid = tree.find((node) => node.key === '2026-11-16');
  assert.equal(valid.props.disabled, false);
  valid.props.onClick();
  assert.equal(selected, '2026-11-16');
  const input = tree.find((node) => node.type === 'input');
  assert.equal(input.props.min, '2026-11-10');
  assert.equal(input.props.max, '2026-11-20');
});

test('coverage Today shortcut cannot bypass a future start-date minimum', () => {
  const date = new Date(); date.setDate(date.getDate() + 2);
  const future = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayButton = (restrictToday) => nodes(DateField({ value: future, minIso: future, restrictToday, onChange() {} }))
    .find((node) => node.type === 'button' && node.props.children === 'Today');
  assert.equal(todayButton(true).props.disabled, true);
  assert.equal(todayButton(false).props.disabled, false, 'existing Dispatch shortcut behavior is preserved');
});

test('coverage calendar is labelled and appears above the coverage dialog', () => {
  const tree = nodes(DateField({ id: 'coverage-start', label: 'Coverage start date', value: '', layer: true, onChange() {} }));
  assert.equal(tree.find((node) => node.type === 'input').props.id, 'coverage-start');
  assert.equal(tree.find((node) => node.type === 'input').props['aria-label'], 'Coverage start date');
  assert.match(tree.find((node) => node.type === 'popup').props.className, /z-\[90\]/);
});

test('shared time picker preserves 24-hour values and AM/PM conversion', () => {
  let value;
  const tree = nodes(TimeField({ label: 'Coverage end time', value: '13:45', layer: true, onChange: (next) => { value = next; } }));
  tree.find((node) => node.type === 'button' && node.props.children === 'AM').props.onClick();
  assert.equal(value, '01:45');
  tree.find((node) => node.type === 'button' && node.props.children === 12).props.onClick();
  assert.equal(value, '12:45');
  assert.equal(tree.find((node) => node.type === 'input').props['aria-label'], 'Coverage end time');
  assert.match(tree.find((node) => node.type === 'popup').props.className, /z-\[90\]/);
});
