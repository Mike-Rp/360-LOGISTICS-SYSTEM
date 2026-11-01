const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');
function load(file, imports = {}, append = '') {
  const source = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source + append)((id) => {
    if (!(id in imports)) throw new Error(`Unexpected import: ${id}`);
    return imports[id];
  }, module, module.exports);
  return module.exports;
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (React.isValidElement(node)) return text(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function runtime(t) {
  const saved = { document: global.document, setTimeout, clearTimeout };
  const listeners = new Set(), timers = new Map(); let timerId = 0, layer = false;
  const doc = { body: {}, activeElement: null,
    querySelector: () => layer ? {} : null,
    getElementById(id) { return { focus() { doc.activeElement = id; } }; },
    addEventListener(type, fn) { if (type === 'keydown') listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
  };
  global.document = doc;
  global.setTimeout = (fn) => { const id = ++timerId; timers.set(id, fn); return id; };
  global.clearTimeout = (id) => timers.delete(id);
  const lifecycles = [];
  function lifecycle() {
    const slots = []; let cursor = 0, pending = [];
    const hooks = {
      useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
        return [slots[id], (value) => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
      useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
      useEffect(fn, deps) { const id = cursor++, prev = slots[id];
        if (!prev || deps.some((dep, index) => !Object.is(dep, prev.deps[index]))) pending.push(() => { prev?.cleanup?.(); slots[id] = { deps, cleanup: fn() }; }); },
    };
    const result = { hooks, render(fn) { cursor = 0; const result = fn(); const next = pending; pending = []; next.forEach(fn => fn()); return result; },
      unmount() { for (const slot of slots) slot?.cleanup?.(); } };
    lifecycles.push(result); return result;
  }
  t.after(() => { lifecycles.reverse().forEach(instance => instance.unmount()); Object.assign(global, saved); });
  return {
    doc, lifecycle,
    element(id, visible = true) { const el = { id, offsetParent: visible ? {} : null, isConnected: true, closest: () => null, focus() { doc.activeElement = el; } }; return el; },
    flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    layer(value) { layer = value; },
    key(key, shiftKey = false, defaultPrevented = false) { const event = { key, shiftKey, defaultPrevented, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }; for (const fn of [...listeners]) fn(event); return event; },
    resources: () => listeners.size + timers.size,
  };
}

test('modal initial focus, forward/reverse Tab containment, Escape and opener restoration', (t) => {
  const env = runtime(t), life = env.lifecycle();
  const { useModalFocus } = load('../components/admin/useModalFocus.ts', { react: life.hooks });
  const opener = env.element('opener'), first = env.element('first'), last = env.element('last'), hidden = env.element('hidden', false);
  const modal = { querySelectorAll: () => [first, hidden, last], contains: el => [first, last].includes(el), focus() { env.doc.activeElement = modal; } };
  const ref = { current: modal }; let closed = 0;
  opener.focus(); life.render(() => useModalFocus(true, ref, () => closed++)); env.flush();
  assert.equal(env.doc.activeElement, first);
  assert.equal(env.key('Tab', true).defaultPrevented, true); assert.equal(env.doc.activeElement, last);
  assert.equal(env.key('Tab').defaultPrevented, true); assert.equal(env.doc.activeElement, first);
  opener.focus(); env.key('Tab'); assert.equal(env.doc.activeElement, first);
  assert.equal(env.key('Escape').defaultPrevented, true); assert.equal(closed, 1);
  life.unmount(); assert.equal(env.doc.activeElement, opener); assert.equal(env.resources(), 0);
});

test('nested modal owns keyboard handling; closing it restores parent control without closing parent', (t) => {
  const env = runtime(t), parentLife = env.lifecycle(), childLife = env.lifecycle();
  // One shared hook module/stack, with the current component hook dispatcher.
  let current = parentLife.hooks;
  const react = { useRef: (...args) => current.useRef(...args), useEffect: (...args) => current.useEffect(...args) };
  const { useModalFocus } = load('../components/admin/useModalFocus.ts', { react });
  const opener = env.element('opener'), parentControl = env.element('open child'), childControl = env.element('cancel child');
  const parentRef = { current: { querySelectorAll: () => [parentControl], contains: el => el === parentControl } };
  const childRef = { current: { querySelectorAll: () => [childControl], contains: el => el === childControl } };
  let parentClosed = 0, childClosed = 0;
  opener.focus(); parentLife.render(() => useModalFocus(true, parentRef, () => parentClosed++)); env.flush();
  current = childLife.hooks; childLife.render(() => useModalFocus(true, childRef, () => childClosed++)); env.flush();
  env.key('Escape'); assert.equal(childClosed, 1); assert.equal(parentClosed, 0);
  childLife.unmount(); assert.equal(env.doc.activeElement, parentControl);
  env.key('Escape'); assert.equal(parentClosed, 1);
});

test('Radix calendar/confirmation layers keep their own keys; updated close callback does not reset focus', (t) => {
  const env = runtime(t), life = env.lifecycle();
  const { useModalFocus } = load('../components/admin/useModalFocus.ts', { react: life.hooks });
  const first = env.element('first'), last = env.element('last'), ref = { current: { querySelectorAll: () => [first, last], contains: el => [first, last].includes(el) } };
  let old = 0, latest = 0;
  life.render(() => useModalFocus(true, ref, () => old++)); env.flush(); last.focus();
  life.render(() => useModalFocus(true, ref, () => latest++)); env.flush(); assert.equal(env.doc.activeElement, last);
  env.layer(true); assert.equal(env.key('Escape').defaultPrevented, false); assert.equal(env.key('Tab').defaultPrevented, false);
  assert.equal(latest, 0); env.layer(false); env.key('Escape', false, true); assert.equal(latest, 0);
  env.key('Escape'); assert.equal(latest, 1); assert.equal(old, 0);
});

test('empty and hidden-only modals retain focus without throwing; disconnected openers are not focused', (t) => {
  const env = runtime(t), life = env.lifecycle();
  const { useModalFocus } = load('../components/admin/useModalFocus.ts', { react: life.hooks });
  const opener = env.element('removed'); opener.focus();
  const modal = { querySelectorAll: () => [], contains: el => el === modal, focus() { env.doc.activeElement = modal; } };
  life.render(() => useModalFocus(true, { current: modal })); env.flush(); assert.equal(env.doc.activeElement, modal);
  env.key('Tab'); assert.equal(env.doc.activeElement, modal); opener.isConnected = false;
  life.unmount(); assert.equal(env.doc.activeElement, modal);
});

test('DOM overlay order wins when child effects run before parent effects', (t) => {
  const env = runtime(t), childLife = env.lifecycle(), parentLife = env.lifecycle(); let current = childLife.hooks;
  const { useModalFocus } = load('../components/admin/useModalFocus.ts', { react: {
    useRef: (...args) => current.useRef(...args), useEffect: (...args) => current.useEffect(...args),
  } });
  const childInput = env.element('child'), parentInput = env.element('parent'); let childClosed = 0, parentClosed = 0;
  const child = { compareDocumentPosition: other => other === child ? 0 : 2, querySelectorAll: () => [childInput], contains: el => el === childInput };
  const parent = { compareDocumentPosition: other => other === parent ? 0 : 4, querySelectorAll: () => [parentInput], contains: el => el === parentInput };
  childLife.render(() => useModalFocus(true, { current: child }, () => childClosed++));
  current = parentLife.hooks; parentLife.render(() => useModalFocus(true, { current: parent }, () => parentClosed++));
  env.flush(); assert.equal(env.doc.activeElement, childInput);
  env.key('Escape'); assert.equal(childClosed, 1); assert.equal(parentClosed, 0);
});

function unavailability(t, kind = 'driver', initial) {
  const env = runtime(t), life = env.lifecycle(); const calls = []; let cancelled = 0, close;
  const time = load('philippineTime.ts', { './assignmentTiming': load('assignmentTiming.ts', { './assignmentOperational': load('assignmentOperational.ts') }) });
  const helpers = load('unavailability.ts', { './philippineTime': time });
  const { default: Dialog } = load('../components/admin/UnavailabilityDialog.tsx', {
    react: life.hooks, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/unavailability': helpers, '../../lib/philippineTime': time,
    '../../lib/fleetDelegation': { toLocalInputValue: time.toPhilippineInputValue },
    './useModalFocus': { useModalFocus(open, ref, callback) { close = callback; } }, './DiscardChangesDialog': { default: 'discard' },
  });
  const render = () => life.render(() => Dialog({ kind, name: 'Long operational name '.repeat(8), mode: initial ? 'edit' : 'mark', initial,
    onSubmit: async (draft) => { calls.push(draft); }, onCancel() { cancelled++; }, errorText: () => 'Request failed' }));
  const field = id => nodes(render()).find(node => node.props.id === id);
  const change = (id, value) => { field(id).props.onChange({ target: { value } }); render(); };
  render();
  return { render, field, change, calls, cancelled: () => cancelled, close: () => close(),
    submit: () => nodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    discard: () => nodes(render()).find(node => node.type === 'discard'), env };
}

test('driver errors are linked, readable and focus the responsible reason/note/return input', (t) => {
  const app = unavailability(t); app.submit();
  assert.equal(app.field('unavailable-reason').props['aria-describedby'], 'unavailable-reason-error');
  assert.equal(app.field('unavailable-reason').props['aria-invalid'], true);
  assert.match(app.field('unavailable-reason-error').props.className, /text-sm/);
  app.change('unavailable-reason', 'other'); app.submit();
  assert.equal(app.field('unavailable-note').props['aria-describedby'], 'unavailable-note-error');
  app.change('unavailable-note', 'A saved reason'); app.change('unavailable-return', '2000-01-01T12:00'); app.submit();
  assert.match(app.field('unavailable-return').props['aria-describedby'], /unavailable-return-error/);
  assert.equal(app.calls.length, 0);
});

test('edited driver drafts survive close/Escape until explicitly discarded', (t) => {
  const app = unavailability(t); app.change('unavailable-note', 'Unsaved note'); app.close();
  assert.equal(app.cancelled(), 0); assert.equal(app.discard().props.open, true);
  app.discard().props.onKeepEditing(); assert.equal(app.discard().props.open, false);
  assert.equal(app.field('unavailable-note').props.value, 'Unsaved note');
  app.close(); app.discard().props.onDiscard(); assert.equal(app.cancelled(), 1);
});

test('unchanged forms close normally; truck metadata wraps and existing maintenance submission stays intact', async (t) => {
  const app = unavailability(t, 'truck'); app.close(); assert.equal(app.cancelled(), 1);
  app.change('unavailable-note', 'Brake repair'); await app.submit();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].reason, 'maintenance'); assert.equal(app.calls[0].note, 'Brake repair');
  const tree = nodes(app.render()), form = tree.find(node => node.type === 'form');
  assert.equal(form.props['aria-labelledby'], 'unavailability-title'); assert.match(form.props.className, /92dvh/);
  assert.ok(tree.some(node => node.type === 'p' && text(node).startsWith('Long operational') && /break-words text-sm/.test(node.props.className)));
  assert.ok(tree.some(node => /min-h-0.*overflow-y-auto/.test(node.props.className ?? '')));
});

test('mobile number errors have unique accessible associations and preserve the fixed prefix and paste workflow', () => {
  let number, error;
  const { default: Mobile } = load('../components/admin/MobileNumberField.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), './unused': {}, '../../lib/philippineMobile': load('philippineMobile.ts'),
  });
  const tree = nodes(Mobile({ id: 'test-phone', value: '', error: 'Enter a valid number.', ariaLabel: 'Contact number', onChange: value => number = value, onError: value => error = value }));
  const input = tree.find(node => node.type === 'input'); assert.equal(input.props['aria-describedby'], 'test-phone-error');
  assert.equal(input.props['aria-invalid'], true); assert.equal(input.props['aria-label'], 'Contact number');
  assert.match(tree.find(node => node.props.id === 'test-phone-error').props.className, /text-sm/);
  assert.ok(tree.some(node => text(node) === '+63'));
  input.props.onPaste({ preventDefault() {}, clipboardData: { getData: () => '+63 917 123 4567' } });
  assert.equal(number, '9171234567'); assert.equal(error, '');
});

