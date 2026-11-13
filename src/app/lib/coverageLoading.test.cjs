const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');

function load(file, imports = {}) {
  const code = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (!(id in imports)) throw new Error(`Unexpected test import: ${id}`);
    return imports[id];
  }, mod, mod.exports);
  return mod.exports;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const philippineTime = load('philippineTime.ts', { './assignmentTiming': load('assignmentTiming.ts') });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the real coverage hooks (and optionally the real Workspace JSX) with a
// deterministic effect lifecycle. Only RPC boundaries and unrelated UI children are stubbed.
function setup(t, mode = 'opm') {
  const previous = { window: global.window, document: global.document, localStorage: global.localStorage };
  const events = () => {
    const listeners = new Map();
    return {
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      emit(type) { for (const fn of [...(listeners.get(type) ?? [])]) fn({}); },
      count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
  };
  let id = 0;
  const intervals = new Map();
  global.window = { ...events(), setInterval: (fn, ms) => { const next = ++id; intervals.set(next, { fn, ms }); return next; }, clearInterval: (key) => intervals.delete(key) };
  global.document = { ...events(), visibilityState: 'visible', body: { style: {} } };
  global.localStorage = { getItem: () => null };
  const slots = [];
  let cursor = 0, dirty = false, mounted = true, updates = 0;
  let effects = [];
  const hooks = {
    useState(initial) {
      const key = cursor++;
      if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
      return [slots[key], (next) => {
        updates++;
        const value = typeof next === 'function' ? next(slots[key]) : next;
        if (!Object.is(value, slots[key])) { slots[key] = value; dirty = true; }
      }];
    },
    useRef(initial) { const key = cursor++; if (!(key in slots)) slots[key] = { current: initial }; return slots[key]; },
    useEffect(fn, deps) {
      const key = cursor++;
      const old = slots[key];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        effects.push(() => { old?.cleanup?.(); slots[key] = { deps, cleanup: fn() }; });
      }
    },
    useCallback: (fn) => fn,
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const requests = [];
  const lookup = () => { const request = deferred(); requests.push(request); return request.promise; };
  const shared = load('useCoverageLookup.ts', { react: hooks });
  const helpers = load('fleetDelegation.ts', { './philippineMobile': {}, './philippineTime': philippineTime });
  const csr = load('useMyFleetDelegation.ts', {
    react: hooks, './db': { getMyFleetDelegation: lookup }, './fleetDelegation': helpers, './useCoverageLookup': shared,
  });
  let enabled = true, owner = 'account-a';
  let component;
  if (mode === 'ui') {
    const imports = {
      react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'),
      'lucide-react': new Proxy({}, { get: () => 'svg' }),
      '../../lib/db': {
        listFleetDelegations: lookup, listTeamMembers: async () => [],
        listCsrPasswordResetRequests: async () => [], resolveAvatarUrls: async () => ({}),
      },
      '../../lib/fleetDelegation': helpers,
      '../../lib/useCoverageLookup': shared,
      '../../lib/philippineTime': philippineTime,
      './ScheduleFields': { DateField: 'date-field', TimeField: 'time-field' },
      './ConfirmPasswordDialog': { default: 'confirmation' },
      './TeamMemberPhotoPreview': { default: 'photo-preview', memberInitials: () => 'TM' },
      './useModalFocus': { useModalFocus() {} }, './useModalBodyLock': { useModalBodyLock() {} }, './DiscardChangesDialog': { default: 'discard-confirmation' },
      './Pagination': { PaginationFooter: 'pagination' },
      '../../lib/adminNavigation': {},
      '../../lib/pendingPasswordResetRequests': {},
      '../../lib/philippineMobile': {},
      './MobileNumberField': { default: 'mobile-input' },
      '../../lib/personName': {},
      '../../lib/teamMemberValidation': load('teamMemberValidation.ts', { './personName': load('personName.ts') }),
    };
    const { default: Workspace } = load('../components/admin/WorkspaceSettingsPanel.tsx', imports);
    component = () => Workspace({ open: enabled, adminEmail: owner, adminName: 'OPM', activityLog: [], onClose: () => { enabled = false; } });
  } else if (mode === 'accounts') {
    const { default: Accounts } = load('../components/admin/AccountsPanel.tsx', {
      react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'),
      'lucide-react': new Proxy({}, { get: () => 'svg' }),
      '../../data/assignmentTypes': { availabilityConfig: {} },
      './RegisterModals': { RegisterDriverModal: 'driver-modal', RegisterTruckModal: 'truck-modal' },
      './useModalFocus': { useModalFocus() {} }, './useModalBodyLock': { useModalBodyLock() {} },
      '../TruckImage': { default: 'truck-image' }, './ConfirmPasswordDialog': { default: 'confirmation' },
      '../../lib/db': {}, './UnavailabilityDialog': { default: 'unavailable-dialog' },
      '../../lib/unavailability': load('unavailability.ts', { './philippineTime': philippineTime }),
      '../ui/dropdown-menu': {},
      '../../lib/fleetAccountSearch': load('fleetAccountSearch.ts'),
      './Pagination': {
        PaginationFooter: 'pagination', useStablePageHeight: () => ({ current: null }),
        usePagination: (items) => ({ page: 1, pageItems: items, setPage: () => {} }),
      },
      '../../lib/recordOrdering': { sortNewestFirst: (items) => items, useLocalAddedHighlight: () => null },
      '../../data/truckTypes': {}, './ASNWithCopy': { default: 'asn' }, '../../lib/philippineMobile': {},
      '../../lib/philippineTime': philippineTime,
    });
    /* The active tab is owned by AdminDashboard in the real app (so search can follow it); the test holds it here. */
    component = () => {
      const [tab, setTab] = hooks.useState('Drivers');
      return Accounts({ drivers: [], trucks: [], search: '', canManageFleetAccounts: false, tab, onTabChange: setTab,
        coverage: csr.useMyFleetDelegation(enabled, owner) });
    };
  } else {
    component = () => mode === 'csr' ? csr.useMyFleetDelegation(enabled, owner)
      : shared.useCoverageLookup(enabled, owner, lookup, 30_000);
  }
  const render = () => {
    assert.ok(mounted);
    let output;
    for (let pass = 0; pass < 15; pass++) {
      cursor = 0; dirty = false;
      output = component();
      const pending = effects; effects = [];
      pending.forEach((effect) => effect());
      if (!dirty) return output;
    }
    throw new Error('Unexpected render loop');
  };
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    if (React.isValidElement(node)) return text(node.props.children);
    return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  }
  const unmount = () => { if (!mounted) return; mounted = false; slots.forEach((slot) => slot?.cleanup?.()); };
  t.after(() => { unmount(); Object.assign(global, previous); });
  const app = {
    render, requests, unmount,
    updates: () => updates,
    listeners: () => window.count() + document.count(),
    timers: () => intervals.size,
    setOwner(next) { owner = next; return render(); },
    setEnabled(next) { enabled = next; return render(); },
    focus() { window.emit('focus'); return render(); },
    poll() { [...intervals.values()].filter((timer) => timer.ms === (mode === 'csr' ? 60_000 : 30_000)).forEach((timer) => timer.fn()); return render(); },
    async resolve(index, value) { requests[index].resolve(value); await flush(); return mounted ? render() : undefined; },
    async reject(index) { requests[index].reject(new Error('Test read failure')); await flush(); return render(); },
    content: () => text(render()),
    find: (type) => nodes(render()).find((node) => node.type === type),
    click(label) {
      const button = nodes(render()).find((node) => node.type === 'button' && text(node).trim().startsWith(label));
      assert.ok(button, `Missing ${label}`); assert.ok(!button.props.disabled, `${label} disabled`);
      button.props.onClick(); return render();
    },
  };
  render();
  if (mode === 'ui') app.click('Leave Coverage');
  return app;
}
const empty = { pinUntil: null, registerUntil: null };
const active = () => ({ pinUntil: new Date(Date.now() + 3_600_000).toISOString(), registerUntil: new Date(Date.now() + 3_600_000).toISOString() });
const record = () => ({ id: 'coverage-a', csrId: 'csr-a', startsAt: new Date(Date.now() - 60_000).toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(), canResetPin: true, canRegister: true, revokedAt: null, contactPhone: null });

