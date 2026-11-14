const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const ts = require('typescript');

function loadTs(file, imports = {}) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (!(id in imports)) throw new Error(`Unexpected import: ${id}`);
    return imports[id];
  }, mod, mod.exports);
  return mod.exports;
}

const { dispatchAreaError } = loadTs(join(__dirname, 'dispatchAreaValidation.ts'));
const valid = (value) => dispatchAreaError(value, 'Enter an origin area.', true);

test('area names accept letters, ñ/Ñ, spaces, periods, and commas without a city whitelist', () => {
  for (const value of ['Santa Rosa', 'Sta. Rosa', 'Sto. Tomas', 'Biñan', 'Las Piñas',
    'General Trias', 'Brgy. San Antonio', 'NIÑO', ' Las Piñas ',
    'Santa Rosa, Laguna', 'Biñan, Laguna', 'Dasmariñas, Cavite', 'Sta. Rosa, Laguna']) {
    assert.equal(valid(value), '', value);
    assert.equal(dispatchAreaError(value, 'Enter an origin area.'), '', value);
  }
});

test('digits, punctuation, symbols, and emoji are rejected without changing the draft', () => {
  for (const value of ['Santa123', 'Laguna1', 'Barangay 1', '123456', 'Santa@Rosa',
    'Quezon_City', 'Cavite!', 'Laguna#', 'Santa/Rosa', 'Santa🚚']) {
    assert.match(dispatchAreaError(value, 'Enter an origin area.'), /Only letters/);
    assert.match(valid(value), /Only letters/, value);
  }
});