test('coverage form links CSR/scopes/window errors, protects drafts, and retains Philippine-time submission', (t) => {
  const env = runtime(t), life = env.lifecycle(); let continued; let closed = 0;
  const time = load('philippineTime.ts', { './assignmentTiming': load('assignmentTiming.ts', { './assignmentOperational': load('assignmentOperational.ts') }) });
  const fleet = load('fleetDelegation.ts', { './philippineTime': time, './philippineMobile': load('philippineMobile.ts') });
  const { CoverageModal } = load('../components/admin/WorkspaceSettingsPanel.tsx', {
    react: life.hooks, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/db': {}, '../../lib/fleetDelegation': fleet, './ConfirmPasswordDialog': {}, './Pagination': {},
    '../../lib/adminNavigation': {}, '../../lib/pendingPasswordResetRequests': {}, '../../lib/philippineMobile': load('philippineMobile.ts'),
    './MobileNumberField': { default: 'mobile' }, '../../lib/teamMemberValidation': {}, '../../lib/useCoverageLookup': {},
    './ScheduleFields': { DateField: 'date-field', TimeField: 'time-field' }, '../../lib/philippineTime': time,
    './useModalFocus': {}, './DiscardChangesDialog': { default: 'discard' },
  }, '\nexports.CoverageModal = CoverageModal;');
  const previousWindow = global.window; global.window = { setInterval: () => 1, clearInterval() {} }; t.after(() => { global.window = previousWindow; });
  const render = () => life.render(() => CoverageModal({ members: [{ id: 'csr', name: 'Niño Peña', email: 'test@example.invalid', status: 'active' }], onClose: () => closed++, onContinue: draft => continued = draft }));
  const all = () => nodes(render()), byId = id => all().find(node => node.props.id === id);
  const click = label => all().find(node => node.type === 'button' && text(node) === label).props.onClick();
  click('Continue'); assert.equal(byId('coverage-csr').props['aria-describedby'], 'coverage-csr-error');
  byId('coverage-csr').props.onChange({ target: { value: 'csr' } });
  let checks = all().filter(node => node.type === 'input' && node.props.type === 'checkbox');
  checks[0].props.onChange({ target: { checked: false } }); checks[1].props.onChange({ target: { checked: false } });
  click('Continue'); assert.equal(byId('coverage-reset-pin').props['aria-describedby'], 'coverage-scopes-error');
  all().filter(node => node.type === 'input' && node.props.type === 'checkbox')[1].props.onChange({ target: { checked: true } });
  click('Continue'); assert.equal(byId('coverage-end').props.describedBy, 'coverage-window-error');
  assert.equal(continued, undefined);
  click('Cancel'); assert.equal(closed, 0);
  let discard = all().find(node => node.type === 'discard'); assert.equal(discard.props.open, true);
  discard.props.onKeepEditing(); assert.equal(byId('coverage-csr').props.value, 'csr');
  byId('coverage-start').props.onChange('2099-01-01');
  all().find(node => node.type === 'time-field' && node.props.label === 'Coverage start time').props.onChange('08:00');
  byId('coverage-end').props.onChange('2099-01-02');
  all().find(node => node.type === 'time-field' && node.props.label === 'Coverage end time').props.onChange('08:00');
  click('Continue'); assert.equal(continued.csr.id, 'csr'); assert.equal(continued.canRegister, true); assert.equal(continued.canResetPin, false);
  assert.equal(continued.startsAt.toISOString(), '2099-01-01T00:00:00.000Z');
});

