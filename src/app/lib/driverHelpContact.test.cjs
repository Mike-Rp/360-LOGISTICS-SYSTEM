const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');

function load(file, imports) {
  const source = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (!(id in imports)) throw new Error(`Unexpected test import: ${id}`);
    return imports[id];
  }, mod, mod.exports);
  return mod.exports;
}

// A deterministic hook lifecycle and browser clock: render the actual LoginScreen
// element tree and execute its effects, without a DOM, real timers or live RPCs.
function setup(t, language = 'en') {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const events = () => {
    const listeners = new Map();
    return {
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      emit(type) { for (const fn of [...(listeners.get(type) ?? [])]) fn({}); },
      count() { return [...listeners.values()].reduce((n, group) => n + group.size, 0); },
    };
  };
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const schedule = (fn, ms, repeat) => { const id = ++timerId; timers.set(id, { fn, ms, at: now + ms, repeat }); return id; };
  const win = {
    ...events(), location: { search: '' },
    setTimeout: (fn, ms) => schedule(fn, ms, false), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: (id) => timers.delete(id),
  };
  const doc = { ...events(), visibilityState: 'visible' };
  global.window = win;
  global.document = doc;

  const slots = [];
  const effects = [];
  let cursor = 0;
  let updates = 0;
  let mounted = true;
  const hooks = {
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
      return [slots[id], (next) => { updates++; slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
    },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(fn, deps) {
      const id = cursor++;
      const old = slots[id];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        effects.push(() => { old?.cleanup?.(); slots[id] = { deps, cleanup: fn() }; });
      }
    },
  };
  const requests = [];
  const lookup = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  const hook = load('useDriverHelpContact.ts', { react: hooks, './db': { getDriverHelpPhone: lookup } });
  const i18n = load('../components/driver/driverI18n.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  });
  const { default: LoginScreen } = load('../components/auth/LoginScreen.tsx', {
    react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'),
    'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png': { default: 'logo.png' },
    'lucide-react': Object.fromEntries(['Eye', 'EyeOff', 'AlertCircle', 'CheckCircle2', 'Phone', 'Loader2', 'X'].map((name) => [name, 'svg'])),
    '../../lib/db': { LoginError: class extends Error {} },
    '../../lib/fleetDelegation': { formatContactPhone: (phone) => phone.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3') },
    '../../lib/useDriverHelpContact': hook,
    '../../lib/useLoginLockout': load('useLoginLockout.ts', { react: hooks }),
    '../driver/driverI18n': { ...i18n, getLastDriverLanguage: () => language },
  });
  const render = () => {
    assert.ok(mounted);
    cursor = 0;
    const tree = LoginScreen({ sessionNotice: null });
    while (effects.length) effects.shift()();
    return tree;
  };
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!React.isValidElement(node)) return [];
    return [node, ...nodes(node.props.children)];
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    if (React.isValidElement(node)) return text(node.props.children);
    return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  }
  const click = (label) => {
    const button = nodes(render()).find((node) => node.type === 'button' && text(node) === label);
    assert.ok(button, `Missing button: ${label}`);
    button.props.onClick();
    render();
  };
  const advance = (ms) => {
    const end = now + ms;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.repeat) timer.at += timer.ms; else timers.delete(id);
      timer.fn();
    }
    now = end;
    render();
  };
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    for (const slot of slots) slot?.cleanup?.();
  };
  t.after(() => { unmount(); global.window = previousWindow; global.document = previousDocument; });
  render();
  return {
    requests, win, doc, advance, click, unmount,
    open: () => click(i18n.translateDriver(language, 'login.resetPin')),
    close: () => click(i18n.translateDriver(language, 'login.gotIt')),
    retry: () => click(i18n.translateDriver(language, 'login.pinHelpRetry')),
    links: () => nodes(render()).filter((node) => node.type === 'a' && node.props.href.startsWith('tel:')),
    content: () => text(render()),
    updates: () => updates,
    timers: () => timers.size,
    async settle(index, phone) { requests[index].resolve(phone); await flush(); render(); },
    async fail(index) { requests[index].reject(new Error('Test lookup failure')); await flush(); render(); },
  };
}
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
const CSR = '09171112222';
const OPM = '09173334444';
const NEW_OPM = '09175556666';

