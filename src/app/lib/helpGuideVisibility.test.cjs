const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const visibilitySource = fs.readFileSync(path.join(__dirname, 'helpGuideVisibility.ts'), 'utf8');
const compiled = ts.transpileModule(visibilitySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRef = { exports: {} };
new Function('module', 'exports', compiled)(moduleRef, moduleRef.exports);
const { HELP_GUIDE_AUDIENCE, visibleHelpTopics, filterHelpTopics, helpCategories } = moduleRef.exports;

// Read the mounted guide definitions without evaluating React or JSX.
const source = fs.readFileSync(path.join(__dirname, '../components/admin/HelpPanel.tsx'), 'utf8');
const ast = ts.createSourceFile('HelpPanel.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declaration = ast.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
  .find((item) => item.name.getText(ast) === 'TOPICS');
assert.ok(declaration && ts.isArrayLiteralExpression(declaration.initializer));
const property = (object, name) => object.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(ast) === name)?.initializer;
const topics = declaration.initializer.elements.map((item) => ({
  id: property(item, 'id').text,
  category: property(item, 'category').text,
  title: property(item, 'title').text,
  summary: property(item, 'summary').text,
  tags: property(item, 'tags').elements.map((tag) => tag.text),
}));
const order = ['Dispatch', 'Deliveries', 'Documents', 'Reports', 'Drivers & Trucks', 'Settings', 'Admin'];
const commonIds = ['add-driver', 'add-truck', 'assign-task', 'review-documents'];

test('every mounted guide has an explicit role policy', () => {
  assert.equal(topics.length, 12);
  assert.deepEqual(Object.keys(HELP_GUIDE_AUDIENCE).sort(), topics.map((topic) => topic.id).sort());
});

test('OPM sees fleet registration but not CSR dispatch or document decisions', () => {
  const ids = visibleHelpTopics(topics, 'opm').map((topic) => topic.id);
  assert.ok(ids.includes('add-driver') && ids.includes('add-truck'));
  assert.ok(!ids.includes('assign-task') && !ids.includes('review-documents'));
  assert.ok(ids.includes('monitor') && ids.includes('deliveries') && ids.includes('documents') && ids.includes('reports') && ids.includes('settings') && ids.includes('security'));
  assert.deepEqual(ids.filter((id) => commonIds.includes(id)), ['add-driver', 'add-truck']);
});

test('CSR sees operational guides without standard fleet management guides', () => {
  const ids = visibleHelpTopics(topics, 'csr').map((topic) => topic.id);
  assert.ok(ids.includes('assign-task') && ids.includes('review-documents'));
  assert.ok(!ids.includes('add-driver') && !ids.includes('add-truck'));
  assert.ok(ids.includes('monitor') && ids.includes('deliveries') && ids.includes('documents') && ids.includes('reports') && ids.includes('settings') && ids.includes('security'));
  assert.deepEqual(ids.filter((id) => commonIds.includes(id)), ['assign-task', 'review-documents']);
  assert.deepEqual(visibleHelpTopics(topics, 'admin').map((topic) => topic.id), ids);
});

test('search, categories, counts, and details use only role-visible guides', () => {
  const csr = visibleHelpTopics(topics, 'csr');
  const opm = visibleHelpTopics(topics, 'opm');
  assert.equal(filterHelpTopics(csr, 'All', 'register').length, 0);
  assert.deepEqual(filterHelpTopics(opm, 'All', 'register').map((topic) => topic.id), ['add-driver', 'add-truck']);
  assert.deepEqual(filterHelpTopics(csr, 'Dispatch', '').map((topic) => topic.id), ['assign-task', 'monitor', 'review-documents']);
  assert.deepEqual(filterHelpTopics(opm, 'Dispatch', '').map((topic) => topic.id), ['monitor']);
  assert.equal(filterHelpTopics(csr, 'Reports', '').length, 1);
  assert.equal(filterHelpTopics(opm, 'Reports', '').length, 1);
  assert.equal(filterHelpTopics(csr, 'Drivers & Trucks', '').length, 2);
  assert.equal(filterHelpTopics(opm, 'Drivers & Trucks', '').length, 4);
  assert.deepEqual(helpCategories(csr, order), ['All', ...order]);
  assert.deepEqual(helpCategories(opm, order), ['All', ...order]);
  assert.ok(!visibleHelpTopics(topics, 'csr').find((topic) => topic.id === 'add-truck'));
});

test('switching accounts recalculates guides and hides the previous role’s detail', () => {
  const opm = visibleHelpTopics(topics, 'opm');
  const csr = visibleHelpTopics(topics, 'csr');
  assert.ok(opm.find((topic) => topic.id === 'add-driver'));
  assert.equal(csr.find((topic) => topic.id === 'add-driver'), undefined);
  assert.deepEqual(visibleHelpTopics(topics, null), []);
  assert.match(source, /const activeTopic = roleTopics\.find\(/);
});
