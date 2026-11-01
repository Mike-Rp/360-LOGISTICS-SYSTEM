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
    if (!(id in imports)) throw new Error(`Unexpected import ${id}`);
    return imports[id];
  }, mod, mod.exports);
  return mod.exports;
}
const rules = load('useLoginLockout.ts', { react: {} });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function setup(t, kind = 'admin', language = 'en') {
  const old = { window: global.window, document: global.document, now: Date.now, error: console.error };
  let now = 1000000, cursor = 0, timerId = 0;
  const slots = [], effects = [], timers = new Map(), requests = [], signedIn = [];
  function events() {
    const listeners = new Map();
    return {
      addEventListener(key, fn) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); },
      removeEventListener(key, fn) { listeners.get(key)?.delete(fn); },
      emit(key) { for (const fn of [...listeners.get(key) ?? []]) fn(); },
      count() { return [...listeners.values()].reduce((n, group) => n + group.size, 0); },
    };
  }
  global.window = { ...events(), location: { search: kind === 'admin' ? '?account=staff' : '' },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  global.document = { ...events(), visibilityState: 'visible' };
  Date.now = () => now; console.error = () => {};
  const hooks = {
    useState(initial) {
      const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
      return [slots[id], (next) => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
    },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(fn, deps) {
      const id = cursor++, prev = slots[id];
      if (!prev || deps.some((dep, index) => !Object.is(dep, prev.deps[index]))) {
        effects.push(() => { prev?.cleanup?.(); slots[id] = { deps, cleanup: fn() }; });
      }
    },
  };
  class LoginError extends Error { constructor(code, retryAfterSeconds) { super(code); this.code = code; this.retryAfterSeconds = retryAfterSeconds; } }
  const authenticate = (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject }));
  const i18n = load('../components/driver/driverI18n.tsx', { react: React, 'react/jsx-runtime': require('react/jsx-runtime') });
  const { default: LoginScreen } = load('../components/auth/LoginScreen.tsx', {
    react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'),
    'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png': { default: 'logo.png' },
    'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/db': { LoginError, signInStaff: authenticate, signInDriver: authenticate },
    '../../lib/fleetDelegation': {},
    '../../lib/useDriverHelpContact': { useDriverHelpContact: () => ({ contact: { status: 'loading' }, retry() {} }) },
    '../../lib/useLoginLockout': load('useLoginLockout.ts', { react: hooks }),
    '../admin/useModalFocus': { useModalFocus() {} },
    '../driver/driverI18n': { ...i18n, getLastDriverLanguage: () => language },
  });
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    if (React.isValidElement(node)) return text(node.props.children);
    return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  }
  const render = () => {
    cursor = 0;
    const tree = LoginScreen({ sessionNotice: null, onDismissSessionNotice() {}, onAdminLogin: (value) => signedIn.push(value), onDriverLogin: (value) => signedIn.push(value) });
    while (effects.length) effects.shift()();
    return tree;
  };
  const all = () => nodes(render());
  const field = (name) => all().find((node) => node.type === 'input' && (
    name === 'account' ? node.props.type === (kind === 'admin' ? 'email' : 'tel') :
    kind === 'admin' ? node.props.placeholder === 'Enter password' : node.props['aria-label'] === `PIN digit ${name + 1}`));
  const type = (name, value) => { field(name).props.onChange({ target: { value } }); render(); };
  const button = () => all().find((node) => node.type === 'button' && node.props.onClick?.name === (kind === 'admin' ? 'handleAdminLogin' : 'handleDriverLogin'));
  const cleanup = () => { for (const slot of slots) slot?.cleanup?.(); };
  t.after(() => { cleanup(); global.window = old.window; global.document = old.document; Date.now = old.now; console.error = old.error; });
  render();
  return {
    requests, signedIn, type, button, field, render, cleanup,
    content: () => text(render()),
    fill() {
      type('account', kind === 'admin' ? 'csr@example.invalid' : '9171234567');
      if (kind === 'admin') type('password', 'test-only-password');
      else for (let i = 0; i < 4; i++) type(i, String(i + 1));
    },
    submit() { const result = button().props.onClick(); render(); return result; },
    async fail(code, seconds) { requests.at(-1).reject(new LoginError(code, seconds)); await flush(); render(); },
    async success() { requests.at(-1).resolve({ id: 'mock', name: 'Mock' }); await flush(); render(); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn(); render();
      }
      now = end; render();
    },
    lifecycle() { window.emit('focus'); document.emit('visibilitychange'); render(); },
    resources: () => timers.size + window.count() + document.count(),
  };
}

test('retry validation never manufactures timing, including malformed and expired values', () => {
  for (const value of [undefined, null, '300', NaN, Infinity, -5, 0, 301, 1e100]) {
    assert.equal(rules.loginRetrySeconds(value), undefined);
    assert.deepEqual(rules.lockoutFeedback(rules.confirmedLockout(value, 0), 0), { blocked: false, minutes: null });
  }
  assert.deepEqual(rules.lockoutFeedback(rules.confirmedLockout(300, 0), 0), { blocked: true, minutes: 5 });
  assert.equal(rules.lockoutFeedback(rules.confirmedLockout(120, 0), 120000), null);
  assert.equal(rules.lockoutFeedback(rules.confirmedLockout(1, 0), 1001), null);
  // A slow response cannot restart or extend its authoritative remaining duration.
  assert.equal(rules.lockoutFeedback(rules.confirmedLockout(10, 0), 11000), null);
});