for (const failure of ['wrong_password', 'network']) {
  test(`confirmation ${failure} has accurate accessible feedback without changing verification`, async (t) => {
    const env = runtime(t), life = env.lifecycle(); let verified = 0, confirmed = 0;
    class AssignmentActionError extends Error { constructor(code) { super(code); this.code = code; } }
    const { default: Dialog } = load('../components/admin/ConfirmPasswordDialog.tsx', {
      react: life.hooks, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': new Proxy({}, { get: () => 'svg' }),
      '../../lib/db': { AssignmentActionError, verifyOwnPassword: async () => { verified++; throw new AssignmentActionError(failure); } },
      './PasswordVisibilityInput': { default: 'password-field' }, './useModalFocus': { useModalFocus() {} },
    });
    const render = () => life.render(() => Dialog({ title: 'Give this CSR leave coverage?', message: 'Confirm coverage', confirmLabel: 'Give Coverage',
      onConfirm: async () => confirmed++, onCancel() {}, errorText: () => 'Could not verify your password. Please try again.' }));
    let tree = nodes(render()), form = tree.find(node => node.type === 'form');
    assert.equal(form.props.role, 'dialog'); assert.equal(form.props['aria-labelledby'], 'account-confirm-title');
    tree.find(node => node.type === 'password-field').props.onChange({ target: { value: 'mock-password-only' } });
    nodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    tree = nodes(render()); const password = tree.find(node => node.type === 'password-field');
    assert.equal(verified, 1); assert.equal(confirmed, 0); assert.equal(password.props.value, '');
    assert.equal(password.props['aria-invalid'], failure === 'wrong_password' ? true : undefined);
    assert.equal(password.props['aria-describedby'], failure === 'wrong_password' ? 'account-confirm-error' : undefined);
    assert.equal(tree.find(node => node.props.id === 'account-confirm-error').props.role, 'alert');
    assert.match(tree.find(node => node.props.id === 'account-confirm-error').props.className, /text-sm/);
    password.props.onChange({ target: { value: 'changed' } });
    assert.equal(nodes(render()).find(node => node.type === 'password-field').props['aria-invalid'], undefined);
  });
}

test('confirmation Escape respects in-flight action; no-password coverage confirmation preserves its callback', async (t) => {
  const env = runtime(t), life = env.lifecycle(); let close, done, confirmed = 0, cancelled = 0;
  const { default: Dialog } = load('../components/admin/ConfirmPasswordDialog.tsx', {
    react: life.hooks, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/db': {}, './PasswordVisibilityInput': {}, './useModalFocus': { useModalFocus(open, ref, onEscape) { close = onEscape; } },
  });
  const render = () => life.render(() => Dialog({ title: 'End coverage now?', message: 'Access will end.', confirmLabel: 'End Coverage', requirePassword: false,
    onConfirm: () => { confirmed++; return new Promise(resolve => done = resolve); }, onCancel: () => cancelled++, errorText: () => 'Failed' }));
  nodes(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); close();
  assert.equal(cancelled, 0); assert.equal(confirmed, 1);
  assert.equal(nodes(render()).find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
  done(); for (let i = 0; i < 6; i++) await Promise.resolve(); render(); close(); assert.equal(cancelled, 1);
});
