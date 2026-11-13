const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');

function load(file, imports = {}, append = '') {
  const code = ts.transpileModule(readFileSync(join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code + append)((id) => {
    if (!(id in imports)) throw new Error(`Unexpected test import: ${id}`);
    return imports[id];
  }, mod, mod.exports);
  return mod.exports;
}
const validation = load('teamMemberValidation.ts', { './personName': load('personName.ts') });
const { validateTeamMemberFields, TeamMemberCreationError } = validation;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function setup(t) {
  const slots = [];
  let cursor = 0;
  let focused;
  const calls = [], added = [];
  let resolve, reject, closed = 0;
  const hooks = {
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
      return [slots[id], (next) => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
    },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
  };
  const createTeamMember = (input) => { calls.push(input); return new Promise((yes, no) => { resolve = yes; reject = no; }); };
  // Expose the existing local component only in this compiled test module. Its production API stays unchanged.
  const { AddMemberModal } = load('../components/admin/WorkspaceSettingsPanel.tsx', {
    react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../../lib/db': { createTeamMember }, '../../lib/teamMemberValidation': validation,
    '../../lib/fleetDelegation': {}, './ConfirmPasswordDialog': {}, './Pagination': {},
    './useModalFocus': { useModalFocus() {} }, './useModalBodyLock': { useModalBodyLock() {} }, './DiscardChangesDialog': { default: 'discard-confirmation' },
    '../../lib/adminNavigation': {}, '../../lib/pendingPasswordResetRequests': {},
    '../../lib/philippineMobile': {}, './MobileNumberField': {}, '../../lib/useCoverageLookup': {},
    './ScheduleFields': {}, '../../lib/philippineTime': {},
    './TeamMemberPhotoPreview': { default: 'photo-preview', memberInitials: () => 'TM' },
  }, '\nexports.AddMemberModal = AddMemberModal;');
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
    const tree = AddMemberModal({ onClose() { closed++; }, onAdded: (member) => added.push(member) });
    for (const node of nodes(tree)) {
      if (node.type === 'input' && node.ref) node.ref.current = { focus: () => { focused = node.props.id; } };
    }
    return tree;
  };
  const input = (field) => nodes(render()).find((node) => node.props.id === `team-member-${field}`);
  const form = () => nodes(render()).find((node) => node.type === 'form');
  const submit = () => {
    let prevented = false;
    form().props.onSubmit({ preventDefault: () => { prevented = true; } });
    assert.ok(prevented);
    render();
  };
  const oldConsoleError = console.error;
  console.error = () => {}; // Expected mock failures; no real requests or accounts are involved.
  t.after(() => { console.error = oldConsoleError; });
  render();
  return {
    calls, added, input, form, submit, closed: () => closed,
    type(field, value) { input(field).props.onChange({ target: { value } }); render(); },
    error: (field) => nodes(render()).find((node) => node.props.id === `team-member-${field}-error`),
    content: () => text(render()),
    focused: () => focused,
    nodes: () => nodes(render()),
    async fail(reason) { reject(reason); await flush(); render(); },
    async succeed(name = 'Sofia Petrov') {
      const member = { id: 'test-member', name, email: 'test@example.invalid', role: 'csr', status: 'active', setupToken: 'test-only-token' };
      resolve(member); await flush(); render(); return member;
    },
  };
}

test('validation preserves the 100-character boundary and accepts Ñ/ñ', () => {
  for (const name of ['Peña', 'Ñandú Cruz', 'Niño Peña', 'A'.repeat(100)]) assert.equal(validateTeamMemberFields(name, 'csr@example.invalid').name, undefined);
  assert.match(validateTeamMemberFields('A'.repeat(101), 'csr@example.invalid').name, /100/);
});

test('untouched Name is quiet; invalid characters show immediately without touching Email', (t) => {
  const app = setup(t);
  assert.equal(app.error('name'), undefined);
  for (const name of ['1', '123456', 'John2', 'John@']) {
    app.type('name', name);
    assert.match(app.error('name').props.children, /letters/);
    assert.match(app.input('name').props.className, /border-red-400/);
    assert.equal(app.input('name').props['aria-describedby'], 'team-member-name-error');
    assert.equal(app.error('email'), undefined);
  }
  for (const name of ['John Smith', 'Michael Peña', 'Niño Dela Cruz', "O'Neill-Smith Jr."]) {
    app.type('name', name);
    assert.equal(app.error('name'), undefined);
  }
  assert.equal(app.input('name').props['aria-invalid'], undefined);
  assert.equal(app.calls.length, 0);
});

