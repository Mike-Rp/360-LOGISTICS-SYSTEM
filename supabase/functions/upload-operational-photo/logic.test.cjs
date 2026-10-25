// Unit tests for the upload-operational-photo decision logic.
// Run: node --test supabase/functions/upload-operational-photo/logic.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');

function loadTypeScript(file) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports;
}

const logic = loadTypeScript(join(__dirname, 'logic.ts'));

const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const DATA_URL = `data:image/png;base64,${ONE_PX_PNG_B64}`;
const BYTES = Buffer.from(ONE_PX_PNG_B64, 'base64');
const HASH = createHash('sha256').update(BYTES).digest('hex');

const VALID_BODY = {
  assignmentId: 'ASN12345', category: 'pickup_front', photoDataUrl: DATA_URL,
  takenAt: '2026-10-25T04:00:00.000Z', location: 'Warehouse A', lat: 14.1, lng: 121.1,
  gpsAccuracyM: 12, gpsObservedAt: '2026-10-25T04:00:00.000Z', source: 'camera', captureObservedAt: null,
};

test('sha256Hex matches a plain Node sha256 of the same bytes', async () => {
  assert.equal(await logic.sha256Hex(new Uint8Array(BYTES)), HASH);
});

test('decodeDataUrl decodes a valid base64 image and rejects non-images', () => {
  const decoded = logic.decodeDataUrl(DATA_URL);
  assert.equal(decoded.contentType, 'image/png');
  assert.equal(Buffer.from(decoded.bytes).toString('base64'), ONE_PX_PNG_B64);
  assert.equal(logic.decodeDataUrl('data:text/plain;base64,aGk='), null);
  assert.equal(logic.decodeDataUrl('not a data url'), null);
  assert.equal(logic.decodeDataUrl(42), null);
});

test('validateRequest accepts a well-formed body and rejects an unknown category', () => {
  const ok = logic.validateRequest(VALID_BODY);
  assert.equal(ok.ok, true);
  assert.equal(ok.input.category, 'pickup_front');

  const bad = logic.validateRequest({ ...VALID_BODY, category: 'trunk_photo' });
  assert.deepEqual(bad, { ok: false, error: 'invalid_request' });

  const missingId = logic.validateRequest({ ...VALID_BODY, assignmentId: '' });
  assert.deepEqual(missingId, { ok: false, error: 'invalid_request' });

  const badSource = logic.validateRequest({ ...VALID_BODY, source: 'fax' });
  assert.deepEqual(badSource, { ok: false, error: 'invalid_request' });
});

function fakeDeps({ owns = true, existingHashes = new Set(), failUpload = false } = {}) {
  const state = { uploaded: null, saved: null };
  const deps = {
    async getOwnAssignment(id) { return owns ? { driverId: 'DRIVER-1' } : null; },
    async hashExists(hash) { return existingHashes.has(hash); },
    async uploadFile(path, bytes, contentType) {
      if (failUpload) throw new Error('storage down');
      state.uploaded = { path, length: bytes.length, contentType };
    },
    async saveRow(fields) { state.saved = fields; },
  };
  return { deps, state };
}

test('handleUpload: happy path uploads, saves the row with the server-computed hash, and returns the path', async () => {
  const { deps, state } = fakeDeps();
  const result = await logic.handleUpload(VALID_BODY, deps);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(result.body.url, /^photos\/ASN12345\/pickup_front_\d+\.png$/);
  assert.equal(state.uploaded.path, result.body.url);
  assert.equal(state.saved.fileHash, HASH);
  assert.equal(state.saved.category, 'pickup_front');
});

test('handleUpload: rejects a hash that already exists, across drivers, without uploading or saving', async () => {
  const { deps, state } = fakeDeps({ existingHashes: new Set([HASH]) });
  const result = await logic.handleUpload(VALID_BODY, deps);
  assert.deepEqual(result, { status: 409, body: { error: 'duplicate_photo' } });
  assert.equal(state.uploaded, null);
  assert.equal(state.saved, null);
});

test('handleUpload: an assignment that is not the caller\'s own is rejected before any hash work', async () => {
  const { deps, state } = fakeDeps({ owns: false });
  const result = await logic.handleUpload(VALID_BODY, deps);
  assert.deepEqual(result, { status: 403, body: { error: 'not_authorized' } });
  assert.equal(state.uploaded, null);
});

test('handleUpload: malformed body is rejected before any deps call', async () => {
  const { deps } = fakeDeps();
  const result = await logic.handleUpload({ not: 'valid' }, deps);
  assert.deepEqual(result, { status: 400, body: { error: 'invalid_request' } });
});

test('handleUpload: a storage failure surfaces as upload_failed, not a raw exception', async () => {
  const { deps } = fakeDeps({ failUpload: true });
  const result = await logic.handleUpload(VALID_BODY, deps);
  assert.deepEqual(result, { status: 500, body: { error: 'upload_failed' } });
});
