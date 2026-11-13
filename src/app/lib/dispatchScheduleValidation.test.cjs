const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function loadTs(file, imports = {}) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => {
    if (!(id in imports)) throw new Error(`Unexpected import: ${id}`);
    return imports[id];
  }, mod, mod.exports);
  return mod.exports;
}

const timing = loadTs(join(__dirname, 'assignmentTiming.ts'));
const manila = loadTs(join(__dirname, 'philippineTime.ts'), { './assignmentTiming': timing });
const component = readFileSync(join(__dirname, '../components/admin/DriversManagement.tsx'), 'utf8');
const start = component.indexOf('const MONTHS      =');
const end = component.indexOf('/* Plain-language text for the errors', start);
assert.ok(start >= 0 && end > start);
const validationJs = ts.transpileModule(component.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const { scheduleErrors, philippineScheduleBounds } = new Function(
  'philippineDateKey', 'parsePhilippineInputValue',
  `${validationJs}\nreturn { scheduleErrors, philippineScheduleBounds };`,
)(manila.philippineDateKey, manila.parsePhilippineInputValue);

const now = new Date('2026-11-12T22:13:00Z'); // Nov 13, 6:13 AM in Manila
assert.equal(manila.parsePhilippineInputValue('2026-11-13T03:00').toISOString(), '2026-11-12T19:00:00.000Z');
const base = {
  pickup: '2026-11-13', delivery: '2026-11-13',
  pickupTime: '07:00', scheduledArrivalTime: '08:00', remarks: '',
  bad: { pickup: false, delivery: false },
};
const live = (changes = {}, at = now) => scheduleErrors({ ...base, ...changes }, {
  requireFilled: false, philippineTime: true, now: at,
});

test('completed pickup and STA times are checked as soon as either value changes', () => {
  assert.match(live({ pickupTime: '05:00' }).pickupTime, /future for today's date/);
  assert.match(live({ scheduledArrivalTime: '04:00' }).scheduledArrivalTime, /future for today's date/);
  assert.equal(live({ pickupTime: '07:00' }).pickupTime, undefined);
  assert.equal(live({ scheduledArrivalTime: '08:00' }).scheduledArrivalTime, undefined);
  assert.match(live({ pickupTime: '09:00' }).scheduledArrivalTime, /earlier than the pickup time/);
  assert.equal(live({ pickupTime: '07:00' }).scheduledArrivalTime, undefined);
});

test('date changes recheck both paired times and existing schedule order', () => {
  assert.match(live({ pickup: '2026-11-12' }).pickedUpDate, /before today/);
  assert.match(live({ delivery: '2026-11-12' }).date, /in the past/);
  assert.match(live({ pickupTime: '05:00', delivery: '2026-11-27', scheduledArrivalTime: '' }).pickupTime, /future for today's date/);
  assert.equal(live({ pickupTime: '05:00', delivery: '2026-11-27', scheduledArrivalTime: '' }).date, undefined);
  assert.equal(live({ pickupTime: '05:00', delivery: '2026-11-27', scheduledArrivalTime: '' }).scheduledArrivalTime, undefined);
  assert.equal(live({ pickup: '2026-11-14', delivery: '2026-11-14', pickupTime: '05:00' }).pickupTime, undefined);
  assert.equal(live({ pickup: '2026-11-14', delivery: '2026-11-14', pickupTime: '05:00' }).scheduledArrivalTime, undefined);
});

test('untouched empty values stay quiet live; submit still requires all four fields', () => {
  const empty = { pickup: '', delivery: '', pickupTime: '', scheduledArrivalTime: '' };
  assert.deepEqual(live(empty), {});
  const submitted = scheduleErrors({ ...base, ...empty }, { philippineTime: true, now });
  assert.deepEqual(Object.keys(submitted).sort(), ['date', 'pickedUpDate', 'pickupTime', 'scheduledArrivalTime'].sort());
  assert.match(scheduleErrors({ ...base, pickupTime: '05:00' }, { philippineTime: true, now }).pickupTime, /future/);
  assert.match(scheduleErrors({ ...base, delivery: '2026-11-27', pickupTime: '03:00', scheduledArrivalTime: '' }, {
    philippineTime: true, now,
  }).pickupTime, /future/, 'the final gate rejects the reported screenshot schedule before any API call');
});

test('Manila date boundary and foreign device timezone do not change validation', () => {
  assert.equal(philippineScheduleBounds(now).today, '2026-11-13');
  const beforeMidnight = new Date('2026-11-13T15:59:00Z');
  const afterMidnight = new Date('2026-11-13T16:01:00Z');
  assert.equal(philippineScheduleBounds(beforeMidnight).today, '2026-11-13');
  assert.equal(philippineScheduleBounds(afterMidnight).today, '2026-11-14');
  assert.match(live({ pickupTime: '05:00' }, afterMidnight).pickedUpDate, /before today/);
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.match(live({ pickupTime: '05:00' }).pickupTime, /future/);
    assert.equal(philippineScheduleBounds(now).today, '2026-11-13');
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('Dispatch field handlers, Step 2 entry, and submit use the same validation', () => {
  assert.match(component, /setTaskDateField[\s\S]*?updateTaskScheduleErrors\(\{ pickup, delivery, bad: nextBad \}\)/);
  assert.match(component, /handleNextStep[\s\S]*?setTaskErrors\(liveTaskScheduleErrors\(\)\)/);
  assert.match(component, /setTaskPickupTime\(v\); updateTaskScheduleErrors\(\{ pickupTime: v \}\)/);
  assert.match(component, /setTaskScheduledArrivalTime\(v\); updateTaskScheduleErrors\(\{ scheduledArrivalTime: v \}\)/);
  assert.match(component, /handleAssignTask[\s\S]*?scheduleErrors\(taskSchedule\(\), \{ philippineTime: true \}\)/);
  for (const field of ['pickup-date', 'pickup-time', 'delivery-date', 'sta-time']) {
    assert.match(component, new RegExp(`describedBy=\\{taskErrors\\.[^}]+\\? 'dispatch-${field}-error'`));
    assert.match(component, new RegExp(`id="dispatch-${field}-error"`));
  }
});

test('the actual Dispatch Step 2 field displays and updates the screenshot pickup error', async () => {
  const React = require('react');
  const slots = [];
  let cursor = 0;
  let dispatchCalls = 0;
  let scheduleEffect;
  let scheduleTick;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (update) => { slots[index] = typeof update === 'function' ? update(slots[index]) : update; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect(effect) {
      cursor++;
      if (effect.toString().includes('liveTaskScheduleErrors')) scheduleEffect = effect;
    },
    useLayoutEffect() { cursor++; },
  };
  const noop = () => null;
  const fallback = new Proxy({}, { get: (_, key) => key === 'default' ? noop : noop });
  const imports = new Proxy({
    react: hooks,
    'react/jsx-runtime': require('react/jsx-runtime'),
    './ScheduleFields': { DateField: noop, TimeField: noop },
    '../../lib/philippineTime': manila,
    './Pagination': { PaginationFooter: noop, usePagination: () => ({ page: 1, setPage: noop, pageItems: [] }), useStablePageHeight: () => ({}) },
    '../../data/assignmentRoute': { destinationAreaEnabled: false, getAssignmentRoute: noop, getDeliveryLocation: noop },
    '../../lib/adminNavigation': { ADMIN_NAVIGATION_EVENT: 'navigation', pushAdminNavigation: noop },
    '../../lib/dispatchStatusFilter': { DISPATCH_STATUS_OPTIONS: [], matchesDispatchStatus: noop },
    '../../data/truckTypes': { TRUCK_CLASSIFICATIONS: [], truckFullImageFor: noop, capacityKgOnly: noop },
    '../../lib/completedOrdering': { sortCompletedNewestFirst: (rows) => rows },
    '../../lib/recordOrdering': { sortNewestFirst: (rows) => rows },
    '../../lib/db': { dispatchAssignment: async () => { dispatchCalls++; return 'unexpected'; } },
  }, { get: (map, id) => id in map ? map[id] : fallback });
  const js = ts.transpileModule(component, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => imports[id], mod, mod.exports);
  const render = () => {
    cursor = 0;
    return mod.exports.default({
      drivers: [{ id: 'driver-1', name: 'Demo Driver', status: 'Active' }],
      trucks: [{ id: 'truck-1', plateNumber: 'ABC 1234', status: 'Available' }],
      assignments: [], completed: [], cancelled: [], notifications: [], activityLog: [],
      search: '', onSearchChange: noop, onServerChange: async (action) => action(), onActionFeedback: noop,
    });
  };
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes)
    : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
  const field = (tree, id) => nodes(tree).find((node) => node.props.id === id);
  const content = (node) => Array.isArray(node) ? node.map(content).join('')
    : React.isValidElement(node) ? content(node.props.children)
    : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  const button = (tree, label) => nodes(tree).find((node) => node.type === 'button' && content(node).trim() === label);
  const typeInto = (tree, placeholder, value) => {
    const input = nodes(tree).find((node) => node.props.placeholder === placeholder);
    assert.ok(input, `missing ${placeholder}`);
    input.props.onChange({ target: { value } });
  };
  const oldNow = Date;
  const oldWindow = global.window;
  const oldDocument = global.document;
  const oldHTMLElement = global.HTMLElement;
  global.window = { location: { search: '' }, setInterval(fn) { scheduleTick = fn; return 1; }, clearInterval() {} };
  global.HTMLElement = class {};
  global.document = { activeElement: null };
  // Validation and rendered UI share the same clock during this interaction test.
  const RealDate = Date;
  let clock = now;
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock.getTime(); } }
  global.Date = FixedDate;
  try {
    let tree = render();
    const open = nodes(tree).find((node) => node.type === 'button' && content(node).includes('Dispatch Truck') && node.props.onClick);
    assert.ok(open);
    open.props.onClick();
    tree = render();
    assert.equal(nodes(tree).find((node) => node.props.open === true && node.type !== 'button') !== undefined, true);
    const driver = nodes(tree).find((node) => node.props.placeholder === 'Select a driver…');
    const truck = nodes(tree).find((node) => node.props.placeholder === 'Select a truck…');
    driver.props.onChange('driver-1');
    truck.props.onChange('truck-1');
    typeInto(tree, 'Enter origin city or area', 'Demo origin');
    typeInto(tree, 'Enter pickup address or location', 'Demo pickup');
    typeInto(tree, 'Enter delivery address or location', 'Demo delivery');
    typeInto(tree, 'Client or company name', 'Demo client');
    tree = render();
    button(tree, 'Next').props.onClick();
    tree = render();
    assert.ok(field(tree, 'dispatch-pickup-time'), 'Step 2 opened with no premature required error');
    assert.equal(field(tree, 'dispatch-pickup-time').props.hasError, false);
    assert.equal(field(tree, 'dispatch-pickup-time').props.isolateWheel, true);
    assert.equal(field(tree, 'dispatch-sta-time').props.isolateWheel, true);

    field(tree, 'dispatch-pickup-date').props.onChange('2026-11-13', false);
    tree = render();
    field(tree, 'dispatch-delivery-date').props.onChange('2026-11-27', false);
    tree = render();
    field(tree, 'dispatch-pickup-time').props.onChange('03:00');
    tree = render();
    assert.equal(field(tree, 'dispatch-pickup-time').props.hasError, true);
    assert.match(content(tree), /Pickup time must be in the future for today's date/);
    assert.equal(field(tree, 'dispatch-sta-time').props.hasError, false);
    await button(tree, 'Dispatch Truck').props.onClick();
    assert.equal(dispatchCalls, 0, 'invalid pickup never reaches dispatchAssignment');

    field(tree, 'dispatch-pickup-time').props.onChange('07:00');
    tree = render();
    assert.equal(field(tree, 'dispatch-pickup-time').props.hasError, false);
    clock = new RealDate('2026-11-12T23:01:00Z'); // 7:01 AM PHT
    assert.ok(scheduleEffect);
    scheduleEffect();
    scheduleTick();
    tree = render();
    assert.equal(field(tree, 'dispatch-pickup-time').props.hasError, true, 'a valid time becoming past is rechecked while open');
    field(tree, 'dispatch-pickup-time').props.onChange('08:00');
    tree = render();
    assert.equal(field(tree, 'dispatch-pickup-time').props.hasError, false);
    field(tree, 'dispatch-pickup-time').props.onChange('03:00');
    tree = render();
    assert.equal(field(tree, 'dispatch-pickup-time').props.hasError, true);

    button(tree, 'Back').props.onClick();
    tree = render();
    button(tree, 'Next').props.onClick();
    tree = render();
    assert.equal(field(tree, 'dispatch-pickup-time').props.hasError, true, 'returning to Step 2 rechecks retained values');
    field(tree, 'dispatch-delivery-date').props.onChange('2026-11-13', false);
    tree = render();
    field(tree, 'dispatch-sta-time').props.onChange('04:00');
    tree = render();
    assert.equal(field(tree, 'dispatch-sta-time').props.hasError, true);
    field(tree, 'dispatch-sta-time').props.onChange('09:00');
    tree = render();
    assert.equal(field(tree, 'dispatch-sta-time').props.hasError, false);
  } finally {
    global.Date = oldNow;
    global.window = oldWindow;
    global.document = oldDocument;
    global.HTMLElement = oldHTMLElement;
  }
});