test('Email rejects malformed structures, preserves trimming, and blocks invalid submission', (t) => {
  const app = setup(t);
  app.type('name', 'Sofia Petrov');
  for (const email of ['johnexample.com', '@example.com', 'john@', 'john@example', 'john @example.com', 'a@@b.com', 'a@b..com']) {
    app.type('email', email); app.submit();
    assert.match(app.error('email').props.children, /valid email/);
    assert.equal(app.calls.length, 0);
  }
  app.type('email', ' john+team@example.com ');
  assert.equal(app.error('email'), undefined);
  app.submit();
  assert.deepEqual(app.calls, [{ name: 'Sofia Petrov', email: 'john+team@example.com', role: 'csr' }]);
});

for (const [name, message] of [['', /required/], ['Sofia@123', /letters/], ['A'.repeat(101), /100/]]) {
  test(`invalid name (${name ? name.length > 100 ? 'over limit' : 'unsupported characters' : 'empty'}) highlights only Name`, (t) => {
    const app = setup(t);
    app.type('name', name); app.type('email', 'csr@example.invalid'); app.submit();
    assert.match(app.error('name').props.children, message);
    assert.match(app.input('name').props.className, /border-red-400 bg-red-50/);
    assert.equal(app.input('email').props['aria-invalid'], undefined);
    assert.equal(app.calls.length, 0);
  });
}

for (const name of ['Ñandú Cruz', 'Niño Peña']) {
  test(`valid Filipino name ${name} preserves trimmed CSR submission and real-response success handling`, async (t) => {
    const app = setup(t);
    app.type('name', ` ${name} `); app.type('email', ' csr@example.invalid '); app.submit();
    assert.deepEqual(app.calls, [{ name, email: 'csr@example.invalid', role: 'csr' }]);
    assert.equal(app.added.length, 0, 'no success before the response');
    const member = await app.succeed(name);
    assert.deepEqual(app.added, [member]);
    assert.match(app.content(), /added!/);
    assert.match(app.content(), /Copy Setup Link/);
    assert.equal(app.form(), undefined);
  });
}

test('invalid email highlights only Email and prevents submission', (t) => {
  const app = setup(t); app.type('name', 'Sofia Petrov'); app.type('email', 'not-an-email'); app.submit();
  assert.equal(app.error('name'), undefined);
  assert.match(app.error('email').props.children, /valid email/);
  assert.match(app.input('email').props.className, /border-red-400 bg-red-50/);
  assert.equal(app.calls.length, 0);
});

test('both invalid fields show distinct errors and Name receives focus first', (t) => {
  const app = setup(t); app.submit();
  assert.match(app.error('name').props.children, /Name is required/);
  assert.match(app.error('email').props.children, /Email is required/);
  assert.equal(app.focused(), 'team-member-name');
  assert.equal(app.calls.length, 0);
});

test('correcting Name clears only its error; correcting Email then clears its own', (t) => {
  const app = setup(t); app.submit();
  app.type('name', 'Sofia#'); assert.ok(app.error('name'));
  app.type('name', 'Peña'); assert.equal(app.error('name'), undefined);
  assert.ok(app.error('email'));
  app.type('email', 'csr@example.invalid'); assert.equal(app.error('email'), undefined);
  assert.equal(app.input('name').props['aria-describedby'], undefined);
  assert.equal(app.input('email').props['aria-invalid'], undefined);
});

test('keyboard form submission associates labels, invalid fields, messages and focus correctly', (t) => {
  const app = setup(t); app.type('name', 'Sofia Petrov'); app.submit();
  assert.equal(app.form().props.noValidate, true);
  assert.equal(app.focused(), 'team-member-email');
  for (const field of ['name', 'email']) {
    assert.ok(app.nodes().some((node) => node.type === 'label' && node.props.htmlFor === app.input(field).props.id));
  }
  assert.equal(app.input('name').props['aria-invalid'], undefined);
  assert.equal(app.input('email').props['aria-invalid'], true);
  assert.equal(app.input('email').props['aria-describedby'], app.error('email').props.id);
  assert.equal(app.error('email').props.role, 'alert');
  assert.match(app.error('email').props.className, /text-sm/);
});