for (const kind of ['admin', 'driver']) {
  test(`${kind}: ordinary credentials errors clear on editing and keep generic wording`, async (t) => {
    const app = setup(t, kind); app.fill(); app.submit(); await app.fail('invalid_credentials');
    assert.match(app.content(), kind === 'admin' ? /Incorrect email or password/ : /incorrect|Invalid/i);
    app.type(kind === 'admin' ? 'password' : 0, '9');
    assert.doesNotMatch(app.content(), /Incorrect email or password|Incorrect mobile|Invalid mobile/i);
    assert.equal(app.button().props.disabled, false);
  });
  test(`${kind}: verified lock survives credential editing, expires, and permits backend retry`, async (t) => {
    const app = setup(t, kind); app.fill(); app.submit(); await app.fail('locked', 300);
    assert.match(app.content(), /try again in 5 minutes/);
    assert.equal(app.button().props.disabled, true);
    assert.equal(app.button().props['aria-describedby'], `${kind}-lockout`);
    app.type(kind === 'admin' ? 'password' : 0, '9');
    assert.match(app.content(), /try again in 5 minutes/);
    app.submit(); assert.equal(app.requests.length, 1);
    app.advance(60000); assert.match(app.content(), /try again in 4 minutes/);
    app.advance(180000); assert.match(app.content(), /try again in 1 minute\./);
    app.advance(60000); assert.equal(app.button().props.disabled, false);
    assert.doesNotMatch(app.content(), /Too many login attempts/);
    app.submit(); assert.equal(app.requests.length, 2); await app.success();
    assert.equal(app.signedIn.length, 1);
  });
  test(`${kind}: switching accounts never transfers a lock; switching back preserves it`, async (t) => {
    const app = setup(t, kind); app.fill(); app.submit(); await app.fail('locked', 120);
    app.type('account', kind === 'admin' ? 'other@example.invalid' : '9181234567');
    assert.equal(app.button().props.disabled, false); assert.doesNotMatch(app.content(), /Too many login attempts/);
    app.type('account', kind === 'admin' ? ' CSR@EXAMPLE.INVALID ' : '9171234567');
    assert.equal(app.button().props.disabled, true);
  });
  test(`${kind}: missing timing preserves the notice through edits, allows retry, and trusts backend rejection`, async (t) => {
    const app = setup(t, kind); app.fill(); app.submit(); await app.fail('locked');
    assert.match(app.content(), /Please try again later/); assert.equal(app.button().props.disabled, false);
    app.type(kind === 'admin' ? 'password' : 0, '9'); assert.match(app.content(), /Please try again later/);
    app.submit(); await app.fail('network'); assert.match(app.content(), /Please try again later/);
    app.submit(); await app.fail('locked', 30); assert.equal(app.button().props.disabled, true);
  });
  test(`${kind}: repeated clicks and Enter do not duplicate in-flight requests`, async (t) => {
    const app = setup(t, kind); app.fill(); const handler = app.button().props.onClick;
    handler(); handler(); app.field('account').props.onKeyDown({ key: 'Enter' });
    assert.equal(app.requests.length, 1); assert.equal(app.field('account').props.disabled, true);
    await app.fail('invalid_credentials'); assert.equal(app.field('account').props.disabled, false);
  });
  test(`${kind}: a fresh mount waits for backend confirmation instead of inventing a lock`, async (t) => {
    const app = setup(t, kind); app.fill(); assert.equal(app.button().props.disabled, false);
    assert.doesNotMatch(app.content(), /Too many login attempts/);
    app.submit(); await app.fail('locked', 80); assert.equal(app.button().props.disabled, true);
  });
  test(`${kind}: focus and visibility restoration respect expiry; listeners and timers clean up`, async (t) => {
    const app = setup(t, kind); app.fill(); app.submit(); await app.fail('locked', 1);
    assert.ok(app.resources() > 0); app.advance(1000); app.lifecycle();
    assert.equal(app.button().props.disabled, false); app.cleanup(); assert.equal(app.resources(), 0);
  });
  for (const value of ['300', 0, -1, NaN, Infinity, 900]) {
    test(`${kind}: malformed retry ${value} gives generic feedback without a disabled timer`, async (t) => {
      const app = setup(t, kind); app.fill(); app.submit(); await app.fail('locked', value);
      assert.match(app.content(), /Please try again later/); assert.equal(app.button().props.disabled, false);
    });
  }
  test(`${kind}: Filipino lockout feedback supports known and unknown retry timing`, async (t) => {
    const app = setup(t, kind, 'fil'); app.fill(); app.submit(); await app.fail('locked', 120);
    assert.match(app.content(), /2 minuto/); app.advance(120000); app.submit(); await app.fail('locked');
    assert.match(app.content(), /Pakisubukang muli mamaya/);
  });
}

test('actual login data layer maps only authoritative valid retry seconds and preserves generic credential errors', async () => {
  let body;
  const db = load('db.ts', {
    './supabaseClient': { supabase: { functions: { invoke: async () => ({ error: { context: new Response(JSON.stringify(body)) } }) } } },
    '../data/assignmentTypes': { DOCUMENT_TYPES: [] }, '../data/assignmentRoute': {}, './assignmentLocation': {},
    './storageRefs': {}, './driverHistory': {}, './resetPasswordFeedback': {}, './teamMemberValidation': {},
  });
  for (const seconds of [300, 55, undefined, null, '300', 0, -1, 301]) {
    body = { error: 'locked', retryAfterSeconds: seconds };
    await assert.rejects(db.signInStaff('csr@example.invalid', 'mock-only'), (error) => error instanceof db.LoginError && error.code === 'locked' && error.retryAfterSeconds === rules.loginRetrySeconds(seconds));
  }
  body = { error: 'invalid_credentials' };
  await assert.rejects(db.signInStaff('csr@example.invalid', 'mock-only'), (error) => error.code === 'invalid_credentials' && error.retryAfterSeconds === undefined);
});
