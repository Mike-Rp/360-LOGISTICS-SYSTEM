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
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in imports)) throw Error(`Unexpected import: ${name}`);
    return imports[name];
  }, mod, mod.exports);
  return mod.exports;
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  return React.isValidElement(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

function setup(t, role = 'opm') {
  const oldDocument = global.document;
  const oldStorage = global.localStorage;
  const oldTimeout = global.setTimeout;
  global.document = { body: { style: { overflow: '' } }, addEventListener() {}, removeEventListener() {} };
  global.localStorage = { setItem() {} };
  global.setTimeout = () => 1;
  t.after(() => { global.document = oldDocument; global.localStorage = oldStorage; global.setTimeout = oldTimeout; });

  const slots = [], effects = []; let cursor = 0;
  let profile = { id: 'opm-1', name: 'Maria Peña', phone: '09123456789', email: 'maria@example.test', role };
  const calls = [], updates = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const Mobile = load('../components/admin/MobileNumberField.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), '../../lib/philippineMobile': load('philippineMobile.ts'),
  }).default;
  const Settings = load('../components/admin/SettingsPanel.tsx', {
    react: hooks, 'react-dom': { createPortal: node => node }, 'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/db': {
      setOwnPhone: phone => new Promise((resolve, reject) => calls.push({ phone, resolve, reject })),
      updateOwnDisplayName: name => { updates.push(name); return Promise.resolve({ name }); },
    },
    '../../lib/philippineMobile': load('philippineMobile.ts'), './MobileNumberField': { default: Mobile },
    './ConfirmPasswordDialog': { default: 'confirm-dialog' }, './useModalFocus': { useModalFocus() {} }, './useModalBodyLock': { useModalBodyLock() {} },
    './useFloatingPanelPresence': { useFloatingPanelPresence: () => ({ mounted: true, visible: true }) },
    '../../lib/notificationSound': { playNotificationSound() {} },
    '../../lib/personName': load('personName.ts'), './AccountRoleBadge': { default: 'role-badge' },
    '../ui/dropdown-menu': { DropdownMenu: 'dropdown', DropdownMenuContent: 'dropdown-content', DropdownMenuItem: 'dropdown-item', DropdownMenuTrigger: 'dropdown-trigger' },
    '../../lib/passwordFormError': { validatePasswordForm() {}, passwordUpdateError() {} },
  }).default;
  const render = () => {
    let tree;
    for (let i = 0; i < 2; i++) {
      cursor = 0;
      tree = Settings({ open: true, onClose() {}, profile, avatarUrl: '', onProfileUpdated(update) { profile = { ...profile, ...update }; }, notifEnabled: true, setNotifEnabled() {}, soundEnabled: true, setSoundEnabled() {} });
      while (effects.length) effects.shift()();
    }
    return tree;
  };
  const all = () => nodes(render());
  const button = label => all().find(node => node.type === 'button' && text(node).trim() === label);
  const mobile = () => all().find(node => node.type === Mobile);
  const phoneInput = () => nodes(Mobile(mobile().props)).find(node => node.type === 'input');
  const openContact = () => { all().find(node => node.type === 'button' && text(node).includes('The number drivers call')).props.onClick(); render(); };
  const openName = () => { all().find(node => node.type === 'dropdown-item' && text(node).includes('Edit Display Name')).props.onSelect(); render(); };
  return { render, all, button, phoneInput, mobile, mobileText: () => text(nodes(Mobile(mobile().props))), openContact, openName, calls, updates,
    setProfile(next) { profile = next; render(); },
    typePhone(value) { phoneInput().props.onChange({ target: { value } }); render(); },
    pastePhone(value) { phoneInput().props.onPaste({ preventDefault() {}, clipboardData: { getData: () => value } }); render(); },
    nameInput() { return all().find(node => node.props.id === 'settings-display-name'); },
    typeName(value) { this.nameInput().props.onChange({ target: { value } }); render(); },
    confirm() { return all().find(node => node.type === 'confirm-dialog'); },
  };
}

test('OPM contact prefix validates on the first digit, while incomplete valid prefixes wait until blur', t => {
  const app = setup(t); app.openContact();
  for (const value of ['1', '4', '8', '0']) {
    app.typePhone(value);
    assert.equal(app.phoneInput().props['aria-invalid'], true);
    assert.match(app.mobileText(), /Mobile number must start with 9 \(e\.g\. 9XX XXX XXXX\)\./);
    assert.equal(app.button('Save Number').props.disabled, true);
    app.button('Save Number').props.onClick(); app.render();
    assert.equal(app.confirm(), undefined);
    assert.equal(app.calls.length, 0);
  }
  app.typePhone('9'); assert.equal(app.phoneInput().props['aria-invalid'], undefined);
  app.typePhone('91234'); assert.equal(app.button('Save Number').props.disabled, true);
  app.typePhone('9876543210'); assert.equal(app.phoneInput().props['aria-invalid'], undefined);
  assert.equal(app.button('Save Number').props.disabled, false);
  app.typePhone(''); assert.equal(app.button('Save Number').props.disabled, true);
  app.pastePhone('0123456789'); assert.equal(app.phoneInput().props['aria-invalid'], true);
  app.pastePhone('9123456789'); assert.equal(app.phoneInput().props['aria-invalid'], undefined);
});