test('rapid repeated submissions issue one request and keep the loading state', async (t) => {
  const app = setup(t); app.type('name', 'Sofia Petrov'); app.type('email', 'csr@example.invalid');
  const form = app.form();
  form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} });
  assert.equal(app.calls.length, 1);
  assert.equal(app.input('name').props.disabled, true);
  assert.equal(app.input('email').props.disabled, true);
  assert.ok(app.nodes().find((node) => node.type === 'button' && node.props.type === 'submit').props.disabled);
  assert.match(app.content(), /Adding…/);
  await app.fail(new Error('Mock network failure'));
  assert.equal(app.input('name').props.disabled, false);
});

for (const [code, field] of [['invalid_name', 'name'], ['name_too_long', 'name'], ['email_exists', 'email'], ['invalid_email', 'email']]) {
  test(`backend ${code} is associated only with ${field} and preserves entered values`, async (t) => {
    const app = setup(t); app.type('name', 'Sofia Petrov'); app.type('email', 'csr@example.invalid'); app.submit();
    await app.fail(new TeamMemberCreationError(code));
    assert.equal(app.input(field).props['aria-invalid'], true);
    assert.equal(app.input(field === 'name' ? 'email' : 'name').props['aria-invalid'], undefined);
    assert.equal(app.input('name').props.value, 'Sofia Petrov');
    assert.equal(app.input('email').props.value, 'csr@example.invalid');
    assert.equal(app.focused(), `team-member-${field}`);
    assert.equal(app.added.length, 0);
  });
}

for (const reason of [new TeamMemberCreationError('not_authorized'), new TeamMemberCreationError('missing_fields'), new Error('Mock server failure')]) {
  test(`general failure (${reason.message}) does not mark either field invalid`, async (t) => {
    const app = setup(t); app.type('name', 'Sofia Petrov'); app.type('email', 'csr@example.invalid'); app.submit();
    await app.fail(reason);
    assert.equal(app.input('name').props['aria-invalid'], undefined);
    assert.equal(app.input('email').props['aria-invalid'], undefined);
    assert.ok(app.nodes().some((node) => node.props.role === 'alert'));
    assert.equal(app.added.length, 0);
    assert.doesNotMatch(app.content(), /added!|Copy Setup Link/);
  });
}

test('the actual createTeamMember service preserves backend field codes and its existing RPC contract', async () => {
  let response;
  const calls = [];
  const db = load('db.ts', {
    './supabaseClient': { supabase: { rpc: async (name, args) => { calls.push({ name, args }); return response; } } },
    '../data/assignmentTypes': { DOCUMENT_TYPES: [] }, '../data/assignmentRoute': {}, './assignmentLocation': {},
    './storageRefs': {}, './driverHistory': {}, './resetPasswordFeedback': {}, './teamMemberValidation': validation,
  });
  const input = { name: 'Niño Peña', email: 'csr@example.invalid', role: 'csr' };
  for (const [code, field] of [['invalid_name', 'name'], ['name_too_long', 'name'], ['email_exists', 'email'], ['invalid_email', 'email'], ['not_authorized', 'general'], ['missing_fields', 'general'], ['unknown_failure', 'general']]) {
    response = { error: { message: code } };
    await assert.rejects(db.createTeamMember(input), (error) => error instanceof TeamMemberCreationError && error.field === field);
  }
  response = { data: { id: 'test-member', name: input.name, email: input.email, role: 'csr', status: 'active', invitedAt: '2030-01-01T00:00:00Z', setupToken: 'test-only-token' }, error: null };
  const member = await db.createTeamMember(input);
  assert.equal(member.name, input.name); assert.equal(member.setupToken, 'test-only-token');
  assert.deepEqual(calls.at(-1), { name: 'create_team_member', args: { p_name: input.name, p_email: input.email, p_role: 'csr' } });
});

test('closing an edited team-member draft requires explicit discard and Keep Editing preserves values', (t) => {
  const app = setup(t);
  app.type('name', 'Niño Peña');
  app.nodes().find(node => node.type === 'button' && node.props.children === 'Cancel').props.onClick();
  const confirmation = () => app.nodes().find(node => node.type === 'discard-confirmation');
  assert.equal(confirmation().props.open, true); assert.equal(app.closed(), 0);
  confirmation().props.onKeepEditing(); assert.equal(confirmation().props.open, false);
  assert.equal(app.input('name').props.value, 'Niño Peña'); assert.equal(app.calls.length, 0);
  app.nodes().find(node => node.type === 'button' && node.props.children === 'Cancel').props.onClick();
  confirmation().props.onDiscard(); assert.equal(app.closed(), 1);
});
