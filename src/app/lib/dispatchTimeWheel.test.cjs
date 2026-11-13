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
  react: { useState: (initial) => [initial, () => {}], useEffect() {} },
  'react/jsx-runtime': require('react/jsx-runtime'),
  'lucide-react': { Calendar: 'svg', Clock: 'svg', ChevronLeft: 'svg', ChevronRight: 'svg' },
  '../ui/popover': { Popover: 'popover', PopoverAnchor: 'anchor', PopoverContent: 'popup' },
};
new Function('require', 'module', 'exports', source)((id) => imports[id], mod, mod.exports);
const { TimeField } = mod.exports;

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
}
function columns(props) {
  return nodes(TimeField(props)).filter((node) => node.type === 'div' &&
    node.props.className?.includes('max-h-40 overflow-y-auto'));
}

test('Dispatch HH and MM wheel events stay in their own native scroll containers', () => {
  let selected = '';
  const fields = columns({ value: '09:15', isolateWheel: true, onChange: (value) => { selected = value; } });
  assert.equal(fields.length, 2);
  for (const column of fields) {
    assert.match(column.props.className, /overscroll-y-contain/);
    assert.match(column.props.className, /overflow-y-auto/);
    let stopped = 0;
    column.props.onWheel({ stopPropagation() { stopped++; } });
    assert.equal(stopped, 1);
    assert.equal(selected, '', 'scrolling does not select a time');
    assert.equal(column.props.onTouchMove, undefined, 'touch and scrollbar behavior stay native');
  }
  const hourTen = nodes(fields[0]).find((node) => node.type === 'button' && node.props.children === 10);
  const minuteTwenty = nodes(fields[1]).find((node) => node.type === 'button' && node.props.children === '20');
  hourTen.props.onClick();
  assert.equal(selected, '10:15');
  minuteTwenty.props.onClick();
  assert.equal(selected, '09:20');
});

test('other TimeField consumers keep their previous wheel behavior and Done control', () => {
  const tree = nodes(TimeField({ value: '09:15', onChange() {} }));
  const ordinaryColumns = tree.filter((node) => node.type === 'div' && node.props.className?.includes('max-h-40 overflow-y-auto'));
  assert.equal(ordinaryColumns.length, 2);
  for (const column of ordinaryColumns) {
    assert.equal(column.props.onWheel, undefined);
    assert.doesNotMatch(column.props.className, /overscroll-y-contain/);
  }
  assert.equal(tree.find((node) => node.type === 'button' && node.props.children === 'Done').props.type, 'button');
  assert.equal(tree.find((node) => node.type === 'button' && node.props.children === 'AM').props.children, 'AM');
});