test('OPM initial loading and successful empty are distinct', async (t) => {
  const app = setup(t);
  assert.equal(app.render().status, 'loading');
  assert.equal(app.render().data, undefined);
  const state = await app.resolve(0, []);
  assert.equal(state.status, 'success'); assert.deepEqual(state.data, []);
});
test('OPM successful records are preserved', async (t) => {
  const app = setup(t); const rows = [record()];
  assert.deepEqual((await app.resolve(0, rows)).data, rows);
});
test('initial failure is not empty, and Retry recovers', async (t) => {
  const app = setup(t);
  const failed = await app.reject(0);
  assert.equal(failed.status, 'error'); assert.equal(failed.data, undefined);
  void failed.refresh();
  assert.equal(app.render().status, 'loading');
  assert.equal((await app.resolve(1, [])).status, 'success');
});
test('failed refresh retains records only as unverified data', async (t) => {
  const app = setup(t); const rows = [record()];
  await app.resolve(0, rows);
  assert.equal(app.poll().status, 'refreshing');
  const failed = await app.reject(1);
  assert.equal(failed.status, 'error'); assert.deepEqual(failed.data, rows);
});
test('older success cannot overwrite a newer result or restore revoked permissions', async (t) => {
  const app = setup(t, 'csr');
  app.focus();
  assert.equal((await app.resolve(1, empty)).canRegister, false);
  const state = await app.resolve(0, active());
  assert.equal(state.canRegister, false); assert.equal(state.canResetPin, false);
});
test('obsolete failures do not replace a newer successful response', async (t) => {
  const app = setup(t); app.focus();
  await app.resolve(1, []);
  assert.equal((await app.reject(0)).status, 'success');
});
test('an older permission result cannot clear a newer verification failure', async (t) => {
  const app = setup(t, 'csr'); app.focus();
  await app.reject(1);
  const state = await app.resolve(0, active());
  assert.equal(state.status, 'error'); assert.equal(state.canRegister, false); assert.equal(state.canResetPin, false);
});
test('an unverified coverage list cannot start a grant or revoke', async (t) => {
  const app = setup(t); const state = await app.reject(0);
  let invoked = false;
  await assert.rejects(state.runUpdate(async () => { invoked = true; }), /coverage_not_verified/);
  assert.equal(invoked, false);
});
test('CSR successful access pauses during refresh and remains disabled on failure', async (t) => {
  const app = setup(t, 'csr'); const known = active();
  const verified = await app.resolve(0, known);
  assert.ok(verified.canResetPin && verified.canRegister);
  const refreshing = app.poll();
  assert.equal(refreshing.status, 'refreshing'); assert.equal(refreshing.canRegister, false);
  const failed = await app.reject(1);
  assert.equal(failed.status, 'error'); assert.equal(failed.canResetPin, false);
  assert.equal(failed.pinUntil, known.pinUntil); // display evidence only, never permission
  failed.retry();
  const revoked = await app.resolve(2, empty);
  assert.equal(revoked.status, 'success'); assert.equal(revoked.canRegister, false);
});
test('CSR first failure grants nothing and Retry restores only verified scopes', async (t) => {
  const app = setup(t, 'csr'); const failed = await app.reject(0);
  assert.equal(failed.status, 'error'); assert.equal(failed.canRegister, false);
  failed.retry();
  const state = await app.resolve(1, { ...active(), registerUntil: null });
  assert.equal(state.canResetPin, true); assert.equal(state.canRegister, false);
});
test('account switching hides prior data immediately and ignores the prior account request', async (t) => {
  const app = setup(t, 'csr'); await app.resolve(0, active()); app.focus();
  const changed = app.setOwner('account-b');
  assert.equal(changed.canRegister, false); assert.equal(changed.pinUntil, null);
  await app.resolve(2, empty);
  assert.equal((await app.resolve(1, active())).canRegister, false);
});
test('logout and unmount invalidate outstanding reads and remove polling/listeners', async (t) => {
  const app = setup(t, 'csr');
  assert.equal(app.setEnabled(false).status, 'idle');
  assert.equal(app.timers(), 0); assert.equal(app.listeners(), 0);
  await app.resolve(0, active());
  assert.equal(app.render().canRegister, false);
  app.setEnabled(true);
  app.unmount(); const before = app.updates();
  app.requests[1].resolve(active()); await flush();
  assert.equal(app.updates(), before); assert.equal(app.timers(), 0); assert.equal(app.listeners(), 0);
});
test('grant/revoke synchronization pauses polling and revalidates before exposing new records', async (t) => {
  const app = setup(t); await app.resolve(0, [record()]);
  const mutation = deferred();
  const update = app.render().runUpdate(() => mutation.promise);
  app.poll(); app.focus();
  assert.equal(app.requests.length, 1);
  mutation.resolve(); await flush();
  assert.equal(app.requests.length, 2);
  await app.resolve(1, []);
  assert.equal(await update, true); assert.deepEqual(app.render().data, []);
});
test('a completed mutation cannot update a closed or replaced session', async (t) => {
  const app = setup(t); await app.resolve(0, []);
  const mutation = deferred(); const update = app.render().runUpdate(() => mutation.promise);
  app.setOwner('account-b'); mutation.resolve(); await flush();
  assert.equal(await update, false);
  assert.equal(app.render().data, undefined);
});
test('Workspace shows error with Retry instead of a false no-coverage message', async (t) => {
  const app = setup(t, 'ui'); await app.reject(0);
  assert.match(app.content(), /Could not verify leave coverage/);
  assert.doesNotMatch(app.content(), /No leave coverage is set|No past coverage/);
  app.click('Retry'); await app.resolve(1, []);
  assert.match(app.content(), /No leave coverage is set/);
  assert.doesNotMatch(app.content(), /Could not verify/);
});
test('Workspace retains records with not-verified feedback on a failed refresh', async (t) => {
  const app = setup(t, 'ui'); await app.resolve(0, [record()]);
  app.focus(); await app.reject(1);
  assert.match(app.content(), /Previously loaded records may be out of date/);
  assert.match(app.content(), /Not verified/);
  assert.doesNotMatch(app.content(), /No leave coverage is set/);
});

