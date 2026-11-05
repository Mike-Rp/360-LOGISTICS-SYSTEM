const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
function load(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => { if (!(name in imports)) throw Error(name); return imports[name]; }, mod, mod.exports);
  return mod.exports;
}
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); return React.isValidElement(node) ? [node, ...nodes(node.props.children), ...nodes(node.props.footer)] : []; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(''); return React.isValidElement(node) ? text(node.props.children) + text(node.props.footer) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup(kind, props = {}) {
  const slots = [], effects = []; let cursor = 0, requests = [], created = [], closed = 0;
  let settings = { temporaryAccess: true, temporaryAccessEnded: false, ...props };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  class AssignmentActionError extends Error { constructor(code) { super(code); this.code = code; } }
  const request = (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject }));
  const module = load('../components/admin/RegisterModals.tsx', {
    react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/db': { normaliseMobile: value => value, registerDriver: request, registerTruck: request, AssignmentActionError },
    '../../lib/philippineMobile': load('philippineMobile.ts'), '../../lib/personName': load('personName.ts'),
    '../../data/truckTypes': load('../data/truckTypes.ts'), '../TruckImage': { default: 'truck-image' },
  });
  const component = kind === 'driver' ? module.RegisterDriverModal : module.RegisterTruckModal;
  const render = () => { cursor = 0; const tree = component({ drivers: [], trucks: [], onServerChange: async fn => fn(), onClose: () => closed++, onCreated: item => created.push(item), ...settings }); while (effects.length) effects.shift()(); return tree; };
  const all = () => nodes(render());
  const input = selector => all().find(node => node.type === 'input' && (node.props.placeholder === selector || node.props.id === selector || node.props['aria-label'] === selector));
  const button = label => all().find(node => node.type === 'button' && text(node).trim() === label);
  return { render, input, button, requests, created, closed: () => closed, AssignmentActionError,
    type(selector, value) { input(selector).props.onChange({ target: { value } }); render(); },
    set(values) { settings = { ...settings, ...values }; render(); render(); },
    content: () => text(render()),
    click(label) { const b = button(label); assert.ok(b, `Missing ${label}`); b.props.onClick(); render(); },
    async reject(code) { requests.at(-1).reject(new AssignmentActionError(code)); await flush(); render(); },
    async succeed() { requests.at(-1).resolve('test-id'); await flush(); render(); },
    chooseTruck() { all().find(node => node.type === 'button' && text(node).includes('Pickup Truck')).props.onClick(); render(); },
  };
}
function fillDriver(app) { app.type('e.g. Juan', 'Juan'); app.type('e.g. dela Cruz', 'Peña'); app.type('Mobile number, ten digits after +63', '9171234567'); app.click('Generate PIN'); }
function fillTruck(app) { app.type('truck-plate-letters', 'ABC'); app.type('truck-plate-numbers', '1234'); app.click('Next'); app.chooseTruck(); app.click('Next'); }

for (const kind of ['driver', 'truck']) {
  const fill = kind === 'driver' ? fillDriver : fillTruck;
  const submit = kind === 'driver' ? 'Register Driver' : 'Register truck';
  test(`${kind}: unverified coverage preserves entries, blocks submission and offers retry`, () => {
    const app = setup(kind, { onRetryVerification() {} }); fill(app);
    app.set({ submissionBlockedReason: 'Checking temporary access. Please wait before submitting.' });
    assert.match(app.content(), /Checking temporary access/); assert.ok(app.button('Retry coverage check'));
    assert.equal(app.button(submit).props.disabled, true);
    app.button(submit).props.onClick(); assert.equal(app.requests.length, 0);
    if (kind === 'driver') assert.equal(app.input('e.g. Juan').props.value, 'Juan'); else assert.match(app.content(), /ABC 1234/);
    app.set({ submissionBlockedReason: undefined }); assert.equal(app.button(submit).props.disabled, false);
  });
  test(`${kind}: expired or revoked coverage keeps draft, permanently blocks the open form, and closes normally`, () => {
    const app = setup(kind); fill(app); app.set({ temporaryAccessEnded: true });
    assert.match(app.content(), /Temporary Access Ended/); if (kind === 'driver') assert.equal(app.input('e.g. Juan').props.value, 'Juan'); else assert.match(app.content(), /ABC 1234/);
    assert.equal(app.button(submit).props.disabled, true); app.button(submit).props.onClick(); assert.equal(app.requests.length, 0);
    if (kind === 'driver') { assert.equal(app.button('Generate PIN').props.disabled, true); assert.doesNotMatch(app.content(), /Share this PIN/); }
    app.set({ temporaryAccessEnded: false }); assert.equal(app.button(submit).props.disabled, true);
    if (kind === 'driver') { app.click('Cancel'); assert.equal(app.closed(), 1); }
  });
  test(`${kind}: backend authorization rejection does not show success or retry automatically`, async () => {
    const app = setup(kind); fill(app); const handler = app.button(submit).props.onClick; handler(); handler(); assert.equal(app.requests.length, 1);
    await app.reject('not_authorized'); assert.match(app.content(), /Temporary Access Ended/);
    assert.equal(app.created.length, 0); assert.equal(app.button(submit).props.disabled, true);
  });
  test(`${kind}: ordinary backend failure is not called permission expiry`, async () => {
    const app = setup(kind); fill(app); app.click(submit); await app.reject('network');
    assert.doesNotMatch(app.content(), /Temporary Access Ended/); assert.match(app.content(), /connection|server/i); assert.equal(app.created.length, 0);
  });
  test(`${kind}: permanent OPM access retains normal successful registration`, async () => {
    const app = setup(kind, { temporaryAccess: false }); fill(app); app.click(submit); await app.succeed(); assert.equal(app.created.length, 1);
  });
}
