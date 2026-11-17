const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');

const slots = [];
let cursor = 0;
const hooks = {
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next) => { slots[index] = next; }];
  },
  useRef(initial) {
    const index = cursor++;
    return slots[index] ?? (slots[index] = { current: initial });
  },
};
const Popover = () => null;
const PopoverTrigger = () => null;
const PopoverContent = () => null;
const Command = () => null;
const CommandInput = () => null;
const CommandItem = () => null;
const CommandList = () => null;
const icon = () => null;
const source = readFileSync(join(__dirname, '../components/admin/DispatchResourceSelect.tsx'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const imports = {
  react: hooks,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'lucide-react': { Check: icon, ChevronsUpDown: icon },
  '../ui/popover': { Popover, PopoverTrigger, PopoverContent },
  '../ui/command': { Command, CommandInput, CommandItem, CommandList },
};
const mod = { exports: {} };
new Function('require', 'module', 'exports', js)((id) => {
  if (!(id in imports)) throw new Error(`Unexpected import: ${id}`);
  return imports[id];
}, mod, mod.exports);
const { default: ResourceSelect, filterDispatchResources } = mod.exports;
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes)
  : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
const find = (tree, type) => nodes(tree).find((node) => node.type === type);
const options = (tree) => nodes(tree).filter((node) => node.type === CommandItem);
const render = (props) => { cursor = 0; return ResourceSelect(props); };

test('search uses only supplied eligible resources, ignores case and accents, and tolerates plate spacing', () => {
  const drivers = [{ id: 'd1', label: 'Niño Dela Cruz' }, { id: 'd2', label: 'Ría Santos' }];
  assert.deepEqual(filterDispatchResources(drivers, '  NINO  ').map((item) => item.id), ['d1']);
  assert.deepEqual(filterDispatchResources(drivers, 'ría').map((item) => item.id), ['d2']);
  assert.deepEqual(filterDispatchResources(drivers, 'Missing'), []);
  assert.deepEqual(filterDispatchResources([{ id: 't1', label: 'ADS 2372' }], 'ads2372', true)
    .map((item) => item.id), ['t1']);
  assert.deepEqual(filterDispatchResources([{ id: 't1', label: 'ADS 2372' }], 'ADS 2', true)
    .map((item) => item.id), ['t1']);
  assert.equal(filterDispatchResources(drivers, 'juan').length, 0,
    'search cannot add drivers that eligibility omitted from the options');
});

test('driver selection keeps its ID, selected state, no-results message, and restores focus', () => {
  slots.length = 0;
  const selected = [];
  const props = { label: 'Driver Name', value: '', onChange: (id) => selected.push(id),
    options: [{ id: 'd1', label: 'Niño Dela Cruz' }, { id: 'd2', label: 'Ría Santos' }],
    placeholder: 'Select a driver…', searchPlaceholder: 'Search driver...',
    emptyLabel: 'No available drivers', noResultsLabel: 'No matching drivers' };
  let tree = render(props);
  assert.equal(find(tree, PopoverTrigger).props.children.props.type, 'button');
  assert.equal(options(tree).length, 2);
  find(tree, Popover).props.onOpenChange(true);
  tree = render(props);
  assert.equal(find(tree, CommandInput).props.placeholder, 'Search driver...');
  find(tree, CommandInput).props.onValueChange('  nino ');
  tree = render(props);
  assert.deepEqual(options(tree).map((item) => item.props.value), ['d1']);
  options(tree)[0].props.onSelect();
  assert.deepEqual(selected, ['d1']);
  tree = render({ ...props, value: 'd1' });
  assert.equal(find(tree, Popover).props.open, false);
  assert.equal(find(tree, PopoverTrigger).props.children.props['aria-label'], 'Driver Name: Niño Dela Cruz');
  assert.equal(options(tree)[0].props['aria-selected'], true);
  find(tree, Popover).props.onOpenChange(true);
  tree = render({ ...props, value: 'd1' });
  find(tree, CommandInput).props.onValueChange('impossible');
  tree = render({ ...props, value: 'd1' });
  assert.equal(options(tree).length, 0);
  assert.ok(nodes(tree).some((node) => node.type === 'p' && node.props.children === 'No matching drivers'));
  let focused = false;
  find(tree, PopoverTrigger).props.children.ref.current = { focus() { focused = true; } };
  find(tree, PopoverContent).props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(focused, true);
  find(tree, CommandInput).props.onKeyDown({ key: 'Escape', preventDefault() {} });
  tree = render({ ...props, value: 'd1' });
  assert.equal(find(tree, Popover).props.open, false);
  assert.equal(find(tree, CommandInput).props.value, '');
});

test('truck search retains plate display and ID, with scrolling and unavailable controls preserved', () => {
  slots.length = 0;
  const selected = [];
  const props = { label: 'Truck', value: '', onChange: (id) => selected.push(id),
    options: [{ id: 't1', label: 'ADS 2372' }, { id: 't2', label: 'KDS 9001' }],
    placeholder: 'Select a truck…', searchPlaceholder: 'Search plate number...',
    emptyLabel: 'No available trucks', noResultsLabel: 'No matching trucks', compactSearch: true };
  let tree = render(props);
  find(tree, CommandInput).props.onValueChange('kds9001');
  tree = render(props);
  assert.deepEqual(options(tree).map((item) => item.props.value), ['t2']);
  options(tree)[0].props.onSelect();
  tree = render({ ...props, value: 't2' });
  assert.deepEqual(selected, ['t2']);
  assert.equal(find(tree, PopoverTrigger).props.children.props['aria-label'], 'Truck: KDS 9001');
  assert.match(find(tree, CommandList).props.className, /touch-pan-y overscroll-y-contain/);
  assert.match(find(tree, PopoverContent).props.className, /radix-popover-trigger-width/);
  assert.equal(find(tree, Command).props.shouldFilter, false);
  tree = render({ ...props, options: [] });
  assert.equal(find(tree, PopoverTrigger).props.children.props.disabled, true);
  assert.equal(find(tree, PopoverTrigger).props.children.props.children[0].props.children, 'No available trucks');
});