test('CSR page distinguishes verification failure from confirmed no access', async (t) => {
  const app = setup(t, 'accounts'); await app.reject(0);
  assert.match(app.content(), /Could not verify temporary fleet access/);
  assert.doesNotMatch(app.content(), /No temporary fleet access is currently active/);
  app.click('Retry'); await app.resolve(1, empty);
  assert.match(app.content(), /No temporary fleet access is currently active/);
});

for (const [tab, button, modal] of [['Drivers', 'Register Driver', 'driver-modal'], ['Trucks', 'Register Truck', 'truck-modal']]) {
  test(`an open ${tab} form remains open and blocked when access is unverified or ends`, async (t) => {
    const app = setup(t, 'accounts'); await app.resolve(0, active());
    if (tab === 'Trucks') app.click('Trucks');
    app.click(button);
    assert.equal(app.find(modal).props.submissionBlockedReason, undefined);
    app.focus();
    assert.match(app.find(modal).props.submissionBlockedReason, /Checking temporary access/);
    await app.reject(1);
    assert.match(app.find(modal).props.submissionBlockedReason, /could not be verified/);
    assert.equal(typeof app.find(modal).props.onRetryVerification, 'function');
    app.find(modal).props.onRetryVerification();
    await app.resolve(2, active());
    assert.equal(app.find(modal).props.submissionBlockedReason, undefined);
    app.focus(); await app.resolve(3, empty);
    assert.equal(app.find(modal).props.temporaryAccessEnded, true);
    assert.equal(app.find(modal).props.temporaryAccess, true);
  });
}
