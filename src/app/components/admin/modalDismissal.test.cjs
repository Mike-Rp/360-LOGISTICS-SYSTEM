const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const panels = [
  'WorkspaceSettingsPanel.tsx', 'RegisterModals.tsx', 'SettingsPanel.tsx',
  'HelpPanel.tsx', 'UnavailabilityDialog.tsx', 'DriversManagement.tsx',
  'Reports.tsx', 'TeamMemberPhotoPreview.tsx', 'ConfirmPasswordDialog.tsx',
];

function jsxNodes(source) {
  const file = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { file, nodes };
}

function prop(node, name) {
  return node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === name);
}

for (const panel of panels) {
  test(`${panel} has a non-dismissing blocking backdrop and an explicit close control`, () => {
    const source = readFileSync(join(__dirname, panel), 'utf8');
    const { file, nodes } = jsxNodes(source);
    const backdrops = nodes.filter((node) => {
      const classes = prop(node, 'className');
      return classes && /bg-black\//.test(classes.getText(file)) && /inset-0/.test(classes.getText(file));
    });
    assert.ok(backdrops.length > 0, `${panel}: no backdrop found`);
    for (const backdrop of backdrops) {
      assert.equal(prop(backdrop, 'onClick'), undefined, `${panel}: backdrop still handles clicks`);
      assert.equal(prop(backdrop, 'onPointerDown'), undefined, `${panel}: backdrop still handles pointer down`);
    }
    assert.match(source, /useModalFocus\(/, `${panel}: missing focus containment`);
    assert.match(source, /useModalBodyLock\(/, `${panel}: missing scroll lock`);
    if (panel === 'ConfirmPasswordDialog.tsx') {
      assert.match(source, /type="button" disabled=\{busy\} onClick=\{onCancel\}/);
      assert.match(source, />\s*Cancel\s*</);
    } else {
      assert.match(source, /aria-label=[{\"\`][^\n]*Close|aria-label="Close/, `${panel}: missing accessible close control`);
    }
  });
}

test('ordinary panels do not wire Escape to their close flow', () => {
  for (const panel of panels.filter((name) => name !== 'ConfirmPasswordDialog.tsx')) {
    const source = readFileSync(join(__dirname, panel), 'utf8');
    assert.doesNotMatch(source, /useModalFocus\([^\n]*,\s*(?:onClose|requestClose)\)/, panel);
  }
});

test('nested staff dialogs keep body scrolling locked until the last one closes', () => {
  const source = readFileSync(join(__dirname, 'useModalBodyLock.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cleanups = [];
  const loaded = { exports: {} };
  const previousDocument = global.document;
  global.document = { body: { style: { overflow: 'auto' } } };
  try {
    new Function('require', 'module', 'exports', compiled)(
      () => ({ useEffect: (effect) => cleanups.push(effect()) }), loaded, loaded.exports,
    );
    loaded.exports.useModalBodyLock(true);
    loaded.exports.useModalBodyLock(true);
    assert.equal(global.document.body.style.overflow, 'hidden');
    cleanups[1]();
    assert.equal(global.document.body.style.overflow, 'hidden');
    cleanups[0]();
    assert.equal(global.document.body.style.overflow, 'auto');
  } finally {
    global.document = previousDocument;
  }
});

test('staff document previews opt out of outside dismissal without changing the Driver Portal', () => {
  const viewer = readFileSync(join(__dirname, 'UploadedFilePreviewModal.tsx'), 'utf8');
  const driver = readFileSync(join(__dirname, '../driver/DriverInterface.tsx'), 'utf8');
  assert.match(viewer, /staffModal = false/);
  assert.match(viewer, /onPointerDownOutside=\{staffModal \?/);
  assert.match(viewer, /onEscapeKeyDown=\{staffModal \?/);
  assert.doesNotMatch(driver, /<UploadedFilePreviewModal[^>]*staffModal/);
});
