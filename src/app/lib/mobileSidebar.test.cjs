const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/admin/Sidebar.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(''); return React.isValidElement(node) ? text(node.props.children) : typeof node === 'string' ? node : ''; }
function setup() {
  const slots = [], effects = [], focusCalls = [], attributes = new Set(), nav = [], requests = [];
  let cursor = 0, open = false;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useLayoutEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old[j]))) effects.push(() => { slots[i] = deps; fn(); }); },
  };
  const mock = { exports: {} };
  const imports = { react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'),
    'figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png': { default: 'logo.png' },
    'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/adminNavigation': { adminHref: page => `/${page.toLowerCase()}`, followAdminLink: (event, fn) => { event.preventDefault(); fn(); } },
    './useModalFocus': { useModalFocus: (enabled, ref) => focusCalls.push({ enabled, ref }) },
  };
  new Function('require', 'module', 'exports', source)(name => imports[name], mock, mock.exports);
  const oldStorage = global.localStorage;
  global.localStorage = { getItem: () => null, setItem() {} };
  const drawer = { setAttribute: key => attributes.add(key), removeAttribute: key => attributes.delete(key) };
  const render = () => {
    cursor = 0;
    const tree = mock.exports.default({ activeNav: 'Dashboard', setActiveNav: value => nav.push(value), mobileOpen: open, setMobileOpen: value => { requests.push(value); open = value; } });
    const aside = nodes(tree).find(node => node.type === 'aside' && node.props.role === 'dialog');
    aside.ref.current = drawer;
    while (effects.length) effects.shift()();
    return tree;
  };
  return { render, attrs: attributes, focusCalls, requests, nav,
    setOpen(value) { open = value; return render(); },
    cleanup() { global.localStorage = oldStorage; },
  };
}

test('drawer and overlay stay mounted and synchronize opening, closing, inert state, and reduced motion', t => {
  const app = setup(); t.after(app.cleanup);
  const get = tree => ({ drawer: nodes(tree).find(node => node.type === 'aside' && node.props.role === 'dialog'), overlay: nodes(tree).find(node => node.type === 'div' && node.props['aria-hidden'] === 'true') });
  let state = get(app.render());
  assert.equal(state.drawer.props['aria-hidden'], true); assert.ok(app.attrs.has('inert'));
  assert.match(state.drawer.props.className, /-translate-x-full.*duration-200/);
  assert.match(state.overlay.props.className, /invisible opacity-0 duration-200/);
  state = get(app.setOpen(true));
  assert.equal(state.drawer.props['aria-modal'], true); assert.equal(state.drawer.props['aria-hidden'], false); assert.equal(app.attrs.has('inert'), false);
  assert.match(state.drawer.props.className, /translate-x-0 duration-\[250ms\]/);
  assert.match(state.overlay.props.className, /visible opacity-100 duration-\[250ms\]/);
  assert.match(state.drawer.props.className, /motion-reduce:transition-none/); assert.match(state.overlay.props.className, /motion-reduce:transition-none/);
  assert.doesNotMatch(state.overlay.props.className, /backdrop-blur/);
  state.overlay.props.onClick(); state = get(app.render());
  assert.ok(app.attrs.has('inert')); assert.equal(state.drawer.props['aria-hidden'], true);
  for (let i = 0; i < 4; i++) { app.setOpen(true); app.setOpen(false); }
  assert.equal(app.focusCalls.at(-1).enabled, false);
});

test('close button and navigation close the menu while preserving the requested destination', t => {
  const app = setup(); t.after(app.cleanup);
  let tree = app.setOpen(true);
  nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === 'Close menu').props.onClick();
  assert.equal(app.requests.at(-1), false);
  tree = app.setOpen(true);
  const aside = nodes(tree).find(node => node.type === 'aside' && node.props.role === 'dialog');
  const content = nodes(aside).find(node => typeof node.type === 'function' && node.type.name === 'NavContent');
  const navigation = content.type(content.props);
  const delivery = nodes(navigation).find(node => node.type === 'a' && text(node).includes('Deliveries'));
  assert.equal(delivery.props.href, '/deliveries');
  delivery.props.onClick({ preventDefault() {} });
  assert.deepEqual(app.nav, ['Deliveries']); assert.equal(app.requests.at(-1), false);
});