test('opening starts a lookup with loading feedback; closed login makes no contact requests', async (t) => {
  const app = setup(t);
  assert.equal(app.requests.length, 0);
  app.open();
  assert.equal(app.requests.length, 1);
  assert.match(app.content(), /Checking the contact number/);
  assert.equal(app.links().length, 0);
});

test('successful lookup preserves formatted tap-to-call; successful null is a distinct unavailable state', async (t) => {
  const app = setup(t);
  app.open();
  await app.settle(0, CSR);
  assert.equal(app.links()[0].props.href, `tel:${CSR}`);
  assert.match(app.content(), /0917 111 2222/);
  app.advance(30_000);
  await app.settle(1, null);
  assert.equal(app.links().length, 0);
  assert.match(app.content(), /no contact number available/);
  assert.doesNotMatch(app.content(), /could not check/);
});

for (const change of ['coverage expires', 'coverage is revoked', 'OPM contact changes']) {
  test(`open dialog updates when the backend contact changes: ${change}`, async (t) => {
    const app = setup(t);
    app.open();
    await app.settle(0, change === 'OPM contact changes' ? OPM : CSR);
    app.advance(30_000);
    assert.equal(app.links().length, 0, 'pending refresh does not advertise the old contact');
    const next = change === 'OPM contact changes' ? NEW_OPM : OPM;
    await app.settle(1, next);
    assert.equal(app.links()[0].props.href, `tel:${next}`);
  });
}

test('focus and visibility restoration refresh; hidden polling pauses and overlapping events share a lookup', async (t) => {
  const app = setup(t);
  app.open();
  await app.settle(0, CSR);
  app.doc.visibilityState = 'hidden';
  app.doc.emit('visibilitychange');
  app.advance(30_000);
  assert.equal(app.requests.length, 1);
  app.doc.visibilityState = 'visible';
  app.doc.emit('visibilitychange');
  app.win.emit('focus');
  assert.equal(app.requests.length, 2);
  await app.settle(1, OPM);
  app.win.emit('focus');
  assert.equal(app.requests.length, 3);
});

test('failed refresh removes the old call link and Retry can recover', async (t) => {
  const app = setup(t);
  app.open();
  await app.settle(0, CSR);
  app.advance(30_000);
  await app.fail(1);
  assert.equal(app.links().length, 0);
  assert.match(app.content(), /could not check the current contact/);
  app.retry();
  assert.match(app.content(), /Checking the contact number/);
  await app.settle(2, OPM);
  assert.equal(app.links()[0].props.href, `tel:${OPM}`);
});

test('timed-out responses cannot overwrite a newer successful retry', async (t) => {
  const app = setup(t);
  app.open();
  app.advance(15_000);
  assert.match(app.content(), /could not check/);
  app.retry();
  await app.settle(1, OPM);
  await app.settle(0, CSR);
  assert.equal(app.links()[0].props.href, `tel:${OPM}`);
});

test('closing stops timers/listeners; reopening ignores the previous open request', async (t) => {
  const app = setup(t);
  app.open();
  app.close();
  assert.equal(app.timers(), 0);
  assert.equal(app.win.count(), 0);
  assert.equal(app.doc.count(), 0);
  app.advance(60_000);
  assert.equal(app.requests.length, 1);
  app.open();
  await app.settle(1, OPM);
  await app.settle(0, CSR);
  assert.equal(app.links()[0].props.href, `tel:${OPM}`);
});

test('unmount cleans up and late responses do not update state', async (t) => {
  const app = setup(t);
  app.open();
  app.unmount();
  const before = app.updates();
  app.requests[0].resolve(CSR);
  await flush();
  assert.equal(app.updates(), before);
  assert.equal(app.timers(), 0);
  assert.equal(app.win.count(), 0);
  assert.equal(app.doc.count(), 0);
});

test('Filipino loading, failure and retry feedback uses the existing translation system', async (t) => {
  const app = setup(t, 'fil');
  app.open();
  assert.match(app.content(), /Sinusuri ang numerong tatawagan/);
  await app.fail(0);
  assert.match(app.content(), /Hindi masuri ang kasalukuyang numerong tatawagan/);
  app.retry();
  await app.settle(1, OPM);
  assert.equal(app.links()[0].props.href, `tel:${OPM}`);
});
