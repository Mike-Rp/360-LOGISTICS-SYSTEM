const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

// Compile in memory: no emitted files, caches, or package-manager commands.
function loadTypeScript(file, resolve = require) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}

function loadWorkflow(requiredTypes) {
  const data = loadTypeScript(join(__dirname, '../data/assignmentTypes.ts'));
  const documentTypes = requiredTypes ?? data.DOCUMENT_TYPES;
  const workflow = loadTypeScript(join(__dirname, 'assignmentWorkflow.ts'), id => {
    assert.equal(id, '../data/assignmentTypes');
    return { ...data, DOCUMENT_TYPES: documentTypes };
  });
  return { ...workflow, documentTypes };
}

const workflow = loadWorkflow();
const assignment = documents => ({ taskStatus: 'Delivered', documents });
const uploads = (types, docStatus = 'approved') => types.map(type => ({ type, uploaded: true, docStatus }));

for (const count of [1, 3]) {
  test(`${count} approved out of six required never shows All approved`, () => {
    const record = assignment(uploads(workflow.documentTypes.slice(0, count)));
    const missing = workflow.documentTypes.length - count;
    assert.equal(workflow.getAssignmentDisplayStatus(record), 'Awaiting Documents');
    assert.equal(workflow.getAssignmentDocumentProgress(record).allApproved, false);
    assert.equal(workflow.getAssignmentDocumentSummary(record).label, `${count} approved · ${missing} awaiting upload`);
    assert.equal(workflow.getAssignmentDocumentSummary(record).tone, 'missing');
  });
}

test('zero uploads and partial pending uploads show missing requirements', () => {
  for (const documents of [[], uploads(workflow.documentTypes.slice(0, 2), 'pending')]) {
    const record = assignment(documents);
    const summary = workflow.getAssignmentDocumentSummary(record);
    assert.equal(workflow.getAssignmentDisplayStatus(record), 'Awaiting Documents');
    assert.equal(summary.label, `${workflow.documentTypes.length - documents.length} awaiting upload`);
    assert.equal(summary.tone, 'missing');
    if (documents.length) assert.match(summary.breakdown, /2 pending review/);
  }
});

test('all required uploads with pending review show Under Review', () => {
  const documents = uploads(workflow.documentTypes);
  for (const document of documents.slice(-3)) document.docStatus = 'pending';
  const record = assignment(documents);
  assert.equal(workflow.getAssignmentDisplayStatus(record), 'Under Review');
  assert.equal(workflow.getAssignmentDocumentSummary(record).label, '3 pending review');
  assert.equal(workflow.getAssignmentDocumentSummary(record).tone, 'pending');
});

test('rejection wins over missing uploads, and re-upload resets review state', () => {
  const documents = uploads(workflow.documentTypes);
  documents[0].docStatus = 'rejected';
  const record = assignment(documents);
  assert.equal(workflow.getAssignmentDisplayStatus(record), 'Needs Correction');
  assert.equal(workflow.getAssignmentDocumentSummary(record).label, '1 rejected');
  assert.equal(workflow.getAssignmentDocumentSummary(assignment(documents.slice(0, 1))).label, '1 rejected');
  documents[0].docStatus = 'pending';
  assert.equal(workflow.getAssignmentDisplayStatus(record), 'Under Review');
  assert.equal(workflow.getAssignmentDocumentSummary(record).label, '1 pending review');
});

test('only all required types approved shows All approved and Completed', () => {
  const record = assignment(uploads(workflow.documentTypes));
  assert.equal(workflow.getAssignmentDisplayStatus(record), 'Completed');
  assert.equal(workflow.getAssignmentDocumentSummary(record).label, 'All approved');
  assert.equal(workflow.getAssignmentDocumentSummary(record).tone, 'approved');
  assert.equal(workflow.getAssignmentDocumentSummary(record).breakdown,
    `${workflow.documentTypes.length} docs · ${workflow.documentTypes.length} approved`);
});

test('duplicates, unrelated types, and unuploaded approved placeholders cannot replace missing types', () => {
  const documents = uploads(workflow.documentTypes.slice(0, -1));
  documents.push({ ...documents[0] }, { type: 'Unrelated test file', uploaded: true, docStatus: 'approved' });
  documents.push({ type: workflow.documentTypes.at(-1), uploaded: false, docStatus: 'approved' });
  const record = assignment(documents);
  assert.equal(workflow.getAssignmentDisplayStatus(record), 'Awaiting Documents');
  assert.equal(workflow.getAssignmentDocumentProgress(record).missing, 1);
  assert.notEqual(workflow.getAssignmentDocumentSummary(record).label, 'All approved');
});

test('duplicate required uploads with unresolved review cannot show All approved', () => {
  for (const docStatus of ['pending', 'rejected']) {
    const documents = uploads(workflow.documentTypes);
    documents.push({ ...documents[0], docStatus });
    const record = assignment(documents);
    assert.notEqual(workflow.getAssignmentDocumentSummary(record).label, 'All approved');
    assert.equal(workflow.getAssignmentDisplayStatus(record), docStatus === 'rejected' ? 'Needs Correction' : 'Under Review');
  }
});

test('the same helpers use the configured required types and count', () => {
  for (const count of [2, 4]) {
    const configured = loadWorkflow(workflow.documentTypes.slice(0, count));
    const record = assignment(uploads(configured.documentTypes.slice(0, -1)));
    assert.equal(configured.getAssignmentDocumentProgress(record).required, count);
    assert.equal(configured.getAssignmentDocumentSummary(record).label, `${count - 1} approved · 1 awaiting upload`);
    assert.equal(configured.getAssignmentDisplayStatus(record), 'Awaiting Documents');
    record.documents.push(...uploads(configured.documentTypes.slice(-1)));
    assert.equal(configured.getAssignmentDocumentSummary(record).label, 'All approved');
    assert.equal(configured.getAssignmentDisplayStatus(record), 'Completed');
  }
});

test('no configured requirements does not invent approvals or completion', () => {
  const configured = loadWorkflow([]);
  const record = assignment([]);
  assert.equal(configured.getAssignmentDocumentProgress(record).allApproved, false);
  assert.equal(configured.getAssignmentDocumentSummary(record).label, 'No required documents');
  assert.equal(configured.getAssignmentDisplayStatus(record), 'Delivered');
});