test('untouched empty and partial input stay quiet live; final validation needs a letter', () => {
  for (const value of ['', '  ', '. ', '...', ', ', '.,.']) assert.equal(dispatchAreaError(value, 'Enter an origin area.'), '');
  assert.equal(valid(''), 'Enter an origin area.');
  assert.equal(valid('   '), 'Enter an origin area.');
  assert.match(valid('...'), /at least one letter/);
  assert.match(valid(' . . '), /at least one letter/);
  assert.match(valid(' , . '), /at least one letter/);
  assert.equal(valid('Sta.'), '');
});

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join('');
  if (React.isValidElement(node)) return content(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

test('the actual Dispatch Step 1 fields show immediate errors and block Next until corrected', () => {
  const timing = loadTs(join(__dirname, 'assignmentTiming.ts'));
  const manila = loadTs(join(__dirname, 'philippineTime.ts'), { './assignmentTiming': timing });
  const slots = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (update) => { slots[index] = typeof update === 'function' ? update(slots[index]) : update; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect() { cursor++; }, useLayoutEffect() { cursor++; },
  };
  const noop = () => null;
  const fallback = new Proxy({}, { get: () => noop });
  const imports = new Proxy({
    react: hooks,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../../lib/dispatchAreaValidation': { dispatchAreaError },
    '../../lib/philippineTime': manila,
    './ScheduleFields': { DateField: noop, TimeField: noop },
    './Pagination': { PaginationFooter: noop, usePagination: () => ({ page: 1, setPage: noop, pageItems: [] }), useStablePageHeight: () => ({}) },
    '../../data/assignmentRoute': { destinationAreaEnabled: true, getAssignmentRoute: noop, getDeliveryLocation: noop },
    '../../lib/adminNavigation': { ADMIN_NAVIGATION_EVENT: 'navigation', pushAdminNavigation: noop },
    '../../lib/dispatchStatusFilter': { DISPATCH_STATUS_OPTIONS: [], matchesDispatchStatus: noop },
    '../../data/truckTypes': { TRUCK_CLASSIFICATIONS: [], truckFullImageFor: noop, capacityKgOnly: noop },
    '../../lib/completedOrdering': { sortCompletedNewestFirst: (rows) => rows },
    '../../lib/recordOrdering': { sortNewestFirst: (rows) => rows },
  }, { get: (map, id) => id in map ? map[id] : fallback });
  const component = ts.transpileModule(readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', component)((id) => imports[id], mod, mod.exports);
  const render = () => {
    cursor = 0;
    return mod.exports.default({
      drivers: [{ id: 'driver-1', name: 'Demo Driver', status: 'Active' }],
      trucks: [{ id: 'truck-1', plateNumber: 'ABC 1234', status: 'Available' }],
      assignments: [], completed: [], cancelled: [], notifications: [], activityLog: [],
      search: '', onSearchChange: noop, onServerChange: async () => {}, onActionFeedback: noop,
    });
  };
  const input = (tree, placeholder) => {
    const found = nodes(tree).find((node) => node.type === 'input' && node.props.placeholder === placeholder);
    assert.ok(found, `Missing ${placeholder}`);
    return found;
  };
  const enter = (tree, placeholder, value) => input(tree, placeholder).props.onChange({ target: { value } });
  const next = (tree) => nodes(tree).find((node) => node.type === 'button' && content(node).trim() === 'Next');
  const oldWindow = global.window, oldDocument = global.document, oldHTMLElement = global.HTMLElement;
  global.window = { location: { search: '' } };
  global.HTMLElement = class {};
  global.document = { activeElement: null };
  try {
    let tree = render();
    assert.equal(input(tree, 'Enter origin city or area').props['aria-invalid'], undefined);
    assert.equal(input(tree, 'Enter destination city or area').props['aria-invalid'], undefined);
    const driver = nodes(tree).find((node) => node.props.placeholder === 'Select a driver…');
    const truck = nodes(tree).find((node) => node.props.placeholder === 'Select a truck…');
    driver.props.onChange('driver-1');
    truck.props.onChange('truck-1');
    enter(tree, 'Enter pickup address or location', '123 Main St., #4');
    enter(tree, 'Enter delivery address or location', 'Bldg. 2 / East');
    enter(tree, 'Client or company name', 'Demo client');

    enter(tree, 'Enter origin city or area', 'Santa1');
    tree = render();
    assert.equal(input(tree, 'Enter origin city or area').props.value, 'Santa1');
    assert.equal(input(tree, 'Enter origin city or area').props['aria-invalid'], true);
    assert.match(input(tree, 'Enter origin city or area').props.className, /border-red-400/);
    assert.match(content(nodes(tree).find((node) => node.props.id === 'dispatch-origin-area-error')), /Only letters/);
    assert.equal(content(nodes(tree).find((node) => node.props.id === 'dispatch-origin-area-error')),
      'Only letters, spaces, periods (.), commas (,), and ñ are allowed.');
    assert.equal(input(tree, 'Enter destination city or area').props['aria-invalid'], undefined);
    next(tree).props.onClick();
    tree = render();
    assert.equal(nodes(tree).some((node) => node.props.id === 'dispatch-pickup-time'), false);

    enter(tree, 'Enter origin city or area', 'Santa Rosa, Laguna');
    tree = render();
    assert.equal(input(tree, 'Enter origin city or area').props['aria-invalid'], undefined);
    enter(tree, 'Enter origin city or area', 'Dasmariñas, Cavite');
    tree = render();
    assert.equal(input(tree, 'Enter origin city or area').props['aria-invalid'], undefined);
    enter(tree, 'Enter destination city or area', 'Laguna@');
    tree = render();
    assert.equal(input(tree, 'Enter destination city or area').props['aria-invalid'], true);
    assert.equal(input(tree, 'Enter origin city or area').props['aria-invalid'], undefined);
    for (const invalid of ['123456', 'Quezon_City', 'Laguna🚚']) {
      enter(tree, 'Enter destination city or area', invalid);
      tree = render();
      assert.equal(input(tree, 'Enter destination city or area').props['aria-invalid'], true, invalid);
    }
    next(tree).props.onClick();
    tree = render();
    assert.equal(nodes(tree).some((node) => node.props.id === 'dispatch-pickup-time'), false);
    enter(tree, 'Enter destination city or area', 'Biñan, Laguna');
    tree = render();
    assert.equal(input(tree, 'Enter destination city or area').props['aria-invalid'], undefined);
    assert.equal(input(tree, 'Enter pickup address or location').props.value, '123 Main St., #4');
    assert.equal(input(tree, 'Enter delivery address or location').props.value, 'Bldg. 2 / East');
    next(tree).props.onClick();
    tree = render();
    assert.ok(nodes(tree).some((node) => node.props.id === 'dispatch-pickup-time'), 'valid Step 1 reaches Step 2');
  } finally {
    global.window = oldWindow;
    global.document = oldDocument;
    global.HTMLElement = oldHTMLElement;
  }
});