test('Revert restores the last saved number locally and clears the draft error', t => {
  const app = setup(t); app.openContact();
  assert.equal(app.button('Save Number').props.disabled, true);
  assert.equal(app.button('Revert'), undefined);
  app.typePhone('1231313131');
  assert.equal(app.phoneInput().props.value, '1231313131');
  assert.ok(app.button('Revert'));
  app.button('Revert').props.onClick(); app.render();
  assert.equal(app.phoneInput().props.value, '9123456789');
  assert.equal(app.phoneInput().props['aria-invalid'], undefined);
  assert.equal(app.button('Save Number').props.disabled, true);
  assert.equal(app.button('Revert'), undefined);
  assert.equal(app.calls.length, 0);
});

test('successful save advances the Revert reference; failed save retains the draft', async t => {
  const app = setup(t); app.openContact();
  app.typePhone('9876543210'); app.button('Save Number').props.onClick(); app.render();
  assert.ok(app.confirm());
  const pending = app.confirm().props.onConfirm();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].phone, '09876543210');
  assert.equal(app.button('Revert').props.disabled, true);
  app.calls[0].resolve({ phone: '09876543210' }); await pending; app.render();
  assert.equal(app.phoneInput().props.value, '9876543210');
  assert.equal(app.button('Revert'), undefined);
  app.typePhone('8123456789'); app.button('Revert').props.onClick(); app.render();
  assert.equal(app.phoneInput().props.value, '9876543210');
  app.typePhone('9111111111'); app.button('Save Number').props.onClick(); app.render();
  const failed = app.confirm().props.onConfirm();
  app.calls[1].reject(new Error('network')); await assert.rejects(failed); app.render();
  assert.equal(app.phoneInput().props.value, '9111111111');
  app.confirm().props.onCancel(); app.render();
  app.button('Revert').props.onClick(); app.render();
  assert.equal(app.phoneInput().props.value, '9876543210');
});

test('account switch restores the new profile value rather than another account draft', t => {
  const app = setup(t); app.openContact(); app.typePhone('8123456789');
  app.setProfile({ id: 'opm-2', name: 'Ana Niño', phone: '09999999999', email: 'ana@example.test', role: 'opm' });
  app.openContact();
  assert.equal(app.phoneInput().props.value, '9999999999');
  assert.equal(app.phoneInput().props['aria-invalid'], undefined);
  assert.equal(app.button('Revert'), undefined);
});

test('OPM display name validates while typing and never sends invalid text', t => {
  const app = setup(t); app.openName();
  for (const value of ['3', '321313', 'Gefran1', 'Gefran@', 'A'.repeat(101)]) {
    app.typeName(value);
    assert.equal(app.nameInput().props['aria-invalid'], true, value);
    app.button('Save Changes').props.onClick();
    assert.equal(app.updates.length, 0);
  }
  for (const value of ['Gefran Pervera', 'Michael Peña', 'Niño', "O'Brien", 'Anne-Marie', 'Ma. Cristina']) {
    app.typeName(value);
    assert.equal(app.nameInput().props['aria-invalid'], false, value);
  }
  assert.equal(app.nameInput().props['aria-describedby'], undefined);
});

test('CSR display name validates on change, blocks invalid saves, and Cancel keeps the saved name', t => {
  const app = setup(t, 'csr'); app.openName();
  assert.equal(app.nameInput().props['aria-invalid'], false);
  for (const value of ['3', '312', 'Mikhail1', 'Mikhail@', 'A'.repeat(101)]) {
    app.typeName(value);
    assert.equal(app.nameInput().props['aria-invalid'], true, value);
    assert.equal(app.nameInput().props['aria-describedby'], 'settings-display-name-error');
    assert.equal(app.button('Save Changes').props.disabled, true);
    app.button('Save Changes').props.onClick();
    assert.equal(app.updates.length, 0);
  }
  for (const value of ['Mikhail Respicio', 'Michael Peña', 'Niño Dela Cruz', "O'Brien-Santos Jr."]) {
    app.typeName(value);
    assert.equal(app.nameInput().props['aria-invalid'], false, value);
    assert.equal(app.button('Save Changes').props.disabled, false, value);
  }
  app.button('Cancel').props.onClick();
  assert.equal(app.nameInput(), undefined);
  app.openName();
  assert.equal(app.nameInput().props.value, 'Maria Peña');
  assert.equal(app.updates.length, 0);
  assert.equal(app.all().some(node => node.type === 'button' && text(node).includes('The number drivers call')), false);
});
